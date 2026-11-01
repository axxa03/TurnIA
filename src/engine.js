// Motor de estimación y disponibilidad de TurnIA.
const { all, get, getSetting } = require('./db');
const T = require('./time');

const ACTIVE = "('pendiente','confirmada','en_curso','reprogramacion')";
const STEP = 15;

function parseService(s) {
  if (!s) return s;
  return { ...s, questions: JSON.parse(s.questions || '[]') };
}
const getService = id => parseService(get('SELECT * FROM services WHERE id = ?', id));

// Duración y precio según respuestas a las preguntas dinámicas.
function estimate(service, answers = {}) {
  let duration = service.base_duration + (service.extra_time || 0);
  let pmin = service.price_min, pmax = service.price_max;
  const sig = [];
  const warnings = [];
  for (const q of service.questions) {
    const a = answers[q.id];
    if (a == null || a === '') continue;
    const vals = Array.isArray(a) ? a : [a];
    for (const v of vals) {
      const opt = (q.options || []).find(o => o.label === v);
      if (q.type === 'number' && q.per_unit_min) {
        const n = Math.max(0, Math.min(Number(v) || 0, 20));
        duration += n * q.per_unit_min; pmin += n * (q.per_unit_price || 0); pmax += n * (q.per_unit_price || 0);
        if (q.signature) sig.push(`${q.id}=${n > 5 ? '6+' : n}`);
        continue;
      }
      if (!opt) continue;
      duration += opt.add_min || 0; pmin += opt.add_price || 0; pmax += opt.add_price || 0;
      if (opt.warn) warnings.push(opt.warn);
      if (q.signature) sig.push(`${q.id}=${v}`);
    }
  }
  if (service.complex) warnings.push('Trabajo químico complejo: el presupuesto y la duración son estimativos y pueden requerir una evaluación presencial.');
  const signature = `${service.id}|${sig.sort().join('|')}`;
  return {
    service_id: service.id, name: service.name, category: service.category,
    duration, prep: service.prep_time || 0, cleanup: service.cleanup_time || 0,
    price_min: pmin, price_max: pmax, signature, warnings,
    deposit: service.deposit_amount || 0, learned: learned(service.id, signature, duration),
  };
}

// Aprendizaje de duraciones: promedio de duraciones reales registradas.
// Nunca reemplaza la duración configurada; se informa de forma transparente.
function learned(serviceId, signature, configured) {
  const minN = getSetting('learning_min_records', 3);
  let r = get('SELECT COUNT(*) n, AVG(actual_duration) avg FROM appointment_items WHERE signature = ? AND actual_duration > 0', signature);
  let scope = 'trabajos con características similares';
  if (!r.n || r.n < minN) {
    r = get('SELECT COUNT(*) n, AVG(actual_duration) avg FROM appointment_items WHERE service_id = ? AND actual_duration > 0', serviceId);
    scope = 'todos los trabajos de este servicio';
  }
  if (!r.n || r.n < minN) return { records: r.n || 0, average: null, used: configured, note: 'Sin historial suficiente: se usa la duración configurada.' };
  const avg = Math.round(r.avg);
  return { records: r.n, average: avg, scope, used: configured, diff: avg - configured,
    note: `Promedio real de ${r.n} registros (${scope}): ${avg} min.` };
}

function eligiblePros(serviceIds) {
  const pros = all('SELECT * FROM professionals WHERE active = 1');
  return pros.filter(p => p.all_services || serviceIds.every(sid =>
    get('SELECT 1 FROM professional_services WHERE professional_id = ? AND service_id = ?', p.id, sid)));
}

