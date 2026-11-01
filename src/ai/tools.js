// Herramientas internas (function calling). El modelo NUNCA accede a la base:
// solo puede invocar estas funciones, que validan identidad, propiedad, permisos y reglas.
// Las acciones que modifican datos (reservar, cancelar, reprogramar) solo PROPONEN:
// la ejecución requiere la confirmación expresa del cliente desde la interfaz (endpoint /confirm).
const { all, get, run, getSetting } = require('../db');
const engine = require('../engine');
const T = require('../time');
const api = require('../api');
const knowledge = require('./knowledge');

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const audit = (conv, action, detail, allowed = 1) => run('INSERT INTO ai_audit(conversation_id,action,detail,allowed,created_at) VALUES(?,?,?,?,?)', conv.id, action, String(detail).slice(0, 500), allowed ? 1 : 0, T.nowLocal());
const svcBrief = s => ({ id: s.id, nombre: s.name, categoria: s.category, precio: s.price_min === s.price_max ? s.price_min : `${s.price_min}-${s.price_max}`, duracion_min: s.base_duration + (s.extra_time || 0), sena: s.deposit_amount || 0, requiere_evaluacion: !!s.complex });
const fmtOpt = (o, n) => ({ opcion: n, modalidad: o.type, dia: `${DAYS[T.weekday(o.date)]} ${o.date}`, inicio: o.start.slice(11), fin: o.end.slice(11),
  detalle: o.items.map(i => `${i.service} con ${i.professional} ${i.start_at.slice(11)}-${i.end_at.slice(11)}`) });
const ok = data => ({ ok: true, ...data });
const no = error => ({ ok: false, error });

function priceType(est, svc) {
  if (svc.complex) return 'presupuesto sujeto a evaluación profesional';
  if (est.price_min === est.price_max) return 'precio estimado según lo informado';
  return 'rango orientativo';
}

