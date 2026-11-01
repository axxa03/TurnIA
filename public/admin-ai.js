// Sección de IA del panel: asistente de gestión, configuración, conocimiento, consultas, fotos, conversaciones y uso.
const KB_ST = { borrador: 'st-finalizada', pendiente: 'st-pendiente', aprobado: 'st-confirmada', desactivado: 'st-cancelada' };
const md = t => e(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); // markdown mínimo y seguro

VIEWS.asistente = async function () {
  const tab = A.aiTab || 'gestion';
  const o = await aapi('/api/admin/ai/overview'); const c = o.counts;
  const tabs = [['gestion', '💬 Asistente de gestión'], ['pendientes', `❓ Consultas pendientes (${c.pending})`], ['conocimiento', `📚 Base de conocimiento${c.kb_pending ? ` (${c.kb_pending} por aprobar)` : ''}`],
    ['fotos', `📷 Fotos (${c.photos})`], ['conversaciones', '🗂️ Conversaciones'], ['config', '⚙️ Configuración y uso']];
  $('#main').innerHTML = H('Inteligencia artificial', '', o.real_ai ? `Proveedor: ${e(o.provider.provider)} · modelo ${e(o.provider.model)} · herramientas ${o.provider.tools ? 'sí' : 'no'}` :
    '⚠️ Proveedor SIMULADO (sin IA): falta configurar AI_API_URL, AI_API_KEY y AI_MODEL en el .env del servidor. Se responde con reglas y base de conocimiento.') +
    `<div class="tabsA" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" onclick="A.aiTab='${k}';show()">${l}</button>`).join('')}</div><div id="aiBody"></div>`;
  await AI[tab](o);
};

const AI = {
  async gestion() {
    if (!A.user.modules.includes('estadisticas')) { $('#aiBody').innerHTML = '<div class="note">Tu usuario no tiene acceso a estadísticas.</div>'; return; }
    const sug = ['¿Cuántas reservas tuvimos este mes y cuántas se cancelaron?', '¿Qué profesional tiene más horarios disponibles esta semana?', '¿Cuáles son los servicios más solicitados?', '¿Qué clientes hace más de dos meses que no vienen?', '¿Qué clientes están esperando un turno?', '¿Cuántos turnos están pendientes de seña?'];
    $('#aiBody').innerHTML = `<div class="card"><div id="agLog" style="max-height:52vh;overflow:auto;display:flex;flex-direction:column;gap:10px">${(A.agLog || []).join('') || '<p class="muted small">Preguntá en lenguaje natural. Solo consulta datos reales (lectura): no modifica nada.</p>'}</div>
      <div class="row" style="margin:10px 0">${sug.map(s => `<button class="chip small" onclick="agAsk(this.textContent)">${e(s)}</button>`).join('')}</div>
      <form class="row" onsubmit="event.preventDefault();agAsk($('#agIn').value)"><input id="agIn" style="flex:1" placeholder="Ej: ¿qué días tenemos menos ocupación?"><button class="btn pri">Preguntar</button></form></div>`;
    $('#agLog').scrollTop = 1e6;
  },
  async pendientes() {
    const qs = await aapi('/api/admin/ai/pending');
    $('#aiBody').innerHTML = `<p class="small muted">Consultas que la IA no pudo responder con información aprobada. La respuesta llega al chat del cliente. Para reutilizarla, proponela como conocimiento: requiere aprobación del propietario.</p>` +
      (qs.map(q => `<div class="card" style="margin-bottom:10px"><div class="row between"><b>“${e(q.question)}”</b><span class="badge">${q.status}</span></div>
        <div class="small muted">${q.created_at} · ${q.first_name ? e(q.first_name + ' ' + q.last_name) : 'Cliente no identificado'}${q.phone ? ' · ' + e(q.phone) : ''} · categoría ${e(q.category || '-')}${q.service ? ' · ' + e(q.service) : ''}</div>
        ${q.context.length ? `<details style="margin-top:6px"><summary class="small">Ver conversación</summary>${q.context.map(m => `<div class="small"><b>${m.role === 'user' ? 'Cliente' : m.role === 'staff' ? 'Equipo' : 'IA'}:</b> ${e(m.content)}</div>`).join('')}</details>` : ''}
        ${q.answer ? `<div class="note ok small" style="margin-top:8px">Respuesta de ${e(q.answered_by)} (${q.answered_at}): ${e(q.answer)}</div>
          ${q.knowledge_id ? '<div class="small muted">Propuesta como conocimiento (ver pestaña Base de conocimiento).</div>' : `<button class="btn sm" style="margin-top:6px" onclick="proposeKb(${q.id})">📚 Proponer como conocimiento reutilizable</button>`}`
        : `<textarea id="pa${q.id}" rows="2" style="margin-top:8px" placeholder="Escribí la respuesta para el cliente…"></textarea>
          <div class="row" style="margin-top:6px"><button class="btn pri sm" onclick="answerPending(${q.id})">Enviar respuesta</button><button class="btn sm" onclick="pendingStatus(${q.id},'en_revision')">En revisión</button><button class="btn sm" onclick="pendingStatus(${q.id},'cerrada')">Cerrar</button></div>`}</div>`).join('') || '<p class="muted">No hay consultas pendientes.</p>');
  },
  async conocimiento() {
    const r = await aapi('/api/admin/ai/knowledge' + (A.kbF ? '?status=' + A.kbF : ''));
    A._kbCats = r.categories;
    $('#aiBody').innerHTML = `<div class="card"><div class="row between"><div class="row"><select style="width:auto" onchange="A.kbF=this.value;show()"><option value="">Todos los estados</option>${['borrador', 'pendiente', 'aprobado', 'desactivado'].map(s => `<option ${A.kbF === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <span class="small muted">La IA solo usa registros <b>aprobados</b>. "General" = conocimiento de belleza que explica conceptos; no reemplaza precios ni políticas del local.</span></div><button class="btn pri sm" onclick="editKb2()">+ Agregar</button></div>
      <div class="tbl"><table><tr><th>Título</th><th>Categoría</th><th>Ámbito</th><th>Estado</th><th>Versión</th><th>Responsable</th><th></th></tr>
      ${r.items.map(k => `<tr><td><b>${e(k.question)}</b><div class="small muted">${e(k.answer.slice(0, 140))}${k.answer.length > 140 ? '…' : ''}</div></td><td>${e(k.category)}</td><td>${k.scope === 'general' ? 'General' : 'Negocio'}</td>
        <td><span class="badge ${KB_ST[k.status]}">${k.status}</span></td><td>v${k.version || 1}<div class="small muted">${(k.updated_at || '').slice(0, 10)}</div></td><td class="small">${e(k.created_by || '')}${k.approved_by ? '<br>aprobó ' + e(k.approved_by) : ''}</td>
        <td class="row" style="gap:4px"><button class="btn sm" onclick='editKb2(${JSON.stringify(k).replace(/'/g, '&#39;')})'>Editar</button>
          ${k.status !== 'aprobado' && A.user.role === 'owner' ? `<button class="btn sm pri" onclick="kbStatus(${k.id},'aprobado')">Aprobar</button>` : ''}
          ${k.status === 'aprobado' ? `<button class="btn sm" onclick="kbStatus(${k.id},'desactivado')">Desactivar</button>` : ''}</td></tr>`).join('')}</table></div></div>`;
  },
  async fotos() {
    const ps = await aapi('/api/admin/ai/photos');
    $('#aiBody').innerHTML = `<p class="small muted">Fotos enviadas por clientes desde el chat. La IA no las analiza: las evalúa un profesional. Son privadas y solo visibles en el panel.</p><div class="grid g2">` +
      (ps.map(p => `<div class="card"><img src="${p.image}" style="width:100%;max-height:260px;object-fit:contain;border-radius:10px;background:#f4f1f9" alt="Foto de cliente">
        <div class="small muted" style="margin-top:6px">${p.created_at} · ${p.first_name ? e(p.first_name + ' ' + p.last_name) : 'Cliente no identificado'}${p.phone ? ' · ' + e(p.phone) : ''}${p.service ? ' · ' + e(p.service) : ''}</div>
        ${p.note ? `<div class="small">Nota: ${e(p.note)}</div>` : ''}
        <div class="row" style="margin-top:6px"><span class="badge">${p.status}</span><span class="small">Para:</span><select style="width:auto" onchange="photoUpd(${p.id},{professional_id:this.value})"><option value="">—</option>${A.pros.map(x => `<option value="${x.id}" ${p.professional_id === x.id ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></div>
        ${p.answer ? `<div class="note ok small" style="margin-top:6px">${e(p.answered_by)}: ${e(p.answer)}</div>` : `<textarea id="ph${p.id}" rows="2" style="margin-top:6px" placeholder="Respuesta al cliente (llega a su chat)…"></textarea><button class="btn pri sm" style="margin-top:4px" onclick="photoUpd(${p.id},{answer:$('#ph${p.id}').value})">Responder</button>`}
        <button class="btn sm" style="margin-top:4px" onclick="newAppt()">Convertir en reserva</button></div>`).join('') || '<p class="muted">No hay fotos recibidas.</p>') + '</div>';
  },
  async conversaciones() {
    const cs = await aapi('/api/admin/ai/conversations');
    $('#aiBody').innerHTML = `<div class="card tbl"><table><tr><th>Inicio</th><th>Última actividad</th><th>Cliente</th><th>Mensajes</th><th>Reserva</th><th></th></tr>${cs.map(c => `<tr><td>${c.created_at}</td><td>${c.updated_at}</td>
      <td>${c.first_name ? e(c.first_name + ' ' + c.last_name) : '<span class="muted">No identificado</span>'}</td><td>${c.n}</td><td>${c.booked ? '✅' : '—'}</td><td><button class="btn sm" onclick="viewConv(${c.id})">Ver</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin conversaciones.</td></tr>'}</table></div>`;
  },
  async config(o) {
    const c = o.config; const own = A.user.role === 'owner';
    $('#aiBody').innerHTML = `<div class="grid g2"><div class="card"><h3>Configuración</h3>
      <label class="row" style="color:var(--ink)"><input type="checkbox" id="ai_en" style="width:auto" ${c.enabled ? 'checked' : ''}> IA activada</label>
      <label>Nombre visible</label><input id="ai_n" value="${e(c.name)}"><label>Mensaje de bienvenida</label><textarea id="ai_w" rows="2">${e(c.welcome)}</textarea>
      <label>Personalidad y tono</label><input id="ai_t" value="${e(c.tone)}"><label>Temas habilitados (vacío = todos los del local)</label><input id="ai_tp" value="${e(c.topics)}">
      <label>Regla de derivación al personal</label><input id="ai_h" value="${e(c.handoff)}">
      <div class="grid g3"><div><label>Diagnóstico (min)</label><input id="ai_d" type="number" value="${c.diagnosis_minutes}"></div><div><label>Máx. tokens</label><input id="ai_m" type="number" value="${c.max_tokens}"></div><div><label>Límite diario</label><input id="ai_l" type="number" value="${c.daily_limit}"></div></div>
      ${own ? '<button class="btn pri" style="margin-top:10px" onclick="saveAi2()">Guardar</button>' : '<p class="small muted">Solo el propietario puede modificar la configuración.</p>'}
      <p class="small muted">Las validaciones de seguridad (confirmación expresa, verificación de propiedad, permisos y revalidación de agenda) no se pueden desactivar.</p></div>
      <div class="card"><h3>Conexión</h3><p class="small">${o.real_ai ? `✅ Conectado: ${e(o.provider.provider)} · ${e(o.provider.model)} · ${e(o.provider.endpoint_host || '')}` : '⚠️ Sin API configurada (modo simulado).'}</p>
      <p class="small muted">La clave se carga solo en el archivo <code>.env</code> del servidor (AI_API_URL, AI_API_KEY, AI_MODEL, AI_TIMEOUT, AI_TOOL_MODE). Nunca se envía al navegador ni se guarda en el repositorio.</p>
      <h3 style="margin-top:12px">Uso (14 días)</h3><table><tr><th>Día</th><th>Tipo</th><th>Proveedor</th><th>Mensajes</th><th>OK</th><th>Tokens</th><th>ms</th></tr>${o.usage.map(u => `<tr><td>${u.day}</td><td>${u.kind}</td><td class="small">${e(u.provider)}</td><td>${u.n}</td><td>${u.ok}</td><td>${u.tokens || 0}</td><td>${u.ms}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin uso.</td></tr>'}</table>
      ${o.errors.length ? `<h3 style="margin-top:12px">Últimos errores</h3>${o.errors.map(x => `<div class="small">${x.created_at} · ${e(x.error)}</div>`).join('')}` : ''}</div></div>`;
  },
};

async function agAsk(q) {
  q = String(q || '').trim(); if (!q) return; $('#agIn') && ($('#agIn').value = '');
  A.agLog = A.agLog || []; A.agLog.push(`<div style="align-self:flex-end;background:var(--p);color:#fff;padding:8px 12px;border-radius:12px;max-width:80%">${e(q)}</div>`);
  A.agLog.push('<div id="agWait" class="muted small">Consultando datos…</div>'); await AI.gestion();
  try {
    const r = await aapi('/api/admin/ai/chat', { body: { message: q, conversation_id: A.agConv } }); A.agConv = r.conversation_id;
    A.agLog.pop(); A.agLog.push(`<div style="background:var(--pl);padding:10px 14px;border-radius:12px;max-width:92%">${mdTable(r.reply)}<div class="small muted" style="margin-top:6px">${e(r.source)}${r.tools.length ? ' · consultas: ' + r.tools.join(', ') : ''}</div></div>`);
  } catch (ex) { A.agLog.pop(); A.agLog.push(`<div class="note bad small">${e(ex.message)}</div>`); }
  if (A.view === 'asistente' && (A.aiTab || 'gestion') === 'gestion') AI.gestion();
}
// Tablas markdown simples → HTML (el resto con md()).
function mdTable(t) {
  const lines = String(t).split('\n'); const out = []; let tbl = [];
  const flush = () => { if (tbl.length) { const rows = tbl.filter(l => !/^\s*\|?\s*-{2,}/.test(l)).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => md(c.trim())));
    out.push(`<table style="margin:6px 0">${rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${c}</td>` : `<th>${c}</th>`).join('')}</tr>`).join('')}</table>`); tbl = []; } };
  for (const l of lines) { if (/^\s*\|/.test(l)) tbl.push(l); else { flush(); out.push(md(l)); } }
  flush(); return out.join('<br>').replace(/(<br>)+(<table)/g, '$2').replace(/(<\/table>)(<br>)+/g, '$1');
}
async function answerPending(id) { const a = $('#pa' + id).value.trim(); if (!a) return toast('Escribí la respuesta'); await aapi('/api/admin/ai/pending/' + id, { method: 'PUT', body: { answer: a } }); toast('Respuesta enviada al chat del cliente'); show(); }
async function pendingStatus(id, status) { await aapi('/api/admin/ai/pending/' + id, { method: 'PUT', body: { status } }); show(); }
async function proposeKb(id) {
  const kw = prompt('Palabras clave para encontrar esta respuesta (separadas por coma):', ''); if (kw === null) return;
  try { await aapi(`/api/admin/ai/pending/${id}/propose`, { body: { keywords: kw } }); toast('Propuesta creada: queda pendiente de aprobación del propietario'); show(); } catch (ex) { err(ex); }
}
function editKb2(k = { question: '', answer: '', keywords: '', category: 'faq', scope: 'negocio', status: 'borrador' }) {
  modal(`<h2>Conocimiento ${k.id ? '(v' + (k.version || 1) + ')' : 'nuevo'}</h2><label>Título / pregunta</label><input id="k2q" value="${e(k.question)}"><label>Contenido</label><textarea id="k2a" rows="4">${e(k.answer)}</textarea>
    <div class="grid g3"><div><label>Categoría</label><select id="k2c">${(A._kbCats || []).map(c => `<option ${k.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div><label>Ámbito</label><select id="k2s"><option value="negocio" ${k.scope !== 'general' ? 'selected' : ''}>Información del negocio</option><option value="general" ${k.scope === 'general' ? 'selected' : ''}>Conocimiento general de belleza</option></select></div>
    <div><label>Estado</label><select id="k2t">${['borrador', 'pendiente', 'aprobado', 'desactivado'].map(s => `<option ${k.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
    <label>Palabras clave</label><input id="k2k" value="${e(k.keywords || '')}">
    <p class="small muted">${A.user.role === 'owner' ? 'Al editar el contenido se genera una nueva versión.' : 'Solo el propietario aprueba: si elegís "aprobado" quedará pendiente.'}</p>
    <div class="row"><button class="btn pri" onclick="saveKb2(${k.id || 0})">Guardar</button>${k.id && A.user.role === 'owner' ? `<button class="btn bad" onclick="if(confirm('¿Eliminar?'))aapi('/api/admin/ai/knowledge/${k.id}',{method:'DELETE',body:{}}).then(()=>{closeModal();show()})">Eliminar</button>` : ''}<button class="btn" onclick="closeModal()">Cancelar</button></div>`);
}
async function saveKb2(id) {
  try { await aapi('/api/admin/ai/knowledge', { body: { id: id || undefined, question: $('#k2q').value, answer: $('#k2a').value, keywords: $('#k2k').value, category: $('#k2c').value, scope: $('#k2s').value, status: $('#k2t').value } }); closeModal(); show(); }
  catch (ex) { err(ex); }
}
async function kbStatus(id, status) { try { await aapi(`/api/admin/ai/knowledge/${id}/status`, { method: 'PUT', body: { status } }); show(); } catch (ex) { err(ex); } }
async function photoUpd(id, body) { try { await aapi('/api/admin/ai/photos/' + id, { method: 'PUT', body }); toast('Guardado'); show(); } catch (ex) { err(ex); } }
async function viewConv(id) {
  const r = await aapi('/api/admin/ai/conversations/' + id);
  modal(`<div class="row between"><h2 style="margin:0">Conversación #${id}</h2><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
    ${r.messages.map(m => `<div style="margin:6px 0;padding:8px 10px;border-radius:10px;background:${m.role === 'user' ? '#f3f4f6' : m.role === 'staff' ? '#ecfdf5' : 'var(--pl)'}"><b class="small">${{ user: 'Cliente', assistant: 'TurnIA', staff: 'Equipo' }[m.role] || m.role}</b> <span class="small muted">${m.created_at}${m.meta.source ? ' · ' + e(m.meta.source) : ''}${m.meta.tools?.length ? ' · ' + m.meta.tools.join(', ') : ''}</span><div style="white-space:pre-line">${e(m.content)}</div></div>`).join('')}
    ${r.audit.length ? `<h3>Auditoría de acciones</h3>${r.audit.map(a => `<div class="small">${a.created_at} · ${a.allowed ? '✔' : '✘'} ${e(a.action)} ${e(a.detail)}</div>`).join('')}` : ''}`);
}
async function saveAi2() {
  try { await aapi('/api/admin/ai/config', { method: 'PUT', body: { enabled: $('#ai_en').checked, name: $('#ai_n').value, welcome: $('#ai_w').value, tone: $('#ai_t').value, topics: $('#ai_tp').value, handoff: $('#ai_h').value,
    diagnosis_minutes: $('#ai_d').value, max_tokens: $('#ai_m').value, daily_limit: $('#ai_l').value } }); toast('Configuración de IA guardada'); show(); } catch (ex) { err(ex); }
}
// Vista de fotos para empleados sin acceso a la sección de IA.
VIEWS.fotos = async function () { $('#main').innerHTML = H('Fotos de clientes', '', 'Fotos enviadas desde el chat para que las evalúes.') + '<div id="aiBody"></div>'; await AI.fotos(); };
