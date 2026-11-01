// Panel de administración de TurnIA.
const A = { user: null, pros: [], services: [], view: 'dashboard', ag: { mode: 'day', date: null, pro: '', svc: '', status: '' } };
const aapi = (p, o = {}) => api(p, { ...o, admin: true }).catch(err => { if (err.status === 401) { localStorage.removeItem('turnia_staff'); boot(); } throw err; });
const NAV = [['dashboard', '📊', 'Dashboard'], ['agenda', '📅', 'Agenda'], ['solicitudes', '📝', 'Solicitudes'], ['clientes', '👥', 'Clientes'], ['profesionales', '💇', 'Profesionales'],
  ['servicios', '✂️', 'Servicios y precios'], ['promociones', '🎁', 'Promociones'], ['opiniones', '⭐', 'Opiniones'], ['recordatorios', '🔔', 'Recordatorios'], ['estadisticas', '📈', 'Estadísticas'],
  ['asistente', '🤖', 'Asistente'], ['configuracion', '⚙️', 'Configuración']];
const ROLE = { owner: 'Propietario', manager: 'Encargado', employee: 'Empleado' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const proById = id => A.pros.find(p => p.id === id) || {};
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const err = ex => toast(ex.message, 4500);

function loginView() {
  $('#app').innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(800px 400px at 80% 0,#ede4ff,transparent),#faf8fd">
  <form class="card" style="max-width:400px;width:100%" onsubmit="login(event)"><div class="row" style="margin-bottom:10px"><span class="avatar" style="background:linear-gradient(135deg,#7c3aed,#ec4899)">T</span><div><h2 style="margin:0">TurnIA</h2><div class="small muted">Panel del comercio</div></div></div>
  <label>Email</label><input id="le" type="email" value="admin@turnia.demo" required><label>Contraseña</label><input id="lw" type="password" required>
  <button class="btn pri" style="width:100%;margin-top:14px">Ingresar</button>
  <div class="note info small" style="margin-top:12px">Demo: <b>admin@turnia.demo</b> (propietario), <b>encargado@turnia.demo</b>, <b>camila@turnia.demo</b> (empleada). La contraseña figura en el README.</div>
  <p class="small" style="text-align:center"><a href="/">← Ver página pública</a></p></form></div>`;
}
async function login(ev) {
  ev.preventDefault();
  try { const r = await api('/api/admin/login', { body: { email: $('#le').value, password: $('#lw').value } }); localStorage.setItem('turnia_staff', r.token); boot(); } catch (ex) { err(ex); }
}
async function boot() {
  if (!localStorage.getItem('turnia_staff')) return loginView();
  try {
    A.user = await aapi('/api/admin/me');
    [A.pros, A.services] = await Promise.all([aapi('/api/admin/professionals'), aapi('/api/admin/services')]);
  } catch { return loginView(); }
  A.view = location.hash.slice(2) || 'dashboard';
  if (!A.user.modules.includes(A.view)) A.view = 'dashboard';
  shell(); show();
}
function shell() {
  const u = A.user;
  $('#app').innerHTML = `<div class="mtop"><button class="btn sm" onclick="$('.side').classList.toggle('open')">☰</button><b>TurnIA</b></div>
  <div class="shell"><nav class="side"><div class="brand"><span class="logo">T</span>TurnIA</div>
  ${NAV.filter(n => u.modules.includes(n[0])).map(([k, i, l]) => `<a href="#/${k}" data-v="${k}">${i} ${l}</a>`).join('')}
  <a href="/" target="_blank">🌐 Página pública</a>
  <div class="who"><b>${e(u.name)}</b><br>${ROLE[u.role]}<br><a href="javascript:void 0" style="padding:6px 0" onclick="localStorage.removeItem('turnia_staff');loginView()">Cerrar sesión</a></div></nav>
  <main class="main" id="main"></main></div>`;
}
window.addEventListener('hashchange', () => { if (!A.user) return; const v = location.hash.slice(2).split('?')[0]; if (A.user.modules.includes(v)) { A.view = v; show(); } });
async function show() {
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('on', a.dataset.v === A.view));
  $('.side')?.classList.remove('open');
  $('#main').innerHTML = '<p class="muted">Cargando…</p>';
  try { await VIEWS[A.view](); } catch (ex) { $('#main').innerHTML = `<div class="note bad">${e(ex.message)}</div>`; }
}
const H = (title, actions = '', sub = '') => `<div class="row between" style="margin-bottom:16px"><div><h1 style="margin:0">${title}</h1>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><div class="row">${actions}</div></div>`;
const kpi = (v, l, c = '') => `<div class="card kpi"><b style="${c ? 'color:' + c : ''}">${v}</b><span>${l}</span></div>`;
const apptLine = a => `<div class="list-item" style="cursor:pointer" onclick="openAppt(${a.id})"><div style="width:52px;font-weight:700">${a.start_at.slice(11)}</div>
  <div class="grow"><b>${e(a.first_name)} ${e(a.last_name)}</b><div class="small muted">${a.items.map(i => `${e(i.service)} · ${e(i.professional)}`).join(' + ')}</div></div>${badge(a.status)}</div>`;

const VIEWS = {
  /* ───── Dashboard ───── */
  async dashboard() {
    const d = await aapi('/api/admin/dashboard'); const k = d.kpis;
    $('#main').innerHTML = H(`Hola, ${e(A.user.name.split(' ')[0])}`, `<button class="btn pri" onclick="newAppt()">+ Nuevo turno</button>`, `${fdate(today())} · ${ROLE[A.user.role]}`) +
    (d.notifications.length ? `<div class="card" style="margin-bottom:14px"><div class="row between"><h3>🔔 Notificaciones</h3><button class="btn sm" onclick="aapi('/api/admin/notifications/read',{body:{}}).then(show)">Marcar leídas</button></div>
      ${d.notifications.slice(0, 5).map(n => `<div class="small" style="padding:4px 0">• ${e(n.message)} <span class="muted">${n.created_at.slice(5)}</span></div>`).join('')}</div>` : '') +
    `<div class="grid g4" style="margin-bottom:14px">${kpi(d.today.length, 'Turnos hoy')}${kpi(money(k.revenue), 'Ingresos estimados (30 días)')}${kpi(money(k.deposits_pending), 'Señas pendientes', 'var(--warn)')}
      ${kpi(k.clientsNew, 'Clientes nuevos (30 días)')}${kpi(k.recurrent, 'Clientes recurrentes')}${kpi((k.cancels || 0) + ' / ' + (k.noshows || 0), 'Cancelaciones / inasistencias')}
      ${kpi(k.openReq, 'Consultas sin convertir')}${kpi(k.conflicts, 'Conflictos de agenda', k.conflicts ? 'var(--bad)' : '')}</div>
    <div class="grid g2"><div class="card"><h3>Turnos de hoy</h3>${d.today.map(apptLine).join('') || '<p class="muted">Sin turnos hoy.</p>'}
      <h3 style="margin-top:16px">Próximos</h3>${d.upcoming.map(a => apptLine(a).replace(`>${a.start_at.slice(11)}<`, `>${fdate(a.start_at).slice(0, 6)}<br>${a.start_at.slice(11)}<`)).join('') || '<p class="muted">Sin próximos turnos.</p>'}</div>
    <div class="grid" style="align-content:start"><div class="card"><h3>Ocupación y horarios libres hoy</h3>${d.pros.map(p => `<div style="margin:10px 0"><div class="row between"><b>${e(p.name)}</b><span class="small">${p.occupancy}%</span></div>
      <div class="bar"><i style="width:${p.occupancy}%;background:${p.color}"></i></div><div class="small muted">${p.available_min ? 'Libre: ' + (p.free.join(', ') || 'sin huecos') : 'No trabaja hoy'}</div></div>`).join('')}</div>
    <div class="card"><h3>💡 Oportunidades de recuperar ventas</h3>${d.opportunities.map(o => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">${e(o.text)} ${o.link ? `<a href="#/${o.link}">Ver</a>` : ''}</div>`).join('') || '<p class="muted small">Sin oportunidades detectadas.</p>'}</div>
    ${d.changeReq.length ? `<div class="card"><h3>Solicitudes de cambio</h3>${d.changeReq.map(apptLine).join('')}</div>` : ''}
    ${d.pendingDeposits.length ? `<div class="card"><h3>Señas pendientes</h3>${d.pendingDeposits.map(a => `<div class="list-item" onclick="openAppt(${a.id})" style="cursor:pointer"><span class="grow">${e(a.first_name)} ${e(a.last_name)} · ${fdt(a.start_at)}</span><b>${money(a.deposit_required - a.deposit_paid)}</b></div>`).join('')}</div>` : ''}
    </div></div>`;
  },

  /* ───── Agenda ───── */
  async agenda() {
    const g = A.ag; g.date ||= today();
    if (A.user.role === 'employee') g.pro = String(A.user.professional_id);
    let from = g.date, to = g.date;
    if (g.mode === 'week') { from = addDays(g.date, -((wd(g.date) + 6) % 7)); to = addDays(from, 6); }
    if (g.mode === 'month') { from = g.date.slice(0, 8) + '01'; to = addDays(addDays(from, 32).slice(0, 8) + '01', -1); }
    const qs = new URLSearchParams({ from, to, professional_id: g.pro, service_id: g.svc, status: g.status });
    const d = await aapi('/api/admin/appointments?' + qs);
    const step = g.mode === 'day' ? 1 : g.mode === 'week' ? 7 : 30;
    $('#main').innerHTML = H('Agenda', `<button class="btn" onclick="blockModal()">Bloquear horario</button><button class="btn pri" onclick="newAppt()">+ Nuevo turno</button>`) +
    `<div class="card" style="margin-bottom:12px"><div class="row">
      <div class="tabsA">${[['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']].map(([k, l]) => `<button class="chip ${g.mode === k ? 'on' : ''}" onclick="A.ag.mode='${k}';show()">${l}</button>`).join('')}</div>
      <button class="btn sm" onclick="A.ag.date=addDays(A.ag.date,-${step});show()">◀</button><input type="date" value="${g.date}" style="width:160px" onchange="A.ag.date=this.value;show()">
      <button class="btn sm" onclick="A.ag.date=addDays(A.ag.date,${step});show()">▶</button><button class="btn sm" onclick="A.ag.date=today();show()">Hoy</button>
      ${A.user.role !== 'employee' ? `<select style="width:auto" onchange="A.ag.pro=this.value;show()"><option value="">Todos los profesionales</option>${A.pros.map(p => `<option value="${p.id}" ${g.pro == p.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select>` : ''}
      <select style="width:auto" onchange="A.ag.svc=this.value;show()"><option value="">Todos los servicios</option>${A.services.map(s => `<option value="${s.id}" ${g.svc == s.id ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select>
      <select style="width:auto" onchange="A.ag.status=this.value;show()"><option value="">Todos los estados</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${g.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>${d.conflicts.length ? `<div class="note bad" style="margin-top:10px">⚠️ ${d.conflicts.length} turno(s) en conflicto (fuera de horario, en descanso/ausencia o superpuestos). Se marcan en rojo.</div>` : ''}</div>` +
    (g.mode === 'month' ? monthView(d, from) : timeGrid(d, g.mode === 'day' ? [g.date] : Array.from({ length: 7 }, (_, i) => addDays(from, i))));
  },

  /* ───── Solicitudes / lista de espera ───── */
  async solicitudes() {
    const rs = await aapi('/api/admin/requests');
    const open = rs.filter(r => r.status === 'abierta'), rest = rs.filter(r => r.status !== 'abierta');
    $('#main').innerHTML = H('Solicitudes y lista de espera', '', 'Priorizadas por cercanía del evento, urgencia, antigüedad y flexibilidad. Nada se mueve sin tu aprobación.') +
    `<div class="card"><h3>Abiertas (${open.length})</h3><div class="tbl"><table><tr><th>Prioridad</th><th>Cliente</th><th>Servicio</th><th>Preferencia</th><th>Urgencia</th><th>Evento</th><th></th></tr>
    ${open.map(r => `<tr><td><b>${r.priority}</b></td><td>${e(r.first_name)} ${e(r.last_name)}<div class="small muted">${e(r.phone)}</div></td><td>${e(r.services)}<div class="small muted">~${hm(r.est_duration)}${r.professional ? ' · prefiere ' + e(r.professional) : ''}</div></td>
      <td>${e(r.preference)}<div class="small muted">Flex. ${r.flexibility}${r.accepts_alternatives ? ' · acepta alternativas' : ''}</div></td><td>${r.urgency}</td><td>${r.event_date ? fdate(r.event_date) : '—'}</td>
      <td><button class="btn sm pri" onclick="reqOptions(${r.id})">Buscar lugar</button> <button class="btn sm" onclick="lostReq(${r.id})">Perdida</button></td></tr>
      ${r.swaps.map(s => `<tr><td></td><td colspan="6" class="small">🔁 Intercambio: mover ${e(s.proposal.appointment?.client)} (${s.proposal.appointment?.start}) → ${s.proposal.move_to?.start} · <b>${s.status}</b> ${s.detail ? '· ' + e(s.detail) : ''}
        ${s.status === 'en_contacto' ? `<button class="btn sm pri" onclick="swapResolve(${s.id},'aceptada')">Cliente aceptó</button> <button class="btn sm" onclick="swapResolve(${s.id},'rechazada')">Rechazó</button>` : ''}</td></tr>`).join('')}`).join('') || '<tr><td colspan="7" class="muted">Sin solicitudes abiertas.</td></tr>'}</table></div></div>
    <div class="card" style="margin-top:14px"><h3>Historial</h3><div class="tbl"><table><tr><th>Cliente</th><th>Servicio</th><th>Estado</th><th>Motivo</th><th>Fecha</th></tr>
    ${rest.map(r => `<tr><td>${e(r.first_name)} ${e(r.last_name)}</td><td>${e(r.services)}</td><td><span class="badge">${r.status}</span></td><td>${e(r.lost_reason || '')}</td><td>${r.created_at.slice(0, 10)}</td></tr>`).join('')}</table></div></div>`;
  },

  /* ───── Clientes ───── */
  async clientes() {
    const q = A.cq || '';
    const cs = await aapi('/api/admin/clients?q=' + encodeURIComponent(q));
    $('#main').innerHTML = H('Clientes', '', 'Identificados por teléfono. Los datos marcados "demo" son ficticios.') +
    `<div class="card"><input placeholder="Buscar por nombre o teléfono…" value="${e(q)}" onchange="A.cq=this.value;show()" style="max-width:360px;margin-bottom:10px">
    <div class="tbl"><table><tr><th>Cliente</th><th>Teléfono</th><th>Visitas</th><th>Cancel.</th><th>Inasist.</th><th>Último turno</th><th></th></tr>
    ${cs.map(c => `<tr><td><b>${e(c.first_name)} ${e(c.last_name)}</b> ${c.registered ? '<span class="badge">Registrado</span>' : ''} ${c.demo ? '<span class="badge st-finalizada">demo</span>' : ''}</td><td>${e(c.phone)}</td>
      <td>${c.done || 0}</td><td>${c.cancels || 0}</td><td>${c.noshows ? `<b style="color:var(--bad)">${c.noshows}</b>` : 0}</td><td>${c.last ? fdate(c.last) : '—'}</td><td><button class="btn sm" onclick="openClient(${c.id})">Ver perfil</button></td></tr>`).join('')}</table></div></div>`;
  },

  /* ───── Profesionales ───── */
  async profesionales() {
    if (A.proId) return proDetail(A.proId);
    $('#main').innerHTML = H('Profesionales', A.user.modules.includes('configuracion') || A.user.role === 'owner' ? `<button class="btn pri" onclick="newPro()">+ Agregar</button>` : '') +
    `<div class="grid g2">${A.pros.map(p => `<div class="card pro" style="display:flex;gap:12px">${avatar(p, 56)}<div class="grow"><b>${e(p.name)}</b> ${p.active ? '' : '<span class="badge st-cancelada">Inactivo</span>'}
      <div class="small" style="color:var(--p)">${e(p.specialties)}</div><div class="small muted">${p.all_services ? 'Realiza todos los servicios' : p.services.length + ' servicios habilitados'} · capacidad ${p.capacity}</div>
      <button class="btn sm" style="margin-top:8px" onclick="A.proId=${p.id};show()">Ver perfil y horarios</button></div></div>`).join('')}</div>`;
  },

  /* ───── Servicios ───── */
  async servicios() {
    A.services = await aapi('/api/admin/services');
    $('#main').innerHTML = H('Servicios y precios', `<button class="btn pri" onclick="editSvc()">+ Nuevo servicio</button>`, 'La duración configurada nunca se reemplaza automáticamente: el promedio real se muestra como referencia.') +
    Object.entries(CAT).map(([c, l]) => `<div class="card" style="margin-bottom:14px"><h3>${l}</h3><div class="tbl"><table><tr><th>Servicio</th><th>Precio</th><th>Duración</th><th>Prep/limpieza</th><th>Promedio real</th><th>Anticip.</th><th>Seña</th><th>Profesionales</th><th></th></tr>
    ${A.services.filter(s => s.category === c).map(s => `<tr style="${s.active ? '' : 'opacity:.5'}"><td><b>${e(s.name)}</b><div class="small muted">${e(s.subcategory || '')}${s.complex ? ' · evaluación' : ''}</div></td><td>${range(s.price_min, s.price_max)}</td>
      <td>${hm(s.base_duration + (s.extra_time || 0))}</td><td class="small">${s.prep_time}/${s.cleanup_time} min</td>
      <td class="small">${s.learned.average ? `<b>${hm(s.learned.average)}</b><div class="muted">${s.learned.records} registros</div>` : `<span class="muted">${s.learned.records} registros</span>`}</td>
      <td class="small">${s.min_advance_hours} h</td><td class="small">${s.deposit_amount ? money(s.deposit_amount) : '—'}</td><td class="small">${s.professionals.map(p => e(p.name.split(' ')[0])).join(', ')}</td>
      <td><button class="btn sm" onclick="editSvc(${s.id})">Editar</button></td></tr>`).join('')}</table></div></div>`).join('');
  },

  /* ───── Promociones ───── */
  async promociones() {
    const ps = await aapi('/api/admin/promotions');
    const AUD = { all: 'Todos', new: 'Clientes nuevos', recurrent: 'Recurrentes', inactive: 'Inactivos (+60 días)' };
    $('#main').innerHTML = H('Promociones', `<button class="btn pri" onclick="editPromo()">+ Nueva promoción</button>`, 'Se aplican automáticamente al reservar (la de mayor descuento). Puntos y recompensas: funcionalidad futura.') +
    `<div class="card tbl"><table><tr><th>Promoción</th><th>Descuento</th><th>Aplica a</th><th>Público</th><th>Vigencia</th><th>Usos</th><th></th></tr>
    ${ps.map(p => `<tr style="${p.active ? '' : 'opacity:.5'}"><td><b>${e(p.name)}</b><div class="small muted">${e(p.description)}</div></td><td>${p.type === 'percent' ? p.value + '%' : money(p.value)}</td>
      <td class="small">${p.service_id ? e(A.services.find(s => s.id === p.service_id)?.name) : 'Todos los servicios'}${p.professional_id ? ' · ' + e(proById(p.professional_id).name) : ''}${p.weekdays.length ? '<br>' + p.weekdays.map(d => DAYS[d]).join(', ') : ''}</td>
      <td>${AUD[p.audience]}</td><td class="small">${p.start_date || ''} → ${p.end_date || '∞'}</td><td>${p.uses}${p.max_uses ? '/' + p.max_uses : ''}</td>
      <td><button class="btn sm" onclick='editPromo(${JSON.stringify(p).replace(/'/g, '&#39;')})'>Editar</button></td></tr>`).join('')}</table></div>`;
  },

  /* ───── Opiniones ───── */
  async opiniones() {
    const rs = await aapi('/api/admin/reviews');
    $('#main').innerHTML = H('Opiniones y fotos', '', 'Privadas por defecto. Solo se publican las aprobadas que elijas, y las fotos únicamente con autorización del cliente.') +
    `<div class="grid g2">${rs.map(r => `<div class="card"><div class="row between"><span class="stars" style="color:#f59e0b">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span><span class="badge">${r.status}${r.published ? ' · publicada' : ''}</span></div>
      <p>${e(r.comment)}</p><div class="row">${r.photos.map(p => `<img src="${p}" style="width:90px;height:90px;object-fit:cover;border-radius:8px">`).join('')}</div>
      <div class="small muted">${e(r.first_name)} ${e(r.last_name)} · ${e(r.service)} con ${e(r.professional)} · ${r.created_at.slice(0, 10)}${r.photos.length ? ` · Fotos: ${r.photo_consent ? 'autorizadas ✅' : 'sin autorización ❌'}` : ''}</div>
      <div class="row" style="margin-top:10px"><button class="btn sm pri" onclick="setReview(${r.id},'aprobada',true)">Aprobar y publicar</button><button class="btn sm" onclick="setReview(${r.id},'aprobada',false)">Aprobar (privada)</button>
      <button class="btn sm bad" onclick="setReview(${r.id},'rechazada',false)">Rechazar</button></div></div>`).join('') || '<p class="muted">Todavía no hay opiniones.</p>'}</div>`;
  },

  /* ───── Recordatorios ───── */
  async recordatorios() {
    const hours = A.remH || 24;
    const d = await aapi('/api/admin/reminders?hours=' + hours);
    const item = r => `<div class="card" style="margin-bottom:10px"><div class="row between"><b>${e(r.first_name)} ${e(r.last_name)} · ${fdt(r.start_at)}</b>${r.reminder_sent ? '<span class="badge st-confirmada">Enviado</span>' : badge(r.status)}</div>
      <p class="small" style="background:var(--bg);padding:10px;border-radius:8px">${e(r.text)}</p>
      <div class="row"><button class="btn sm" onclick="copy(${JSON.stringify(r.text).replace(/"/g, '&quot;')})">Copiar mensaje</button><a class="btn sm pri" target="_blank" rel="noopener" href="${r.wa}" onclick="aapi('/api/admin/reminders/${r.id}/sent',{body:{}})">Abrir WhatsApp</a></div></div>`;
    $('#main').innerHTML = H('Recordatorios', `<select style="width:auto" onchange="A.remH=Number(this.value);show()">${[12, 24, 48, 72].map(h => `<option value="${h}" ${h === hours ? 'selected' : ''}>Próximas ${h} h</option>`).join('')}</select>`,
      'Mensajes listos para copiar o abrir en WhatsApp. TurnIA no envía mensajes automáticamente ni usa APIs externas.') +
    `<h3>Turnos próximos (${d.upcoming.length})</h3>${d.upcoming.map(item).join('') || '<p class="muted">No hay turnos en ese período.</p>'}
     <h3 style="margin-top:18px">Avisos de cambios y cancelaciones (últimos 3 días)</h3>${d.changes.map(item).join('') || '<p class="muted">Sin cambios recientes.</p>'}`;
  },

  /* ───── Estadísticas ───── */
  async estadisticas() {
    const s = await aapi('/api/admin/stats');
    const max = Math.max(1, ...s.byDay.map(x => x.n)), maxS = Math.max(1, ...s.topServices.map(x => x.n));
    const st = Object.fromEntries(s.byStatus.map(x => [x.status, x.n])), total = s.byStatus.reduce((a, x) => a + x.n, 0);
    $('#main').innerHTML = H('Estadísticas', '', `Período ${s.from} → ${s.to}`) +
    (s.demo ? '<div class="note" style="margin-bottom:14px">📌 Incluye <b>datos ficticios de demostración</b> (clientes y turnos marcados "demo"). No son métricas reales de un comercio.</div>' : '') +
    `<div class="grid g4" style="margin-bottom:14px">${kpi(total, 'Turnos en el período')}${kpi(range(s.revenue.min, s.revenue.max), 'Ingresos estimados')}${kpi(st.cancelada || 0, 'Cancelaciones')}${kpi(st.no_asistio || 0, 'Inasistencias')}
      ${kpi(s.recurrent, 'Clientes recurrentes')}${kpi(s.clients, 'Clientes totales')}${kpi(s.requests.find(r => r.status === 'abierta')?.n || 0, 'Consultas sin convertir')}${kpi(s.notReturning.length, 'Clientes que no regresan')}</div>
    <div class="grid g2"><div class="card"><h3>Turnos por día</h3><div style="display:flex;align-items:flex-end;gap:3px;height:140px">${s.byDay.map(x => `<div title="${x.d}: ${x.n}" style="flex:1;background:var(--p);border-radius:4px 4px 0 0;height:${x.n / max * 100}%;min-width:4px"></div>`).join('')}</div>
      <div class="small muted row between"><span>${s.byDay[0]?.d || ''}</span><span>${s.byDay.at(-1)?.d || ''}</span></div></div>
    <div class="card"><h3>Servicios más solicitados</h3>${s.topServices.map(x => `<div style="margin:6px 0"><div class="row between small"><span>${e(x.name)}</span><b>${x.n}</b></div><div class="bar"><i style="width:${x.n / maxS * 100}%"></i></div></div>`).join('')}</div>
    <div class="card"><h3>Demanda y ocupación por profesional</h3><table><tr><th>Profesional</th><th>Turnos</th><th>Horas</th><th>Cancel.</th><th>Inasist.</th></tr>${s.byPro.map(p => `<tr><td>${e(p.name)}</td><td>${p.n}</td><td>${hm(p.minutes || 0)}</td><td>${p.cancels}</td><td>${p.noshows}</td></tr>`).join('')}</table></div>
    <div class="card"><h3>Consultas no convertidas y motivos de pérdida</h3>${s.requests.map(r => `<div class="small">${r.status}: <b>${r.n}</b></div>`).join('')}<hr style="border:0;border-top:1px solid var(--line)">
      ${s.lostReasons.map(r => `<div class="small">• ${e(r.reason)}: ${r.n}</div>`).join('') || '<p class="small muted">Sin pérdidas registradas.</p>'}
      <h3 style="margin-top:12px">Oportunidades recuperables</h3>${s.notReturning.map(c => `<div class="small">• ${e(c.first_name)} ${e(c.last_name)} — última visita ${fdate(c.last)}</div>`).join('') || '<p class="small muted">Todos tus clientes volvieron.</p>'}</div></div>`;
  },

  /* ───── Asistente / base de conocimiento ───── */
  async asistente() {
    const d = await aapi('/api/admin/knowledge'); const ai = d.ai;
    $('#main').innerHTML = H('Asistente TurnIA', '', 'Responde con reglas, tu base de conocimiento y los datos del local (servicios, precios, horarios, promociones, profesionales).') +
    `<div class="grid g2"><div class="card"><h3>Probar el asistente</h3><form class="row" onsubmit="testBot(event)"><input id="tb" class="grow" placeholder="¿Cuánto sale el balayage? ¿Hay turno para corte mañana?" style="flex:1"><button class="btn pri">Preguntar</button></form><div id="tbr" style="margin-top:10px"></div></div>
    <div class="card"><h3>IA externa opcional (API DonWeb)</h3>
      <p class="small">Estado: ${ai.configured ? '<b style="color:var(--ok)">API configurada en el servidor</b>' : '<b>No configurada</b> — cargá AI_API_URL, AI_API_KEY y AI_MODEL en el archivo .env del servidor (nunca en el código).'}</p>
      <p class="small muted">Solo se usa cuando las reglas y la base de conocimiento no tienen respuesta, con contexto mínimo del local, respuestas cortas, caché y límite diario. Uso hoy: ${ai.used_today}/${ai.daily_limit}.</p>
      <div class="grid g3"><label class="row" style="color:var(--ink)"><input type="checkbox" id="aie" style="width:auto" ${ai.enabled ? 'checked' : ''}> Habilitar</label>
      <div><label>Máx. tokens</label><input id="aim" type="number" value="${ai.max_tokens}"></div><div><label>Límite diario</label><input id="aid" type="number" value="${ai.daily_limit}"></div></div>
      <button class="btn" style="margin-top:10px" onclick="saveAi()">Guardar</button></div></div>
    <div class="card" style="margin-top:14px"><div class="row between"><h3>Base de conocimiento (lo que le enseñás)</h3><button class="btn pri sm" onclick="editKb()">+ Agregar</button></div>
    <div class="tbl"><table><tr><th>Pregunta</th><th>Respuesta</th><th>Palabras clave</th><th></th></tr>${d.items.map(k => `<tr><td>${e(k.question)}</td><td class="small">${e(k.answer)}</td><td class="small muted">${e(k.keywords)}</td>
      <td><button class="btn sm" onclick='editKb(${JSON.stringify(k).replace(/'/g, '&#39;')})'>Editar</button></td></tr>`).join('')}</table></div></div>`;
  },

  /* ───── Configuración ───── */
  async configuracion() {
    const [s, users] = await Promise.all([aapi('/api/admin/settings'), aapi('/api/admin/users')]); const b = s.business;
    const f = (k, l, t = 'input') => `<div><label>${l}</label>${t === 'ta' ? `<textarea rows="2" data-b="${k}">${e(b[k] || '')}</textarea>` : `<input data-b="${k}" value="${e(b[k] || '')}">`}</div>`;
    $('#main').innerHTML = H('Configuración') + `<div class="card"><h3>Página pública del local</h3><div class="grid g2">${f('name', 'Nombre')}${f('tagline', 'Frase principal')}${f('logo', 'URL del logo (opcional)')}${f('primary', 'Color principal (hex)')}
      ${f('address', 'Dirección')}${f('hours', 'Horario general')}${f('phone', 'Teléfono')}${f('whatsapp', 'WhatsApp (solo números)')}${f('instagram', 'Instagram')}${f('email', 'Email')}</div>
      ${f('description', 'Descripción', 'ta')}${f('conditions', 'Condiciones generales', 'ta')}${f('demo_notice', 'Aviso al pie')}</div>
    <div class="card" style="margin-top:14px"><h3>Reglas de reserva</h3><div class="grid g3">
      <div><label>Horizonte máximo (días)</label><input id="s_h" type="number" value="${s.booking_horizon_days}"></div><div><label>Anticipación de recordatorios (h)</label><input id="s_r" type="number" value="${s.reminder_hours}"></div>
      <div><label>Registros mínimos para promediar duración</label><input id="s_l" type="number" value="${s.learning_min_records}"></div>
      <div><label>Inasistencias para exigir seña</label><input id="s_d" type="number" value="${s.noshow_deposit_after}"></div><div><label>Inasistencias para bloquear reserva online</label><input id="s_b" type="number" value="${s.noshow_block_after}"></div>
      <label class="row" style="color:var(--ink)"><input id="s_p" type="checkbox" style="width:auto" ${s.promos_require_registration ? 'checked' : ''}> Promos solo para clientes registrados</label></div>
      <p class="small muted">La anticipación mínima y la política de cancelación se configuran por servicio.</p><button class="btn pri" onclick="saveSettings()">Guardar configuración</button></div>
    <div class="card" style="margin-top:14px"><div class="row between"><h3>Usuarios y permisos</h3><button class="btn sm pri" onclick="editUser()">+ Usuario</button></div><table><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Módulos</th><th></th></tr>
      ${users.map(u => `<tr><td>${e(u.name)}</td><td>${e(u.email)}</td><td>${ROLE[u.role]}${u.professional_id ? ' · ' + e(proById(u.professional_id).name) : ''}</td><td class="small">${u.role === 'owner' ? 'Todo' : u.role === 'employee' ? 'Su agenda' : u.permissions.join(', ')}</td>
      <td><button class="btn sm" onclick='editUser(${JSON.stringify(u).replace(/'/g, '&#39;')})'>Editar</button></td></tr>`).join('')}</table></div>`;
  },
};

