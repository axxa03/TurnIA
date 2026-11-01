// Página pública del comercio + asistente guiado de reserva.
let INFO = null;
const S = { step: 0 }; // estado del asistente de reserva

function header() {
  const b = INFO.business;
  return `<header class="top"><div class="wrap">
    <a class="brand" href="#/">${b.logo ? `<img src="${e(b.logo)}" class="logo" alt="">` : `<span class="logo">${e(b.name[0])}</span>`}<span>${e(b.name)}</span></a>
    <span class="grow"></span>
    <a class="btn ghost sm" href="#/mi-turno">Mi turno</a>
    <a class="btn ghost sm" href="#/cuenta">Mi cuenta</a>
    <a class="btn pri sm" href="#/reservar">Reservar</a>
  </div></header>`;
}
const footer = () => `<footer class="foot"><div class="wrap row between">
  <span>${e(INFO.business.name)} · Reservas con <b>TurnIA</b></span>
  <span>${e(INFO.business.demo_notice || '')} · <a href="/admin">Acceso comercio</a></span></div></footer>`;

/* ───────── Home ───────── */
function home() {
  const b = INFO.business;
  const cat = S.homeCat || 'peluqueria';
  const svcs = INFO.services.filter(s => s.category === cat);
  const subs = [...new Set(svcs.map(s => s.subcategory))];
  return header() + `
  <div class="hero"><div class="wrap">
    <span class="badge">Reservas online · respuesta inmediata</span>
    <h1 style="margin-top:12px">${e(b.tagline || b.name)}</h1>
    <p>${e(b.description)}</p>
    <div class="row" style="margin-top:18px"><a class="btn pri big" href="#/reservar">Reservar turno</a>
    <a class="btn big" href="https://wa.me/${e(b.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a></div>
    <p class="small" style="margin-top:14px">📍 ${e(b.address)} · 🕘 ${e(b.hours)}</p>
  </div></div>
  <div class="wrap">
  ${INFO.promotions.length ? `<section><div class="grid g3">${INFO.promotions.map(p => `<div class="card promo"><h3>🎁 ${e(p.name)}</h3><div class="muted">${e(p.description)}</div>
     <div class="small" style="margin-top:8px;opacity:.85">${INFO.promos_require_registration ? 'Exclusiva clientes registrados. ' : ''}${p.end_date ? 'Hasta ' + fdate(p.end_date) : ''}</div></div>`).join('')}</div></section>` : ''}
  <section id="servicios"><div class="sec-h"><h2>Servicios y precios</h2><span class="small muted">Precios estimados; el asistente calcula tu presupuesto</span></div>
    <div class="tabs">${Object.entries(CAT).map(([k, v]) => `<button class="chip ${k === cat ? 'on' : ''}" onclick="S.homeCat='${k}';render()">${v}</button>`).join('')}</div>
    ${subs.map(sub => `<h3 class="muted" style="margin:16px 0 8px">${e(sub)}</h3><div class="grid g3">${svcs.filter(s => s.subcategory === sub).map(s => `
      <div class="card svc"><div class="row between"><b>${e(s.name)}</b>${s.complex ? '<span class="badge st-pendiente">Evaluación</span>' : ''}</div>
      <div class="small muted">${e(s.description)}</div>
      <div class="row between" style="margin-top:auto"><span class="price">${range(s.price_min, s.price_max)}</span><span class="small muted">~${hm(s.duration)}</span></div>
      ${s.deposit_amount ? `<div class="small muted">Seña ${money(s.deposit_amount)}</div>` : ''}
      <a class="btn sm" href="#/reservar" onclick="S.preset=${s.id}">Reservar</a></div>`).join('')}</div>`).join('')}
  </section>
  <section><h2>Nuestro equipo</h2><div class="grid g2">${INFO.professionals.map(p => `
    <div class="card pro">${avatar(p, 56)}<div><b>${e(p.name)}</b><div class="small" style="color:var(--p)">${e(p.specialties)}</div>
    <div class="small muted">${e(p.bio)}</div><div class="small muted" style="margin-top:4px">${schedSummary(p.schedule)}</div></div></div>`).join('')}</div></section>
  ${INFO.reviews.length ? `<section><h2>Opiniones</h2><div class="grid g3">${INFO.reviews.map(r => `<div class="card"><div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
    <p>${e(r.comment)}</p>${(r.photos || []).map(p => `<img src="${p}" style="width:100%;border-radius:10px;margin-bottom:6px" alt="Resultado">`).join('')}
    <div class="small muted">${e(r.first_name)} · ${e(r.service)} con ${e(r.professional)}</div></div>`).join('')}</div></section>` : ''}
  <section><div class="card grid g3">
    <div><h3>Contacto</h3><div class="small">📞 ${e(b.phone)}<br>💬 WhatsApp: ${e(b.whatsapp)}<br>📸 ${e(b.instagram)}<br>✉️ ${e(b.email)}</div></div>
    <div><h3>Dirección</h3><div class="small">${e(b.address)}<br>${e(b.hours)}</div></div>
    <div><h3>Condiciones</h3><div class="small">${e(b.conditions)}</div></div></div></section>
  </div>` + footer();
}
function schedSummary(sch) {
  const by = {}; sch.forEach(s => (by[`${s.start}–${s.end}`] ??= []).push(DAYS[s.weekday]));
  return Object.entries(by).map(([h, d]) => `${d.join(', ')} ${h}`).join(' · ');
}