/* ───────── Herramientas del chat de clientes ───────── */
const CLIENT_TOOLS = [
  { name: 'get_business_info', description: 'Datos del local: nombre, dirección, horario general, contacto, condiciones generales, horizonte de reservas y duración del turno de diagnóstico.', parameters: { type: 'object', properties: {} },
    run: () => { const b = getSetting('business', {}); const ai = getSetting('ai', {});
      return ok({ nombre: b.name, direccion: b.address, horario: b.hours, telefono: b.phone, whatsapp: b.whatsapp, instagram: b.instagram, email: b.email, condiciones: b.conditions,
        reservas_hasta_dias: getSetting('booking_horizon_days', 45), diagnostico_minutos: ai.diagnosis_minutes || 15, hoy: T.nowLocal() }); } },
  { name: 'list_services', description: 'Lista servicios activos con precio vigente (exacto o rango), duración base, seña y si requieren evaluación. Filtrar por categoría (peluqueria|manicuria) o texto.', parameters: { type: 'object', properties: { category: { type: 'string', enum: ['peluqueria', 'manicuria'] }, query: { type: 'string' } } },
    run: ({ category, query }) => {
      let s = all('SELECT * FROM services WHERE active = 1' + (category ? ' AND category = ?' : ''), ...(category ? [category] : []));
      if (query) { const q = norm(query); const f = s.filter(x => norm(x.name + ' ' + x.description + ' ' + x.subcategory).split(' ').some(w => w.length > 3 && q.includes(w.slice(0, 5)))); if (f.length) s = f; }
      return ok({ servicios: s.map(svcBrief) });
    } },
  { name: 'get_service_details', description: 'Detalle de un servicio: descripción, preguntas para presupuestar (con opciones), requisitos, seña, política de cancelación, profesionales habilitados y duración real promedio.', parameters: { type: 'object', properties: { service_id: { type: 'integer' } }, required: ['service_id'] },
    run: ({ service_id }) => {
      const s = engine.getService(Number(service_id)); if (!s || !s.active) return no('Servicio inexistente');
      const est = engine.estimate(s, {});
      return ok({ ...svcBrief(s), descripcion: s.description, preparacion_min: s.prep_time, limpieza_min: s.cleanup_time, anticipacion_minima_h: s.min_advance_hours,
        requisitos: s.requirements, condiciones_sena: s.deposit_terms, cancelacion_sin_cargo_h: s.cancel_hours, fuera_de_termino: s.late_cancel_terms,
        preguntas: s.questions.map(q => ({ id: q.id, pregunta: q.label, tipo: q.type, opciones: (q.options || []).map(o => o.label) })),
        profesionales: engine.eligiblePros([s.id]).map(p => p.name), duracion_real: est.learned });
    } },
  { name: 'estimate_quote', description: 'Calcula presupuesto y duración para uno o más servicios según las respuestas del cliente (answers: {id_pregunta: opción}). Indica si es precio estimado, rango o sujeto a evaluación y aplica promociones si el cliente está identificado.', parameters: { type: 'object', properties: { services: { type: 'array', items: { type: 'object', properties: { service_id: { type: 'integer' }, answers: { type: 'object' } }, required: ['service_id'] } } }, required: ['services'] },
    run: ({ services }, conv) => {
      const out = []; for (const x of services || []) {
        const s = engine.getService(Number(x.service_id)); if (!s) return no('Servicio inexistente: ' + x.service_id);
        const e = engine.estimate(s, x.answers || {});
        out.push({ servicio: s.name, precio_min: e.price_min, precio_max: e.price_max, tipo: priceType(e, s), duracion_min: e.duration, en_agenda_min: e.prep + e.duration + e.cleanup, sena: e.deposit, advertencias: e.warnings, historial: e.learned.note });
      }
      const promo = conv.client_id ? api.bestPromo(conv.client_id, (services || []).map(x => { const s = engine.getService(Number(x.service_id)); const e = engine.estimate(s, x.answers || {}); return { service_id: s.id, professional_id: null, price_min: e.price_min }; }), T.today()) : null;
      return ok({ items: out, total_min: out.reduce((a, x) => a + x.precio_min, 0), total_max: out.reduce((a, x) => a + x.precio_max, 0), promocion_aplicable: promo, nota: 'Ningún valor es definitivo hasta la atención en el local.' });
    } },
  { name: 'list_professionals', description: 'Profesionales activos con especialidades, horarios semanales y servicios que realizan.', parameters: { type: 'object', properties: {} },
    run: () => ok({ profesionales: all('SELECT * FROM professionals WHERE active = 1').map(p => ({ id: p.id, nombre: p.name, especialidades: p.specialties,
      horarios: all('SELECT weekday, start, end FROM schedules WHERE professional_id = ? ORDER BY weekday', p.id).map(s => `${DAYS[s.weekday]} ${s.start}-${s.end}`),
      servicios: p.all_services ? 'todos' : all('SELECT s.name FROM professional_services ps JOIN services s ON s.id = ps.service_id WHERE ps.professional_id = ?', p.id).map(s => s.name) })) }) },
  { name: 'check_availability', description: 'Consulta la agenda REAL y devuelve opciones numeradas. Considera horarios, descansos, comidas, ausencias, capacidad, preparación/limpieza y servicios combinados (simultáneo o consecutivo). Usar siempre antes de ofrecer horarios.', parameters: { type: 'object', properties: {
      services: { type: 'array', items: { type: 'object', properties: { service_id: { type: 'integer' }, answers: { type: 'object' } }, required: ['service_id'] } },
      date_from: { type: 'string', description: 'YYYY-MM-DD' }, days: { type: 'integer' }, time_pref: { type: 'string', enum: ['any', 'manana', 'tarde', 'noche'] },
      weekdays: { type: 'array', items: { type: 'integer' }, description: '0=domingo ... 6=sábado' }, professional_id: { type: 'integer' } }, required: ['services'] },
    run: (a, conv) => {
      const services = (a.services || []).map(x => ({ id: Number(x.service_id), answers: x.answers || {} }));
      const pros = {}; if (a.professional_id) for (const s of services) { const svc = engine.getService(s.id); if (svc) pros[svc.category] = Number(a.professional_id); }
      let r; try { r = api.availability({ services, pros, dateFrom: a.date_from, days: Math.min(Number(a.days) || 7, 14), timePref: a.time_pref || 'any', weekdays: a.weekdays }); } catch (e) { return no(e.message); }
      const lists = { simple: r.single, simultaneo: r.simultaneous, consecutivo: r.consecutive };
      const opts = []; for (const [k, l] of Object.entries(lists)) for (const o of pickSpread(l, 6)) opts.push(o);
      conv.state.last_options = opts.map(o => ({ type: o.type, start: o.start, choice: o.choice, items: o.items.map(i => ({ service: i.service, professional: i.professional, start_at: i.start_at, end_at: i.end_at })) }));
      conv.state.last_services = services;
      if (!opts.length) return ok({ opciones: [], mensaje: 'No hay horarios con esos criterios. Se puede ampliar el rango, cambiar la franja o registrar una solicitud en lista de espera.' });
      return ok({ opciones: opts.map((o, i) => fmtOpt(o, i + 1)), nota: 'Disponibilidad al momento de la consulta; se revalida al confirmar.' });
    } },
  { name: 'get_promotions', description: 'Promociones vigentes con condiciones. Si el cliente está identificado, indica si califica.', parameters: { type: 'object', properties: {} },
    run: (_, conv) => {
      const ps = all('SELECT * FROM promotions WHERE active = 1 AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?) AND (max_uses IS NULL OR uses < max_uses)', T.today(), T.today());
      const client = conv.client_id ? get('SELECT registered FROM clients WHERE id = ?', conv.client_id) : null;
      return ok({ requieren_registro: getSetting('promos_require_registration', true), cliente_registrado: client ? !!client.registered : null,
        promociones: ps.map(p => ({ nombre: p.name, descripcion: p.description, descuento: p.type === 'percent' ? p.value + '%' : '$' + p.value, publico: p.audience, dias: JSON.parse(p.weekdays || '[]').map(d => DAYS[d]), hasta: p.end_date })) });
    } },
  { name: 'search_knowledge', description: 'Busca en la base de conocimiento APROBADA (políticas, preguntas frecuentes, cuidados, información general de belleza). Usar antes de responder dudas que no son precio/horario.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: ({ query }) => { const r = knowledge.search(query, 4); return ok({ resultados: r.map(k => ({ titulo: k.question, contenido: k.answer, categoria: k.category, ambito: k.scope === 'general' ? 'conocimiento general (no reemplaza políticas del local)' : 'información oficial del local', version: k.version })) }); } },
  { name: 'verify_client', description: 'Vincula la conversación a un cliente existente validando teléfono + código de alguno de sus turnos. Necesario para ver historial o gestionar reservas.', parameters: { type: 'object', properties: { phone: { type: 'string' }, code: { type: 'string' } }, required: ['phone', 'code'] },
    run: ({ phone, code }, conv) => {
      const a = get('SELECT a.client_id FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.code = ? AND c.phone = ?', String(code || '').toUpperCase(), api.phoneNorm(phone));
      if (!a) { audit(conv, 'verify_client_fallido', api.phoneNorm(phone), 0); return no('No coinciden teléfono y código.'); }
      conv.client_id = a.client_id; audit(conv, 'verify_client', 'ok');
      return ok({ mensaje: 'Cliente verificado', nombre: get('SELECT first_name FROM clients WHERE id = ?', a.client_id).first_name });
    } },
  { name: 'get_client_history', description: 'Historial del cliente identificado (servicios anteriores, profesionales, preferencias, cancelaciones). Solo funciona si la conversación está vinculada a un cliente. Usarlo como referencia, no como certeza.', parameters: { type: 'object', properties: {} },
    run: (_, conv) => {
      if (!conv.client_id) return no('Cliente no identificado. Tratarlo como cliente nuevo o pedir verificación (teléfono + código de un turno).');
      const c = get('SELECT first_name, preferences FROM clients WHERE id = ?', conv.client_id); const st = api.clientStats(conv.client_id);
      const visits = all(`SELECT a.start_at, a.status, s.name service, p.name professional, i.answers FROM appointments a JOIN appointment_items i ON i.appointment_id = a.id
        JOIN services s ON s.id = i.service_id JOIN professionals p ON p.id = i.professional_id WHERE a.client_id = ? ORDER BY a.start_at DESC LIMIT 6`, conv.client_id);
      return ok({ nombre: c.first_name, preferencias: c.preferences, visitas_finalizadas: st.done || 0, cancelaciones: st.cancels || 0, inasistencias: st.noshows || 0,
        turnos: visits.map(v => ({ fecha: v.start_at.slice(0, 10), estado: v.status, servicio: v.service, profesional: v.professional, detalles: JSON.parse(v.answers || '{}') })) });
    } },
  { name: 'save_client_preference', description: 'Guarda una preferencia del cliente identificado SOLO después de que el cliente aceptó que se registre.', parameters: { type: 'object', properties: { preference: { type: 'string' } }, required: ['preference'] },
    run: ({ preference }, conv) => {
      if (!conv.client_id) return no('Cliente no identificado');
      const c = get('SELECT preferences FROM clients WHERE id = ?', conv.client_id);
      const p = [c.preferences, `${T.today()}: ${String(preference).slice(0, 200)}`].filter(Boolean).join(' | ').slice(-800);
      run('UPDATE clients SET preferences = ? WHERE id = ?', p, conv.client_id); audit(conv, 'save_preference', preference);
      return ok({ guardado: true });
    } },
  { name: 'get_my_appointments', description: 'Turnos próximos del cliente identificado, con su código.', parameters: { type: 'object', properties: {} },
    run: (_, conv) => {
      if (!conv.client_id) return no('Cliente no identificado');
      return ok({ turnos: all("SELECT id FROM appointments WHERE client_id = ? AND start_at >= ? AND status IN ('pendiente','confirmada','reprogramacion') ORDER BY start_at", conv.client_id, T.nowLocal())
        .map(r => api.appointmentDetail(r.id)).map(a => ({ codigo: a.code, fecha: a.start_at, estado: a.status_label, servicios: a.items.map(i => `${i.service} con ${i.professional}`) })) });
    } },
  { name: 'propose_booking', description: 'Prepara una reserva con una opción numerada devuelta por check_availability. NO confirma: el cliente debe tocar "Confirmar" en la interfaz. Requiere nombre, apellido y teléfono.', parameters: { type: 'object', properties: {
      option: { type: 'integer' }, first_name: { type: 'string' }, last_name: { type: 'string' }, phone: { type: 'string' }, notes: { type: 'string' } }, required: ['option', 'first_name', 'last_name', 'phone'] },
    run: (a, conv) => {
      const o = (conv.state.last_options || [])[Number(a.option) - 1];
      if (!o) return no('Opción inexistente. Volver a consultar disponibilidad.');
      if (!a.first_name || !a.last_name || api.phoneNorm(a.phone).length < 8) return no('Faltan nombre, apellido o un teléfono válido.');
      const services = conv.state.last_services || [];
      const ests = services.map(s => engine.estimate(engine.getService(s.id), s.answers || {}));
      const svcs = services.map(s => engine.getService(s.id));
      const summary = { tipo: 'reserva', cliente: `${a.first_name} ${a.last_name}`, telefono: api.phoneNorm(a.phone), fecha: `${DAYS[T.weekday(o.start.slice(0, 10))]} ${o.start}`, modalidad: o.type,
        detalle: o.items.map(i => `${i.service} con ${i.professional} ${i.start_at.slice(11)}-${i.end_at.slice(11)}`), duracion_min: ests.reduce((x, e) => x + e.duration, 0),
        precio: `$${ests.reduce((x, e) => x + e.price_min, 0)} - $${ests.reduce((x, e) => x + e.price_max, 0)} (estimado)`, sena: ests.reduce((x, e) => x + e.deposit, 0),
        cancelacion: `Sin cargo hasta ${Math.max(...svcs.map(s => s.cancel_hours || 24))} h antes. ${svcs.map(s => s.late_cancel_terms).filter(Boolean).join(' ')}`,
        condiciones: getSetting('business', {}).conditions };
      conv.state.pending_action = { id: Math.random().toString(36).slice(2, 10), type: 'book', client: { first_name: a.first_name, last_name: a.last_name, phone: a.phone }, services, choice: o.choice, mode: o.type, notes: a.notes || '', summary };
      audit(conv, 'propose_booking', JSON.stringify(summary.detalle));
      return ok({ esperando_confirmacion: true, resumen: summary, instruccion: 'Mostrá el resumen y pedí que toque "Confirmar". No digas que está reservada.' });
    } },
  { name: 'propose_cancellation', description: 'Prepara la cancelación de un turno. Verifica propiedad (código + teléfono) y calcula consecuencias sobre la seña. NO cancela: requiere que el cliente toque "Confirmar cancelación".', parameters: { type: 'object', properties: { code: { type: 'string' }, phone: { type: 'string' }, reason: { type: 'string' } }, required: ['code', 'phone'] },
    run: (a, conv) => {
      const ap = get('SELECT a.id FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.code = ? AND c.phone = ?', String(a.code || '').toUpperCase(), api.phoneNorm(a.phone));
      if (!ap) { audit(conv, 'propose_cancellation_rechazada', a.code, 0); return no('No encontramos un turno con ese código y teléfono.'); }
      const d = api.appointmentDetail(ap.id);
      if (['cancelada', 'finalizada', 'no_asistio'].includes(d.status)) return no('El turno no se puede cancelar en su estado actual: ' + d.status_label);
      const hours = (T.stamp(d.start_at) - T.stamp(T.nowLocal())) / 60; const late = hours < d.cancel_hours;
      const consecuencia = late ? (d.deposit_paid ? `Fuera de término: se pierde la seña abonada ($${d.deposit_paid}).` : 'Fuera de término: queda registrado como cancelación tardía.') : (d.deposit_paid ? `En término: la seña ($${d.deposit_paid}) queda pendiente de devolución.` : 'En término: sin penalización.');
      conv.client_id ||= d.client_id;
      conv.state.pending_action = { id: Math.random().toString(36).slice(2, 10), type: 'cancel', appointment_id: d.id, code: d.code, phone: a.phone, reason: a.reason || '',
        summary: { tipo: 'cancelacion', codigo: d.code, fecha: d.start_at, servicios: d.items.map(i => `${i.service} con ${i.professional}`), consecuencia } };
      audit(conv, 'propose_cancellation', d.code);
      return ok({ esperando_confirmacion: true, resumen: conv.state.pending_action.summary, instruccion: 'Explicá la consecuencia y pedí que toque "Confirmar cancelación".' });
    } },
  { name: 'propose_reschedule', description: 'Prepara mover un turno propio a una opción numerada de check_availability (consultada con los mismos servicios). Verifica código + teléfono. Requiere confirmación del cliente en la interfaz.', parameters: { type: 'object', properties: { code: { type: 'string' }, phone: { type: 'string' }, option: { type: 'integer' } }, required: ['code', 'phone', 'option'] },
    run: (a, conv) => {
      const ap = get('SELECT a.id FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.code = ? AND c.phone = ?', String(a.code || '').toUpperCase(), api.phoneNorm(a.phone));
      if (!ap) { audit(conv, 'propose_reschedule_rechazada', a.code, 0); return no('No encontramos un turno con ese código y teléfono.'); }
      const d = api.appointmentDetail(ap.id); const o = (conv.state.last_options || [])[Number(a.option) - 1];
      if (!['confirmada', 'pendiente', 'reprogramacion'].includes(d.status)) return no('Este turno no admite cambios.');
      if (!o) return no('Opción inexistente. Consultar disponibilidad con los servicios del turno.');
      const same = d.items.map(i => i.service_id).sort().join() === (conv.state.last_services || []).map(s => s.id).sort().join();
      if (!same) return no('La disponibilidad consultada no corresponde a los servicios del turno. Consultá con los mismos servicios.');
      conv.client_id ||= d.client_id;
      conv.state.pending_action = { id: Math.random().toString(36).slice(2, 10), type: 'reschedule', appointment_id: d.id, choice: o.choice,
        summary: { tipo: 'reprogramacion', codigo: d.code, de: d.start_at, a: o.start, detalle: o.items.map(i => `${i.service} con ${i.professional} ${i.start_at.slice(11)}`) } };
      audit(conv, 'propose_reschedule', d.code);
      return ok({ esperando_confirmacion: true, resumen: conv.state.pending_action.summary });
    } },
  { name: 'register_unanswered_question', description: 'Registra una consulta que no se puede responder con información aprobada, para que el equipo la responda. Usar en vez de inventar.', parameters: { type: 'object', properties: { question: { type: 'string' }, category: { type: 'string' }, service_id: { type: 'integer' } }, required: ['question'] },
    run: (a, conv) => {
      const id = Number(run('INSERT INTO ai_pending(conversation_id,client_id,phone,question,category,service_id,created_at) VALUES(?,?,?,?,?,?,?)', conv.id, conv.client_id || null,
        conv.client_id ? get('SELECT phone FROM clients WHERE id = ?', conv.client_id)?.phone : (conv.state.phone || null), String(a.question).slice(0, 600), a.category || 'general', Number(a.service_id) || null, T.nowLocal()).lastInsertRowid);
      api.notify('ia_consulta', `Consulta sin respuesta para la IA: "${String(a.question).slice(0, 80)}"`, String(id));
      return ok({ registrada: true, id, mensaje: 'El equipo la responderá en este mismo chat.' });
    } },
];

/* ───────── Herramientas del asistente administrativo (solo lectura) ───────── */
const dateRe = /^\d{4}-\d\d-\d\d$/;
const per = a => { const from = dateRe.test(a.from || '') ? a.from : T.addDays(T.today(), -30), to = dateRe.test(a.to || '') ? a.to : T.today(); return { from, to }; };
const W = 'substr(a.start_at,1,10) BETWEEN ? AND ?';
const ADMIN_TOOLS = [
  { name: 'business_stats', description: 'Métricas reales del período: turnos por estado, ingresos estimados, señas pendientes, clientes nuevos, cancelaciones, inasistencias.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: a => { const { from, to } = per(a);
      return ok({ periodo: { from, to }, por_estado: all(`SELECT status, COUNT(*) n FROM appointments a WHERE ${W} GROUP BY status`, from, to),
        ingresos_estimados: get(`SELECT SUM(price_min-discount) min, SUM(price_max-discount) max FROM appointments a WHERE ${W} AND status IN ('confirmada','pendiente','en_curso','finalizada')`, from, to),
        senas_pendientes: get(`SELECT COUNT(*) n, SUM(deposit_required-deposit_paid) monto FROM appointments a WHERE ${W} AND deposit_status IN ('pendiente','parcial') AND status NOT IN ('cancelada','no_asistio')`, from, to),
        clientes_nuevos: get('SELECT COUNT(*) n FROM clients WHERE substr(created_at,1,10) BETWEEN ? AND ?', from, to).n,
        incluye_datos_demo: !!get(`SELECT 1 FROM appointments a WHERE ${W} AND source = 'demo'`, from, to) }); } },
  { name: 'appointments_list', description: 'Listado de turnos del período (máx. 40), filtrable por estado o profesional.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, status: { type: 'string' }, professional_id: { type: 'integer' } } },
    run: a => { const { from, to } = per(a);
      let sql = `SELECT DISTINCT a.id FROM appointments a JOIN appointment_items i ON i.appointment_id=a.id WHERE ${W}`; const p = [from, to];
      if (a.status) { sql += ' AND a.status = ?'; p.push(a.status); } if (a.professional_id) { sql += ' AND i.professional_id = ?'; p.push(Number(a.professional_id)); }
      return ok({ periodo: { from, to }, turnos: all(sql + ' ORDER BY a.start_at LIMIT 40', ...p).map(r => api.appointmentDetail(r.id)).map(x => ({ codigo: x.code, fecha: x.start_at, cliente: `${x.first_name} ${x.last_name}`, estado: x.status, servicios: x.items.map(i => `${i.service} (${i.professional})`).join(' + '), sena: x.deposit_status })) }); } },
  { name: 'occupancy', description: 'Ocupación por profesional y por día de la semana en el período (minutos disponibles vs reservados, % y horas libres).', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: a => { const { from, to } = per(a); const pros = all('SELECT id, name FROM professionals WHERE active = 1'); const byPro = {}, byWd = {};
      for (let d = from; d <= to; d = T.addDays(d, 1)) for (const p of pros) {
        const avail = engine.freeWindows(p.id, d).reduce((x, [s, e]) => x + e - s, 0); if (!avail) continue;
        const busy = get(`SELECT COALESCE(SUM((julianday(replace(i.block_end,' ','T'))-julianday(replace(i.block_start,' ','T')))*1440),0) m FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id WHERE i.professional_id=? AND substr(i.block_start,1,10)=? AND a.status IN ('pendiente','confirmada','en_curso','finalizada','reprogramacion')`, p.id, d).m;
        (byPro[p.name] ??= { disponible: 0, reservado: 0 }); byPro[p.name].disponible += avail; byPro[p.name].reservado += busy;
        const w = DAYS[T.weekday(d)]; (byWd[w] ??= { disponible: 0, reservado: 0 }); byWd[w].disponible += avail; byWd[w].reservado += busy;
      }
      const fmt = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ocupacion_pct: Math.round(v.reservado / v.disponible * 100), horas_libres: Math.round((v.disponible - v.reservado) / 60) }]));
      return ok({ periodo: { from, to }, por_profesional: fmt(byPro), por_dia_semana: fmt(byWd) }); } },
  { name: 'top_services', description: 'Servicios más solicitados y servicios con más cancelaciones en el período.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: a => { const { from, to } = per(a); return ok({ periodo: { from, to },
      mas_solicitados: all(`SELECT s.name servicio, COUNT(*) n FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id JOIN services s ON s.id=i.service_id WHERE ${W} GROUP BY s.id ORDER BY n DESC LIMIT 8`, from, to),
      cancelaciones_por_servicio: all(`SELECT s.name servicio, SUM(a.status='cancelada') cancelados, SUM(a.status='no_asistio') inasistencias, COUNT(*) total FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id JOIN services s ON s.id=i.service_id WHERE ${W} GROUP BY s.id HAVING cancelados + inasistencias > 0 ORDER BY cancelados DESC`, from, to) }); } },
  { name: 'inactive_clients', description: 'Clientes cuya última visita finalizada fue hace más de N días y no tienen turnos futuros.', parameters: { type: 'object', properties: { days: { type: 'integer' } } },
    run: a => { const days = Math.max(1, Number(a.days) || 60); return ok({ dias: days, clientes: all(`SELECT c.first_name || ' ' || c.last_name cliente, c.phone telefono, MAX(a.start_at) ultima_visita, c.demo FROM clients c JOIN appointments a ON a.client_id=c.id AND a.status='finalizada'
      GROUP BY c.id HAVING ultima_visita < ? AND c.id NOT IN (SELECT client_id FROM appointments WHERE start_at > ?) ORDER BY ultima_visita LIMIT 30`, T.addDays(T.today(), -days) + ' 00:00', T.nowLocal()) }); } },
  { name: 'waitlist_and_unconverted', description: 'Lista de espera abierta, solicitudes perdidas con motivo, consultas de IA pendientes y conversaciones que no terminaron en reserva.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: a => { const { from, to } = per(a); return ok({ periodo: { from, to },
      lista_espera: all("SELECT r.created_at, c.first_name || ' ' || c.last_name cliente, r.service_ids, r.preference, r.urgency, r.event_date FROM requests r JOIN clients c ON c.id=r.client_id WHERE r.status='abierta'").map(r => ({ ...r, servicios: JSON.parse(r.service_ids).map(id => get('SELECT name FROM services WHERE id=?', id)?.name).join(' + '), service_ids: undefined })),
      perdidas: all("SELECT COALESCE(lost_reason,'sin motivo') motivo, COUNT(*) n FROM requests WHERE status IN ('perdida','descartada') AND substr(created_at,1,10) BETWEEN ? AND ? GROUP BY motivo", from, to),
      consultas_ia_pendientes: get("SELECT COUNT(*) n FROM ai_pending WHERE status IN ('pendiente','en_revision')").n,
      conversaciones: get("SELECT COUNT(*) n, SUM(CASE WHEN state LIKE '%\"booked\":true%' THEN 1 ELSE 0 END) con_reserva FROM ai_conversations WHERE kind='cliente' AND substr(created_at,1,10) BETWEEN ? AND ?", from, to) }); } },
  { name: 'free_slots', description: 'Huecos libres (≥30 min) por profesional en una fecha.', parameters: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] },
    run: a => { const date = dateRe.test(a.date || '') ? a.date : T.today();
      return ok({ fecha: date, huecos: all('SELECT id, name FROM professionals WHERE active = 1').map(p => {
        const busy = all(`SELECT i.block_start s, i.block_end e FROM appointment_items i JOIN appointments a ON a.id=i.appointment_id WHERE i.professional_id=? AND substr(i.block_start,1,10)=? AND a.status IN ('pendiente','confirmada','en_curso','reprogramacion') ORDER BY s`, p.id, date);
        const free = []; for (const [ws, we] of engine.freeWindows(p.id, date)) { let cur = ws; for (const b of busy) { const bs = T.toMin(b.s.slice(11)), be = T.toMin(b.e.slice(11)); if (be <= cur || bs >= we) continue; if (bs - cur >= 30) free.push(`${T.fromMin(cur)}-${T.fromMin(bs)}`); cur = Math.max(cur, be); } if (we - cur >= 30) free.push(`${T.fromMin(cur)}-${T.fromMin(we)}`); }
        return { profesional: p.name, libres: free }; }) }); } },
];

function pickSpread(list, n) { // opciones repartidas en distintos días
  if (list.length <= n) return list;
  const byDay = {}; list.forEach(o => (byDay[o.date] ??= []).push(o));
  const out = []; let i = 0; const days = Object.values(byDay);
  while (out.length < n && days.some(d => d[i])) { for (const d of days) if (d[i] && out.length < n) out.push(d[i]); i += 2; }
  return out.sort((a, b) => a.start < b.start ? -1 : 1);
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');

async function execTool(set, name, args, conv) {
  const t = set.find(x => x.name === name);
  if (!t) return no('Herramienta inexistente');
  try { return await t.run(args || {}, conv); } catch (e) { console.error('[TurnIA][tool]', name, e.message); return no('Error interno de la herramienta'); }
}
const schemas = set => set.map(({ run, ...s }) => s);

module.exports = { CLIENT_TOOLS, ADMIN_TOOLS, execTool, schemas, audit, norm };
