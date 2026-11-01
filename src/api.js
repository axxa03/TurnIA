// API REST de TurnIA. Toda validación de negocio se hace aquí (backend).
const { all, get, run, tx, getSetting, setSetting } = require('./db');
const engine = require('./engine');
const T = require('./time');
const auth = require('./auth');
const assistant = require('./assistant');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };
const J = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const phoneNorm = p => String(p || '').replace(/\D/g, '').replace(/^54/, '').replace(/^9/, '').slice(-10);
const money = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
const STATUSES = ['pendiente', 'confirmada', 'en_curso', 'finalizada', 'cancelada', 'reprogramacion', 'no_asistio'];
const STATUS_LABEL = { pendiente: 'Pendiente de confirmación', confirmada: 'Confirmada', en_curso: 'En curso', finalizada: 'Finalizada', cancelada: 'Cancelada', reprogramacion: 'Reprogramación solicitada', no_asistio: 'No asistió' };
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const routes = [];
const route = (method, pattern, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, fn, ...opts });
};

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 4e6) fail(413, 'Contenido demasiado grande'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'JSON inválido'); }
}

async function handle(req, res, url) {
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) return send(404, { error: 'No encontrado' });
    const m = url.pathname.match(r.re); const params = {}; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
    const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const ctx = { params, body, query: Object.fromEntries(url.searchParams), token };
    if (r.module) {
      const p = auth.verify(token);
      if (!p || p.kind !== 'staff') fail(401, 'Sesión expirada. Ingresá nuevamente.');
      const u = get('SELECT * FROM users WHERE id = ? AND active = 1', p.uid);
      if (!u) fail(401, 'Usuario inactivo');
      u.permissions = J(u.permissions, []);
      if (!auth.can(u, r.module)) fail(403, 'No tenés permiso para esta sección.');
      ctx.user = u;
    }
    send(200, await r.fn(ctx));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e instanceof HttpError ? e.message : 'Error interno' });
  }
}

/* ───────────── helpers de dominio ───────────── */
function clientStats(cid) {
  return get(`SELECT COUNT(*) total, SUM(status='finalizada') done, SUM(status='cancelada') cancels, SUM(status='no_asistio') noshows,
    MAX(CASE WHEN status='finalizada' THEN start_at END) last_visit FROM appointments WHERE client_id = ?`, cid);
}
function upsertClient(c) {
  const phone = phoneNorm(c.phone);
  if (phone.length < 8) fail(400, 'Ingresá un teléfono válido (con código de área).');
  if (!c.first_name?.trim() || !c.last_name?.trim()) fail(400, 'Nombre y apellido son obligatorios.');
  const ex = get('SELECT * FROM clients WHERE phone = ?', phone);
  if (ex) {
    run('UPDATE clients SET first_name = ?, last_name = ?, email = COALESCE(?, email) WHERE id = ?', c.first_name.trim(), c.last_name.trim(), c.email || null, ex.id);
    return ex.id;
  }
  return Number(run('INSERT INTO clients(first_name,last_name,phone,email,created_at) VALUES(?,?,?,?,?)', c.first_name.trim(), c.last_name.trim(), phone, c.email || null, T.nowLocal()).lastInsertRowid);
}
function notify(type, message, ref) { run('INSERT INTO notifications(type,message,ref,created_at) VALUES(?,?,?,?)', type, message, ref || null, T.nowLocal()); }
function history(aid, action, detail, user) { run('INSERT INTO appointment_history(appointment_id,action,detail,user,at) VALUES(?,?,?,?,?)', aid, action, detail || '', user || 'cliente', T.nowLocal()); }

function bestPromo(clientId, items, date) {
  const client = get('SELECT * FROM clients WHERE id = ?', clientId);
  if (getSetting('promos_require_registration', true) && !client?.registered) return null;
  const st = clientStats(clientId);
  const wd = T.weekday(date);
  const subtotal = items.reduce((a, i) => a + i.price_min, 0);
  let best = null;
  for (const p of all('SELECT * FROM promotions WHERE active = 1 AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)', date, date)) {
    if (p.max_uses && p.uses >= p.max_uses) continue;
    const wds = J(p.weekdays, []); if (wds.length && !wds.includes(wd)) continue;
    if (p.audience === 'new' && st.done > 0) continue;
    if (p.audience === 'recurrent' && st.done < 2) continue;
    if (p.audience === 'inactive' && (!st.last_visit || T.stamp(st.last_visit) > T.stamp(T.nowLocal()) - 60 * 1440)) continue;
    const base = items.filter(i => (!p.service_id || i.service_id === p.service_id) && (!p.professional_id || i.professional_id === p.professional_id)).reduce((a, i) => a + i.price_min, 0);
    if (!base) continue;
    const disc = Math.min(base, p.type === 'percent' ? base * p.value / 100 : p.value);
    if (!best || disc > best.discount) best = { id: p.id, name: p.name, discount: Math.round(disc) };
  }
  return best && best.discount <= subtotal ? best : null;
}

// Arma los ítems del turno a partir de lo que pide el cliente, recalculando todo en el servidor.
function buildItems(services, choice) {
  const ests = services.map(s => {
    const svc = engine.getService(Number(s.id)); if (!svc || !svc.active) fail(400, 'Servicio inexistente');
    return { est: engine.estimate(svc, s.answers || {}), answers: s.answers || {} };
  });
  const items = [];
  for (const g of choice) { // [{ professional_id, block_start, service_ids:[...] }] en orden
    const pro = get('SELECT * FROM professionals WHERE id = ?', Number(g.professional_id)); if (!pro) fail(400, 'Profesional inválido');
    const groupEsts = g.service_ids.map(id => ests.find(e => e.est.service_id === Number(id))).filter(Boolean);
    if (!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(g.block_start || '')) fail(400, 'Horario inválido');
    const planned = engine.planGroup({ estimates: groupEsts.map(e => e.est) }, pro, g.block_start);
    planned.forEach((p, k) => items.push({ ...p, answers: groupEsts[k].answers }));
  }
  if (items.length !== ests.length) fail(400, 'La selección de horario no coincide con los servicios.');
  return { items, ests };
}

function createAppointment({ clientId, services, choice, notes, mode, source, status, user, admin }) {
  const { items, ests } = buildItems(services, choice);
  if (admin) items.forEach(i => i._admin = true);
  const client = get('SELECT * FROM clients WHERE id = ?', clientId);
  const st = clientStats(clientId);
  const blockAfter = getSetting('noshow_block_after', 3), depAfter = getSetting('noshow_deposit_after', 1);
  if (!admin && st.noshows >= blockAfter) fail(403, 'Registramos inasistencias previas. Para reservar comunicate con el local.');
  return tx(() => {
    const err = engine.validateItems(items);
    if (err) fail(409, err);
    const start = items.map(i => i.start_at).sort()[0], end = items.map(i => i.end_at).sort().at(-1);
    const pmin = items.reduce((a, i) => a + i.price_min, 0), pmax = items.reduce((a, i) => a + i.price_max, 0);
    let deposit = ests.reduce((a, e) => a + (e.est.deposit || 0), 0);
    let finalStatus = status || 'confirmada';
    if (!admin && st.noshows >= depAfter) { deposit = Math.max(deposit, Math.round(pmin * 0.3)); finalStatus = 'pendiente'; }
    const promo = bestPromo(clientId, items, start.slice(0, 10));
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const a = run(`INSERT INTO appointments(code,client_id,status,mode,start_at,end_at,price_min,price_max,discount,promo_id,deposit_required,deposit_status,notes,source,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, code, clientId, finalStatus, mode || (items.length > 1 ? 'combinado' : 'simple'), start, end, pmin, pmax,
      promo?.discount || 0, promo?.id || null, deposit, deposit ? 'pendiente' : 'no_requerida', notes || '', source || 'web', T.nowLocal());
    const aid = Number(a.lastInsertRowid);
    for (const i of items) run(`INSERT INTO appointment_items(appointment_id,service_id,professional_id,start_at,end_at,block_start,block_end,answers,est_duration,price_min,price_max,signature)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, aid, i.service_id, i.professional_id, i.start_at, i.end_at, i.block_start, i.block_end, JSON.stringify(i.answers || {}), i.est_duration, i.price_min, i.price_max, i.signature);
    if (promo) run('UPDATE promotions SET uses = uses + 1 WHERE id = ?', promo.id);
    history(aid, 'creada', `${STATUS_LABEL[finalStatus]} · ${items.map(i => i.service).join(' + ')}`, user || 'cliente (web)');
    notify('reserva', `Nueva reserva ${code}: ${client.first_name} ${client.last_name} · ${items.map(i => i.service).join(' + ')} · ${start}`, String(aid));
    return appointmentDetail(aid);
  });
}

