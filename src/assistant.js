// Asistente TurnIA: responde primero con reglas + base de conocimiento + datos del local.
// Solo si no encuentra respuesta y hay un proveedor configurado (ej. API de IA de DonWeb,
// compatible con OpenAI) hace UNA llamada corta, con contexto mínimo y caché.
const { all, getSetting } = require('./db');
const engine = require('./engine');
const T = require('./time');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ');
const money = n => '$' + Math.round(n).toLocaleString('es-AR');
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const cache = new Map();
let usage = { day: '', count: 0 };

function findServices(q) {
  const services = all('SELECT * FROM services WHERE active = 1');
  const words = q.split(' ').filter(w => w.length > 3);
  return services.filter(s => {
    const n = norm(s.name);
    return q.includes(n) || n.split(' ').filter(w => w.length > 3).some(w => words.some(x => x.startsWith(w.slice(0, 5))));
  }).slice(0, 4);
}

function ruleAnswer(question, { useKb = true } = {}) {
  const q = norm(question);
  const biz = getSetting('business', {});
  const out = [];
  const svcs = findServices(q);

  if (/hola|buenas|buen dia/.test(q) && q.length < 20)
    return { text: `¡Hola! Soy el asistente de ${biz.name}. Puedo contarte precios, duraciones, horarios, promociones y buscarte un turno.`, source: 'reglas' };

  if (svcs.length && /precio|cuanto|sale|cuesta|valor|presupuesto|dura|tiempo|demora|turno|disponib|reserv/.test(q) || svcs.length && q.split(' ').length <= 4) {
    for (const s of svcs) {
      const est = engine.estimate(engine.parseService(s), {});
      out.push(`• ${s.name}: ${money(s.price_min)}${s.price_max > s.price_min ? ' a ' + money(s.price_max) : ''}, ~${est.duration} min.` +
        (s.deposit_amount ? ` Seña ${money(s.deposit_amount)}.` : '') + (s.complex ? ' Requiere evaluación presencial.' : '') +
        (est.learned.average ? ` (Promedio real: ${est.learned.average} min sobre ${est.learned.records} turnos)` : ''));
    }
    if (/turno|disponib|reserv|cuando|hoy|manana/.test(q)) {
      const s = svcs[0];
      const r = engine.search({ groups: [{ estimates: [engine.estimate(engine.parseService(s), {})], pro: 'recommend' }], days: 7, limit: 3 });
      if (r.single.length) out.push(`Próximos horarios para ${s.name}: ` + r.single.slice(0, 3).map(o => `${DAYS[T.weekday(o.date)]} ${o.date.slice(8)}/${o.date.slice(5, 7)} ${o.start.slice(11)} con ${o.items[0].professional}`).join(' · ') + '.');
      else out.push(`No veo horarios libres para ${s.name} en los próximos 7 días; podés dejar una solicitud y te avisamos.`);
    }
    out.push('Los valores son estimados: el asistente de reserva calcula el presupuesto exacto según tu cabello o uñas.');
    return { text: out.join('\n'), source: 'datos del local', action: 'reservar' };
  }
  if (/horario|abren|cierran|atienden|abierto|dias/.test(q))
    return { text: `Atendemos ${biz.hours}. Los horarios reales disponibles los ves al reservar.`, source: 'datos del local' };
  if (/promo|descuento|oferta|beneficio/.test(q)) {
    const p = all('SELECT * FROM promotions WHERE active = 1 AND (end_date IS NULL OR end_date >= ?)', T.today());
    return { text: p.length ? 'Promociones vigentes:\n' + p.map(x => `• ${x.name}: ${x.description}`).join('\n') + '\nRegistrate con tu teléfono para acceder.' : 'Hoy no hay promociones vigentes.', source: 'datos del local' };
  }
  const pros = all('SELECT * FROM professionals WHERE active = 1');
  const pro = pros.find(p => q.includes(norm(p.name).split(' ')[0]));
  if (pro || /profesional|quien|estilista|manicur|colorista/.test(q)) {
    const list = pro ? [pro] : pros;
    return { text: list.map(p => `• ${p.name}: ${p.specialties}.`).join('\n'), source: 'datos del local' };
  }
  if (/telefono|whatsapp|contacto|instagram|mail/.test(q))
    return { text: `Tel: ${biz.phone} · WhatsApp: ${biz.whatsapp} · Instagram: ${biz.instagram}`, source: 'datos del local' };

  if (!useKb) return null;
  // Base de conocimiento cargada por el comercio.
  let best = null, score = 0;
  for (const k of all('SELECT * FROM knowledge')) {
    const keys = norm(k.keywords).split(/[ ,]+/).filter(Boolean);
    const s = keys.filter(w => q.includes(w)).length * 2 + norm(k.question).split(' ').filter(w => w.length > 3 && q.includes(w)).length;
    if (s > score) { score = s; best = k; }
  }
  if (best && score >= 2) return { text: best.answer, source: 'base de conocimiento' };
  return null;
}

function compactContext() {
  const biz = getSetting('business', {});
  const kb = all('SELECT question, answer FROM knowledge').map(k => `P: ${k.question} R: ${k.answer}`).join('\n');
  const svc = all('SELECT name, price_min, price_max, base_duration FROM services WHERE active = 1')
    .map(s => `${s.name} ${s.price_min}-${s.price_max} ${s.base_duration}min`).join('; ');
  return `Local: ${biz.name}. ${biz.address}. Horario: ${biz.hours}. Condiciones: ${biz.conditions}\nServicios: ${svc}\nConocimiento:\n${kb}`;
}

async function llmAnswer(question) {
  const cfg = getSetting('ai', {});
  const url = process.env.AI_API_URL, key = process.env.AI_API_KEY;
  if (!cfg.enabled || !url || !key) return null;
  const day = T.today();
  if (usage.day !== day) usage = { day, count: 0 };
  if (usage.count >= (cfg.daily_limit || 60)) return null;
  const k = norm(question).trim();
  if (cache.has(k)) return { ...cache.get(k), cached: true };
  usage.count++;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'default', max_tokens: cfg.max_tokens || 220, temperature: 0.2,
        messages: [
          { role: 'system', content: 'Sos el asistente de reservas de un local de belleza. Respondé en español rioplatense, breve (máx. 3 oraciones), SOLO con la información del contexto. Si no está en el contexto decí que lo consulten con el local. No hagas diagnósticos médicos. No inventes precios ni horarios.\n\n' + compactContext() },
          { role: 'user', content: String(question).slice(0, 400) },
        ],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    const r = { text, source: 'IA (contexto del local)' };
    cache.set(k, r);
    return r;
  } catch { return null; } finally { clearTimeout(to); }
}

async function answer(question) {
  const r = ruleAnswer(question);
  if (r) return r;
  const ai = await llmAnswer(question);
  if (ai) return ai;
  return { text: 'No tengo esa información cargada todavía. Podés reservar desde el botón "Reservar" o escribirnos por WhatsApp y te respondemos.', source: 'reglas', action: 'reservar' };
}

const aiStatus = () => ({ configured: !!(process.env.AI_API_URL && process.env.AI_API_KEY), ...getSetting('ai', {}), used_today: usage.day === T.today() ? usage.count : 0 });

const ruleAnswerOnly = async q => ruleAnswer(q, { useKb: false });

module.exports = { answer, aiStatus, ruleAnswerOnly };
