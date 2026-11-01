// Endpoints del módulo de IA (público y panel).
const { all, get, run, getSetting, setSetting } = require('../db');
const T = require('../time');
const api = require('../api');
const conv = require('./conversation');
const knowledge = require('./knowledge');
const tools = require('./tools');
const { getProvider } = require('./provider');
const { route, fail, auth } = api;

knowledge.seedGeneral();
ensureDiagnosisServices();

// Servicios de diagnóstico presencial con duración configurable (15 min por defecto).
function ensureDiagnosisServices() {
  const mins = conv.aiConfig().diagnosis_minutes || 15;
  for (const [name, cat, desc] of [['Diagnóstico capilar', 'peluqueria', 'Evaluación presencial del cabello antes de un trabajo químico o tratamiento.'], ['Evaluación de uñas', 'manicuria', 'Evaluación presencial de las uñas antes de elegir técnica.']]) {
    let s = get('SELECT id FROM services WHERE name = ?', name);
    if (!s) {
      const id = Number(run(`INSERT INTO services(name,category,subcategory,description,price_min,price_max,base_duration,prep_time,cleanup_time,min_advance_hours,cancel_hours,questions)
        VALUES(?,?,?,?,0,0,?,0,0,1,12,'[]')`, name, cat, 'Diagnóstico', desc, mins).lastInsertRowid);
      for (const p of all('SELECT DISTINCT ps.professional_id id FROM professional_services ps JOIN services sv ON sv.id = ps.service_id WHERE sv.category = ?', cat)) run('INSERT OR IGNORE INTO professional_services VALUES(?,?)', p.id, id);
    } else run('UPDATE services SET base_duration = ? WHERE id = ?', mins, s.id);
  }
}

// Límite simple de solicitudes por IP (protege la cuota de IA).
const hits = new Map();
function rateLimit(key, max = 15) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter(t => now - t < 60000);
  if (arr.length >= max) fail(429, 'Demasiados mensajes seguidos. Esperá unos segundos.');
  arr.push(now); hits.set(key, arr);
}

// Valida que quien habla sea el dueño de la conversación (token secreto).
function ownConv(id, token) {
  const c = conv.loadConv(id);
  if (!c || c.kind !== 'cliente' || !token || c.token !== token) fail(403, 'Conversación no autorizada.');
  return c;
}
const clientFromAuth = header => { const p = auth.verify(header); return p?.kind === 'client' ? p.cid : null; };

/* ───────── Público ───────── */
route('GET', '/api/ai/config', () => { const c = conv.aiConfig(); const p = getProvider();
  return { name: c.name, welcome: c.welcome, enabled: c.enabled, real_ai: p.isReal, diagnosis_minutes: c.diagnosis_minutes,
    suggestions: ['¿Cuánto sale el balayage?', '¿Qué diferencia hay entre kapping y semipermanente?', '¿Tienen lugar el sábado a la mañana?', '¿Puedo hacerme las uñas mientras me tiño?'] }; });

route('POST', '/api/ai/chat', async ({ body, token }) => {
  const message = String(body.message || '').trim().slice(0, 800);
  if (!message) fail(400, 'Escribí un mensaje.');
  let c = body.conversation_id ? ownConv(body.conversation_id, body.token) : conv.createConversation('cliente');
  rateLimit('c' + c.id);
  const cid = clientFromAuth(token); if (cid && !c.client_id) c.client_id = cid;
  const ctx = { wizard: body.wizard && typeof body.wizard === 'object' ? { step: String(body.wizard.step || '').slice(0, 30), services: (body.wizard.services || []).slice(0, 6).map(s => String(s).slice(0, 60)), first_name: String(body.wizard.first_name || '').slice(0, 40), phone: String(body.wizard.phone || '').slice(0, 20) } : null };
  const r = await conv.clientChat({ conv: c, message, ctx });
  return { conversation_id: c.id, token: c.token, ...r };
});