/* ───────── Asistente de reserva ───────── */
const STEPS = ['datos', 'categoria', 'servicios', 'preguntas', 'estimacion', 'preferencias', 'profesional', 'horarios', 'resumen'];
function resetWizard() {
  Object.assign(S, { step: 0, client: S.client || { first_name: '', last_name: '', phone: '', email: '' }, known: S.known || null, cats: [], services: [], answers: {},
    est: null, prefs: { dateFrom: '', timePref: 'any', flexibility: 'media', urgency: 'media', event_date: '' }, pros: {}, avail: null, mode: null, pick: null, notes: '', done: null });
  if (S.preset) { const s = INFO.services.find(x => x.id === S.preset); if (s) { S.cats = [s.category]; S.services = [s.id]; } S.preset = null; }
}
const bubble = html => `<div class="bubble">${html}</div>`;
const nav = (next = 'Continuar', can = true, extra = '') => `<div class="nav">${S.step > 0 ? `<button class="btn" onclick="go(-1)">← Volver</button>` : '<span></span>'}
  <span class="row">${extra}<button class="btn pri" ${can ? '' : 'disabled'} onclick="next()">${next}</button></span></div>`;

function wizard() {
  if (S.done) return header() + `<div class="wrap wiz">${doneView()}</div>`;
  const name = STEPS[S.step];
  const body = ({ datos: stDatos, categoria: stCat, servicios: stSvc, preguntas: stQ, estimacion: stEst, preferencias: stPref, profesional: stPro, horarios: stSlots, resumen: stSum })[name]();
  return header() + `<div class="wrap wiz"><div class="steps">${STEPS.map((_, i) => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('')}</div>
    <div class="card">${body}</div><p class="small muted" style="text-align:center;margin-top:12px">Asistente TurnIA · basado en reglas y datos reales del local</p></div>`;
}
function go(d) { S.step = Math.max(0, S.step + d); if (STEPS[S.step] === 'preguntas' && !qServices().length && d < 0) S.step--; render(); scrollTo(0, 0); }
async function next() {
  const name = STEPS[S.step];
  try {
    if (name === 'datos') {
      const c = S.client;
      if (!c.first_name.trim() || !c.last_name.trim()) return toast('Completá nombre y apellido');
      if (c.phone.replace(/\D/g, '').length < 8) return toast('Ingresá un teléfono válido con código de área');
      if (S.register) {
        if (!c.email || !S.password) return toast('Para registrarte completá email y contraseña');
        const r = await api('/api/public/register', { body: { ...c, password: S.password } });
        localStorage.setItem('turnia_client', r.token); S.register = false; toast('¡Registro listo! Ya accedés a las promociones.');
      }
    }
    if (name === 'categoria' && !S.cats.length) return toast('Elegí una opción');
    if (name === 'servicios') {
      if (!S.services.length) return toast('Elegí al menos un servicio');
      for (const c of S.cats) if (!S.services.some(id => svc(id).category === c)) return toast(`Elegí un servicio de ${CAT[c]}`);
      if (!qServices().length) S.step++;
    }
    if (name === 'preguntas' || (name === 'servicios' && !qServices().length)) {
      S.est = await api('/api/public/estimate', { body: { services: payloadServices() } });
    }
    if (name === 'profesional') { S.avail = null; S.pick = null; S.step++; render(); return loadSlots(); }
    if (name === 'horarios' && !S.pick) return toast('Elegí un horario');
    if (name === 'resumen') return book();
    S.step++; render(); scrollTo(0, 0);
  } catch (err) { toast(err.message); }
}
const svc = id => INFO.services.find(s => s.id === id);
const qServices = () => S.services.map(svc).filter(s => s.questions.length);
const payloadServices = () => S.services.map(id => ({ id, answers: S.answers[id] || {} }));

