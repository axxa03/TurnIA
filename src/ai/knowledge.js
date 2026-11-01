// Base de conocimiento administrable. La IA solo usa registros con estado 'aprobado'.
// scope 'negocio' = información oficial del local; scope 'general' = conocimiento general
// de belleza (explica conceptos, nunca reemplaza precios ni políticas del local).
const { all, get, run } = require('../db');
const T = require('../time');

const CATEGORIES = ['negocio', 'servicios', 'precios', 'duraciones', 'profesionales', 'especialidades', 'horarios', 'promociones', 'politicas', 'faq', 'cuidados', 'contacto'];
const STATUSES = ['borrador', 'pendiente', 'aprobado', 'desactivado'];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
const STOP = new Set(['para', 'como', 'que', 'una', 'con', 'los', 'las', 'del', 'por', 'mas', 'hay', 'quiero', 'tienen', 'hacen', 'puedo', 'cual', 'entre', 'diferencia', 'esta', 'este']);

function search(query, limit = 3) {
  const q = norm(query); const words = q.split(' ').filter(w => w.length > 2 && !STOP.has(w));
  return all("SELECT * FROM knowledge WHERE status = 'aprobado'").map(k => {
    const keys = norm(k.keywords).split(/[ ,]+/).filter(Boolean);
    const text = norm(k.question + ' ' + k.answer);
    const kw = keys.filter(w => q.includes(w)).length, tx = words.filter(w => text.includes(w.slice(0, 6))).length;
    // Coincidencia clara: 2 palabras clave, o 1 clave + 3 términos del contenido.
    return { ...k, score: kw * 3 + tx, strong: kw >= 2 || (kw >= 1 && tx >= 3) };
  }).filter(k => k.strong).sort((a, b) => b.score - a.score).slice(0, limit);
}

function list(filter = {}) {
  let sql = 'SELECT * FROM knowledge WHERE 1=1'; const p = [];
  if (filter.status) { sql += ' AND status = ?'; p.push(filter.status); }
  if (filter.category) { sql += ' AND category = ?'; p.push(filter.category); }
  return all(sql + ' ORDER BY CASE status WHEN \'pendiente\' THEN 0 ELSE 1 END, category, id', ...p);
}

function save(body, user) {
  const now = T.nowLocal();
  const category = CATEGORIES.includes(body.category) ? body.category : 'faq';
  const scope = body.scope === 'general' ? 'general' : 'negocio';
  // Solo el propietario aprueba directamente; el resto queda pendiente de aprobación.
  let status = STATUSES.includes(body.status) ? body.status : 'borrador';
  if (status === 'aprobado' && user.role !== 'owner') status = 'pendiente';
  if (!body.question?.trim() || !body.answer?.trim()) throw Object.assign(new Error('Completá título y contenido'), { status: 400 });
  if (body.id) {
    const k = get('SELECT * FROM knowledge WHERE id = ?', Number(body.id)); if (!k) throw Object.assign(new Error('No existe'), { status: 404 });
    const changed = k.answer !== body.answer || k.question !== body.question;
    run(`UPDATE knowledge SET question=?, answer=?, keywords=?, category=?, scope=?, status=?, version=?, updated_at=?, approved_at=?, approved_by=? WHERE id=?`,
      body.question, body.answer, body.keywords || '', category, scope, status, changed ? (k.version || 1) + 1 : (k.version || 1), now,
      status === 'aprobado' ? now : null, status === 'aprobado' ? user.name : null, k.id);
    return k.id;
  }
  return Number(run(`INSERT INTO knowledge(question,answer,keywords,category,scope,status,version,created_at,updated_at,created_by,approved_at,approved_by,source_pending_id) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?)`,
    body.question, body.answer, body.keywords || '', category, scope, status, now, now, user.name, status === 'aprobado' ? now : null, status === 'aprobado' ? user.name : null, body.source_pending_id || null).lastInsertRowid);
}

function setStatus(id, status, user) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error('Estado inválido'), { status: 400 });
  if (status === 'aprobado' && user.role !== 'owner') throw Object.assign(new Error('Solo el propietario puede aprobar conocimiento.'), { status: 403 });
  run('UPDATE knowledge SET status = ?, updated_at = ?, approved_at = ?, approved_by = ? WHERE id = ?', status, T.nowLocal(), status === 'aprobado' ? T.nowLocal() : null, status === 'aprobado' ? user.name : null, Number(id));
}