/* ───────── Agenda: vistas ───────── */
const PX = 1.1, H0 = 8 * 60, H1 = 21 * 60;
function timeGrid(d, dates) {
  const byPro = dates.length === 1 && !A.ag.pro;
  const cols = byPro ? A.pros.filter(p => p.active).map(p => ({ key: p.id, label: p.name, date: dates[0], pro: p.id })) : dates.map(dt => ({ key: dt, label: fdate(dt), date: dt, pro: Number(A.ag.pro) || null }));
  const height = (H1 - H0) * PX;
  const times = []; for (let m = H0; m < H1; m += 60) times.push(m);
  const evs = col => d.appointments.flatMap(a => a.items.filter(i => i.block_start.slice(0, 10) === col.date && (!col.pro || i.professional_id === col.pro)).map(i => ({ a, i })));
  const blocks = col => d.blocks.filter(b => b.start_date <= col.date && b.end_date >= col.date && (!b.professional_id || !col.pro || b.professional_id === col.pro));
  return `<div class="ag" style="grid-template-columns:52px repeat(${cols.length},minmax(130px,1fr))"><div class="ag-h"></div>${cols.map(c => `<div class="ag-h">${e(c.label)}</div>`).join('')}
    <div style="position:relative;height:${height}px">${times.map(m => `<div class="ag-time" style="position:absolute;top:${(m - H0) * PX - 6}px;right:0">${String(m / 60).padStart(2, '0')}:00</div>`).join('')}</div>
    ${cols.map(c => `<div class="ag-col" style="height:${height}px" ondblclick="newAppt('${c.date}',${c.pro || 'null'})">${times.map(m => `<div class="ag-line" style="top:${(m - H0) * PX}px"></div>`).join('')}
      ${blocks(c).map(b => { const s = b.start_time ? mins(b.start_time) : H0, en = b.end_time ? mins(b.end_time) : H1;
        return `<div class="blk" style="top:${(s - H0) * PX}px;height:${(en - s) * PX}px" title="${e(b.reason)}">${e(b.type)}${b.professional ? '' : ' (local)'} · ${e(b.reason || '')} <a href="javascript:void 0" onclick="delBlock(${b.id})">quitar</a></div>`; }).join('')}
      ${evs(c).map(({ a, i }) => { const s = mins(i.block_start.slice(11)), en = mins(i.block_end.slice(11));
        return `<div class="ev ${a.status} ${d.conflicts.includes(a.id) ? 'conflict' : ''}" style="top:${(s - H0) * PX}px;height:${Math.max(18, (en - s) * PX - 2)}px;background:${i.color}" onclick="openAppt(${a.id})" title="${e(STATUS[a.status])}">
          <b>${i.start_at.slice(11)} ${e(a.first_name)} ${e(a.last_name[0])}.</b><br>${e(i.service)}${byPro ? '' : '<br>' + e(i.professional.split(' ')[0])}</div>`; }).join('')}</div>`).join('')}</div>
    <p class="small muted">Doble clic en una columna para crear un turno. Las franjas rayadas son bloqueos y ausencias.</p>`;
}
function monthView(d, from) {
  const start = addDays(from, -((wd(from) + 6) % 7)); const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return `<div class="month">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(x => `<div class="small muted" style="text-align:center">${x}</div>`).join('')}
  ${days.map(dt => { const as = d.appointments.filter(a => a.start_at.slice(0, 10) === dt);
    return `<div class="d ${dt.slice(0, 7) !== from.slice(0, 7) ? 'out' : ''}" onclick="A.ag.mode='day';A.ag.date='${dt}';show()"><b>${Number(dt.slice(8))}</b>${as.slice(0, 4).map(a => `<span class="dot" style="background:${a.items[0].color};${a.status === 'cancelada' ? 'opacity:.4' : ''}">${a.start_at.slice(11)} ${e(a.first_name)}</span>`).join('')}${as.length > 4 ? `<span class="small muted">+${as.length - 4} más</span>` : ''}</div>`; }).join('')}</div>`;
}