function stDatos() {
  const c = S.client;
  return bubble('¡Hola! Soy el asistente de reservas de <b>' + e(INFO.business.name) + '</b>. Para empezar, ¿cómo te llamás?') + `
  <div class="grid g2"><div><label>Nombre</label><input value="${e(c.first_name)}" oninput="S.client.first_name=this.value" autocomplete="given-name"></div>
  <div><label>Apellido</label><input value="${e(c.last_name)}" oninput="S.client.last_name=this.value" autocomplete="family-name"></div></div>
  <label>Teléfono (WhatsApp)</label><input value="${e(c.phone)}" inputmode="tel" placeholder="11 2345 6789" oninput="S.client.phone=this.value" onblur="lookup()" autocomplete="tel">
  <div id="known">${knownView()}</div>
  <label class="row" style="font-weight:500;color:var(--ink)"><input type="checkbox" style="width:auto" ${S.register ? 'checked' : ''} onchange="S.register=this.checked;render()"> Quiero registrarme para acceder a promociones (opcional)</label>
  ${S.register ? `<div class="grid g2"><div><label>Email</label><input type="email" value="${e(c.email)}" oninput="S.client.email=this.value"></div>
    <div><label>Contraseña</label><input type="password" oninput="S.password=this.value" placeholder="mín. 6 caracteres"></div></div>` : ''}
  <p class="small muted">No necesitás crear una cuenta para reservar. Tu teléfono nos permite recuperar tu historial.</p>` + nav();
}
function knownView() {
  const k = S.known; if (!k) return '';
  if (!k.exists) return `<div class="note info" style="margin-top:10px">Es tu primera vez con nosotros. ¡Bienvenida/o!</div>`;
  return `<div class="note ok" style="margin-top:10px">¡Hola de nuevo, <b>${e(k.first_name)}</b>! ${k.visits ? `Llevás ${k.visits} visita(s).` : ''}
    ${k.last ? `Tu último servicio fue ${e(k.last.service)} con ${e(k.last.professional)}.` : ''} ${k.registered ? '' : ''}</div>`;
}
async function lookup() {
  const p = S.client.phone.replace(/\D/g, ''); if (p.length < 8) return;
  try {
    S.known = await api('/api/public/lookup', { body: { phone: p } });
    if (S.known.exists) { if (!S.client.first_name) S.client.first_name = S.known.first_name; if (!S.client.last_name) S.client.last_name = S.known.last_name; render(); }
    else $('#known').innerHTML = knownView();
  } catch { }
}
function stCat() {
  const opts = [['peluqueria', '✂️ Peluquería', 'Cortes, color, tratamientos, peinados'], ['manicuria', '💅 Manicuría', 'Manos, pies, extensiones, nail art'], ['ambos', '✨ Ambos', 'Combiná peluquería y uñas en una visita']];
  const cur = S.cats.length === 2 ? 'ambos' : S.cats[0];
  return bubble(`Genial, <b>${e(S.client.first_name)}</b>. ¿Qué te querés hacer?`) + `<div class="grid g3">${opts.map(([k, t, d]) =>
    `<button class="choice ${cur === k ? 'on' : ''}" onclick="S.cats=${k === 'ambos' ? "['peluqueria','manicuria']" : `['${k}']`};S.services=S.services.filter(id=>S.cats.includes(svc(id).category));render()"><b>${t}</b><div class="small muted">${d}</div></button>`).join('')}</div>` + nav('Continuar', S.cats.length > 0);
}
function stSvc() {
  return bubble('¿Qué servicio necesitás? Podés elegir más de uno.' + (S.cats.length === 2 ? ' Elegí al menos uno de cada categoría.' : '')) +
    S.cats.map(c => `<h3 style="margin-top:14px">${CAT[c]}</h3><div class="opts">${INFO.services.filter(s => s.category === c).map(s =>
      `<button class="chip ${S.services.includes(s.id) ? 'on' : ''}" onclick="toggleSvc(${s.id})">${e(s.name)} <span class="small muted">${money(s.price_min)}</span></button>`).join('')}</div>`).join('') +
    `<div class="small muted" style="margin-top:12px">${S.services.map(id => svc(id).description).join(' · ')}</div>` + nav('Continuar', S.services.length > 0);
}
function toggleSvc(id) { S.services = S.services.includes(id) ? S.services.filter(x => x !== id) : [...S.services, id]; render(); }
function stQ() {
  return bubble('Contame un poco más para estimar tiempo y presupuesto. Todas las preguntas son rápidas.') + qServices().map(s => {
    const a = S.answers[s.id] ??= {};
    return `<h3 style="margin-top:16px">${e(s.name)}</h3>${s.questions.map(q => `<label>${e(q.label)}</label>${
      q.type === 'select' ? `<div class="opts">${q.options.map(o => `<button class="chip ${a[q.id] === o.label ? 'on' : ''}" onclick="S.answers[${s.id}]['${q.id}']=${JSON.stringify(o.label).replace(/"/g, '&quot;')};render()">${e(o.label)}</button>`).join('')}</div>`
      : q.type === 'number' ? `<input type="number" min="0" max="20" value="${e(a[q.id] ?? '')}" oninput="S.answers[${s.id}]['${q.id}']=this.value" style="max-width:140px">`
      : `<input value="${e(a[q.id] ?? '')}" oninput="S.answers[${s.id}]['${q.id}']=this.value">`}`).join('')}
      ${s.requirements ? `<div class="note" style="margin-top:10px">${e(s.requirements)}</div>` : ''}`;
  }).join('') + nav('Calcular presupuesto');
}
function stEst() {
  const est = S.est || [];
  const tmin = est.reduce((a, x) => a + x.price_min, 0), tmax = est.reduce((a, x) => a + x.price_max, 0);
  const warns = [...new Set(est.flatMap(x => x.warnings))];
  return bubble('Esta es mi estimación según lo que me contaste:') + `<table class="sum">${est.map(x => `<tr><td><b>${e(x.name)}</b><div class="small muted">Duración estimada ${hm(x.duration)}
    ${x.learned.average ? ` · <span title="${e(x.learned.note)}">Promedio real: ${hm(x.learned.average)} (${x.learned.records} registros)</span>` : ` · ${e(x.learned.note)}`}</div></td>
    <td style="text-align:right;white-space:nowrap">${range(x.price_min, x.price_max)}</td></tr>`).join('')}
    <tr><td class="total">Total estimado</td><td class="total" style="text-align:right">${range(tmin, tmax)}</td></tr></table>
    ${est.some(x => x.deposit) ? `<div class="note info">Requiere seña de ${money(est.reduce((a, x) => a + x.deposit, 0))}. Se descuenta del total.</div>` : ''}
    ${warns.map(w => `<div class="note" style="margin-top:8px">⚠️ ${e(w)}</div>`).join('')}` + nav('Elegir horario');
}
function stPref() {
  const p = S.prefs; const today = INFO.now.slice(0, 10);
  const ch = (k, v, l) => `<button class="chip ${p[k] === v ? 'on' : ''}" onclick="S.prefs.${k}='${v}';render()">${l}</button>`;
  return bubble('¿Cuándo te queda mejor?') + `
    <label>¿Desde qué fecha?</label><input type="date" min="${today}" value="${p.dateFrom || today}" onchange="S.prefs.dateFrom=this.value" style="max-width:220px">
    <label>Franja horaria</label><div class="opts">${ch('timePref', 'any', 'Cualquiera')}${ch('timePref', 'manana', 'Mañana')}${ch('timePref', 'tarde', 'Tarde')}${ch('timePref', 'noche', 'Después de las 17')}</div>
    <label>Flexibilidad</label><div class="opts">${ch('flexibility', 'alta', 'Muy flexible')}${ch('flexibility', 'media', 'Algo flexible')}${ch('flexibility', 'baja', 'Solo esa franja')}</div>
    <label>Urgencia</label><div class="opts">${ch('urgency', 'baja', 'Sin apuro')}${ch('urgency', 'media', 'Esta semana')}${ch('urgency', 'alta', 'Lo antes posible')}</div>
    <label>¿Es para un evento? (opcional)</label><input type="date" min="${today}" value="${p.event_date}" onchange="S.prefs.event_date=this.value" style="max-width:220px">` + nav();
}
function stPro() {
  return bubble('¿Tenés preferencia de profesional?') + S.cats.map(c => {
    const ids = S.services.filter(id => svc(id).category === c);
    const pros = INFO.professionals.filter(p => ids.every(id => p.services.includes(id)));
    const cur = S.pros[c] || 'recommend';
    return `<h3 style="margin-top:14px">${CAT[c]}</h3><div class="grid g3">
      <button class="choice ${cur === 'recommend' ? 'on' : ''}" onclick="S.pros['${c}']='recommend';render()"><b>✨ Recomendación TurnIA</b><div class="small muted">La profesional con mejor disponibilidad para ese horario</div></button>
      <button class="choice ${cur === 'any' ? 'on' : ''}" onclick="S.pros['${c}']='any';render()"><b>Cualquiera</b><div class="small muted">Me da igual, quiero el primer turno</div></button>
      ${pros.map(p => `<button class="choice ${String(cur) === String(p.id) ? 'on' : ''}" onclick="S.pros['${c}']=${p.id};render()"><div class="row">${avatar(p, 36)}<div><b>${e(p.name)}</b><div class="small muted">${e(p.specialties)}</div></div></div></button>`).join('')}
      </div>${!pros.length ? '<div class="note bad">Ningún profesional realiza todos estos servicios juntos. Volvé y elegí menos servicios.</div>' : ''}`;
  }).join('') + nav('Buscar horarios');
}
async function loadSlots() {
  try {
    S.avail = await api('/api/public/availability', { body: { services: payloadServices(), pros: S.pros, dateFrom: S.prefs.dateFrom, timePref: S.prefs.timePref, days: S.prefs.urgency === 'alta' ? 5 : 10 } });
    S.mode = S.avail.single.length ? 'single' : S.avail.simultaneous.length ? 'simultaneous' : 'consecutive';
  } catch (err) { S.avail = { error: err.message, single: [], simultaneous: [], consecutive: [] }; }
  render();
}
function stSlots() {
  if (!S.avail) return bubble('Buscando disponibilidad real en la agenda…') + '<p class="muted">Un momento…</p>';
  if (S.avail.error) return `<div class="note bad">${e(S.avail.error)}</div>` + nav('Continuar', false);
  const two = S.cats.length === 2;
  const list = S.avail[S.mode] || [];
  const tabs = two ? `<div class="tabs"><button class="chip ${S.mode === 'simultaneous' ? 'on' : ''}" onclick="S.mode='simultaneous';S.pick=null;render()">Al mismo tiempo (${S.avail.simultaneous.length})</button>
    <button class="chip ${S.mode === 'consecutive' ? 'on' : ''}" onclick="S.mode='consecutive';S.pick=null;render()">Uno después del otro (${S.avail.consecutive.length})</button></div>
    <p class="small muted">${S.mode === 'simultaneous' ? 'Dos profesionales te atienden en paralelo: terminás antes.' : 'Primero un servicio y a continuación el otro.'}</p>` : '';
  if (!S.avail.single.length && !S.avail.simultaneous.length && !S.avail.consecutive.length) return noSlots();
  const byDate = {}; list.forEach((o, i) => (byDate[o.date] ??= []).push([o, i]));
  return bubble(`Encontré estos horarios disponibles${two ? ' para ambos servicios' : ''}:`) + tabs +
    (list.length ? Object.entries(byDate).map(([d, os]) => `<h3 style="margin:14px 0 8px">${fdate(d)}</h3><div class="slots">${os.map(([o, i]) =>
      `<button class="slot ${S.pick === i ? 'on' : ''}" onclick="S.pick=${i};render()">${o.start.slice(11)}<small>${[...new Set(o.items.map(x => x.professional.split(' ')[0]))].join(' + ')}</small></button>`).join('')}</div>`).join('')
      : '<div class="note">No hay opciones en esta modalidad. Probá la otra pestaña.</div>') +
    `<p class="small" style="margin-top:14px">¿Ninguno te sirve? <a href="javascript:void 0" onclick="S.waitlist=true;render()">Dejar una solicitud en lista de espera</a></p>` +
    (S.waitlist ? waitForm() : '') + nav('Ver resumen', S.pick != null);
}
function noSlots() {
  return `<div class="note">No encontré horarios con esas preferencias. Podés cambiar la fecha o franja, o dejar una solicitud y el local te contacta cuando se libere un lugar.</div>` + waitForm() + nav('Continuar', false);
}
function waitForm() {
  return `<div class="card" style="margin-top:14px;background:var(--bg)"><h3>Lista de espera</h3>
    <label>¿Qué días y horarios te sirven?</label><input id="wpref" placeholder="Ej: martes o jueves después de las 17">
    <label class="row" style="font-weight:500;color:var(--ink)"><input id="walt" type="checkbox" style="width:auto" checked> Acepto horarios alternativos</label>
    <button class="btn pri" style="margin-top:10px" onclick="sendRequest()">Enviar solicitud</button></div>`;
}
async function sendRequest() {
  try {
    const proIds = Object.values(S.pros).filter(v => !isNaN(v));
    await api('/api/public/request', { body: { client: S.client, services: payloadServices(), preference: $('#wpref').value || S.prefs.timePref, flexibility: S.prefs.flexibility,
      urgency: S.prefs.urgency, event_date: S.prefs.event_date || null, professional_id: proIds[0] || null, accepts_alternatives: $('#walt').checked } });
    S.done = { request: true }; render();
  } catch (err) { toast(err.message); }
}
function stSum() {
  const o = S.avail[S.mode][S.pick]; const est = S.est;
  const tmin = est.reduce((a, x) => a + x.price_min, 0), tmax = est.reduce((a, x) => a + x.price_max, 0), dep = est.reduce((a, x) => a + x.deposit, 0);
  const svcs = S.services.map(svc);
  return bubble('¡Último paso! Revisá tu reserva:') + `<table class="sum">
    <tr><td class="muted">Cliente</td><td>${e(S.client.first_name)} ${e(S.client.last_name)} · ${e(S.client.phone)}</td></tr>
    <tr><td class="muted">Fecha</td><td><b>${fdt(o.start)}</b></td></tr>
    ${o.items.map(i => `<tr><td class="muted">${e(i.service)}</td><td>${i.start_at.slice(11)}–${i.end_at.slice(11)} con <b>${e(i.professional)}</b></td></tr>`).join('')}
    <tr><td class="muted">Modalidad</td><td>${o.type === 'simultaneo' ? 'Simultánea' : o.type === 'consecutivo' ? 'Consecutiva' : 'Simple'} · duración total ${hm((new Date(o.end.replace(' ', 'T')) - new Date(o.start.replace(' ', 'T'))) / 60000)}</td></tr>
    <tr><td class="muted">Precio estimado</td><td class="total">${range(tmin, tmax)}</td></tr>
    ${dep ? `<tr><td class="muted">Seña</td><td>${money(dep)} — ${e(svcs.find(s => s.deposit_amount)?.deposit_terms || '')}</td></tr>` : ''}
  </table>
  <div class="note info" style="margin-top:10px"><b>Condiciones:</b> ${e(INFO.business.conditions)} Cancelación sin cargo hasta ${Math.max(...svcs.map(s => s.cancel_hours))} h antes.
    ${svcs.map(s => s.late_cancel_terms).filter(Boolean).map(e).join(' ')}</div>
  <label>¿Algo que debamos saber? (opcional)</label><textarea rows="2" oninput="S.notes=this.value" placeholder="Alergias, referencias, preferencias…">${e(S.notes)}</textarea>` + nav('Confirmar reserva');
}
async function book() {
  const o = S.avail[S.mode][S.pick];
  const btn = document.querySelector('.nav .btn.pri'); if (btn) { btn.disabled = true; btn.textContent = 'Confirmando…'; }
  try {
    const prefs = `Franja: ${S.prefs.timePref}, flexibilidad ${S.prefs.flexibility}, urgencia ${S.prefs.urgency}${S.prefs.event_date ? ', evento ' + S.prefs.event_date : ''}`;
    S.done = await api('/api/public/book', { body: { client: { ...S.client, preferences: prefs }, services: payloadServices(), choice: o.choice, mode: o.type, notes: S.notes } });
    localStorage.setItem('turnia_last', JSON.stringify({ code: S.done.code, phone: S.client.phone }));
    render(); scrollTo(0, 0);
  } catch (err) {
    toast(err.message, 5000);
    if (err.status === 409) { S.step = STEPS.indexOf('horarios'); S.pick = null; S.avail = null; render(); loadSlots(); }
    else if (btn) { btn.disabled = false; btn.textContent = 'Confirmar reserva'; }
  }
}
function doneView() {
  if (S.done.request) return `<div class="card" style="text-align:center"><h2>📝 Solicitud registrada</h2><p class="muted">El local revisará la lista de espera y te contactará por WhatsApp cuando haya un lugar compatible.</p><a class="btn pri" href="#/" onclick="S.done=null">Volver al inicio</a></div>`;
  const a = S.done, b = INFO.business;
  const link = `${location.origin}/#/mi-turno?code=${a.code}&phone=${a.phone}`;
  const msg = `Hola! Reservé un turno en ${b.name}: ${a.items.map(i => i.service).join(' + ')} el ${fdt(a.start_at)}. Código ${a.code}`;
  return `<div class="card" style="text-align:center"><div style="font-size:44px">🎉</div><h2>¡Reserva ${a.status === 'confirmada' ? 'confirmada' : 'registrada'}!</h2>
    <p>Código <b style="font-size:20px;letter-spacing:2px">${e(a.code)}</b></p>${badge(a.status)}
    ${a.status === 'pendiente' ? '<div class="note" style="margin-top:10px">Por inasistencias previas, el local confirmará tu turno al recibir la seña.</div>' : ''}
    <p style="margin-top:12px"><b>${fdt(a.start_at)}</b><br>${a.items.map(i => `${e(i.service)} con ${e(i.professional)} (${i.start_at.slice(11)})`).join('<br>')}</p>
    <p>Total estimado ${range(a.price_min - a.discount, a.price_max - a.discount)}${a.discount ? ` <span class="badge">Promo ${e(a.promo)}: -${money(a.discount)}</span>` : ''}</p>
    ${a.deposit_required ? `<div class="note info">Seña pendiente: ${money(a.deposit_required)}. Coordiná el pago con el local.</div>` : ''}
    <div class="row" style="justify-content:center;margin-top:14px"><a class="btn pri" href="${link.replace(location.origin, '')}" onclick="S.done=null">Ver / gestionar mi turno</a>
    <a class="btn" target="_blank" rel="noopener" href="https://wa.me/${e(b.whatsapp)}?text=${encodeURIComponent(msg)}">Avisar por WhatsApp</a>
    <button class="btn" onclick="copy('${link}')">Copiar link</button></div></div>`;
}

