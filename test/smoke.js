// Prueba de humo contra un servidor en ejecución: node test/smoke.js [baseUrl]
const BASE = process.argv[2] || 'http://localhost:3000';
const post = (u, b, t) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(b) })
  .then(async r => ({ status: r.status, body: await r.json() }));
const ok = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) process.exitCode = 1; };

(async () => {
  const svc = [{ id: 1, answers: { largo: 'Medio' } }, { id: 15, answers: {} }];
  const av = await post('/api/public/availability', { services: svc, days: 7 });
  ok(av.status === 200 && av.body.simultaneous.length && av.body.consecutive.length, 'Disponibilidad combinada (simultánea y consecutiva)');
  const est = av.body.groups[0].estimates[0];
  ok(est.duration === 60 && est.price_min === 12000, 'Estimación de duración y precio según respuestas');
  const choice = av.body.consecutive.at(-1).choice;
  const phone = '11' + String(Date.now()).slice(-8);
  const [a, b] = await Promise.all([
    post('/api/public/book', { client: { first_name: 'Test', last_name: 'Uno', phone }, services: svc, choice }),
    post('/api/public/book', { client: { first_name: 'Test', last_name: 'Dos', phone: phone.slice(0, -1) + '9' }, services: svc, choice }),
  ]);
  ok([a.status, b.status].sort().join() === '200,409', `Doble reserva simultánea: una confirma y otra 409 (${a.status}/${b.status})`);
  const lk = await post('/api/public/lookup', { phone });
  ok(lk.body.exists, 'Cliente recurrente detectado por teléfono');
  const code = (a.status === 200 ? a : b).body.code;
  const c = await post(`/api/public/appointment/${code}/cancel`, { phone: a.status === 200 ? phone : phone.slice(0, -1) + '9', reason: 'test' });
  ok(c.status === 200 && c.body.appointment.status === 'cancelada', 'Cancelación con política');
  const lg = await post('/api/admin/login', { email: 'admin@turnia.demo', password: process.env.DEMO_ADMIN_PASSWORD || 'demo1234' });
  ok(lg.status === 200, 'Login administrativo');
  const bad = await fetch(BASE + '/api/admin/dashboard');
  ok(bad.status === 401, 'Rutas del panel protegidas');
})();
