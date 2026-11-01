// Utilidades de tiempo. Todas las fechas se guardan como hora local de
// America/Argentina/Buenos_Aires en formato 'YYYY-MM-DD HH:MM'.
const TZ = 'America/Argentina/Buenos_Aires';

function nowLocal() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}`;
}
const today = () => nowLocal().slice(0, 10);
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Fecha como número de minutos desde epoch "local" (sin zona) para comparar.
function stamp(dt) {
  const [d, t] = dt.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  return Date.UTC(y, mo - 1, da) / 60000 + toMin(t || '00:00');
}
function fromStamp(s) {
  const d = new Date(s * 60000);
  return d.toISOString().slice(0, 10) + ' ' + fromMin(d.getUTCHours() * 60 + d.getUTCMinutes());
}
const addMin = (dt, m) => fromStamp(stamp(dt) + m);
function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay();

module.exports = { TZ, nowLocal, today, toMin, fromMin, stamp, fromStamp, addMin, addDays, weekday };