/* ───────── Mi turno (por código + teléfono) ───────── */
async function myTurn() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const last = JSON.parse(localStorage.getItem('turnia_last') || 'null');
  const code = q.get('code') || last?.code || '', phone = q.get('phone') || last?.phone || '';
  let body = `<div class="card"><h2>Mi turno</h2><p class="muted">Consultá, cancelá, pedí un cambio u opiná sobre tu servicio.</p>
    <div class="grid g2"><div><label>Código</label><input id="mc" value="${e(code)}"></div><div><label>Teléfono</label><input id="mp" value="${e(phone)}"></div></div>
    <button class="btn pri" style="margin-top:12px" onclick="location.hash='#/mi-turno?code='+$('#mc').value.trim()+'&phone='+$('#mp').value.trim()">Buscar</button></div>`;
  if (code && phone) {
    try { const a = await api(`/api/public/appointment/${encodeURIComponent(code)}?phone=${encodeURIComponent(phone)}`); body += turnCard(a, phone); }
    catch (err) { body += `<div class="note bad" style="margin-top:12px">${e(err.message)}</div>`; }
  }
  $('#app').innerHTML = header() + `<div class="wrap wiz">${body}</div>` + footer();
}
function turnCard(a, phone) {
  const active = ['confirmada', 'pendiente'].includes(a.status);
  return `<div class="card" style="margin-top:14px"><div class="row between"><h3>Turno ${e(a.code)}</h3>${badge(a.status)}</div>
    <p><b>${fdt(a.start_at)}</b><br>${a.items.map(i => `${e(i.service)} con ${e(i.professional)} · ${i.start_at.slice(11)}–${i.end_at.slice(11)}`).join('<br>')}</p>
    <p>Total estimado ${range(a.price_min - a.discount, a.price_max - a.discount)} ${a.deposit_required ? `· Seña ${money(a.deposit_required)} (${e(a.deposit_status)})` : ''}</p>
    ${active ? `<div class="note info">Cancelación sin cargo hasta ${a.cancel_hours} h antes del turno.</div>
      <div class="row" style="margin-top:12px"><button class="btn" onclick="reqChange('${a.code}','${e(phone)}')">Pedir cambio de horario</button>
      <button class="btn bad" onclick="cancelTurn('${a.code}','${e(phone)}')">Cancelar turno</button></div>` : ''}
    ${a.status === 'finalizada' && !a.review ? reviewForm(a.code, phone) : ''}
    ${a.review ? `<div class="note ok" style="margin-top:10px">Gracias por tu opinión (${'★'.repeat(a.review.rating)}). Está ${a.review.status === 'aprobada' ? 'aprobada' : 'en revisión'}.</div>` : ''}</div>`;
}
async function cancelTurn(code, phone) {
  const reason = prompt('¿Querés contarnos el motivo? (opcional)'); if (reason === null) return;
  try { const r = await api(`/api/public/appointment/${code}/cancel`, { body: { phone, reason } });
    toast(r.late ? 'Turno cancelado fuera de término. Revisá las condiciones de seña.' : 'Turno cancelado. ¡Gracias por avisar!'); myTurn(); } catch (err) { toast(err.message); }
}
async function reqChange(code, phone) {
  const note = prompt('¿Qué día/horario te queda mejor?'); if (!note) return;
  try { await api(`/api/public/appointment/${code}/reschedule`, { body: { phone, note } }); toast('Solicitud enviada. El local te contactará.'); myTurn(); } catch (err) { toast(err.message); }
}
function reviewForm(code, phone) {
  return `<div class="card" style="margin-top:12px;background:var(--bg)"><h3>¿Cómo te fue?</h3>
    <div class="opts" id="rstars">${[1, 2, 3, 4, 5].map(n => `<button class="chip" onclick="S.rating=${n};document.querySelectorAll('#rstars .chip').forEach((c,i)=>c.classList.toggle('on',i<${n}))">★ ${n}</button>`).join('')}</div>
    <label>Comentario</label><textarea id="rc" rows="2"></textarea>
    <label>Fotos del resultado (opcional, máx. 3)</label><input type="file" id="rf" accept="image/*" multiple>
    <label class="row" style="font-weight:500;color:var(--ink)"><input type="checkbox" id="rconsent" style="width:auto"> Autorizo a publicar mis fotos en la página del local</label>
    <p class="small muted">Tu opinión es privada hasta que el local la revise.</p>
    <button class="btn pri" onclick="sendReview('${code}','${phone}')">Enviar opinión</button></div>`;
}
async function sendReview(code, phone) {
  const files = [...$('#rf').files].slice(0, 3);
  const photos = await Promise.all(files.map(shrink));
  try { await api(`/api/public/appointment/${code}/review`, { body: { phone, rating: S.rating || 5, comment: $('#rc').value, photos, consent: $('#rconsent').checked } }); toast('¡Gracias por tu opinión!'); myTurn(); }
  catch (err) { toast(err.message); }
}
function shrink(file) {
  return new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); const k = Math.min(1, 900 / Math.max(img.width, img.height));
    c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .75)); }; img.src = URL.createObjectURL(file); });
}