// Conocimiento general de belleza (separado del negocio) y migración de registros previos.
function seedGeneral() {
  run("UPDATE knowledge SET category = COALESCE(category,'faq'), scope = COALESCE(scope,'negocio'), status = COALESCE(status,'aprobado'), created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?), created_by = COALESCE(created_by,'sistema') WHERE created_at IS NULL", T.nowLocal(), T.nowLocal());
  if (get("SELECT 1 FROM knowledge WHERE scope = 'general'")) return;
  const g = [
    ['Diferencia entre mechas, balayage y babylights', 'Las mechas clásicas aclaran mechones desde la raíz con papel: el contraste es marcado y requiere retoque más seguido. El balayage se pinta a mano alzada, más concentrado en medios y puntas: queda un degradé natural y crece mejor. Las babylights son mechas muy finas que imitan el aclarado natural de la infancia. La elección depende del resultado buscado, el color de base y el estado del cabello; los trabajos con decoloración se evalúan en persona.', 'mechas,balayage,babylights,aclarar,rubio,iluminar', 'servicios'],
    ['Diferencia entre semipermanente, kapping y soft gel', 'El semipermanente es un esmalte que se cura con lámpara y dura 2 a 3 semanas sobre la uña natural, sin darle estructura. El kapping agrega una capa de gel o acrílico que refuerza la uña natural: ideal para uñas finas o que se quiebran, dura 3 a 4 semanas. El soft gel son tips de gel que alargan la uña de forma rápida y liviana. Las esculpidas construyen la extensión a medida con gel o acrílico.', 'kapping,semipermanente,soft,gel,esculpidas,duren,durar,quiebran', 'servicios'],
    ['¿Qué es el botox capilar?', 'Es un tratamiento de relleno de la fibra capilar que aporta brillo, suavidad y control de frizz sin alisar del todo. No contiene toxina botulínica. Dura entre 1 y 3 meses según el cuidado.', 'botox,frizz,relleno', 'servicios'],
    ['Diferencia entre keratina y alisado', 'La keratina reduce el volumen y el frizz y deja el cabello más manejable; el alisado busca un lacio más marcado y duradero. Ambos son procesos químicos: se evalúa el estado del cabello y los químicos previos antes de realizarlos.', 'keratina,alisado,lacio,planchado', 'servicios'],
    ['Cuidados después de una coloración', 'Usar shampoo sin sulfatos, esperar 48 h antes del primer lavado, proteger del sol y el cloro, y hacer hidrataciones periódicas ayuda a mantener el color.', 'cuidados,despues,color,tintura,mantener', 'cuidados'],
    ['Cuidados de uñas con semipermanente o kapping', 'Evitar usar las uñas como herramienta, usar guantes para limpiar, hidratar las cutículas y no retirar el producto arrancándolo: el retiro profesional cuida la uña natural.', 'cuidados,unas,semipermanente,kapping,retiro', 'cuidados'],
    ['Opciones para un evento', 'Para eventos se suele combinar peinado o brushing con manicuría. Conviene reservar con anticipación y, si se quiere un cambio de color, hacerlo unos días antes del evento.', 'evento,casamiento,fiesta,15,arreglarme', 'servicios'],
    ['Mi cabello está dañado, ¿qué tratamiento necesita?', 'Según el nivel de daño se usan hidratación (aporta agua y suavidad), nutrición (aporta lípidos y brillo) o reconstrucción (repone proteína en cabellos muy procesados). Sin ver el cabello no se puede indicar con certeza: se recomienda un diagnóstico presencial.', 'danado,seco,tratamiento,necesita,quebradizo,reconstruccion,hidratacion,nutricion', 'cuidados'],
  ];
  for (const [q, a, k, c] of g) run(`INSERT INTO knowledge(question,answer,keywords,category,scope,status,version,created_at,updated_at,created_by,approved_at,approved_by) VALUES(?,?,?,?,'general','aprobado',1,?,?,'sistema',?,'sistema')`, q, a, k, c, T.nowLocal(), T.nowLocal(), T.nowLocal());
}

module.exports = { search, list, save, setStatus, seedGeneral, CATEGORIES, STATUSES };