/* ───────── Turno: detalle y acciones ───────── */
async function openAppt(id) {
  let a; try { a = await aapi('/api/admin/appointments/' + id); } catch (ex) { return err(ex); }
  const st = a.client_stats;
  const actions = { confirmada: 'Confirmar', en_curso: 'En curso', finalizada: 'Finalizar', no_asistio: 'No asistió', reprogramacion: 'Marcar reprogramación' };
  modal(`<div class="row between"><h2 style="margin:0">Turno ${e(a.code)}</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <div class="row" style="margin:8px 0">${badge(a.status)} ${a.conflict ? '<span class="badge st-cancelada">⚠️ Conflicto de agenda</span>' : ''} <span class="badge">${e(a.mode)}</span> <span class="small muted">Origen: ${e(a.source)}</span></div>
  <p><b>${e(a.first_name)} ${e(a.last_name)}</b> · ${e(a.phone)} ${a.registered ? '<span class="badge">Registrado</span>' : ''}<br><span class="small muted">${st.done || 0} visitas · ${st.cancels || 0} cancelaciones · ${st.noshows || 0} inasistencias</span>
   ${A.user.modules.includes('clientes') ? ` <a href="javascript:void 0" onclick="openClient(${a.client_id})">Ver perfil</a>` : ''}</p>
  <table>${a.items.map(i => `<tr><td><b>${e(i.service)}</b><div class="small muted">${Object.entries(i.answers).filter(([, v]) => v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${e(v)}`).join(' · ')}</div></td>
    <td>${fdt(i.start_at)}–${i.end_at.slice(11)}<div class="small muted">${e(i.professional)} · est. ${hm(i.est_duration)}${i.actual_duration ? ' · real ' + hm(i.actual_duration) : ''}</div></td></tr>`).join('')}</table>
  <p>Precio estimado <b>${range(a.price_min - a.discount, a.price_max - a.discount)}</b>${a.discount ? ` (promo ${e(a.promo)} -${money(a.discount)})` : ''} · Seña ${a.deposit_required ? `${money(a.deposit_paid)}/${money(a.deposit_required)} <span class="badge">${a.deposit_status}</span>` : 'no requerida'}
   ${a.refund_status ? `<br><span class="badge st-pendiente">${e(a.refund_status.replace(/_/g, ' '))}</span>` : ''}${a.cancel_reason ? `<br><span class="small">Motivo cancelación: ${e(a.cancel_reason)}</span>` : ''}</p>
  ${a.notes ? `<div class="note small">${e(a.notes)}</div>` : ''}
  ${!['cancelada', 'finalizada', 'no_asistio'].includes(a.status) ? `<h3 style="margin-top:14px">Cambiar estado</h3><div class="row">${Object.entries(actions).filter(([k]) => k !== a.status).map(([k, l]) => `<button class="btn sm ${k === 'finalizada' ? 'pri' : ''}" onclick="setStatus(${a.id},'${k}')">${l}</button>`).join('')}
    <button class="btn sm bad" onclick="setStatus(${a.id},'cancelada')">Cancelar</button></div>
    <div id="fin" class="hide card" style="margin-top:10px;background:var(--bg)"><b>Duración real (aprendizaje de TurnIA)</b>${a.items.map(i => `<div class="row" style="margin-top:6px"><span class="grow small">${e(i.service)} (est. ${i.est_duration} min)</span><input type="number" data-item="${i.id}" value="${i.est_duration}" style="width:100px"> min</div>`).join('')}
    <button class="btn pri sm" style="margin-top:8px" onclick="finish(${a.id})">Guardar y finalizar</button></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" onclick="reschedule(${a.id})">📅 Reprogramar</button><button class="btn sm" onclick="payModal(${a.id})">💵 Registrar seña / pago</button></div>` :
    `<div class="row" style="margin-top:10px">${['cancelada', 'no_asistio'].includes(a.status) ? `<button class="btn sm" onclick="setStatus(${a.id},'confirmada')">Reactivar (revalida disponibilidad)</button>` : ''}<button class="btn sm" onclick="payModal(${a.id})">💵 Registrar seña / devolución</button></div>`}
  ${a.payments.length ? `<h3 style="margin-top:14px">Pagos registrados</h3>${a.payments.map(p => `<div class="small">${p.at} · ${p.kind} ${money(p.amount)} ${e(p.note)}</div>`).join('')}` : ''}
  <h3 style="margin-top:14px">Historial de cambios</h3>${a.history.map(h => `<div class="small" style="padding:3px 0;border-bottom:1px solid var(--line)"><span class="muted">${h.at}</span> · <b>${e(h.action)}</b> · ${e(h.detail)} <span class="muted">(${e(h.user)})</span></div>`).join('')}`);
}
async function setStatus(id, status) {
  if (status === 'finalizada') return $('#fin').classList.remove('hide');
  let reason = '';
  if (status === 'cancelada') { reason = prompt('Motivo de la cancelación:'); if (reason === null) return; }
  try { await aapi(`/api/admin/appointments/${id}/status`, { body: { status, reason } }); toast('Estado actualizado'); openAppt(id); refresh(); } catch (ex) { err(ex); }
}
async function finish(id) {
  const durations = [...document.querySelectorAll('[data-item]')].map(i => ({ item_id: Number(i.dataset.item), actual: Number(i.value) }));
  try { await aapi(`/api/admin/appointments/${id}/status`, { body: { status: 'finalizada', durations } }); toast('Turno finalizado y duración registrada'); openAppt(id); refresh(); } catch (ex) { err(ex); }
}
function payModal(id) {
  const k = prompt('Tipo: seña / pago / devolucion', 'seña'); if (!k) return;
  const amount = prompt('Importe ($):'); if (!amount) return;
  const note = prompt('Nota (ej: transferencia):', 'transferencia') || '';
  aapi(`/api/admin/appointments/${id}/payment`, { body: { kind: k.trim().toLowerCase(), amount: Number(amount), note } }).then(() => { toast('Registrado'); openAppt(id); refresh(); }).catch(err);
}
const refresh = () => { if (['agenda', 'dashboard'].includes(A.view)) VIEWS[A.view]().catch(() => { }); };

/* Selector de horarios reutilizable (alta, reprogramación, solicitudes) */
async function slotPicker(target, body, onPick, url = '/api/admin/availability') {
  $(target).innerHTML = '<p class="muted">Buscando disponibilidad…</p>';
  try {
    const r = await aapi(url, { body });
    const list = r.options || [...r.single, ...r.simultaneous, ...r.consecutive];
    A._slots = list; A._onPick = onPick;
    if (!list.length) { $(target).innerHTML = '<div class="note">Sin horarios disponibles en ese rango.</div>'; return r; }
    const by = {}; list.forEach((o, i) => (by[o.date] ??= []).push([o, i]));
    $(target).innerHTML = Object.entries(by).slice(0, 7).map(([d, os]) => `<div style="margin:8px 0"><b class="small">${fdate(d)}</b><div class="row" style="gap:6px;margin-top:4px">${os.map(([o, i]) =>
      `<button class="chip" onclick="A._onPick(A._slots[${i}])" title="${o.items.map(x => x.service + ' · ' + x.professional).join(' / ')}">${o.start.slice(11)} <span class="small muted">${[...new Set(o.items.map(x => x.professional.split(' ')[0]))].join('+')}${o.type !== 'simple' && o.type ? ' · ' + o.type.slice(0, 5) : ''}</span></button>`).join('')}</div></div>`).join('');
    return r;
  } catch (ex) { $(target).innerHTML = `<div class="note bad">${e(ex.message)}</div>`; }
}
async function reschedule(id) {
  const a = await aapi('/api/admin/appointments/' + id);
  modal(`<div class="row between"><h2 style="margin:0">Reprogramar ${e(a.code)}</h2><button class="btn sm ghost" onclick="openAppt(${id})">← Volver</button></div>
    <p class="small muted">Se revalida la disponibilidad en el servidor antes de guardar. El turno actual se excluye de la búsqueda.</p>
    <div class="row"><input type="date" id="rd" value="${today()}" style="width:180px"><button class="btn" onclick="rsSearch(${id})">Buscar</button></div><div id="rslots"></div>`);
  A._rs = a; rsSearch(id);
}
function rsSearch(id) {
  const a = A._rs;
  slotPicker('#rslots', { services: a.items.map(i => ({ id: i.service_id, answers: i.answers })), dateFrom: $('#rd').value, days: 7, exclude: id }, async o => {
    if (!confirm(`¿Mover el turno a ${fdt(o.start)}?`)) return;
    try { await aapi(`/api/admin/appointments/${id}/reschedule`, { body: { choice: o.choice } }); toast('Turno reprogramado. Avisale al cliente desde Recordatorios.'); openAppt(id); refresh(); } catch (ex) { err(ex); }
  });
}
function newAppt(date, pro) {
  A._na = { services: [] };
  modal(`<div class="row between"><h2 style="margin:0">Nuevo turno</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <div class="grid g3"><div><label>Teléfono</label><input id="np" onblur="naLookup()"></div><div><label>Nombre</label><input id="nf"></div><div><label>Apellido</label><input id="nl"></div></div>
  <label>Servicios</label><select id="ns" multiple size="6">${Object.entries(CAT).map(([c, l]) => `<optgroup label="${l}">${A.services.filter(s => s.category === c && s.active).map(s => `<option value="${s.id}">${e(s.name)} · ${hm(s.base_duration)}</option>`).join('')}</optgroup>`).join('')}</select>
  <div class="small muted">Ctrl/Cmd + clic para elegir varios.</div>
  <div class="grid g3"><div><label>Profesional</label><select id="npro"><option value="">Recomendación TurnIA</option>${A.pros.map(p => `<option value="${p.id}" ${pro === p.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></div>
  <div><label>Desde</label><input type="date" id="nd" value="${date || today()}"></div><div><label>Notas</label><input id="nn"></div></div>
  <button class="btn" style="margin-top:10px" onclick="naSearch()">Buscar horarios</button><div id="nslots"></div>`);
}
async function naLookup() { try { const r = await api('/api/public/lookup', { body: { phone: $('#np').value } }); if (r.exists) { $('#nf').value = r.first_name; $('#nl').value = r.last_name; toast(`Cliente existente · ${r.visits} visitas`); } } catch { } }
function naSearch() {
  const ids = [...$('#ns').selectedOptions].map(o => Number(o.value)); if (!ids.length) return toast('Elegí al menos un servicio');
  const pro = $('#npro').value; const pros = {};
  if (pro) for (const id of ids) pros[A.services.find(s => s.id === id).category] = Number(pro);
  const services = ids.map(id => ({ id, answers: {} }));
  slotPicker('#nslots', { services, pros, dateFrom: $('#nd').value, days: 7 }, async o => {
    try {
      const a = await aapi('/api/admin/appointments', { body: { client: { phone: $('#np').value, first_name: $('#nf').value, last_name: $('#nl').value }, services, choice: o.choice, mode: o.type, notes: $('#nn').value } });
      toast(`Turno ${a.code} creado`); openAppt(a.id); refresh();
    } catch (ex) { err(ex); }
  });
}
function blockModal() {
  modal(`<div class="row between"><h2 style="margin:0">Bloquear horario / ausencia</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <div class="grid g2"><div><label>Profesional</label><select id="bp">${A.user.role === 'employee' ? '' : '<option value="">Todo el local</option>'}${A.pros.filter(p => A.user.role !== 'employee' || p.id === A.user.professional_id).map(p => `<option value="${p.id}">${e(p.name)}</option>`).join('')}</select></div>
  <div><label>Tipo</label><select id="bt"><option value="bloqueo">Bloqueo temporal</option><option value="vacaciones">Vacaciones</option><option value="licencia">Licencia</option><option value="no_laborable">Día no laborable</option></select></div>
  <div><label>Desde</label><input type="date" id="bs" value="${A.ag.date || today()}"></div><div><label>Hasta</label><input type="date" id="be" value="${A.ag.date || today()}"></div>
  <div><label>Hora inicio (vacío = todo el día)</label><input type="time" id="bhs"></div><div><label>Hora fin</label><input type="time" id="bhe"></div></div>
  <label>Motivo</label><input id="br"><button class="btn pri" style="margin-top:12px" onclick="saveBlock()">Guardar</button><div id="baff"></div>`);
}
async function saveBlock() {
  try {
    const r = await aapi('/api/admin/absences', { body: { professional_id: $('#bp').value, type: $('#bt').value, start_date: $('#bs').value, end_date: $('#be').value, start_time: $('#bhs').value, end_time: $('#bhe').value, reason: $('#br').value } });
    if (!r.affected.length) { toast('Bloqueo guardado'); closeModal(); return show(); }
    $('#baff').innerHTML = affectedHtml(r.affected); refresh();
  } catch (ex) { err(ex); }
}
function affectedHtml(list) {
  return `<div class="note bad" style="margin-top:12px">⚠️ Esta ausencia afecta <b>${list.length}</b> turno(s). TurnIA <b>no los modifica automáticamente</b>: contactá al cliente y elegí una alternativa.</div>` +
    list.map(a => `<div class="card" style="margin-top:8px"><b>${e(a.first_name)} ${e(a.last_name)}</b> · ${fdt(a.start_at)} · ${a.items.map(i => e(i.service) + ' con ' + e(i.professional)).join(' + ')}
      <div class="small muted" style="margin-top:6px">Alternativas sugeridas:</div><div class="row" style="gap:6px">${a.alternatives.map(o => `<button class="chip" onclick='applyAlt(${a.id},${JSON.stringify(o.choice)},"${o.start}")'>${fdt(o.start)} · ${e(o.items[0].professional.split(' ')[0])}</button>`).join('') || '<span class="small">Sin alternativas cercanas</span>'}</div>
      <div class="row" style="margin-top:6px"><button class="btn sm" onclick="openAppt(${a.id})">Abrir turno</button></div></div>`).join('');
}
async function applyAlt(id, choice, start) {
  if (!confirm(`¿El cliente aceptó mover el turno a ${fdt(start)}?`)) return;
  try { await aapi(`/api/admin/appointments/${id}/reschedule`, { body: { choice } }); toast('Turno movido con aceptación del cliente'); closeModal(); show(); } catch (ex) { err(ex); }
}
async function delBlock(id) { if (!confirm('¿Quitar este bloqueo?')) return; await aapi('/api/admin/absences/' + id, { method: 'DELETE', body: {} }); show(); }

/* ───────── Solicitudes ───────── */
async function reqOptions(id) {
  modal(`<div class="row between"><h2 style="margin:0">Opciones para la solicitud</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <h3>Horarios libres</h3><div id="ro"></div><h3 style="margin-top:14px">🔁 Intercambios sugeridos</h3><div id="rsw" class="small muted">Analizando…</div>`);
  const r = await slotPicker('#ro', {}, async o => {
    try { const a = await aapi(`/api/admin/requests/${id}/book`, { body: { choice: o.choice } }); toast(`Turno ${a.code} creado desde la lista de espera`); closeModal(); show(); } catch (ex) { err(ex); }
  }, `/api/admin/requests/${id}/options`);
  if (!r) return;
  A._swaps = r.swaps;
  $('#rsw').innerHTML = r.swaps.length ? r.swaps.map((s, i) => `<div class="card" style="margin-top:8px">Mover a <b>${e(s.appointment.client)}</b> (${e(s.appointment.service)}) de ${fdt(s.appointment.start)} a <b>${fdt(s.move_to.start)}</b> con ${e(s.move_to.professional)}
    libera ${fdt(s.request_slot.block_start)} con ${e(s.request_slot.professional)} para esta solicitud.<div class="small muted">Requiere contactar a ${e(s.appointment.client)} (${e(s.appointment.phone)}). No se mueve nada hasta que registres su respuesta.</div>
    <button class="btn sm pri" style="margin-top:6px" onclick="proposeSwap(${id},${i})">Proponer y contactar</button></div>`).join('') : 'No hay intercambios viables en los próximos 10 días.';
}
async function proposeSwap(rid, i) {
  const s = A._swaps[i];
  try { await aapi('/api/admin/swaps', { body: { request_id: rid, appointment_id: s.appointment.id, proposal: s } }); toast('Propuesta registrada. Contactá al cliente y registrá su respuesta.'); closeModal(); show(); } catch (ex) { err(ex); }
}
async function swapResolve(id, status) {
  const detail = prompt(status === 'aceptada' ? 'Nota (ej: aceptó por WhatsApp)' : 'Motivo del rechazo') ?? '';
  try { await aapi('/api/admin/swaps/' + id, { method: 'PUT', body: { status, detail } }); toast(status === 'aceptada' ? 'Intercambio aplicado tras revalidar disponibilidad' : 'Registrado'); show(); } catch (ex) { err(ex); show(); }
}
async function lostReq(id) { const r = prompt('Motivo de pérdida (ej: sin horario, precio, eligió otro local):'); if (r === null) return; await aapi('/api/admin/requests/' + id, { method: 'PUT', body: { status: 'perdida', lost_reason: r } }); show(); }

/* ───────── Clientes ───────── */
async function openClient(id) {
  const c = await aapi('/api/admin/clients/' + id);
  modal(`<div class="row between"><h2 style="margin:0">${e(c.first_name)} ${e(c.last_name)}</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <p>${e(c.phone)} · ${e(c.email || 'sin email')} ${c.registered ? '<span class="badge">Registrado</span>' : ''} ${c.demo ? '<span class="badge st-finalizada">Cliente demo</span>' : ''}<br>
  <span class="small muted">Cliente desde ${c.created_at.slice(0, 10)} · ${c.stats.done || 0} visitas · ${c.stats.cancels || 0} cancelaciones · <b style="${c.stats.noshows ? 'color:var(--bad)' : ''}">${c.stats.noshows || 0} inasistencias</b></span></p>
  <div class="grid g2"><div><b class="small">Servicios realizados</b>${c.services.map(s => `<div class="small">${e(s.name)} × ${s.n}</div>`).join('') || '<div class="small muted">—</div>'}</div>
  <div><b class="small">Profesionales elegidos</b>${c.professionals.map(s => `<div class="small">${e(s.name)} × ${s.n}</div>`).join('') || '<div class="small muted">—</div>'}</div></div>
  <label>Preferencias</label><textarea id="cpref" rows="2">${e(c.preferences || '')}</textarea><label>Notas internas</label><textarea id="cnotes" rows="2">${e(c.notes || '')}</textarea>
  <button class="btn sm" style="margin-top:6px" onclick="saveClient(${c.id},'${e(c.first_name)}','${e(c.last_name)}','${e(c.email || '')}')">Guardar notas</button>
  <h3 style="margin-top:14px">Historial de turnos</h3>${c.appointments.map(a => `<div class="list-item" style="cursor:pointer" onclick="openAppt(${a.id})"><span class="grow small">${fdt(a.start_at)} · ${a.items.map(i => e(i.service) + ' (' + e(i.professional.split(' ')[0]) + ')').join(' + ')}</span>${badge(a.status)}</div>`).join('')}
  ${c.reviews.length ? `<h3 style="margin-top:14px">Comentarios y fotos</h3>${c.reviews.map(r => `<div class="small">${'★'.repeat(r.rating)} ${e(r.comment)} ${r.photos.map(p => `<img src="${p}" style="width:60px;height:60px;object-fit:cover;border-radius:6px">`).join('')}</div>`).join('')}` : ''}`);
}
async function saveClient(id, f, l, em) { await aapi('/api/admin/clients/' + id, { method: 'PUT', body: { first_name: f, last_name: l, email: em, preferences: $('#cpref').value, notes: $('#cnotes').value } }); toast('Guardado'); }

/* ───────── Profesionales ───────── */
async function proDetail(id) {
  const p = await aapi('/api/admin/professionals/' + id);
  const canEdit = A.user.role === 'owner' || A.user.modules.includes('profesionales') && A.user.role !== 'employee';
  A._p = p;
  $('#main').innerHTML = H(`${avatar(p, 40)} ${e(p.name)}`, `<button class="btn" onclick="A.proId=null;show()">← Volver</button><button class="btn" onclick="A.ag.pro='${p.id}';A.ag.mode='week';location.hash='#/agenda'">Ver su agenda</button>`) +
  `<div class="grid g2"><div class="card"><h3>Perfil</h3><label>Nombre</label><input id="pn" value="${e(p.name)}"><label>Especialidades</label><input id="psp" value="${e(p.specialties)}"><label>Bio</label><textarea id="pb" rows="2">${e(p.bio)}</textarea>
    <div class="grid g3"><div><label>Color</label><input id="pc" type="color" value="${e(p.color)}" style="height:42px"></div><div><label>Capacidad simultánea</label><input id="pcap" type="number" min="1" max="5" value="${p.capacity}"></div><div><label>Foto (URL)</label><input id="pph" value="${e(p.photo || '')}"></div></div>
    <label class="row" style="color:var(--ink)"><input id="pact" type="checkbox" style="width:auto" ${p.active ? 'checked' : ''}> Activo</label>
    <div class="grid g4" style="margin-top:10px">${kpi(p.stats.total, 'Turnos')}${kpi(p.stats.done || 0, 'Finalizados')}${kpi(p.stats.cancels || 0, 'Cancelados')}${kpi(p.stats.noshows || 0, 'Inasistencias')}</div></div>
  <div class="card"><h3>Servicios habilitados</h3><label class="row" style="color:var(--ink)"><input id="pall" type="checkbox" style="width:auto" ${p.all_services ? 'checked' : ''} onchange="$('#psvcs').classList.toggle('hide',this.checked)"> Realiza todos los servicios</label>
    <div id="psvcs" class="${p.all_services ? 'hide' : ''}" style="columns:2;font-size:14px">${A.services.map(s => `<label class="row" style="color:var(--ink);font-weight:400;margin:2px 0"><input type="checkbox" class="psv" value="${s.id}" style="width:auto" ${p.services.includes(s.id) ? 'checked' : ''}> ${e(s.name)}</label>`).join('')}</div></div>
  <div class="card"><h3>Horarios laborales</h3><div id="psch">${p.schedules.map(schedRow).join('')}</div><button class="btn sm" onclick="$('#psch').insertAdjacentHTML('beforeend',schedRow({weekday:1,start:'09:00',end:'18:00'}))">+ Franja</button>
    <p class="small muted">Podés cargar varias franjas el mismo día (horario cortado).</p></div>
  <div class="card"><h3>Descansos y comidas</h3><div id="pbrk">${p.breaks.map(breakRow).join('')}</div><button class="btn sm" onclick="$('#pbrk').insertAdjacentHTML('beforeend',breakRow({weekday:1,start:'13:00',end:'14:00',type:'comida'}))">+ Descanso</button>
    <p class="small muted">Fijos por día de semana o variables para una fecha puntual.</p></div>
  <div class="card"><div class="row between"><h3>Vacaciones, licencias y bloqueos</h3><button class="btn sm" onclick="blockModal();$('#bp').value='${p.id}'">+ Agregar</button></div>
    ${p.absences.map(b => `<div class="list-item small"><span class="grow"><b>${e(b.type)}</b> ${b.start_date}${b.end_date !== b.start_date ? ' → ' + b.end_date : ''} ${b.start_time ? b.start_time + '–' + b.end_time : '(todo el día)'} · ${e(b.reason || '')}</span>
      <button class="btn sm" onclick="showAffected(${b.id})">Turnos afectados</button><button class="btn sm bad" onclick="delBlock(${b.id})">Quitar</button></div>`).join('') || '<p class="small muted">Sin ausencias cargadas.</p>'}</div>
  <div class="card"><h3>Duración real promedio</h3><table><tr><th>Servicio</th><th>Configurada</th><th>Promedio real</th><th>Registros</th></tr>${p.durations.map(d => `<tr><td>${e(d.name)}</td><td>${hm(d.configured)}</td><td><b>${hm(d.average)}</b></td><td>${d.records}</td></tr>`).join('') || '<tr><td colspan="4" class="muted small">Sin registros aún. Se cargan al finalizar turnos.</td></tr>'}</table></div></div>
  ${canEdit ? `<div style="position:sticky;bottom:0;background:var(--bg);padding:12px 0"><button class="btn pri big" onclick="savePro(${p.id})">Guardar cambios del profesional</button></div>` : ''}`;
}
const wdSel = (v, cls) => `<select class="${cls}">${DAYS_L.map((d, i) => `<option value="${i}" ${Number(v) === i ? 'selected' : ''}>${d}</option>`).join('')}</select>`;
const schedRow = s => `<div class="sched-row s-row">${wdSel(s.weekday, 's-wd')}<input type="time" class="s-st" value="${s.start}"><input type="time" class="s-en" value="${s.end}"><button class="btn sm" onclick="this.parentElement.remove()">✕</button></div>`;
const breakRow = b => `<div class="sched-row b-row" style="grid-template-columns:120px 1fr 1fr 1fr 40px">${b.date ? `<input type="date" class="b-date" value="${b.date}">` : `<div class="row" style="gap:2px">${wdSel(b.weekday, 'b-wd')}</div>`}
  <input type="time" class="b-st" value="${b.start}"><input type="time" class="b-en" value="${b.end}"><select class="b-ty"><option ${b.type === 'descanso' ? 'selected' : ''}>descanso</option><option ${b.type === 'comida' ? 'selected' : ''}>comida</option></select><button class="btn sm" onclick="this.parentElement.remove()">✕</button></div>`;
async function savePro(id) {
  const body = { name: $('#pn').value, specialties: $('#psp').value, bio: $('#pb').value, color: $('#pc').value, capacity: $('#pcap').value, photo: $('#pph').value, active: $('#pact').checked,
    all_services: $('#pall').checked, services: [...document.querySelectorAll('.psv:checked')].map(x => Number(x.value)),
    schedules: [...document.querySelectorAll('.s-row')].map(r => ({ weekday: r.querySelector('.s-wd').value, start: r.querySelector('.s-st').value, end: r.querySelector('.s-en').value })),
    breaks: [...document.querySelectorAll('.b-row')].map(r => ({ weekday: r.querySelector('.b-wd')?.value, date: r.querySelector('.b-date')?.value, start: r.querySelector('.b-st').value, end: r.querySelector('.b-en').value, type: r.querySelector('.b-ty').value })) };
  try {
    const r = await aapi('/api/admin/professionals/' + id, { method: 'PUT', body });
    A.pros = await aapi('/api/admin/professionals');
    toast(r.conflicts.length ? `Guardado. ⚠️ ${r.conflicts.length} turno(s) quedaron fuera del nuevo horario: revisalos en la agenda.` : 'Cambios guardados', 5000); show();
  } catch (ex) { err(ex); }
}
async function showAffected(id) { const list = await aapi(`/api/admin/absences/${id}/affected`); modal(`<div class="row between"><h2 style="margin:0">Turnos afectados</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>${list.length ? affectedHtml(list) : '<p class="muted">Ningún turno activo afectado.</p>'}`); }
async function newPro() { const name = prompt('Nombre del profesional:'); if (!name) return; const r = await aapi('/api/admin/professionals', { body: { name } }); A.pros = await aapi('/api/admin/professionals'); A.proId = r.id; show(); }

/* ───────── Servicios ───────── */
function editSvc(id) {
  const s = A.services.find(x => x.id === id) || { name: '', category: 'peluqueria', subcategory: '', description: '', price_min: 0, price_max: 0, base_duration: 30, extra_time: 0, prep_time: 5, cleanup_time: 5, min_advance_hours: 2, deposit_amount: 0, deposit_terms: '', cancel_hours: 24, late_cancel_terms: '', requirements: '', complex: 0, active: 1, professionals: [] };
  const n = (k, l) => `<div><label>${l}</label><input type="number" data-s="${k}" value="${s[k] ?? 0}"></div>`, t = (k, l) => `<div><label>${l}</label><input data-s="${k}" value="${e(s[k] || '')}"></div>`;
  modal(`<div class="row between"><h2 style="margin:0">${id ? 'Editar' : 'Nuevo'} servicio</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <div class="grid g2">${t('name', 'Nombre')}<div><label>Categoría</label><select data-s="category"><option value="peluqueria" ${s.category === 'peluqueria' ? 'selected' : ''}>Peluquería</option><option value="manicuria" ${s.category === 'manicuria' ? 'selected' : ''}>Manicuría</option></select></div>${t('subcategory', 'Subcategoría')}${t('description', 'Descripción')}</div>
  <div class="grid g3">${n('price_min', 'Precio mínimo')}${n('price_max', 'Precio máximo (= mínimo si es fijo)')}${n('base_duration', 'Duración inicial (min)')}${n('extra_time', 'Tiempo adicional (min)')}${n('prep_time', 'Preparación (min)')}${n('cleanup_time', 'Limpieza (min)')}
  ${n('min_advance_hours', 'Anticipación mínima (h)')}${n('deposit_amount', 'Seña requerida ($)')}${n('cancel_hours', 'Cancelación sin cargo hasta (h)')}</div>
  <div class="grid g2">${t('deposit_terms', 'Condiciones de seña')}${t('late_cancel_terms', 'Condiciones fuera de término')}${t('requirements', 'Requisitos')}</div>
  <div class="row"><label class="row" style="color:var(--ink)"><input type="checkbox" data-s="complex" style="width:auto" ${s.complex ? 'checked' : ''}> Química compleja (requiere evaluación)</label>
  <label class="row" style="color:var(--ink)"><input type="checkbox" data-s="active" style="width:auto" ${s.active ? 'checked' : ''}> Activo</label></div>
  ${id ? `<label>Profesionales habilitados</label><div class="row">${A.pros.map(p => `<label class="row" style="color:var(--ink);font-weight:400"><input type="checkbox" class="sp" value="${p.id}" style="width:auto" ${p.all_services ? 'checked disabled' : s.professionals.some(x => x.id === p.id) ? 'checked' : ''}> ${e(p.name)}${p.all_services ? ' (todos)' : ''}</label>`).join('')}</div>` : ''}
  ${id && s.questions?.length ? `<p class="small muted">Preguntas dinámicas: ${s.questions.map(q => e(q.label)).join(' · ')}</p>` : ''}
  <button class="btn pri" style="margin-top:12px" onclick="saveSvc(${id || 0})">Guardar</button>`);
}
async function saveSvc(id) {
  const b = {}; document.querySelectorAll('[data-s]').forEach(i => b[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value);
  if (id) b.professional_ids = [...document.querySelectorAll('.sp:checked:not(:disabled)')].map(x => Number(x.value));
  try { await aapi('/api/admin/services' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: b }); toast('Servicio guardado'); closeModal(); show(); } catch (ex) { err(ex); }
}

/* ───────── Promociones / KB / usuarios / settings ───────── */
function editPromo(p = { name: '', description: '', type: 'percent', value: 10, audience: 'all', weekdays: [], active: 1, start_date: today(), end_date: '' }) {
  modal(`<div class="row between"><h2 style="margin:0">Promoción</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <div class="grid g2"><div><label>Nombre</label><input id="pr_n" value="${e(p.name)}"></div><div><label>Descripción</label><input id="pr_d" value="${e(p.description)}"></div>
  <div><label>Tipo</label><select id="pr_t"><option value="percent" ${p.type === 'percent' ? 'selected' : ''}>Porcentaje</option><option value="amount" ${p.type === 'amount' ? 'selected' : ''}>Importe fijo</option></select></div><div><label>Valor</label><input id="pr_v" type="number" value="${p.value}"></div>
  <div><label>Servicio</label><select id="pr_s"><option value="">Todos</option>${A.services.map(s => `<option value="${s.id}" ${p.service_id === s.id ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select></div>
  <div><label>Profesional</label><select id="pr_p"><option value="">Todos</option>${A.pros.map(x => `<option value="${x.id}" ${p.professional_id === x.id ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></div>
  <div><label>Público</label><select id="pr_a">${[['all', 'Todos'], ['new', 'Nuevos'], ['recurrent', 'Recurrentes'], ['inactive', 'Inactivos']].map(([k, l]) => `<option value="${k}" ${p.audience === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  <div><label>Límite de usos</label><input id="pr_m" type="number" value="${p.max_uses || ''}"></div><div><label>Desde</label><input id="pr_sd" type="date" value="${p.start_date || ''}"></div><div><label>Hasta</label><input id="pr_ed" type="date" value="${p.end_date || ''}"></div></div>
  <label>Días</label><div class="row">${DAYS.map((d, i) => `<label class="row" style="color:var(--ink);font-weight:400"><input type="checkbox" class="pr_w" value="${i}" style="width:auto" ${p.weekdays.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
  <label class="row" style="color:var(--ink)"><input type="checkbox" id="pr_ac" style="width:auto" ${p.active ? 'checked' : ''}> Activa</label>
  <div class="row" style="margin-top:12px"><button class="btn pri" onclick="savePromo(${p.id || 0})">Guardar</button>${p.id ? `<button class="btn bad" onclick="aapi('/api/admin/promotions/${p.id}',{method:'DELETE',body:{}}).then(()=>{closeModal();show()})">Eliminar</button>` : ''}</div>`);
}
async function savePromo(id) {
  const b = { name: $('#pr_n').value, description: $('#pr_d').value, type: $('#pr_t').value, value: Number($('#pr_v').value), service_id: $('#pr_s').value, professional_id: $('#pr_p').value, audience: $('#pr_a').value,
    max_uses: $('#pr_m').value, start_date: $('#pr_sd').value || null, end_date: $('#pr_ed').value || null, weekdays: [...document.querySelectorAll('.pr_w:checked')].map(x => Number(x.value)), active: $('#pr_ac').checked };
  try { await aapi('/api/admin/promotions' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: b }); closeModal(); show(); } catch (ex) { err(ex); }
}
async function setReview(id, status, published) { await aapi('/api/admin/reviews/' + id, { method: 'PUT', body: { status, published } }); toast('Opinión actualizada'); show(); }
async function testBot(ev) { ev.preventDefault(); const r = await api('/api/public/assistant', { body: { question: $('#tb').value } }); $('#tbr').innerHTML = `<div class="note info" style="white-space:pre-line">${e(r.text)}</div><div class="small muted">Fuente: ${e(r.source)}</div>`; }
async function saveAi() { try { await aapi('/api/admin/ai', { method: 'PUT', body: { enabled: $('#aie').checked, max_tokens: $('#aim').value, daily_limit: $('#aid').value } }); toast('Guardado'); show(); } catch (ex) { err(ex); } }
function editKb(k = { question: '', answer: '', keywords: '' }) {
  modal(`<h2>Conocimiento del asistente</h2><label>Pregunta</label><input id="kq" value="${e(k.question)}"><label>Respuesta</label><textarea id="ka" rows="3">${e(k.answer)}</textarea>
  <label>Palabras clave (separadas por coma)</label><input id="kk" value="${e(k.keywords)}">
  <div class="row" style="margin-top:12px"><button class="btn pri" onclick="saveKb(${k.id || 0})">Guardar</button>${k.id ? `<button class="btn bad" onclick="aapi('/api/admin/knowledge/${k.id}',{method:'DELETE',body:{}}).then(()=>{closeModal();show()})">Eliminar</button>` : ''}<button class="btn" onclick="closeModal()">Cancelar</button></div>`);
}
async function saveKb(id) { try { await aapi('/api/admin/knowledge' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { question: $('#kq').value, answer: $('#ka').value, keywords: $('#kk').value } }); closeModal(); show(); } catch (ex) { err(ex); } }
async function saveSettings() {
  const s = await aapi('/api/admin/settings'); const b = { ...s.business }; document.querySelectorAll('[data-b]').forEach(i => b[i.dataset.b] = i.value);
  try { await aapi('/api/admin/settings', { method: 'PUT', body: { business: b, booking_horizon_days: Number($('#s_h').value), reminder_hours: Number($('#s_r').value), learning_min_records: Number($('#s_l').value),
    noshow_deposit_after: Number($('#s_d').value), noshow_block_after: Number($('#s_b').value), promos_require_registration: $('#s_p').checked } }); toast('Configuración guardada'); } catch (ex) { err(ex); }
}
function editUser(u = { name: '', email: '', role: 'employee', permissions: [], active: 1 }) {
  const mods = ['agenda', 'solicitudes', 'clientes', 'profesionales', 'servicios', 'promociones', 'opiniones', 'recordatorios', 'estadisticas', 'asistente'];
  modal(`<h2>${u.id ? 'Editar' : 'Nuevo'} usuario</h2><div class="grid g2"><div><label>Nombre</label><input id="un" value="${e(u.name)}"></div><div><label>Email</label><input id="ue" value="${e(u.email)}" ${u.id ? 'disabled' : ''}></div>
  <div><label>Rol</label><select id="ur">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  <div><label>Profesional asociado (empleados)</label><select id="upr"><option value="">—</option>${A.pros.map(p => `<option value="${p.id}" ${u.professional_id === p.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></div>
  <div><label>${u.id ? 'Nueva contraseña (opcional)' : 'Contraseña (mín. 8)'}</label><input id="uw" type="password"></div></div>
  <label>Módulos habilitados para encargados</label><div class="row">${mods.map(m => `<label class="row" style="color:var(--ink);font-weight:400"><input type="checkbox" class="um" value="${m}" style="width:auto" ${u.permissions.includes(m) ? 'checked' : ''}>${m}</label>`).join('')}</div>
  <label class="row" style="color:var(--ink)"><input type="checkbox" id="ua" style="width:auto" ${u.active ? 'checked' : ''}> Activo</label>
  <div class="row" style="margin-top:12px"><button class="btn pri" onclick="saveUser(${u.id || 0})">Guardar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`);
}
async function saveUser(id) {
  const b = { name: $('#un').value, email: $('#ue').value, role: $('#ur').value, professional_id: $('#upr').value, password: $('#uw').value || undefined, active: $('#ua').checked, permissions: [...document.querySelectorAll('.um:checked')].map(x => x.value) };
  try { await aapi('/api/admin/users' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: b }); closeModal(); show(); } catch (ex) { err(ex); }
}

boot();