/* ───────── Mi cuenta (clientes registrados) ───────── */
async function account() {
  let body;
  if (!localStorage.getItem('turnia_client')) {
    body = `<div class="card"><h2>Mi cuenta</h2><p class="muted">Ingresá con tu teléfono y contraseña. Si no tenés cuenta, podés registrarte al reservar (es opcional).</p>
      <label>Teléfono</label><input id="lp" inputmode="tel"><label>Contraseña</label><input id="lw" type="password">
      <button class="btn pri" style="margin-top:12px" onclick="clientLogin()">Ingresar</button></div>`;
  } else {
    try {
      const me = await api('/api/public/me');
      body = `<div class="card"><div class="row between"><h2>Hola, ${e(me.client.first_name)}</h2><button class="btn sm" onclick="localStorage.removeItem('turnia_client');account()">Salir</button></div>
        <p class="muted">${me.stats.done || 0} visitas · ${me.stats.cancels || 0} cancelaciones</p><a class="btn pri" href="#/reservar">Nueva reserva</a></div>` +
        me.appointments.map(a => turnCard(a, me.client.phone)).join('');
      S.client = { ...S.client, first_name: me.client.first_name, last_name: me.client.last_name, phone: me.client.phone, email: me.client.email || '' };
    } catch { localStorage.removeItem('turnia_client'); return account(); }
  }
  $('#app').innerHTML = header() + `<div class="wrap wiz">${body}</div>` + footer();
}
async function clientLogin() {
  try { const r = await api('/api/public/login', { body: { phone: $('#lp').value, password: $('#lw').value } }); localStorage.setItem('turnia_client', r.token); account(); }
  catch (err) { toast(err.message); }
}