function appointmentDetail(id) {
  const a = get(`SELECT a.*, c.first_name, c.last_name, c.phone, c.email, c.registered FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.id = ?`, id);
  if (!a) return null;
  a.items = all(`SELECT i.*, s.name service, s.category, s.cancel_hours, s.late_cancel_terms, s.deposit_terms, s.requirements, s.complex, p.name professional, p.color
    FROM appointment_items i JOIN services s ON s.id = i.service_id JOIN professionals p ON p.id = i.professional_id WHERE appointment_id = ? ORDER BY block_start`, id)
    .map(i => ({ ...i, answers: J(i.answers, {}) }));
  a.status_label = STATUS_LABEL[a.status];
  a.promo = a.promo_id ? get('SELECT name FROM promotions WHERE id = ?', a.promo_id)?.name : null;
  a.cancel_hours = Math.max(...a.items.map(i => i.cancel_hours || 24));
  return a;
}

function cancelAppointment(a, reason, by) {
  if (['cancelada', 'finalizada', 'no_asistio'].includes(a.status)) fail(400, 'El turno no se puede cancelar en su estado actual.');
  const hoursLeft = (T.stamp(a.start_at) - T.stamp(T.nowLocal())) / 60;
  const late = hoursLeft < a.cancel_hours;
  const penalty = late ? (a.deposit_paid || 0) : 0;
  const refund = !late && a.deposit_paid > 0 ? 'pendiente_devolucion' : late && a.deposit_paid > 0 ? 'seña_retenida' : null;
  run('UPDATE appointments SET status = ?, cancel_reason = ?, cancel_penalty = ?, refund_status = ? WHERE id = ?', 'cancelada', reason || '', penalty, refund, a.id);
  history(a.id, 'cancelada', `${late ? 'Fuera de término' : 'En término'} (${Math.max(0, Math.round(hoursLeft))} h antes). ${reason || ''}${refund ? ' · ' + refund.replace('_', ' ') : ''}`, by);
  notify('cancelacion', `Cancelación ${a.code}: ${a.first_name} ${a.last_name} (${a.start_at})${late ? ' — fuera de término' : ''}`, String(a.id));
  return { late, penalty, refund };
}

/* ───────────── PÚBLICO ───────────── */
function publicServices() {
  return all('SELECT * FROM services WHERE active = 1 ORDER BY category, subcategory, name').map(s => {
    const svc = engine.parseService(s); const est = engine.estimate(svc, {});
    return { id: s.id, name: s.name, category: s.category, subcategory: s.subcategory, description: s.description, price_min: s.price_min, price_max: s.price_max,
      duration: est.duration, deposit_amount: s.deposit_amount, deposit_terms: s.deposit_terms, cancel_hours: s.cancel_hours, late_cancel_terms: s.late_cancel_terms,
      requirements: s.requirements, complex: !!s.complex, min_advance_hours: s.min_advance_hours, questions: svc.questions, learned: est.learned };
  });
}
function publicPros() {
  return all('SELECT * FROM professionals WHERE active = 1').map(p => ({
    id: p.id, name: p.name, photo: p.photo, bio: p.bio, specialties: p.specialties, color: p.color,
    services: p.all_services ? all('SELECT id FROM services WHERE active = 1').map(s => s.id) : all('SELECT service_id id FROM professional_services WHERE professional_id = ?', p.id).map(s => s.id),
    schedule: all('SELECT weekday, start, end FROM schedules WHERE professional_id = ? ORDER BY weekday, start', p.id),
  }));
}

route('GET', '/api/public/info', () => ({
  business: getSetting('business', {}), services: publicServices(), professionals: publicPros(), now: T.nowLocal(),
  promotions: all('SELECT id,name,description,type,value,audience,end_date FROM promotions WHERE active = 1 AND (end_date IS NULL OR end_date >= ?)', T.today()),
  reviews: all(`SELECT r.rating, r.comment, r.photos, r.photo_consent, r.created_at, s.name service, p.name professional, c.first_name
    FROM reviews r LEFT JOIN services s ON s.id=r.service_id LEFT JOIN professionals p ON p.id=r.professional_id LEFT JOIN clients c ON c.id=r.client_id
    WHERE r.published = 1 AND r.status = 'aprobada' ORDER BY r.created_at DESC LIMIT 12`).map(r => ({ ...r, photos: r.photo_consent ? J(r.photos, []) : [] })),
  promos_require_registration: getSetting('promos_require_registration', true),
}));

route('POST', '/api/public/lookup', ({ body }) => {
  const c = get('SELECT * FROM clients WHERE phone = ?', phoneNorm(body.phone));
  if (!c) return { exists: false };
  const st = clientStats(c.id);
  const last = get(`SELECT s.name service, p.name professional, a.start_at FROM appointments a JOIN appointment_items i ON i.appointment_id=a.id
    JOIN services s ON s.id=i.service_id JOIN professionals p ON p.id=i.professional_id WHERE a.client_id=? AND a.status='finalizada' ORDER BY a.start_at DESC LIMIT 1`, c.id);
  return { exists: true, first_name: c.first_name, last_name: c.last_name, registered: !!c.registered, visits: st.done || 0, last };
});

route('POST', '/api/public/register', ({ body }) => {
  if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) fail(400, 'Ingresá un email válido.');
  if (!body.password || String(body.password).length < 6) fail(400, 'La contraseña debe tener al menos 6 caracteres.');
  const id = upsertClient(body);
  run('UPDATE clients SET registered = 1, email = ?, password_hash = ? WHERE id = ?', body.email, auth.hashPassword(body.password), id);
  return { ok: true, token: auth.sign({ kind: 'client', cid: id }, 24 * 30) };
});
route('POST', '/api/public/login', ({ body }) => {
  const c = get('SELECT * FROM clients WHERE phone = ?', phoneNorm(body.phone));
  if (!c || !auth.verifyPassword(body.password, c.password_hash)) fail(401, 'Teléfono o contraseña incorrectos.');
  return { token: auth.sign({ kind: 'client', cid: c.id }, 24 * 30) };
});
route('GET', '/api/public/me', ({ token }) => {
  const p = auth.verify(token); if (!p || p.kind !== 'client') fail(401, 'Ingresá nuevamente.');
  const c = get('SELECT id, first_name, last_name, phone, email, registered, preferences FROM clients WHERE id = ?', p.cid);
  const appts = all('SELECT id FROM appointments WHERE client_id = ? ORDER BY start_at DESC', c.id).map(a => appointmentDetail(a.id));
  return { client: c, stats: clientStats(c.id), appointments: appts };
});

route('POST', '/api/public/estimate', ({ body }) => (body.services || []).map(s => {
  const svc = engine.getService(Number(s.id)); if (!svc) fail(400, 'Servicio inexistente');
  return engine.estimate(svc, s.answers || {});
}));

function availability(body) {
  const byCat = {};
  for (const s of body.services || []) {
    const svc = engine.getService(Number(s.id)); if (!svc) fail(400, 'Servicio inexistente');
    (byCat[svc.category] ??= []).push(engine.estimate(svc, s.answers || {}));
  }
  const cats = Object.keys(byCat);
  if (!cats.length) fail(400, 'Elegí al menos un servicio.');
  const groups = cats.map(c => ({ category: c, estimates: byCat[c], pro: (body.pros || {})[c] || 'recommend' }));
  for (const g of groups) if (!engine.eligiblePros(g.estimates.map(e => e.service_id)).length)
    fail(400, `No hay un profesional que realice todos los servicios de ${g.category} juntos. Elegí menos servicios o reservalos por separado.`);
  const days = Math.min(Number(body.days) || 7, 21);
  const r = engine.search({ groups, dateFrom: body.dateFrom, days, timePref: body.timePref || 'any', weekdays: body.weekdays, excludeApptId: Number(body.exclude) || 0 });
  const toChoice = o => {
    const ch = []; for (const i of o.items) {
      const last = ch.at(-1);
      if (last && last.professional_id === i.professional_id && last.end === i.block_start) { last.service_ids.push(i.service_id); last.end = i.block_end; }
      else ch.push({ professional_id: i.professional_id, block_start: i.block_start, service_ids: [i.service_id], end: i.block_end });
    }
    return { ...o, choice: ch.map(({ end, ...c }) => c) };
  };
  return { groups: groups.map(g => ({ category: g.category, estimates: g.estimates })), single: r.single.map(toChoice), simultaneous: r.simultaneous.map(toChoice), consecutive: r.consecutive.map(toChoice) };
}
route('POST', '/api/public/availability', ({ body }) => availability(body));