// Ventanas libres de un profesional en una fecha (horario - descansos - ausencias).
function freeWindows(proId, date) {
  const wd = T.weekday(date);
  let wins = all('SELECT start, end FROM schedules WHERE professional_id = ? AND weekday = ? ORDER BY start', proId, wd)
    .map(s => [T.toMin(s.start), T.toMin(s.end)]);
  const cuts = all('SELECT start, end FROM breaks WHERE professional_id = ? AND ((weekday = ? AND date IS NULL) OR date = ?)', proId, wd, date)
    .map(b => [T.toMin(b.start), T.toMin(b.end)]);
  for (const a of all('SELECT * FROM absences WHERE (professional_id = ? OR professional_id IS NULL) AND start_date <= ? AND end_date >= ?', proId, date, date)) {
    if (!a.start_time) return [];
    cuts.push([T.toMin(a.start_time), T.toMin(a.end_time)]);
  }
  for (const [cs, ce] of cuts) {
    const next = [];
    for (const [ws, we] of wins) {
      if (ce <= ws || cs >= we) { next.push([ws, we]); continue; }
      if (cs > ws) next.push([ws, cs]);
      if (ce < we) next.push([ce, we]);
    }
    wins = next;
  }
  return wins;
}

function inWindows(wins, s, e) { return wins.some(([ws, we]) => s >= ws && e <= we); }

// ¿Puede el profesional tomar el bloque [start,end)? Valida horario, capacidad y superposición.
function isFree(pro, start, end, excludeApptId = 0, cache) {
  const date = start.slice(0, 10);
  if (end.slice(0, 10) !== date) return false;
  const key = pro.id + date;
  const wins = cache ? (cache[key] ??= freeWindows(pro.id, date)) : freeWindows(pro.id, date);
  if (!inWindows(wins, T.toMin(start.slice(11)), T.toMin(end.slice(11)))) return false;
  const busy = all(`SELECT i.block_start s, i.block_end e FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id
    WHERE i.professional_id = ? AND a.status IN ${ACTIVE} AND a.id != ? AND i.block_start < ? AND i.block_end > ?`,
    pro.id, excludeApptId, end, start);
  if (!busy.length) return true;
  // Máxima concurrencia dentro del intervalo vs capacidad del profesional.
  const pts = [];
  for (const b of busy) { pts.push([b.s < start ? start : b.s, 1]); pts.push([b.e, -1]); }
  pts.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
  let c = 0, max = 0; for (const [, d] of pts) { c += d; max = Math.max(max, c); }
  return max < (pro.capacity || 1);
}

// Construye los ítems de un grupo de servicios realizados en secuencia por un profesional.
function planGroup(group, pro, t) {
  const items = []; let cur = t;
  for (const est of group.estimates) {
    const bs = cur, s = T.addMin(bs, est.prep), e = T.addMin(s, est.duration), be = T.addMin(e, est.cleanup);
    items.push({ service_id: est.service_id, service: est.name, professional_id: pro.id, professional: pro.name,
      block_start: bs, start_at: s, end_at: e, block_end: be, est_duration: est.duration,
      price_min: est.price_min, price_max: est.price_max, signature: est.signature });
    cur = be;
  }
  return items;
}
const groupLen = g => g.estimates.reduce((a, e) => a + e.prep + e.duration + e.cleanup, 0);
const groupFits = (items, cache, ex) => items.every(i => isFree({ id: i.professional_id, capacity: i._cap }, i.block_start, i.block_end, ex, cache));

function dayLoad(proId, date) {
  return get(`SELECT COALESCE(SUM((julianday(replace(i.block_end,' ','T')) - julianday(replace(i.block_start,' ','T')))*1440),0) m
    FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id
    WHERE i.professional_id = ? AND a.status IN ${ACTIVE} AND substr(i.block_start,1,10) = ?`, proId, date).m;
}

function timeOk(pref, hhmm) {
  const m = T.toMin(hhmm);
  if (pref === 'manana') return m < 13 * 60;
  if (pref === 'tarde') return m >= 13 * 60 && m < 17 * 60;
  if (pref === 'noche') return m >= 17 * 60;
  return true;
}

