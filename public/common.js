// Utilidades compartidas entre la página pública y el panel.
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
const money = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
const range = (a, b) => a === b || !b ? money(a) : `${money(a)} – ${money(b)}`;
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAYS_L = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const wd = d => new Date(d.slice(0, 10) + 'T00:00:00Z').getUTCDay();
const fdate = d => `${DAYS[wd(d)]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const fdt = d => `${fdate(d)} · ${d.slice(11, 16)} h`;
const hm = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
const initials = n => n.split(' ').map(x => x[0]).slice(0, 2).join('');
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const STATUS = { pendiente: 'Pendiente de confirmación', confirmada: 'Confirmada', en_curso: 'En curso', finalizada: 'Finalizada', cancelada: 'Cancelada', reprogramacion: 'Reprogramación solicitada', no_asistio: 'No asistió' };
const badge = s => `<span class="badge st-${s}">${STATUS[s] || s}</span>`;
const CAT = { peluqueria: 'Peluquería', manicuria: 'Manicuría' };

async function api(path, opts = {}) {
  const token = opts.token ?? localStorage.getItem(opts.admin ? 'turnia_staff' : 'turnia_client');
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || 'Error de conexión'); err.status = res.status; throw err; }
  return data;
}
function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function modal(html) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', ev => { if (ev.target === bg) closeModal(); });
  document.body.appendChild(bg);
  return bg;
}
const closeModal = () => document.getElementById('modal')?.remove();
const avatar = (p, size = 44) => p.photo ? `<img class="avatar" src="${e(p.photo)}" style="width:${size}px;height:${size}px" alt="">`
  : `<span class="avatar" style="background:${e(p.color || '#7c3aed')};width:${size}px;height:${size}px">${e(initials(p.name))}</span>`;
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Copiado al portapapeles')).catch(() => prompt('Copiá el texto:', text)); }