route('POST', '/api/public/book', ({ body }) => {
  if (!Array.isArray(body.choice) || !body.choice.length) fail(400, 'Elegí un horario.');
  const clientId = upsertClient(body.client || {});
  if (body.client?.preferences) run('UPDATE clients SET preferences = ? WHERE id = ?', String(body.client.preferences).slice(0, 300), clientId);
  return createAppointment({ clientId, services: body.services, choice: body.choice, notes: String(body.notes || '').slice(0, 500), mode: body.mode, source: 'web' });
});

route('POST', '/api/public/request', ({ body }) => {
  const clientId = upsertClient(body.client || {});
  const ests = (body.services || []).map(s => engine.estimate(engine.getService(Number(s.id)), s.answers || {}));
  if (!ests.length) fail(400, 'Indicá el servicio.');
  const id = run(`INSERT INTO requests(client_id,service_ids,est_duration,preference,flexibility,urgency,event_date,professional_id,accepts_alternatives,status,notes,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, clientId, JSON.stringify(ests.map(e => e.service_id)), ests.reduce((a, e) => a + e.duration + e.prep + e.cleanup, 0),
    String(body.preference || '').slice(0, 200), body.flexibility || 'media', body.urgency || 'media', body.event_date || null,
    Number(body.professional_id) || null, body.accepts_alternatives ? 1 : 0, 'abierta', String(body.notes || '').slice(0, 300), T.nowLocal()).lastInsertRowid;
  notify('solicitud', `Nueva solicitud en lista de espera: ${ests.map(e => e.name).join(' + ')}`, String(id));
  return { ok: true, id: Number(id) };
});

function publicAppt(code, phone) {
  const a = get('SELECT a.id FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.code = ? AND c.phone = ?', String(code).toUpperCase(), phoneNorm(phone));
  if (!a) fail(404, 'No encontramos un turno con ese código y teléfono.');
  return appointmentDetail(a.id);
}
route('GET', '/api/public/appointment/:code', ({ params, query }) => {
  const a = publicAppt(params.code, query.phone);
  a.review = get('SELECT rating, comment, status FROM reviews WHERE appointment_id = ?', a.id);
  return a;
});
route('POST', '/api/public/appointment/:code/cancel', ({ params, body }) => {
  const a = publicAppt(params.code, body.phone);
  return tx(() => ({ ...cancelAppointment(a, body.reason, 'cliente (web)'), appointment: appointmentDetail(a.id) }));
});
route('POST', '/api/public/appointment/:code/reschedule', ({ params, body }) => {
  const a = publicAppt(params.code, body.phone);
  if (!['confirmada', 'pendiente'].includes(a.status)) fail(400, 'Este turno no admite reprogramación.');
  run('UPDATE appointments SET status = ? WHERE id = ?', 'reprogramacion', a.id);
  history(a.id, 'reprogramacion_solicitada', String(body.note || '').slice(0, 300), 'cliente (web)');
  notify('cambio', `Solicitud de reprogramación ${a.code}: ${a.first_name} ${a.last_name} — "${String(body.note || '').slice(0, 80)}"`, String(a.id));
  return appointmentDetail(a.id);
});
route('POST', '/api/public/appointment/:code/review', ({ params, body }) => {
  const a = publicAppt(params.code, body.phone);
  if (a.status !== 'finalizada') fail(400, 'Podés opinar cuando el servicio esté finalizado.');
  if (get('SELECT 1 FROM reviews WHERE appointment_id = ?', a.id)) fail(400, 'Ya dejaste tu opinión. ¡Gracias!');
  const rating = Math.max(1, Math.min(5, Number(body.rating) || 5));
  const photos = (Array.isArray(body.photos) ? body.photos : []).filter(p => /^data:image\/(png|jpe?g|webp);base64,/.test(p) && p.length < 900e3).slice(0, 3);
  run('INSERT INTO reviews(appointment_id,client_id,service_id,professional_id,rating,comment,photos,photo_consent,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    a.id, a.client_id, a.items[0].service_id, a.items[0].professional_id, rating, String(body.comment || '').slice(0, 800), JSON.stringify(photos), body.consent ? 1 : 0, T.nowLocal());
  notify('opinion', `Nueva opinión (${rating}★) de ${a.first_name} — pendiente de revisión`, String(a.id));
  return { ok: true };
});
route('POST', '/api/public/assistant', async ({ body }) => assistant.answer(String(body.question || '').slice(0, 400)));

/* ───────────── ADMIN ───────────── */
route('POST', '/api/admin/login', ({ body }) => {
  const u = get('SELECT * FROM users WHERE email = ? AND active = 1', String(body.email || '').toLowerCase().trim());
  if (!u || !auth.verifyPassword(body.password, u.password_hash)) fail(401, 'Email o contraseña incorrectos.');
  return { token: auth.sign({ kind: 'staff', uid: u.id }), user: staffInfo(u) };
});
const staffInfo = u => { const p = Array.isArray(u.permissions) ? u.permissions : J(u.permissions, []); const x = { ...u, permissions: p };
  return { id: u.id, name: u.name, email: u.email, role: u.role, professional_id: u.professional_id, modules: auth.MODULES.filter(m => auth.can(x, m)) }; };
route('GET', '/api/admin/me', { module: 'dashboard' }, ({ user }) => staffInfo(user));

const scopePro = (user, q) => user.role === 'employee' ? user.professional_id : (Number(q) || null);

route('GET', '/api/admin/dashboard', { module: 'dashboard' }, ({ user }) => {
  const td = T.today(), now = T.nowLocal(), proF = user.role === 'employee' ? user.professional_id : null;
  const pf = proF ? ` AND a.id IN (SELECT appointment_id FROM appointment_items WHERE professional_id = ${Number(proF)})` : '';
  const list = (where, ...p) => all(`SELECT a.id FROM appointments a WHERE ${where}${pf} ORDER BY a.start_at`, ...p).map(r => appointmentDetail(r.id));
  const todayA = list("substr(a.start_at,1,10) = ? AND a.status != 'cancelada'", td);
  const upcoming = list("a.start_at > ? AND substr(a.start_at,1,10) > ? AND a.status IN ('pendiente','confirmada','reprogramacion')", now, td).slice(0, 8);
  const pros = all('SELECT * FROM professionals WHERE active = 1').filter(p => !proF || p.id === proF).map(p => {
    const wins = engine.freeWindows(p.id, td); const avail = wins.reduce((a, [s, e]) => a + e - s, 0);
    const busy = get(`SELECT COALESCE(SUM((julianday(replace(i.block_end,' ','T'))-julianday(replace(i.block_start,' ','T')))*1440),0) m FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id
      WHERE i.professional_id=? AND substr(i.block_start,1,10)=? AND a.status IN ${engine.ACTIVE.replace(')', ",'finalizada')")}`, p.id, td).m;
    const free = []; for (const [s, e] of wins) {
      let cur = s; const items = all(`SELECT i.block_start, i.block_end FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id WHERE i.professional_id=? AND substr(i.block_start,1,10)=? AND a.status IN ${engine.ACTIVE} ORDER BY i.block_start`, p.id, td);
      for (const it of items) { const bs = T.toMin(it.block_start.slice(11)), be = T.toMin(it.block_end.slice(11)); if (bs > cur && bs <= e) free.push([cur, Math.min(bs, e)]); cur = Math.max(cur, be); }
      if (cur < e) free.push([cur, e]);
    }
    return { id: p.id, name: p.name, color: p.color, available_min: avail, busy_min: Math.round(busy), occupancy: avail ? Math.min(100, Math.round(busy / avail * 100)) : 0,
      free: free.filter(([s, e]) => e - s >= 30).map(([s, e]) => `${T.fromMin(s)}–${T.fromMin(e)}`) };
  });
  const since = T.addDays(td, -30) + ' 00:00';
  const k = get(`SELECT SUM(status='cancelada') cancels, SUM(status='no_asistio') noshows, SUM(status='reprogramacion') changes,
    SUM(CASE WHEN status IN ('confirmada','pendiente','en_curso','finalizada') THEN price_min - discount ELSE 0 END) revenue,
    SUM(CASE WHEN deposit_status='pendiente' AND status NOT IN ('cancelada') THEN deposit_required - deposit_paid ELSE 0 END) deposits_pending
    FROM appointments a WHERE created_at >= ? ${pf}`, since);
  const clientsNew = get('SELECT COUNT(*) n FROM clients WHERE created_at >= ?', since).n;
  const recurrent = get(`SELECT COUNT(*) n FROM (SELECT client_id FROM appointments WHERE status='finalizada' GROUP BY client_id HAVING COUNT(*) >= 2)`).n;
  const openReq = get("SELECT COUNT(*) n FROM requests WHERE status = 'abierta'").n;
  const lostReq = get("SELECT COUNT(*) n FROM requests WHERE status = 'perdida'").n;
  const changeReq = list("a.status = 'reprogramacion'");
  const pendingDeposits = list("a.deposit_status = 'pendiente' AND a.status NOT IN ('cancelada','no_asistio')").slice(0, 6);
  const opportunities = [];
  for (const p of pros) if (p.free.length && p.occupancy < 60) opportunities.push({ type: 'hueco', text: `${p.name} tiene ${p.free.length} hueco(s) libres hoy (${p.free.slice(0, 3).join(', ')}). Ofrecelos a la lista de espera.` });
  if (openReq) opportunities.push({ type: 'espera', text: `${openReq} solicitud(es) en lista de espera sin turno asignado.`, link: 'solicitudes' });
  const inactive = all(`SELECT c.id, c.first_name, c.last_name, MAX(a.start_at) last FROM clients c JOIN appointments a ON a.client_id=c.id AND a.status='finalizada'
    GROUP BY c.id HAVING last < ? AND c.id NOT IN (SELECT client_id FROM appointments WHERE start_at > ?)`, T.addDays(td, -30) + ' 00:00', now);
  if (inactive.length) opportunities.push({ type: 'inactivos', text: `${inactive.length} cliente(s) sin volver hace más de 30 días: ${inactive.slice(0, 3).map(c => c.first_name).join(', ')}… Enviales la promo "Te extrañamos".`, link: 'clientes' });
  const cancelled = all("SELECT a.id FROM appointments a WHERE a.status='cancelada' AND a.start_at > ?", now);
  if (cancelled.length) opportunities.push({ type: 'cancelados', text: `${cancelled.length} turno(s) cancelado(s) liberaron horarios futuros.`, link: 'agenda' });
  const conflicts = findConflicts().length;
  return { today: todayA, upcoming, pros, kpis: { ...k, clientsNew, recurrent, openReq, lostReq, conflicts }, changeReq, pendingDeposits, opportunities,
    notifications: all('SELECT * FROM notifications WHERE read = 0 ORDER BY id DESC LIMIT 15') };
});
route('POST', '/api/admin/notifications/read', { module: 'dashboard' }, () => { run('UPDATE notifications SET read = 1'); return { ok: true }; });

route('GET', '/api/admin/appointments', { module: 'agenda' }, ({ query, user }) => {
  const from = query.from || T.today(), to = query.to || from;
  const pro = scopePro(user, query.professional_id);
  let sql = `SELECT DISTINCT a.id FROM appointments a JOIN appointment_items i ON i.appointment_id = a.id WHERE substr(a.start_at,1,10) BETWEEN ? AND ?`;
  const p = [from, to];
  if (pro) { sql += ' AND i.professional_id = ?'; p.push(pro); }
  if (query.service_id) { sql += ' AND i.service_id = ?'; p.push(Number(query.service_id)); }
  if (query.status) { sql += ' AND a.status = ?'; p.push(query.status); }
  if (query.q) { sql += " AND a.client_id IN (SELECT id FROM clients WHERE first_name || ' ' || last_name LIKE ? OR phone LIKE ?)"; p.push(`%${query.q}%`, `%${query.q}%`); }
  const appts = all(sql + ' ORDER BY a.start_at', ...p).map(r => appointmentDetail(r.id));
  const blocks = all(`SELECT a.*, p.name professional FROM absences a LEFT JOIN professionals p ON p.id = a.professional_id WHERE start_date <= ? AND end_date >= ?`, to, from)
    .filter(b => !pro || !b.professional_id || b.professional_id === pro);
  return { appointments: appts, blocks, conflicts: findConflicts().map(c => c.appointment_id) };
});
route('GET', '/api/admin/appointments/:id', { module: 'agenda' }, ({ params }) => {
  const a = appointmentDetail(Number(params.id)); if (!a) fail(404, 'Turno inexistente');
  a.history = all('SELECT * FROM appointment_history WHERE appointment_id = ? ORDER BY id DESC', a.id);
  a.payments = all('SELECT * FROM payments WHERE appointment_id = ? ORDER BY id', a.id);
  a.client_stats = clientStats(a.client_id);
  a.conflict = findConflicts().some(c => c.appointment_id === a.id);
  return a;
});
route('POST', '/api/admin/availability', { module: 'agenda' }, ({ body }) => availability(body));
route('POST', '/api/admin/appointments', { module: 'agenda' }, ({ body, user }) => {
  const clientId = body.client_id ? Number(body.client_id) : upsertClient(body.client || {});
  return createAppointment({ clientId, services: body.services, choice: body.choice, notes: body.notes, mode: body.mode, source: 'admin', status: body.status || 'confirmada', user: user.name, admin: true });
});
route('POST', '/api/admin/appointments/:id/status', { module: 'agenda' }, ({ params, body, user }) => {
  const a = appointmentDetail(Number(params.id)); if (!a) fail(404, 'Turno inexistente');
  if (!STATUSES.includes(body.status)) fail(400, 'Estado inválido');
  if (user.role === 'employee' && !a.items.some(i => i.professional_id === user.professional_id)) fail(403, 'Solo podés gestionar tus turnos.');
  return tx(() => {
    if (body.status === 'cancelada') { cancelAppointment(a, body.reason, user.name); return appointmentDetail(a.id); }
    if (['confirmada', 'pendiente', 'en_curso'].includes(body.status) && ['cancelada', 'no_asistio'].includes(a.status)) {
      const err = engine.validateItems(a.items.map(i => ({ ...i, _admin: true })), a.id); if (err) fail(409, 'No se puede reactivar: ' + err);
    }
    run('UPDATE appointments SET status = ? WHERE id = ?', body.status, a.id);
    for (const d of body.durations || []) {
      const n = Number(d.actual); if (n > 0 && n < 600) run('UPDATE appointment_items SET actual_duration = ? WHERE id = ? AND appointment_id = ?', Math.round(n), Number(d.item_id), a.id);
    }
    history(a.id, 'estado', `${STATUS_LABEL[a.status]} → ${STATUS_LABEL[body.status]}${(body.durations || []).length ? ' · duración real registrada' : ''}${body.reason ? ' · ' + body.reason : ''}`, user.name);
    if (body.status === 'no_asistio') notify('inasistencia', `Inasistencia: ${a.first_name} ${a.last_name} (${a.code})`, String(a.id));
    return appointmentDetail(a.id);
  });
});
route('POST', '/api/admin/appointments/:id/reschedule', { module: 'agenda' }, ({ params, body, user }) => {
  const a = appointmentDetail(Number(params.id)); if (!a) fail(404, 'Turno inexistente');
  const services = a.items.map(i => ({ id: i.service_id, answers: i.answers }));
  const { items } = buildItems(services, body.choice);
  return tx(() => {
    const err = engine.validateItems(items.map(i => ({ ...i, _admin: true })), a.id); if (err) fail(409, err);
    run('DELETE FROM appointment_items WHERE appointment_id = ?', a.id);
    for (const i of items) run(`INSERT INTO appointment_items(appointment_id,service_id,professional_id,start_at,end_at,block_start,block_end,answers,est_duration,price_min,price_max,signature)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, a.id, i.service_id, i.professional_id, i.start_at, i.end_at, i.block_start, i.block_end, JSON.stringify(i.answers || {}), i.est_duration, i.price_min, i.price_max, i.signature);
    const start = items.map(i => i.start_at).sort()[0], end = items.map(i => i.end_at).sort().at(-1);
    run('UPDATE appointments SET start_at = ?, end_at = ?, status = ? WHERE id = ?', start, end, 'confirmada', a.id);
    history(a.id, 'reprogramada', `${a.start_at} → ${start} (${items.map(i => i.professional).join(', ')})`, user.name);
    notify('cambio', `Turno ${a.code} reprogramado a ${start}. Avisale a ${a.first_name}.`, String(a.id));
    return appointmentDetail(a.id);
  });
});
route('POST', '/api/admin/appointments/:id/payment', { module: 'agenda' }, ({ params, body, user }) => {
  const a = appointmentDetail(Number(params.id)); if (!a) fail(404, 'Turno inexistente');
  const amount = Number(body.amount) || 0; if (amount <= 0) fail(400, 'Importe inválido');
  const kind = ['seña', 'devolucion', 'pago'].includes(body.kind) ? body.kind : 'seña';
  run('INSERT INTO payments(appointment_id,kind,amount,note,at) VALUES(?,?,?,?,?)', a.id, kind, amount, String(body.note || '').slice(0, 200), T.nowLocal());
  if (kind === 'seña') {
    const paid = (a.deposit_paid || 0) + amount;
    run('UPDATE appointments SET deposit_paid = ?, deposit_status = ? WHERE id = ?', paid, paid >= a.deposit_required ? 'pagada' : 'parcial', a.id);
  }
  if (kind === 'devolucion') run('UPDATE appointments SET refund_status = ? WHERE id = ?', 'devuelta', a.id);
  history(a.id, kind, `${money(amount)} ${body.note || ''} (registro manual, sin pasarela)`, user.name);
  return appointmentDetail(a.id);
});
route('PUT', '/api/admin/appointments/:id/notes', { module: 'agenda' }, ({ params, body, user }) => {
  run('UPDATE appointments SET notes = ? WHERE id = ?', String(body.notes || '').slice(0, 1000), Number(params.id));
  history(Number(params.id), 'nota', 'Notas actualizadas', user.name); return { ok: true };
});