/* ───────── Chat del asistente ───────── */
const Chat = {
  toggle() { $('#chat').classList.toggle('hide'); if (!$('#chatLog').children.length) this.add('bot', `¡Hola! Preguntame por precios, duraciones, horarios, promociones o profesionales de ${INFO.business.name}.`); $('#chatIn').focus(); },
  add(who, text, src) { const d = document.createElement('div'); d.className = who; d.textContent = text; $('#chatLog').appendChild(d);
    if (src) { const s = document.createElement('div'); s.className = 'src'; s.textContent = 'Fuente: ' + src; $('#chatLog').appendChild(s); } $('#chatLog').scrollTop = 1e6; },
  async send(ev) { ev.preventDefault(); const q = $('#chatIn').value.trim(); if (!q) return; $('#chatIn').value = ''; this.add('me', q);
    try { const r = await api('/api/public/assistant', { body: { question: q } }); this.add('bot', r.text, r.source); } catch (err) { this.add('bot', err.message); } },
};
$('#chatBtn').onclick = () => Chat.toggle();

/* ───────── Router ───────── */
function render() {
  const h = location.hash.split('?')[0];
  if (h === '#/reservar') { $('#app').innerHTML = wizard(); return; }
  if (h === '#/mi-turno') return myTurn();
  if (h === '#/cuenta') return account();
  $('#app').innerHTML = home();
}
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/reservar')) resetWizard(); render(); scrollTo(0, 0); });
(async () => {
  try { INFO = await api('/api/public/info'); } catch { $('#app').innerHTML = '<div class="wrap" style="padding:60px 16px">No se pudo conectar con el servidor.</div>'; return; }
  document.title = `${INFO.business.name} · Reservas`;
  document.documentElement.style.setProperty('--p', INFO.business.primary || '#7c3aed');
  resetWizard(); render();
})();