route('GET', '/api/ai/conversations/:id', ({ params, query }) => {
  const c = ownConv(params.id, query.token);
  return { messages: conv.messages(c.id).filter(m => ['user', 'assistant', 'staff'].includes(m.role)).map(m => ({ id: m.id, role: m.role, content: m.content, action: m.meta.action || null, source: m.meta.source || null, at: m.created_at })),
    pending_action: c.state.pending_action ? conv.publicAction(c.state.pending_action) : null };
});

// Confirmación expresa del cliente: única vía para ejecutar reservas, cancelaciones o cambios.
route('POST', '/api/ai/conversations/:id/confirm', ({ params, body }) => {
  const c = ownConv(params.id, body.token);
  const a = c.state.pending_action;
  if (!a || a.id !== body.action_id) fail(409, 'Esta acción ya no está vigente. Pedile a la asistente que la prepare de nuevo.');
  let text;
  try {
    if (a.type === 'book') {
      const clientId = api.upsertClient(a.client);
      const ap = api.createAppointment({ clientId, services: a.services, choice: a.choice, notes: ('Reserva por chat IA. ' + (a.notes || '')).slice(0, 500), mode: a.mode, source: 'chat_ia' });
      c.client_id = clientId; c.state.booked = true;
      text = `✅ Reserva ${ap.status === 'confirmada' ? 'confirmada' : 'registrada (pendiente de confirmación)'} por el sistema. Código ${ap.code}: ${ap.items.map(i => `${i.service} con ${i.professional} el ${i.start_at}`).join(' + ')}.${ap.deposit_required ? ` Seña pendiente: $${ap.deposit_required}.` : ''}`;
      c.state.last_booking = { code: ap.code, phone: ap.phone };
    } else if (a.type === 'cancel') {
      const d = api.appointmentDetail(a.appointment_id);
      const r = require('../db').tx(() => api.cancelAppointment(d, a.reason || 'Cancelado por chat', 'cliente (chat IA)'));
      text = `✅ El sistema canceló el turno ${d.code}. ${r.late ? 'Fue fuera de término.' : 'Fue en término.'}${r.refund ? ' Seña: ' + r.refund.replace(/_/g, ' ') + '.' : ''}`;
    } else if (a.type === 'reschedule') {
      const d = api.appointmentDetail(a.appointment_id);
      const { items } = rebuild(d, a.choice);
      text = `✅ El sistema movió el turno ${d.code} a ${items[0].start_at}.`;
    } else fail(400, 'Acción desconocida');
  } catch (e) {
    tools.audit(c, 'confirm_fallido', `${a.type}: ${e.message}`, 0);
    c.state.pending_action = null; conv.saveConv(c);
    const msg = `❌ No se pudo completar: ${e.message}`; conv.addMessage(c.id, 'assistant', msg, { source: 'sistema' });
    fail(e.status || 500, msg);
  }
  tools.audit(c, 'confirm_' + a.type, text);
  c.state.pending_action = null; conv.addMessage(c.id, 'assistant', text, { source: 'sistema' }); conv.saveConv(c);
  return { ok: true, message: text, last_booking: c.state.last_booking || null };
});
route('POST', '/api/ai/conversations/:id/dismiss', ({ params, body }) => {
  const c = ownConv(params.id, body.token); c.state.pending_action = null; conv.addMessage(c.id, 'assistant', 'Listo, no hice ningún cambio.', { source: 'sistema' }); conv.saveConv(c); return { ok: true };
});