// Conflictos: turnos activos fuera de horario, en descansos/ausencias o superpuestos sobre la capacidad.
function findConflicts() {
  const items = all(`SELECT i.*, a.code FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id WHERE a.status IN ${engine.ACTIVE} AND i.block_end >= ?`, T.today() + ' 00:00');
  const out = [];
  for (const i of items) {
    const pro = get('SELECT * FROM professionals WHERE id = ?', i.professional_id);
    if (!engine.isFree(pro, i.block_start, i.block_end, i.appointment_id))
      out.push({ appointment_id: i.appointment_id, code: i.code, professional: pro.name, at: i.block_start });
  }
  return out;
}
route('GET', '/api/admin/conflicts', { module: 'agenda' }, () => findConflicts());

/* Bloqueos y ausencias (con detección de turnos afectados y alternativas) */
function affectedBy(abs) {
  const items = all(`SELECT DISTINCT a.id FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id
    WHERE a.status IN ${engine.ACTIVE} AND (? IS NULL OR i.professional_id = ?) AND substr(i.block_start,1,10) BETWEEN ? AND ?`, abs.professional_id, abs.professional_id, abs.start_date, abs.end_date);
  return items.map(r => appointmentDetail(r.id)).filter(a => a.items.some(i => {
    if (abs.professional_id && i.professional_id !== abs.professional_id) return false;
    if (!abs.start_time) return true;
    return i.block_start.slice(11) < abs.end_time && i.block_end.slice(11) > abs.start_time;
  })).map(a => {
    // Alternativas: mismo servicio, mismo día u otros días, con cualquier profesional habilitado.
    let alts = [];
    try { alts = availability({ services: a.items.map(i => ({ id: i.service_id, answers: i.answers })), pros: {}, dateFrom: a.start_at.slice(0, 10), days: 5, exclude: a.id }); } catch { }
    const list = alts.single?.length ? alts.single : alts.consecutive || [];
    return { ...a, alternatives: list.slice(0, 4) };
  });
}
route('GET', '/api/admin/absences', { module: 'profesionales' }, ({ query }) => all(`SELECT a.*, p.name professional FROM absences a LEFT JOIN professionals p ON p.id = a.professional_id
  WHERE end_date >= ? ORDER BY start_date`, query.from || T.addDays(T.today(), -30)));
