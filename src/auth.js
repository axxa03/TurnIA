// Autenticación: contraseñas con scrypt y tokens firmados con HMAC.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[TurnIA] SESSION_SECRET no definido: se usa uno temporal (las sesiones se invalidan al reiniciar).');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const h = crypto.scryptSync(String(pw), salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
function sign(payload, hours = 12) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}

// Permisos por rol. El encargado tiene los módulos habilitados en users.permissions.
const MODULES = ['dashboard', 'agenda', 'solicitudes', 'clientes', 'profesionales', 'servicios', 'promociones', 'opiniones', 'recordatorios', 'estadisticas', 'asistente', 'configuracion'];
function can(user, mod) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (user.role === 'manager') return mod === 'dashboard' || (user.permissions || []).includes(mod);
  if (user.role === 'employee') return ['dashboard', 'agenda'].includes(mod);
  return false;
}

module.exports = { hashPassword, verifyPassword, sign, verify, can, MODULES };