// Reprogramación transaccional reutilizando la validación del motor.
function rebuild(d, choice) {
  const engine = require('../engine'); const db = require('../db');
  const services = d.items.map(i => ({ id: i.service_id, answers: i.answers }));
  return db.tx(() => {
    const ests = services.map(s => engine.estimate(engine.getService(s.id), s.answers));
    const items = [];
    for (const g of choice) { const pro = get('SELECT * FROM professionals WHERE id = ?', g.professional_id); const ge = g.service_ids.map(id => ests.find(e => e.service_id === id));
      engine.planGroup({ estimates: ge }, pro, g.block_start).forEach((p, k) => items.push({ ...p, answers: services.find(s => s.id === ge[k].service_id).answers })); }
    const err = engine.validateItems(items, d.id); if (err) fail(409, err);
    run('DELETE FROM appointment_items WHERE appointment_id = ?', d.id);
    for (const i of items) run(`INSERT INTO appointment_items(appointment_id,service_id,professional_id,start_at,end_at,block_start,block_end,answers,est_duration,price_min,price_max,signature) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      d.id, i.service_id, i.professional_id, i.start_at, i.end_at, i.block_start, i.block_end, JSON.stringify(i.answers), i.est_duration, i.price_min, i.price_max, i.signature);
    run('UPDATE appointments SET start_at = ?, end_at = ?, status = ? WHERE id = ?', items.map(i => i.start_at).sort()[0], items.map(i => i.end_at).sort().at(-1), 'confirmada', d.id);
    api.history(d.id, 'reprogramada', `${d.start_at} → ${items[0].start_at} (chat IA, confirmado por el cliente)`, 'cliente (chat IA)');
    api.notify('cambio', `Turno ${d.code} reprogramado por el cliente desde el chat a ${items[0].start_at}`, String(d.id));
    return { items };
  });
}

// Fotografías: se guardan asociadas a la conversación. La IA NO las analiza.
route('POST', '/api/ai/conversations/:id/photo', ({ params, body }) => {
  const c = ownConv(params.id, body.token); rateLimit('p' + c.id, 5);
  const img = String(body.image || '');
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(img) || img.length > 1.5e6) fail(400, 'Imagen inválida o demasiado grande (máx. ~1 MB).');
  const pid = Number(run('INSERT INTO ai_photos(conversation_id,client_id,service_id,image,note,created_at) VALUES(?,?,?,?,?,?)', c.id, c.client_id || null, Number(body.service_id) || null, img, String(body.note || '').slice(0, 300), T.nowLocal()).lastInsertRowid);
  const text = `Recibí tu foto (guardada de forma privada). No analizo imágenes, pero podés elegir: A) que la vea un profesional y te responda por acá, o B) reservar un turno de diagnóstico presencial de ${conv.aiConfig().diagnosis_minutes} minutos.`;
  conv.addMessage(c.id, 'user', '📎 Foto adjunta' + (body.note ? ': ' + body.note : ''), { photo_id: pid });
  conv.addMessage(c.id, 'assistant', text, { source: 'sistema', photo_id: pid });
  return { photo_id: pid, message: text, professionals: all('SELECT id, name FROM professionals WHERE active = 1'), diagnosis: all("SELECT id, name, category FROM services WHERE subcategory = 'Diagnóstico' AND active = 1") };
});
route('POST', '/api/ai/conversations/:id/photo/:pid/send', ({ params, body }) => {
  const c = ownConv(params.id, body.token);
  const p = get('SELECT * FROM ai_photos WHERE id = ? AND conversation_id = ?', Number(params.pid), c.id); if (!p) fail(404, 'Foto inexistente');
  const pro = get('SELECT id, name FROM professionals WHERE id = ? AND active = 1', Number(body.professional_id)); if (!pro) fail(400, 'Elegí un profesional');
  run("UPDATE ai_photos SET professional_id = ?, choice = 'profesional', status = 'enviada' WHERE id = ?", pro.id, p.id);
  api.notify('ia_foto', `Nueva foto para evaluar de un cliente, destinada a ${pro.name}`, String(p.id));
  const text = `Listo: la foto quedó registrada para ${pro.name}. Te va a responder en este chat; volvé a abrirlo para ver la respuesta.`;
  conv.addMessage(c.id, 'assistant', text, { source: 'sistema' });
  return { ok: true, message: text };
});

/* ───────── Panel ───────── */
const M = 'asistente';
route('GET', '/api/admin/ai/overview', { module: M }, () => {
  const p = getProvider(); const cfg = conv.aiConfig();
  return { config: cfg, provider: p.getModelInfo(), real_ai: p.isReal,
    usage: all('SELECT day, kind, provider, COUNT(*) n, SUM(ok) ok, SUM(tokens) tokens, ROUND(AVG(ms)) ms FROM ai_usage WHERE day >= ? GROUP BY day, kind, provider ORDER BY day DESC', T.addDays(T.today(), -14)),
    errors: all('SELECT created_at, kind, error FROM ai_usage WHERE ok = 0 ORDER BY id DESC LIMIT 10'),
    counts: { conversations: get("SELECT COUNT(*) n FROM ai_conversations WHERE kind='cliente'").n, pending: get("SELECT COUNT(*) n FROM ai_pending WHERE status IN ('pendiente','en_revision')").n,
      photos: get("SELECT COUNT(*) n FROM ai_photos WHERE status IN ('nueva','enviada')").n, kb_pending: get("SELECT COUNT(*) n FROM knowledge WHERE status='pendiente'").n } };
});
route('PUT', '/api/admin/ai/config', { module: M }, ({ body, user }) => {
  if (user.role !== 'owner') fail(403, 'Solo el propietario configura la IA.');
  const cur = conv.aiConfig();
  const next = { ...cur, enabled: !!body.enabled, name: String(body.name || cur.name).slice(0, 40), welcome: String(body.welcome || cur.welcome).slice(0, 300), tone: String(body.tone || cur.tone).slice(0, 200),
    topics: String(body.topics ?? cur.topics).slice(0, 500), handoff: String(body.handoff || cur.handoff).slice(0, 300),
    diagnosis_minutes: Math.max(5, Math.min(120, Number(body.diagnosis_minutes) || 15)), max_tokens: Math.max(100, Math.min(1200, Number(body.max_tokens) || 450)), daily_limit: Math.max(0, Math.min(5000, Number(body.daily_limit) || 300)) };
  setSetting('ai', next); ensureDiagnosisServices(); return next;
});

route('GET', '/api/admin/ai/knowledge', { module: M }, ({ query }) => ({ items: knowledge.list(query), categories: knowledge.CATEGORIES }));
route('POST', '/api/admin/ai/knowledge', { module: M }, ({ body, user }) => ({ id: knowledge.save(body, user) }));
route('PUT', '/api/admin/ai/knowledge/:id/status', { module: M }, ({ params, body, user }) => { knowledge.setStatus(params.id, body.status, user); return { ok: true }; });
route('DELETE', '/api/admin/ai/knowledge/:id', { module: M }, ({ params, user }) => { if (user.role !== 'owner') fail(403, 'Solo el propietario elimina conocimiento.'); run('DELETE FROM knowledge WHERE id = ?', Number(params.id)); return { ok: true }; });

route('GET', '/api/admin/ai/pending', { module: M }, () => all(`SELECT q.*, c.first_name, c.last_name, s.name service FROM ai_pending q LEFT JOIN clients c ON c.id = q.client_id LEFT JOIN services s ON s.id = q.service_id
  ORDER BY CASE q.status WHEN 'pendiente' THEN 0 WHEN 'en_revision' THEN 1 ELSE 2 END, q.id DESC LIMIT 100`).map(q => ({ ...q,
  context: q.conversation_id ? all("SELECT role, content, created_at FROM ai_messages WHERE conversation_id = ? AND role IN ('user','assistant','staff') ORDER BY id DESC LIMIT 6", q.conversation_id).reverse() : [] })));
route('PUT', '/api/admin/ai/pending/:id', { module: M }, ({ params, body, user }) => {
  const q = get('SELECT * FROM ai_pending WHERE id = ?', Number(params.id)); if (!q) fail(404, 'No existe');
  const status = ['pendiente', 'en_revision', 'respondida', 'cerrada'].includes(body.status) ? body.status : q.status;
  if (body.answer) {
    const ans = String(body.answer).slice(0, 2000);
    run("UPDATE ai_pending SET answer = ?, answered_by = ?, answered_at = ?, status = 'respondida', assigned_to = ? WHERE id = ?", ans, user.name, T.nowLocal(), user.id, q.id);
    if (q.conversation_id) conv.addMessage(q.conversation_id, 'staff', ans, { by: user.name, pending_id: q.id });
  } else run('UPDATE ai_pending SET status = ?, assigned_to = ? WHERE id = ?', status, user.id, q.id);
  return { ok: true };
});
// Propone la respuesta como conocimiento: queda PENDIENTE de aprobación del propietario.
route('POST', '/api/admin/ai/pending/:id/propose', { module: M }, ({ params, body, user }) => {
  const q = get('SELECT * FROM ai_pending WHERE id = ?', Number(params.id)); if (!q?.answer) fail(400, 'Primero respondé la consulta.');
  const id = knowledge.save({ question: body.question || q.question, answer: body.answer || q.answer, keywords: body.keywords || '', category: body.category || 'faq', scope: 'negocio', status: 'pendiente', source_pending_id: q.id }, { ...user, role: 'manager' });
  run('UPDATE ai_pending SET knowledge_id = ? WHERE id = ?', id, q.id);
  return { id };
});

route('GET', '/api/admin/ai/photos', { module: 'agenda' }, ({ user }) => {
  const pf = user.role === 'employee' ? ' AND (p.professional_id = ' + Number(user.professional_id) + ')' : '';
  return all(`SELECT p.*, c.first_name, c.last_name, c.phone, s.name service, pr.name professional, ac.state FROM ai_photos p LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN services s ON s.id = p.service_id LEFT JOIN professionals pr ON pr.id = p.professional_id LEFT JOIN ai_conversations ac ON ac.id = p.conversation_id WHERE 1=1 ${pf} ORDER BY p.id DESC LIMIT 60`)
    .map(({ state, ...p }) => ({ ...p, phone: p.phone || JSON.parse(state || '{}').phone || null }));
});
route('PUT', '/api/admin/ai/photos/:id', { module: 'agenda' }, ({ params, body, user }) => {
  const p = get('SELECT * FROM ai_photos WHERE id = ?', Number(params.id)); if (!p) fail(404, 'No existe');
  if (user.role === 'employee' && p.professional_id !== user.professional_id) fail(403, 'Esta foto no está asignada a vos.');
  if (body.professional_id) run('UPDATE ai_photos SET professional_id = ? WHERE id = ?', Number(body.professional_id), p.id);
  if (body.answer) {
    run("UPDATE ai_photos SET answer = ?, answered_by = ?, answered_at = ?, status = 'respondida' WHERE id = ?", String(body.answer).slice(0, 2000), user.name, T.nowLocal(), p.id);
    conv.addMessage(p.conversation_id, 'staff', `Sobre tu foto: ${body.answer}`, { by: user.name, photo_id: p.id });
  }
  if (body.status) run('UPDATE ai_photos SET status = ? WHERE id = ?', body.status, p.id);
  return { ok: true };
});

route('GET', '/api/admin/ai/conversations', { module: M }, () => all(`SELECT a.id, a.kind, a.created_at, a.updated_at, a.state, c.first_name, c.last_name,
  (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = a.id) n FROM ai_conversations a LEFT JOIN clients c ON c.id = a.client_id WHERE a.kind = 'cliente' ORDER BY a.updated_at DESC LIMIT 60`)
  .map(({ state, ...r }) => ({ ...r, booked: !!JSON.parse(state || '{}').booked })));
route('GET', '/api/admin/ai/conversations/:id', { module: M }, ({ params }) => ({ messages: conv.messages(Number(params.id)), audit: all('SELECT * FROM ai_audit WHERE conversation_id = ? ORDER BY id', Number(params.id)) }));

// Asistente administrativo (solo lectura sobre datos reales).
route('POST', '/api/admin/ai/chat', { module: 'estadisticas' }, async ({ body, user }) => {
  const message = String(body.message || '').trim().slice(0, 600); if (!message) fail(400, 'Escribí una consulta.');
  rateLimit('a' + user.id, 20);
  let c = body.conversation_id ? conv.loadConv(body.conversation_id) : null;
  if (!c || c.kind !== 'admin' || c.user_id !== user.id) c = conv.createConversation('admin', { userId: user.id });
  return { conversation_id: c.id, ...(await conv.adminChat({ conv: c, message, user })) };
});