route('POST', '/api/admin/absences', { module: 'agenda' }, ({ body, user }) => {
  if (!body.start_date) fail(400, 'Indicá la fecha.');
  const abs = { professional_id: Number(body.professional_id) || null, start_date: body.start_date, end_date: body.end_date || body.start_date,
    start_time: body.start_time || null, end_time: body.end_time || null, type: body.type || 'bloqueo', reason: String(body.reason || '').slice(0, 200) };
  if (abs.end_date < abs.start_date) fail(400, 'La fecha de fin es anterior al inicio.');
  if ((abs.start_time && !abs.end_time) || (abs.start_time && abs.end_time <= abs.start_time)) fail(400, 'Rango horario inválido.');
  if (user.role === 'employee') abs.professional_id = user.professional_id;
  const id = Number(run('INSERT INTO absences(professional_id,start_date,end_date,start_time,end_time,type,reason) VALUES(?,?,?,?,?,?,?)', abs.professional_id, abs.start_date, abs.end_date, abs.start_time, abs.end_time, abs.type, abs.reason).lastInsertRowid);
  const affected = affectedBy(abs);
  if (affected.length) notify('ausencia', `La ausencia cargada afecta ${affected.length} turno(s) confirmados. Revisalos: TurnIA no los modifica automáticamente.`, String(id));
  return { id, affected };
});
route('GET', '/api/admin/absences/:id/affected', { module: 'agenda' }, ({ params }) => {
  const abs = get('SELECT * FROM absences WHERE id = ?', Number(params.id)); if (!abs) fail(404, 'No existe');
  return affectedBy(abs);
});
route('DELETE', '/api/admin/absences/:id', { module: 'agenda' }, ({ params }) => { run('DELETE FROM absences WHERE id = ?', Number(params.id)); return { ok: true }; });

/* Profesionales */
route('GET', '/api/admin/professionals', { module: 'agenda' }, () => all('SELECT * FROM professionals ORDER BY active DESC, name').map(p => ({
  ...p, services: p.all_services ? all('SELECT id FROM services').map(s => s.id) : all('SELECT service_id id FROM professional_services WHERE professional_id = ?', p.id).map(s => s.id) })));
route('GET', '/api/admin/professionals/:id', { module: 'agenda' }, ({ params }) => {
  const id = Number(params.id); const p = get('SELECT * FROM professionals WHERE id = ?', id); if (!p) fail(404, 'No existe');
  p.services = all('SELECT service_id id FROM professional_services WHERE professional_id = ?', id).map(s => s.id);
  p.schedules = all('SELECT * FROM schedules WHERE professional_id = ? ORDER BY weekday, start', id);
  p.breaks = all('SELECT * FROM breaks WHERE professional_id = ? ORDER BY weekday, date, start', id);
  p.absences = all('SELECT * FROM absences WHERE professional_id = ? AND end_date >= ? ORDER BY start_date', id, T.addDays(T.today(), -60));
  p.durations = all(`SELECT s.id, s.name, s.base_duration configured, COUNT(i.actual_duration) records, ROUND(AVG(i.actual_duration)) average
    FROM appointment_items i JOIN services s ON s.id = i.service_id WHERE i.professional_id = ? AND i.actual_duration > 0 GROUP BY s.id ORDER BY records DESC`, id);
  p.stats = get(`SELECT COUNT(DISTINCT a.id) total, SUM(a.status='finalizada') done, SUM(a.status='cancelada') cancels, SUM(a.status='no_asistio') noshows
    FROM appointments a JOIN appointment_items i ON i.appointment_id = a.id WHERE i.professional_id = ?`, id);
  return p;
});
route('POST', '/api/admin/professionals', { module: 'profesionales' }, ({ body }) => {
  if (!body.name?.trim()) fail(400, 'Nombre obligatorio');
  const id = Number(run('INSERT INTO professionals(name,bio,specialties,color,capacity,all_services,photo) VALUES(?,?,?,?,?,?,?)', body.name.trim(), body.bio || '', body.specialties || '', body.color || '#7c3aed', Math.max(1, Number(body.capacity) || 1), body.all_services ? 1 : 0, body.photo || '').lastInsertRowid);
  for (const wd of [1, 2, 3, 4, 5]) run('INSERT INTO schedules(professional_id,weekday,start,end) VALUES(?,?,?,?)', id, wd, '10:00', '19:00');
  return { id };
});
route('PUT', '/api/admin/professionals/:id', { module: 'profesionales' }, ({ params, body }) => {
  const id = Number(params.id);
  tx(() => {
    run('UPDATE professionals SET name=?, bio=?, specialties=?, color=?, capacity=?, all_services=?, active=?, photo=? WHERE id=?', String(body.name || '').trim(), body.bio || '', body.specialties || '', body.color || '#7c3aed',
      Math.max(1, Math.min(5, Number(body.capacity) || 1)), body.all_services ? 1 : 0, body.active === false ? 0 : 1, body.photo || '', id);
    if (Array.isArray(body.services)) { run('DELETE FROM professional_services WHERE professional_id = ?', id); for (const s of body.services) run('INSERT INTO professional_services VALUES(?,?)', id, Number(s)); }
    const okT = t => /^\d\d:\d\d$/.test(t);
    if (Array.isArray(body.schedules)) {
      run('DELETE FROM schedules WHERE professional_id = ?', id);
      for (const s of body.schedules) { if (!okT(s.start) || !okT(s.end) || s.end <= s.start) fail(400, 'Horario inválido: ' + JSON.stringify(s)); run('INSERT INTO schedules(professional_id,weekday,start,end) VALUES(?,?,?,?)', id, Number(s.weekday), s.start, s.end); }
    }
    if (Array.isArray(body.breaks)) {
      run('DELETE FROM breaks WHERE professional_id = ?', id);
      for (const b of body.breaks) { if (!okT(b.start) || !okT(b.end) || b.end <= b.start) fail(400, 'Descanso inválido'); run('INSERT INTO breaks(professional_id,weekday,date,start,end,type) VALUES(?,?,?,?,?,?)', id, b.date ? null : Number(b.weekday), b.date || null, b.start, b.end, b.type || 'descanso'); }
    }
  });
  return { ok: true, conflicts: findConflicts().filter(c => get('SELECT 1 FROM appointment_items WHERE appointment_id = ? AND professional_id = ?', c.appointment_id, id)) };
});