// groups: [{ category, estimates:[est], pro: 'any'|'recommend'|id }]
function search({ groups, dateFrom, days = 7, timePref = 'any', weekdays = null, excludeApptId = 0, limit = 40 }) {
  const horizon = getSetting('booking_horizon_days', 45);
  const now = T.nowLocal();
  const advance = Math.max(...groups.flatMap(g => g.estimates.map(e => (getService(e.service_id).min_advance_hours || 0))));
  const earliest = T.addMin(now, advance * 60);
  const maxDate = T.addDays(T.today(), horizon);
  const start = dateFrom && dateFrom > T.today() ? dateFrom : T.today();
  const cache = {};

  for (const g of groups) {
    let pros = eligiblePros(g.estimates.map(e => e.service_id));
    if (g.pro && !['any', 'recommend'].includes(g.pro)) pros = pros.filter(p => p.id === Number(g.pro));
    g.pros = pros; g.len = groupLen(g);
  }
  const results = { single: [], simultaneous: [], consecutive: [] };
  const mk = (g, pro, t) => planGroup(g, pro, t).map(i => ({ ...i, _cap: pro.capacity }));
  const pick = (g, date, t, avoid) => {
    let cands = g.pros.filter(p => p.id !== avoid).map(p => ({ p, items: mk(g, p, t) }))
      .filter(c => groupFits(c.items, cache, excludeApptId));
    if (!cands.length) return null;
    if (g.pro === 'recommend' || g.pro === 'any') cands.sort((a, b) => dayLoad(a.p.id, date) - dayLoad(b.p.id, date));
    return cands[0];
  };

  for (let d = 0; d < days; d++) {
    const date = T.addDays(start, d);
    if (date > maxDate) break;
    if (weekdays && weekdays.length && !weekdays.includes(T.weekday(date))) continue;
    for (let m = 7 * 60; m <= 22 * 60; m += STEP) {
      const t = `${date} ${T.fromMin(m)}`;
      if (t < earliest || !timeOk(timePref, T.fromMin(m))) continue;
      if (groups.length === 1) {
        const c = pick(groups[0], date, t);
        if (c) results.single.push({ type: 'simple', date, start: t, end: c.items.at(-1).block_end, items: clean(c.items), recommended: groups[0].pro === 'recommend' });
      } else {
        const [g1, g2] = groups;
        const a = pick(g1, date, t);
        if (a) {
          const b = pick(g2, date, t, a.p.id);
          if (b) results.simultaneous.push({ type: 'simultaneo', date, start: t, end: maxEnd(a.items, b.items), items: clean([...a.items, ...b.items]) });
          const b2 = pick(g2, date, T.addMin(t, g1.len));
          if (b2) results.consecutive.push({ type: 'consecutivo', date, start: t, end: b2.items.at(-1).block_end, items: clean([...a.items, ...b2.items]) });
        }
      }
    }
  }
  const thin = list => {
    // Máximo 8 opciones por día para mantener la lista legible.
    const per = {}; return list.filter(o => (per[o.date] = (per[o.date] || 0) + 1) <= 8).slice(0, limit);
  };
  return { single: thin(results.single), simultaneous: thin(results.simultaneous), consecutive: thin(results.consecutive) };
}
const clean = items => items.map(({ _cap, ...i }) => i);
const maxEnd = (a, b) => [a.at(-1).block_end, b.at(-1).block_end].sort().at(-1);

// Revalidación completa en backend (se llama dentro de la transacción).
function validateItems(items, excludeApptId = 0) {
  const now = T.nowLocal();
  const horizon = T.addDays(T.today(), getSetting('booking_horizon_days', 45));
  for (const i of items) {
    const svc = getService(i.service_id);
    const pro = get('SELECT * FROM professionals WHERE id = ? AND active = 1', i.professional_id);
    if (!svc || !pro) return `Servicio o profesional inválido.`;
    if (!pro.all_services && !get('SELECT 1 FROM professional_services WHERE professional_id = ? AND service_id = ?', pro.id, svc.id))
      return `${pro.name} no realiza ${svc.name}.`;
    if (i.block_start < T.addMin(now, (svc.min_advance_hours || 0) * 60) && !i._admin) return `${svc.name} requiere ${svc.min_advance_hours} h de anticipación.`;
    if (i.block_start.slice(0, 10) > horizon && !i._admin) return 'La fecha supera el horizonte máximo de reservas.';
    if (!isFree(pro, i.block_start, i.block_end, excludeApptId)) return `El horario de ${pro.name} (${i.block_start.slice(11)}) ya no está disponible.`;
  }
  return null;
}

module.exports = { estimate, search, validateItems, isFree, freeWindows, eligiblePros, getService, parseService, planGroup, ACTIVE };