/* Servicios */
const SVC_FIELDS = ['name', 'category', 'subcategory', 'description', 'price_min', 'price_max', 'base_duration', 'extra_time', 'prep_time', 'cleanup_time', 'min_advance_hours', 'deposit_amount', 'deposit_terms', 'cancel_hours', 'late_cancel_terms', 'requirements', 'complex', 'active'];
route('GET', '/api/admin/services', { module: 'agenda' }, () => all('SELECT * FROM services ORDER BY category, subcategory, name').map(s => {
  const svc = engine.parseService(s); const est = engine.estimate(svc, {});
  return { ...svc, learned: est.learned, professionals: all(`SELECT p.id, p.name FROM professionals p WHERE p.active = 1 AND (p.all_services = 1 OR p.id IN (SELECT professional_id FROM professional_services WHERE service_id = ?))`, s.id) };
}));
function svcValues(b) {
  if (!b.name?.trim()) fail(400, 'Nombre obligatorio');
  if (!['peluqueria', 'manicuria'].includes(b.category)) fail(400, 'Categoría inválida');
  if (Number(b.price_max) < Number(b.price_min)) fail(400, 'El precio máximo no puede ser menor al mínimo');
  if (!(Number(b.base_duration) > 0)) fail(400, 'Duración inválida');
  return SVC_FIELDS.map(f => ['complex', 'active'].includes(f) ? (b[f] ? 1 : 0) : b[f] ?? null);
}
route('POST', '/api/admin/services', { module: 'servicios' }, ({ body }) => {
  const id = Number(run(`INSERT INTO services(${SVC_FIELDS.join(',')},questions) VALUES(${SVC_FIELDS.map(() => '?').join(',')},?)`, ...svcValues({ active: 1, ...body }), JSON.stringify(body.questions || [])).lastInsertRowid);
  return { id };
});
route('PUT', '/api/admin/services/:id', { module: 'servicios' }, ({ params, body }) => {
  run(`UPDATE services SET ${SVC_FIELDS.map(f => f + '=?').join(',')} ${body.questions ? ', questions=?' : ''} WHERE id=?`, ...svcValues(body), ...(body.questions ? [JSON.stringify(body.questions)] : []), Number(params.id));
  if (Array.isArray(body.professional_ids)) {
    for (const p of all('SELECT id, all_services FROM professionals')) {
      if (p.all_services) continue;
      const on = body.professional_ids.map(Number).includes(p.id);
      if (on) run('INSERT OR IGNORE INTO professional_services VALUES(?,?)', p.id, Number(params.id));
      else run('DELETE FROM professional_services WHERE professional_id = ? AND service_id = ?', p.id, Number(params.id));
    }
  }
  return { ok: true };
});

/* Clientes */
route('GET', '/api/admin/clients', { module: 'clientes' }, ({ query }) => {
  const q = `%${query.q || ''}%`;
  return all(`SELECT c.id, c.first_name, c.last_name, c.phone, c.email, c.registered, c.created_at, c.demo,
    COUNT(a.id) total, SUM(a.status='finalizada') done, SUM(a.status='cancelada') cancels, SUM(a.status='no_asistio') noshows, MAX(a.start_at) last
    FROM clients c LEFT JOIN appointments a ON a.client_id = c.id WHERE (c.first_name || ' ' || c.last_name LIKE ? OR c.phone LIKE ?) GROUP BY c.id ORDER BY last DESC NULLS LAST`, q, q);
});
route('GET', '/api/admin/clients/:id', { module: 'clientes' }, ({ params }) => {
  const c = get('SELECT id, first_name, last_name, phone, email, registered, preferences, notes, created_at, demo FROM clients WHERE id = ?', Number(params.id)); if (!c) fail(404, 'No existe');
  c.stats = clientStats(c.id);
  c.appointments = all('SELECT id FROM appointments WHERE client_id = ? ORDER BY start_at DESC', c.id).map(a => appointmentDetail(a.id));
  c.reviews = all('SELECT r.*, s.name service FROM reviews r LEFT JOIN services s ON s.id = r.service_id WHERE client_id = ?', c.id).map(r => ({ ...r, photos: J(r.photos, []) }));
  c.services = all(`SELECT s.name, COUNT(*) n FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id JOIN services s ON s.id=i.service_id WHERE a.client_id=? AND a.status='finalizada' GROUP BY s.id ORDER BY n DESC`, c.id);
  c.professionals = all(`SELECT p.name, COUNT(*) n FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id JOIN professionals p ON p.id=i.professional_id WHERE a.client_id=? GROUP BY p.id ORDER BY n DESC`, c.id);
  return c;
});
route('PUT', '/api/admin/clients/:id', { module: 'clientes' }, ({ params, body }) => {
  run('UPDATE clients SET first_name=?, last_name=?, email=?, preferences=?, notes=? WHERE id=?', body.first_name, body.last_name, body.email || null, String(body.preferences || '').slice(0, 500), String(body.notes || '').slice(0, 1000), Number(params.id));
  return { ok: true };
});

/* Solicitudes, lista de espera e intercambio sugerido */
const URG = { alta: 3, media: 2, baja: 1 }, FLEX = { alta: 2, media: 1, baja: 0 };
function prioritize(r) {
  let score = (URG[r.urgency] || 2) * 20 + (FLEX[r.flexibility] || 1) * 5;
  if (r.event_date) { const d = (T.stamp(r.event_date + ' 00:00') - T.stamp(T.nowLocal())) / 1440; score += d < 0 ? 0 : Math.max(0, 40 - d * 4); }
  score += Math.min(20, (T.stamp(T.nowLocal()) - T.stamp(r.created_at)) / 1440 * 2);
  if (r.accepts_alternatives) score += 5;
  return Math.round(score);
}
route('GET', '/api/admin/requests', { module: 'solicitudes' }, () => all(`SELECT r.*, c.first_name, c.last_name, c.phone, p.name professional FROM requests r JOIN clients c ON c.id = r.client_id
  LEFT JOIN professionals p ON p.id = r.professional_id ORDER BY r.created_at DESC`).map(r => {
  const ids = J(r.service_ids, []);
  return { ...r, service_ids: ids, services: ids.map(id => get('SELECT name FROM services WHERE id = ?', id)?.name).join(' + '), priority: r.status === 'abierta' ? prioritize(r) : 0,
    swaps: all('SELECT * FROM swaps WHERE request_id = ? ORDER BY id DESC', r.id).map(s => ({ ...s, proposal: J(s.proposal, {}) })) };
}).sort((a, b) => b.priority - a.priority));
route('PUT', '/api/admin/requests/:id', { module: 'solicitudes' }, ({ params, body }) => {
  const st = ['abierta', 'convertida', 'perdida', 'descartada'].includes(body.status) ? body.status : 'abierta';
  run('UPDATE requests SET status = ?, lost_reason = ? WHERE id = ?', st, body.lost_reason || null, Number(params.id)); return { ok: true };
});
route('POST', '/api/admin/requests/:id/options', { module: 'solicitudes' }, ({ params }) => {
  const r = get('SELECT * FROM requests WHERE id = ?', Number(params.id)); if (!r) fail(404, 'No existe');
  const services = J(r.service_ids, []).map(id => ({ id, answers: {} }));
  const cat = engine.getService(services[0].id).category;
  const avail = availability({ services, pros: r.professional_id ? { [cat]: r.professional_id } : {}, days: 14 });
  // Intercambio: turnos de otros clientes que, movidos a otro horario libre, liberan lugar para esta solicitud.
  const swaps = [];
  const est = engine.estimate(engine.getService(services[0].id), {});
  const eligible = engine.eligiblePros([services[0].id]).filter(p => !r.professional_id || p.id === r.professional_id);
  const cands = all(`SELECT DISTINCT a.id FROM appointments a JOIN appointment_items i ON i.appointment_id = a.id WHERE a.status = 'confirmada' AND a.start_at > ? AND a.start_at < ?
    AND i.professional_id IN (${eligible.map(p => p.id).join(',') || 0})`, T.addMin(T.nowLocal(), 24 * 60), T.addDays(T.today(), 10) + ' 23:59').map(x => appointmentDetail(x.id));
  for (const a of cands) {
    if (swaps.length >= 3) break;
    const it = a.items[0], pro = get('SELECT * FROM professionals WHERE id = ?', it.professional_id);
    const plan = engine.planGroup({ estimates: [est] }, pro, it.block_start);
    if (!plan.every(p => engine.isFree(pro, p.block_start, p.block_end, a.id))) continue;
    let alt;
    try { alt = availability({ services: a.items.map(i => ({ id: i.service_id, answers: i.answers })), pros: {}, dateFrom: a.start_at.slice(0, 10), days: 3, exclude: a.id }); } catch { continue; }
    // Alternativa que no choque con el lugar que tomaría la solicitud.
    const free = (alt.single || []).find(o => o.items.every(x => x.professional_id !== pro.id || x.block_end <= plan[0].block_start || x.block_start >= plan.at(-1).block_end));
    if (!free) continue;
    swaps.push({ appointment: { id: a.id, code: a.code, client: `${a.first_name} ${a.last_name}`, phone: a.phone, start: a.start_at, service: a.items.map(i => i.service).join(' + '), professional: it.professional },
      move_to: { start: free.start, choice: free.choice, professional: free.items[0].professional }, request_slot: { professional_id: pro.id, professional: pro.name, block_start: it.block_start } });
  }
  return { options: avail.single.length ? avail.single : avail.consecutive, swaps };
});
route('POST', '/api/admin/requests/:id/book', { module: 'solicitudes' }, ({ params, body, user }) => {
  const r = get('SELECT * FROM requests WHERE id = ?', Number(params.id)); if (!r) fail(404, 'No existe');
  const a = createAppointment({ clientId: r.client_id, services: J(r.service_ids, []).map(id => ({ id, answers: {} })), choice: body.choice, notes: 'Desde lista de espera. ' + (r.notes || ''), source: 'lista_espera', user: user.name, admin: true });
  run("UPDATE requests SET status = 'convertida' WHERE id = ?", r.id);
  return a;
});
route('POST', '/api/admin/swaps', { module: 'solicitudes' }, ({ body }) => {
  const id = run('INSERT INTO swaps(request_id,appointment_id,proposal,status,created_at,updated_at) VALUES(?,?,?,?,?,?)', Number(body.request_id), Number(body.appointment_id), JSON.stringify(body.proposal || {}), 'en_contacto', T.nowLocal(), T.nowLocal()).lastInsertRowid;
  history(Number(body.appointment_id), 'intercambio_sugerido', 'El local contactará al cliente para proponer un cambio de horario.', 'sistema');
  return { id: Number(id) };
});
route('PUT', '/api/admin/swaps/:id', { module: 'solicitudes' }, ({ params, body, user }) => {
  const s = get('SELECT * FROM swaps WHERE id = ?', Number(params.id)); if (!s) fail(404, 'No existe');
  if (s.status !== 'en_contacto') fail(400, 'La sugerencia ya fue resuelta.');
  if (body.status === 'rechazada') {
    run("UPDATE swaps SET status = 'rechazada', detail = ?, updated_at = ? WHERE id = ?", body.detail || 'El cliente no aceptó', T.nowLocal(), s.id);
    history(s.appointment_id, 'intercambio_rechazado', body.detail || '', user.name); return { ok: true };
  }
  const p = J(s.proposal, {});
  const a = appointmentDetail(s.appointment_id); const r = get('SELECT * FROM requests WHERE id = ?', s.request_id);
  // Revalidación completa y atómica de ambos movimientos.
  return tx(() => {
    const moved = buildItems(a.items.map(i => ({ id: i.service_id, answers: i.answers })), p.move_to.choice).items;
    let err = engine.validateItems(moved.map(i => ({ ...i, _admin: true })), a.id); if (err) fail(409, 'No se puede mover el turno: ' + err);
    run('DELETE FROM appointment_items WHERE appointment_id = ?', a.id);
    for (const i of moved) run(`INSERT INTO appointment_items(appointment_id,service_id,professional_id,start_at,end_at,block_start,block_end,answers,est_duration,price_min,price_max,signature)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, a.id, i.service_id, i.professional_id, i.start_at, i.end_at, i.block_start, i.block_end, JSON.stringify(i.answers), i.est_duration, i.price_min, i.price_max, i.signature);
    run('UPDATE appointments SET start_at = ?, end_at = ? WHERE id = ?', moved.map(i => i.start_at).sort()[0], moved.map(i => i.end_at).sort().at(-1), a.id);
    history(a.id, 'intercambio_aceptado', `Movido de ${a.start_at} a ${moved[0].start_at} con aceptación del cliente`, user.name);
    const services = J(r.service_ids, []).map(id => ({ id, answers: {} }));
    const { items } = buildItems(services, [{ professional_id: p.request_slot.professional_id, block_start: p.request_slot.block_start, service_ids: services.map(x => x.id) }]);
    err = engine.validateItems(items.map(i => ({ ...i, _admin: true }))); if (err) fail(409, 'El hueco ya no está libre: ' + err);
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const nid = Number(run(`INSERT INTO appointments(code,client_id,status,mode,start_at,end_at,price_min,price_max,source,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      code, r.client_id, 'confirmada', 'simple', items[0].start_at, items.at(-1).end_at, items.reduce((x, i) => x + i.price_min, 0), items.reduce((x, i) => x + i.price_max, 0), 'intercambio', 'Generado por intercambio aceptado', T.nowLocal()).lastInsertRowid);
    for (const i of items) run(`INSERT INTO appointment_items(appointment_id,service_id,professional_id,start_at,end_at,block_start,block_end,answers,est_duration,price_min,price_max,signature)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, nid, i.service_id, i.professional_id, i.start_at, i.end_at, i.block_start, i.block_end, '{}', i.est_duration, i.price_min, i.price_max, i.signature);
    history(nid, 'creada', 'Desde intercambio de turnos', user.name);
    run("UPDATE swaps SET status = 'aceptada', detail = ?, updated_at = ? WHERE id = ?", body.detail || 'Cliente aceptó', T.nowLocal(), s.id);
    run("UPDATE requests SET status = 'convertida' WHERE id = ?", r.id);
    return { ok: true, appointment_id: nid };
  });
});

/* Promociones */
const PROMO_FIELDS = ['name', 'description', 'type', 'value', 'service_id', 'professional_id', 'weekdays', 'audience', 'start_date', 'end_date', 'max_uses', 'active'];
const promoVals = b => { if (!b.name) fail(400, 'Nombre obligatorio'); if (!['percent', 'amount'].includes(b.type)) fail(400, 'Tipo inválido');
  return PROMO_FIELDS.map(f => f === 'weekdays' ? JSON.stringify(b.weekdays || []) : f === 'active' ? (b.active === false ? 0 : 1) : ['service_id', 'professional_id', 'max_uses'].includes(f) ? (Number(b[f]) || null) : b[f] ?? null); };
route('GET', '/api/admin/promotions', { module: 'promociones' }, () => all('SELECT * FROM promotions ORDER BY active DESC, id DESC').map(p => ({ ...p, weekdays: J(p.weekdays, []) })));
route('POST', '/api/admin/promotions', { module: 'promociones' }, ({ body }) => ({ id: Number(run(`INSERT INTO promotions(${PROMO_FIELDS}) VALUES(${PROMO_FIELDS.map(() => '?')})`, ...promoVals(body)).lastInsertRowid) }));
route('PUT', '/api/admin/promotions/:id', { module: 'promociones' }, ({ params, body }) => { run(`UPDATE promotions SET ${PROMO_FIELDS.map(f => f + '=?')} WHERE id=?`, ...promoVals(body), Number(params.id)); return { ok: true }; });
route('DELETE', '/api/admin/promotions/:id', { module: 'promociones' }, ({ params }) => { run('DELETE FROM promotions WHERE id = ?', Number(params.id)); return { ok: true }; });

/* Opiniones */
route('GET', '/api/admin/reviews', { module: 'opiniones' }, () => all(`SELECT r.*, c.first_name, c.last_name, s.name service, p.name professional FROM reviews r
  LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN services s ON s.id=r.service_id LEFT JOIN professionals p ON p.id=r.professional_id ORDER BY r.created_at DESC`).map(r => ({ ...r, photos: J(r.photos, []) })));
route('PUT', '/api/admin/reviews/:id', { module: 'opiniones' }, ({ params, body }) => {
  const st = ['pendiente', 'aprobada', 'rechazada'].includes(body.status) ? body.status : 'pendiente';
  run('UPDATE reviews SET status = ?, published = ? WHERE id = ?', st, st === 'aprobada' && body.published ? 1 : 0, Number(params.id)); return { ok: true };
});

/* Recordatorios: mensajes listos para copiar/enviar por WhatsApp (sin API externa) */
route('GET', '/api/admin/reminders', { module: 'recordatorios' }, ({ query }) => {
  const hours = Number(query.hours) || getSetting('reminder_hours', 24);
  const biz = getSetting('business', {});
  const now = T.nowLocal(), until = T.addMin(now, hours * 60);
  const wa = (phone, text) => `https://wa.me/549${phone}?text=${encodeURIComponent(text)}`;
  const fmt = dt => `${DAYS[T.weekday(dt.slice(0, 10))]} ${dt.slice(8, 10)}/${dt.slice(5, 7)} a las ${dt.slice(11)} h`;
  const upcoming = all(`SELECT id FROM appointments WHERE status IN ('confirmada','pendiente') AND start_at BETWEEN ? AND ? ORDER BY start_at`, now, until).map(r => {
    const a = appointmentDetail(r.id);
    const text = `Hola ${a.first_name}! Te recordamos tu turno en ${biz.name} el ${fmt(a.start_at)}: ${a.items.map(i => `${i.service} con ${i.professional}`).join(' + ')}. ` +
      (a.deposit_status === 'pendiente' ? `Recordá abonar la seña de ${money(a.deposit_required - a.deposit_paid)}. ` : '') + `Si no podés asistir avisanos. Código: ${a.code}`;
    return { ...a, kind: 'recordatorio', text, wa: wa(a.phone, text) };
  });
  const changes = all(`SELECT DISTINCT a.id, h.action, h.at FROM appointment_history h JOIN appointments a ON a.id = h.appointment_id
    WHERE h.action IN ('reprogramada','cancelada','intercambio_aceptado') AND h.at >= ? ORDER BY h.at DESC`, T.addDays(T.today(), -3) + ' 00:00').map(r => {
    const a = appointmentDetail(r.id);
    const text = r.action === 'cancelada' ? `Hola ${a.first_name}, confirmamos la cancelación de tu turno del ${fmt(a.start_at)} en ${biz.name}. ¡Te esperamos pronto!`
      : `Hola ${a.first_name}, tu turno en ${biz.name} quedó para el ${fmt(a.start_at)} (${a.items.map(i => i.service + ' con ' + i.professional).join(' + ')}). Código ${a.code}.`;
    return { ...a, kind: r.action, text, wa: wa(a.phone, text) };
  });
  return { hours, upcoming, changes };
});
route('POST', '/api/admin/reminders/:id/sent', { module: 'recordatorios' }, ({ params, user }) => {
  run('UPDATE appointments SET reminder_sent = 1 WHERE id = ?', Number(params.id)); history(Number(params.id), 'recordatorio', 'Recordatorio enviado manualmente por WhatsApp', user.name); return { ok: true };
});

/* Estadísticas */
route('GET', '/api/admin/stats', { module: 'estadisticas' }, ({ query }) => {
  const from = query.from || T.addDays(T.today(), -30), to = query.to || T.addDays(T.today(), 30);
  const W = `substr(a.start_at,1,10) BETWEEN '${from.replace(/[^0-9-]/g, '')}' AND '${to.replace(/[^0-9-]/g, '')}'`;
  return {
    from, to,
    byStatus: all(`SELECT status, COUNT(*) n FROM appointments a WHERE ${W} GROUP BY status`),
    byDay: all(`SELECT substr(start_at,1,10) d, COUNT(*) n FROM appointments a WHERE ${W} AND status != 'cancelada' GROUP BY d ORDER BY d`),
    topServices: all(`SELECT s.name, s.category, COUNT(*) n FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id JOIN services s ON s.id=i.service_id WHERE ${W} GROUP BY s.id ORDER BY n DESC LIMIT 8`),
    byPro: all(`SELECT p.name, p.color, COUNT(*) n, SUM(a.status='cancelada') cancels, SUM(a.status='no_asistio') noshows,
      ROUND(SUM((julianday(replace(i.block_end,' ','T'))-julianday(replace(i.block_start,' ','T')))*1440)) minutes FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id JOIN professionals p ON p.id=i.professional_id WHERE ${W} GROUP BY p.id`),
    revenue: get(`SELECT SUM(price_min - discount) min, SUM(price_max - discount) max FROM appointments a WHERE ${W} AND status IN ('confirmada','pendiente','en_curso','finalizada')`),
    recurrent: get(`SELECT COUNT(*) n FROM (SELECT client_id FROM appointments WHERE status='finalizada' GROUP BY client_id HAVING COUNT(*) >= 2)`).n,
    clients: get('SELECT COUNT(*) n FROM clients').n,
    requests: all('SELECT status, COUNT(*) n FROM requests GROUP BY status'),
    lostReasons: all("SELECT COALESCE(lost_reason,'Sin motivo') reason, COUNT(*) n FROM requests WHERE status IN ('perdida','descartada') GROUP BY reason"),
    notReturning: all(`SELECT c.first_name, c.last_name, c.phone, MAX(a.start_at) last FROM clients c JOIN appointments a ON a.client_id=c.id WHERE a.status='finalizada'
      GROUP BY c.id HAVING last < ? AND c.id NOT IN (SELECT client_id FROM appointments WHERE start_at > ?) ORDER BY last`, T.addDays(T.today(), -30) + ' 00:00', T.nowLocal()),
    demo: !!get("SELECT 1 FROM appointments WHERE source = 'demo' LIMIT 1"),
  };
});

/* Base de conocimiento y asistente */
route('GET', '/api/admin/knowledge', { module: 'asistente' }, () => ({ items: all('SELECT * FROM knowledge ORDER BY id'), ai: assistant.aiStatus() }));
route('POST', '/api/admin/knowledge', { module: 'asistente' }, ({ body }) => { if (!body.question || !body.answer) fail(400, 'Completá pregunta y respuesta');
  return { id: Number(run('INSERT INTO knowledge(question,answer,keywords) VALUES(?,?,?)', body.question, body.answer, body.keywords || '').lastInsertRowid) }; });
route('PUT', '/api/admin/knowledge/:id', { module: 'asistente' }, ({ params, body }) => { run('UPDATE knowledge SET question=?, answer=?, keywords=? WHERE id=?', body.question, body.answer, body.keywords || '', Number(params.id)); return { ok: true }; });
route('DELETE', '/api/admin/knowledge/:id', { module: 'asistente' }, ({ params }) => { run('DELETE FROM knowledge WHERE id = ?', Number(params.id)); return { ok: true }; });
route('PUT', '/api/admin/ai', { module: 'asistente' }, ({ body }) => { setSetting('ai', { enabled: !!body.enabled, max_tokens: Math.min(400, Number(body.max_tokens) || 220), daily_limit: Math.min(500, Number(body.daily_limit) || 60) }); return assistant.aiStatus(); });

/* Configuración y usuarios */
const SETTING_KEYS = ['business', 'booking_horizon_days', 'reminder_hours', 'noshow_deposit_after', 'noshow_block_after', 'learning_min_records', 'promos_require_registration'];
route('GET', '/api/admin/settings', { module: 'dashboard' }, () => Object.fromEntries(SETTING_KEYS.map(k => [k, getSetting(k)])));
route('PUT', '/api/admin/settings', { module: 'configuracion' }, ({ body }) => { for (const k of SETTING_KEYS) if (k in body) setSetting(k, body[k]); return { ok: true }; });
route('GET', '/api/admin/users', { module: 'configuracion' }, () => all('SELECT id, name, email, role, professional_id, permissions, active FROM users').map(u => ({ ...u, permissions: J(u.permissions, []) })));
route('POST', '/api/admin/users', { module: 'configuracion' }, ({ body }) => {
  if (!body.email || !body.password || String(body.password).length < 8) fail(400, 'Email y contraseña (mín. 8) obligatorios');
  if (!['owner', 'manager', 'employee'].includes(body.role)) fail(400, 'Rol inválido');
  try { return { id: Number(run('INSERT INTO users(name,email,password_hash,role,professional_id,permissions) VALUES(?,?,?,?,?,?)', body.name, body.email.toLowerCase(), auth.hashPassword(body.password), body.role, Number(body.professional_id) || null, JSON.stringify(body.permissions || [])).lastInsertRowid) }; }
  catch { fail(400, 'El email ya existe'); }
});
route('PUT', '/api/admin/users/:id', { module: 'configuracion' }, ({ params, body, user }) => {
  const id = Number(params.id);
  if (id === user.id && (body.active === false || body.role !== 'owner')) fail(400, 'No podés quitarte permisos de propietario a vos mismo.');
  run('UPDATE users SET name=?, role=?, professional_id=?, permissions=?, active=? WHERE id=?', body.name, body.role, Number(body.professional_id) || null, JSON.stringify(body.permissions || []), body.active === false ? 0 : 1, id);
  if (body.password) { if (String(body.password).length < 8) fail(400, 'Contraseña mínima de 8 caracteres'); run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(body.password), id); }
  return { ok: true };
});

route('GET', '/api/health', () => ({ ok: true, time: T.nowLocal(), tz: T.TZ }));

module.exports = { handle };
