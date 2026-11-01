// Datos de demostración (ficticios). Se cargan solo si la base está vacía.
const { all, get, run, setSetting } = require('./db');
const T = require('./time');
const { hashPassword } = require('./auth');

const o = (label, add_min = 0, add_price = 0, warn) => ({ label, add_min, add_price, ...(warn ? { warn } : {}) });
const Q = {
  largo: { id: 'largo', label: '¿Qué largo tiene tu cabello?', type: 'select', signature: true, options: [o('Corto'), o('Medio', 15, 3000), o('Largo', 30, 6000), o('Extra largo', 45, 9000)] },
  grosor: { id: 'grosor', label: 'Grosor del cabello', type: 'select', options: [o('Fino'), o('Medio'), o('Grueso', 10, 1500)] },
  densidad: { id: 'densidad', label: 'Densidad (cantidad de pelo)', type: 'select', signature: true, options: [o('Poca'), o('Normal'), o('Mucha', 15, 3000)] },
  tipo: { id: 'tipo', label: 'Tipo de cabello', type: 'select', options: [o('Lacio'), o('Ondulado', 5), o('Rizado', 10), o('Afro', 15, 2000)] },
  estado: { id: 'estado', label: 'Estado actual del cabello', type: 'select', options: [o('Sano'), o('Seco'), o('Dañado / quebradizo', 10, 0, 'Cabello dañado: la profesional evaluará el tratamiento adecuado antes de comenzar.')] },
  colorActual: { id: 'color_actual', label: 'Color actual', type: 'text' },
  colorDeseado: { id: 'color_deseado', label: 'Color deseado', type: 'text' },
  quimicos: { id: 'quimicos', label: '¿Tratamientos químicos previos?', type: 'select', signature: true, options: [o('Ninguno'), o('Tintura'), o('Decoloración', 30, 5000, 'Con decoloración previa el resultado debe evaluarse en persona.'), o('Alisado / keratina', 15)] },
  ultimaTintura: { id: 'ultima_tintura', label: 'Fecha aproximada de la última tintura', type: 'select', options: [o('Nunca'), o('Menos de 1 mes'), o('1 a 3 meses'), o('Más de 3 meses')] },
  referencia: { id: 'referencia', label: 'Link o descripción de la foto de referencia (opcional)', type: 'text' },
  evento: { id: 'evento', label: 'Tipo de evento', type: 'select', options: [o('Casamiento', 30, 8000), o('15 años', 20, 6000), o('Fiesta / salida'), o('Sesión de fotos', 15, 3000)] },
  estadoUnas: { id: 'estado_unas', label: 'Estado de tus uñas', type: 'select', options: [o('Sanas'), o('Quebradizas / finas', 10), o('Con alguna alteración (color, dolor, desprendimiento)', 0, 0, 'No realizamos diagnósticos: si notás alteraciones te sugerimos una evaluación profesional antes del servicio.')] },
  producto: { id: 'producto_anterior', label: 'Producto que tenés puesto', type: 'select', signature: true, options: [o('Nada'), o('Esmalte común', 5), o('Semipermanente', 15, 2500), o('Kapping / soft gel', 25, 3500), o('Acrílico / esculpidas', 35, 4500)] },
  largoUnas: { id: 'largo_unas', label: 'Largo deseado', type: 'select', signature: true, options: [o('Corto'), o('Medio', 10, 2000), o('Largo', 20, 4000), o('Extra largo', 30, 6000)] },
  forma: { id: 'forma', label: 'Forma', type: 'select', options: [o('Cuadrada'), o('Redonda'), o('Almendra'), o('Stiletto', 5), o('Coffin / ballerina', 5)] },
  colorUnas: { id: 'color', label: 'Color o estilo', type: 'text' },
  diseno: { id: 'diseno', label: 'Diseño', type: 'select', options: [o('Liso'), o('Francesa', 15, 2500), o('Efecto (cromado, ojo de gato, aurora)', 15, 3000), o('Nail art', 0, 0)] },
  decoradas: { id: 'decoradas', label: '¿Cuántas uñas decoradas?', type: 'number', signature: true, per_unit_min: 5, per_unit_price: 700 },
  reparaciones: { id: 'reparaciones', label: '¿Cuántas uñas a reparar?', type: 'number', per_unit_min: 7, per_unit_price: 900 },
};
const hairBasic = [Q.largo, Q.tipo, Q.estado];
const hairColor = [Q.largo, Q.grosor, Q.densidad, Q.colorActual, Q.colorDeseado, Q.quimicos, Q.ultimaTintura, Q.referencia];
const nails = [Q.estadoUnas, Q.producto, Q.forma, Q.colorUnas];
const nailsLong = [Q.estadoUnas, Q.producto, Q.largoUnas, Q.forma, Q.colorUnas, Q.diseno, Q.decoradas];

// [nombre, categoría, subcat, desc, min, max, dur, prep, limpieza, anticipación h, seña, complejo, preguntas]
const SERVICES = [
  ['Corte', 'peluqueria', 'Cortes', 'Corte personalizado con lavado y secado básico.', 9000, 12000, 45, 5, 10, 2, 0, 0, hairBasic],
  ['Brushing y planchita', 'peluqueria', 'Peinado', 'Lavado, brushing y terminación con planchita.', 7000, 9000, 40, 5, 5, 2, 0, 0, hairBasic],
  ['Peinado', 'peluqueria', 'Peinado', 'Recogidos, semirrecogidos y ondas.', 12000, 18000, 60, 5, 10, 12, 0, 0, [Q.largo, Q.tipo, Q.referencia]],
  ['Peinado para eventos', 'peluqueria', 'Peinado', 'Peinado de fiesta con prueba de estilo.', 20000, 35000, 75, 10, 10, 48, 8000, 0, [Q.evento, Q.largo, Q.densidad, Q.referencia]],
  ['Tintura de raíz', 'peluqueria', 'Color', 'Retoque de raíz hasta 3 cm.', 16000, 20000, 75, 10, 10, 6, 5000, 0, [Q.largo, Q.colorActual, Q.colorDeseado, Q.ultimaTintura]],
  ['Tintura completa', 'peluqueria', 'Color', 'Color global de medios a puntas.', 22000, 32000, 105, 10, 15, 12, 7000, 0, hairColor],
  ['Baño de color', 'peluqueria', 'Color', 'Matiz y brillo sin compromiso.', 14000, 18000, 60, 5, 10, 6, 0, 0, [Q.largo, Q.colorActual, Q.colorDeseado]],
  ['Mechas / balayage / babylights', 'peluqueria', 'Color', 'Iluminación personalizada con técnica a elección.', 45000, 75000, 180, 10, 20, 24, 15000, 1, hairColor],
  ['Decoloración y corrección de color', 'peluqueria', 'Color', 'Corrección de tonos no deseados. Requiere evaluación.', 55000, 95000, 210, 10, 20, 48, 20000, 1, hairColor],
  ['Hidratación / nutrición / reconstrucción', 'peluqueria', 'Tratamientos', 'Tratamiento según diagnóstico capilar.', 12000, 20000, 50, 5, 10, 2, 0, 0, [Q.largo, Q.estado, Q.quimicos]],
  ['Botox capilar', 'peluqueria', 'Tratamientos', 'Relleno de fibra y control de frizz.', 28000, 40000, 120, 10, 15, 24, 8000, 0, [Q.largo, Q.densidad, Q.estado, Q.quimicos]],
  ['Keratina / alisado', 'peluqueria', 'Alisados', 'Alisado progresivo o keratina. Química compleja.', 40000, 70000, 180, 10, 20, 24, 15000, 1, [Q.largo, Q.densidad, Q.tipo, Q.quimicos, Q.ultimaTintura]],
  ['Permanente', 'peluqueria', 'Tratamientos', 'Ondas o rulos permanentes.', 35000, 50000, 150, 10, 15, 24, 10000, 1, [Q.largo, Q.estado, Q.quimicos]],
  ['Manicuría tradicional', 'manicuria', 'Manos', 'Limado, cutículas y esmaltado común.', 6000, 7000, 40, 5, 10, 1, 0, 0, nails],
  ['Semipermanente', 'manicuria', 'Manos', 'Esmaltado semipermanente con cabina UV/LED.', 9000, 11000, 60, 5, 10, 1, 0, 0, [...nails, Q.diseno, Q.decoradas]],
  ['Kapping', 'manicuria', 'Manos', 'Refuerzo de uña natural con gel o acrílico.', 12000, 14000, 75, 5, 10, 2, 0, 0, [...nails, Q.diseno, Q.decoradas]],
  ['Soft gel', 'manicuria', 'Extensiones', 'Extensiones con tips de gel suave.', 16000, 19000, 90, 5, 10, 2, 0, 0, nailsLong],
  ['Esculpidas / extensiones', 'manicuria', 'Extensiones', 'Uñas esculpidas en gel o acrílico.', 20000, 26000, 120, 5, 15, 12, 5000, 0, nailsLong],
  ['Baño acrílico', 'manicuria', 'Manos', 'Capa protectora de acrílico sobre uña natural.', 13000, 15000, 75, 5, 10, 2, 0, 0, [...nails, Q.diseno]],
  ['Retiro y mantenimiento', 'manicuria', 'Mantenimiento', 'Retiro de producto o service de extensiones.', 6000, 12000, 45, 5, 10, 1, 0, 0, [Q.producto, Q.estadoUnas]],
  ['Reparación de uñas', 'manicuria', 'Mantenimiento', 'Reparación de uñas quebradas.', 2000, 3000, 15, 0, 5, 1, 0, 0, [Q.reparaciones, Q.producto]],
  ['Nail art', 'manicuria', 'Diseño', 'Diseños a mano alzada, stamping, encapsulados.', 3000, 8000, 30, 0, 5, 1, 0, 0, [Q.decoradas, Q.diseno, Q.colorUnas]],
  ['Francesa y efectos especiales', 'manicuria', 'Diseño', 'Francesa clásica, baby boomer, cromados.', 4000, 6000, 30, 0, 5, 1, 0, 0, [Q.diseno, Q.forma]],
  ['Encapsulados', 'manicuria', 'Diseño', 'Flores, glitter o foil encapsulados en gel.', 5000, 9000, 40, 0, 5, 2, 0, 0, [Q.decoradas]],
  ['Spa de manos', 'manicuria', 'Spa', 'Exfoliación, máscara hidratante y masajes.', 9000, 11000, 45, 5, 10, 2, 0, 0, [Q.estadoUnas]],
  ['Pedicuría', 'manicuria', 'Pies', 'Pedicuría estética completa (no podológica).', 12000, 14000, 60, 5, 15, 2, 0, 0, [Q.estadoUnas]],
  ['Semipermanente de pies', 'manicuria', 'Pies', 'Esmaltado semipermanente en pies.', 9000, 10000, 45, 5, 10, 2, 0, 0, [Q.estadoUnas, Q.producto]],
];

function seed() {
  if (get('SELECT COUNT(*) n FROM services').n > 0) return false;

  setSetting('business', {
    name: 'Studio Aurora — Peluquería & Nails',
    tagline: 'Color, cortes y uñas con turnos en minutos',
    description: 'Somos un estudio de belleza en Palermo con especialistas en color, alisados y uñas esculpidas. Reservá online en menos de 2 minutos: TurnIA te dice el presupuesto estimado y los horarios reales disponibles.',
    logo: '', cover: '', primary: '#7c3aed', address: 'Av. Santa Fe 3456, Palermo, CABA',
    phone: '+54 11 5555-0000', whatsapp: '5491155550000', instagram: '@studioaurora.demo',
    email: 'hola@studioaurora.demo', hours: 'Lunes a sábados de 9 a 20 h',
    conditions: 'Tolerancia de 15 minutos. Las señas se descuentan del total. Los precios son estimados y se confirman en el local.',
    demo_notice: 'Comercio y datos ficticios para demostración de TurnIA.',
  });
  setSetting('booking_horizon_days', 45);
  setSetting('reminder_hours', 24);
  setSetting('noshow_deposit_after', 1);
  setSetting('noshow_block_after', 3);
  setSetting('learning_min_records', 3);
  setSetting('promos_require_registration', true);
  setSetting('ai', { enabled: true, max_tokens: 450, daily_limit: 300, diagnosis_minutes: 15 });

  const sids = {};
  for (const s of SERVICES) {
    const r = run(`INSERT INTO services(name,category,subcategory,description,price_min,price_max,base_duration,prep_time,cleanup_time,min_advance_hours,deposit_amount,complex,questions,deposit_terms,cancel_hours,late_cancel_terms,requirements)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], JSON.stringify(s[12]),
      s[10] ? 'Seña por transferencia dentro de las 24 h de reservado. Se descuenta del total.' : '',
      s[11] ? 48 : 24, s[10] ? 'Cancelando fuera de término se pierde la seña.' : 'Avisar con anticipación para liberar el turno.',
      s[11] ? 'Venir con el cabello sin lavar de 24 h. Puede requerir prueba de mechón.' : '');
    sids[s[0]] = Number(r.lastInsertRowid);
  }

  const pros = [
    ['Lucía Fernández', 'Colorista senior especializada en balayage y correcciones.', 'Color, balayage, correcciones', '#7c3aed', 0, 1, ['Corte', 'Brushing y planchita', 'Tintura de raíz', 'Tintura completa', 'Baño de color', 'Mechas / balayage / babylights', 'Decoloración y corrección de color', 'Hidratación / nutrición / reconstrucción', 'Botox capilar']],
    ['Martín Sosa', 'Estilista de cortes y alisados. 10 años de experiencia.', 'Cortes, alisados, peinados', '#0ea5e9', 0, 2, ['Corte', 'Brushing y planchita', 'Peinado', 'Peinado para eventos', 'Keratina / alisado', 'Permanente', 'Hidratación / nutrición / reconstrucción', 'Botox capilar', 'Baño de color']],
    ['Camila Ríos', 'Manicura y nail artist. Esculpidas y diseños.', 'Esculpidas, nail art, soft gel', '#ec4899', 0, 1, null],
    ['Sofía Benítez', 'Manicura, spa de manos y pedicuría estética.', 'Semipermanente, spa, pies', '#10b981', 0, 1, ['Manicuría tradicional', 'Semipermanente', 'Kapping', 'Baño acrílico', 'Retiro y mantenimiento', 'Reparación de uñas', 'Spa de manos', 'Pedicuría', 'Semipermanente de pies', 'Francesa y efectos especiales']],
  ];
  const pids = [];
  for (const [name, bio, spec, color, all_s, cap, svcs] of pros) {
    const r = run('INSERT INTO professionals(name,bio,specialties,color,all_services,capacity,photo) VALUES(?,?,?,?,?,?,?)', name, bio, spec, color, all_s, cap, '');
    const id = Number(r.lastInsertRowid); pids.push(id);
    const list = svcs || SERVICES.filter(s => s[1] === 'manicuria').map(s => s[0]);
    for (const n of list) run('INSERT INTO professional_services VALUES(?,?)', id, sids[n]);
  }
  // Horarios: Lucía y Camila mañana/tarde, Martín y Sofía tarde/noche. Sábados medio día.
  const shifts = [['09:00', '18:00'], ['11:00', '20:00'], ['09:00', '18:00'], ['11:00', '20:00']];
  pids.forEach((id, i) => {
    for (const wd of [1, 2, 3, 4, 5]) run('INSERT INTO schedules(professional_id,weekday,start,end) VALUES(?,?,?,?)', id, wd, ...shifts[i]);
    if (i !== 3) run('INSERT INTO schedules(professional_id,weekday,start,end) VALUES(?,?,?,?)', id, 6, '09:00', '14:00');
    const lunch = i % 2 === 0 ? ['13:00', '14:00'] : ['15:00', '15:45'];
    for (const wd of [1, 2, 3, 4, 5]) run('INSERT INTO breaks(professional_id,weekday,start,end,type) VALUES(?,?,?,?,?)', id, wd, ...lunch, 'comida');
  });
  run('INSERT INTO breaks(professional_id,weekday,start,end,type) VALUES(?,?,?,?,?)', pids[0], 3, '16:30', '17:00', 'descanso');
  // Licencia de Sofía dentro de 10 días y bloqueo puntual de Martín.
  run('INSERT INTO absences(professional_id,start_date,end_date,type,reason) VALUES(?,?,?,?,?)', pids[3], T.addDays(T.today(), 10), T.addDays(T.today(), 14), 'vacaciones', 'Vacaciones (demo)');
  run('INSERT INTO absences(professional_id,start_date,end_date,start_time,end_time,type,reason) VALUES(?,?,?,?,?,?,?)', pids[1], T.addDays(T.today(), 2), T.addDays(T.today(), 2), '11:00', '13:00', 'bloqueo', 'Capacitación (demo)');

  run('INSERT INTO users(name,email,password_hash,role,permissions) VALUES(?,?,?,?,?)', 'Dueña Demo', 'admin@turnia.demo', hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'demo1234'), 'owner', '[]');
  run('INSERT INTO users(name,email,password_hash,role,permissions) VALUES(?,?,?,?,?)', 'Encargado Demo', 'encargado@turnia.demo', hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'demo1234'), 'manager', JSON.stringify(['agenda', 'clientes', 'solicitudes', 'profesionales', 'recordatorios', 'opiniones']));
  run('INSERT INTO users(name,email,password_hash,role,professional_id,permissions) VALUES(?,?,?,?,?,?)', 'Camila (empleada)', 'camila@turnia.demo', hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'demo1234'), 'employee', pids[2], '[]');

  // Promociones
  const td = T.today(), end = T.addDays(td, 60);
  run('INSERT INTO promotions(name,description,type,value,audience,start_date,end_date,max_uses) VALUES(?,?,?,?,?,?,?,?)', 'Bienvenida 15%', '15% off en tu primera visita registrándote.', 'percent', 15, 'new', td, end, 100);
  run('INSERT INTO promotions(name,description,type,value,service_id,weekdays,audience,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,?)', 'Martes de uñas', '$2.000 off en semipermanente los martes.', 'amount', 2000, sids['Semipermanente'], '[2]', 'all', td, end);
  run('INSERT INTO promotions(name,description,type,value,audience,start_date,end_date) VALUES(?,?,?,?,?,?,?)', 'Te extrañamos', '20% off si no venís hace más de 60 días.', 'percent', 20, 'inactive', td, end);

  // Base de conocimiento del asistente
  const kb = [
    ['¿Dónde están ubicados?', 'Estamos en Av. Santa Fe 3456, Palermo, CABA.', 'direccion,ubicacion,donde,llegar,local'],
    ['¿Qué medios de pago aceptan?', 'Efectivo, transferencia y tarjetas de débito/crédito en el local. Las señas se abonan por transferencia.', 'pago,pagar,tarjeta,efectivo,transferencia,mercado'],
    ['¿Tengo que pagar seña?', 'Solo algunos servicios (color, alisados, eventos y esculpidas) requieren seña. Se descuenta del total.', 'seña,senia,adelanto,deposito'],
    ['¿Puedo cancelar mi turno?', 'Sí, desde el link de tu reserva. Sin penalización hasta 24 h antes (48 h en servicios químicos complejos).', 'cancelar,cancelacion,reprogramar,cambiar,turno'],
    ['¿Hacen diagnóstico de uñas?', 'No realizamos diagnósticos médicos. Si notás alguna alteración te recomendamos consultar con un profesional de la salud.', 'hongos,diagnostico,dolor,uña,lastimada'],
    ['¿Atienden sin turno?', 'Priorizamos turnos reservados; si hay un hueco libre te podemos atender, consultá por WhatsApp.', 'sin turno,demanda,espontaneo'],
  ];
  for (const k of kb) run('INSERT INTO knowledge(question,answer,keywords) VALUES(?,?,?)', ...k);

  seedDemoActivity(pids, sids);
  return true;
}

// Clientes, turnos pasados (con duración real) y futuros. Todo ficticio.
function seedDemoActivity(pids, sids) {
  const { estimate, getService, planGroup } = require('./engine');
  const clients = [
    ['Valentina', 'Demo', '1100000001', 'valentina@demo.test', 1], ['Julieta', 'Demo', '1100000002', null, 0],
    ['Agustina', 'Demo', '1100000003', 'agustina@demo.test', 1], ['Rocío', 'Demo', '1100000004', null, 0],
    ['Florencia', 'Demo', '1100000005', null, 0], ['Carla', 'Demo', '1100000006', 'carla@demo.test', 1],
  ];
  const cids = clients.map(c => Number(run('INSERT INTO clients(first_name,last_name,phone,email,registered,created_at,demo) VALUES(?,?,?,?,?,?,1)',
    c[0], c[1], c[2], c[3], c[4], T.addDays(T.today(), -90) + ' 10:00').lastInsertRowid));

  const book = (ci, sname, pi, date, time, status, actual, answers = {}) => {
    const svc = getService(sids[sname]); const est = estimate(svc, answers);
    const pro = { id: pids[pi], name: '' };
    const items = planGroup({ estimates: [est] }, pro, `${date} ${time}`);
    const code = 'D' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const a = run(`INSERT INTO appointments(code,client_id,status,mode,start_at,end_at,price_min,price_max,deposit_required,deposit_status,source,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, code, cids[ci], status, 'simple', items[0].start_at, items[0].end_at, est.price_min, est.price_max,
      est.deposit, est.deposit ? (status === 'finalizada' ? 'pagada' : 'pendiente') : 'no_requerida', 'demo', T.addDays(date, -3) + ' 12:00');
    const aid = Number(a.lastInsertRowid);
    for (const i of items) run(`INSERT INTO appointment_items(appointment_id,service_id,professional_id,start_at,end_at,block_start,block_end,answers,est_duration,actual_duration,price_min,price_max,signature)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, aid, i.service_id, i.professional_id, i.start_at, i.end_at, i.block_start, i.block_end, JSON.stringify(answers), i.est_duration, actual || null, i.price_min, i.price_max, i.signature);
    run('INSERT INTO appointment_history(appointment_id,action,detail,user,at) VALUES(?,?,?,?,?)', aid, 'creada', 'Turno de demostración', 'sistema', T.nowLocal());
    return aid;
  };
  const d = n => T.addDays(T.today(), n);
  const wdSafe = n => { let x = n; while (T.weekday(d(x)) === 0) x += (n < 0 ? -1 : 1); return d(x); };
  // Historial para aprendizaje de duraciones (corte largo tarda más que lo configurado).
  const past = [
    [0, 'Corte', 1, -40, '11:00', 'finalizada', 62, { largo: 'Largo' }], [2, 'Corte', 1, -33, '12:00', 'finalizada', 58, { largo: 'Largo' }],
    [4, 'Corte', 0, -26, '10:00', 'finalizada', 66, { largo: 'Largo' }], [5, 'Corte', 1, -19, '16:00', 'finalizada', 47, { largo: 'Corto' }],
    [0, 'Semipermanente', 2, -30, '10:00', 'finalizada', 70, {}], [1, 'Semipermanente', 3, -22, '12:00', 'finalizada', 64, {}],
    [3, 'Semipermanente', 2, -12, '15:00', 'finalizada', 75, {}], [2, 'Tintura de raíz', 0, -15, '10:00', 'finalizada', 80, {}],
    [5, 'Esculpidas / extensiones', 2, -8, '10:00', 'finalizada', 140, { largo_unas: 'Medio' }], [3, 'Corte', 1, -5, '17:00', 'no_asistio', null, {}],
    [1, 'Pedicuría', 3, -4, '12:00', 'cancelada', null, {}], [0, 'Botox capilar', 0, -3, '14:00', 'finalizada', 125, { largo: 'Medio' }],
  ];
  for (const p of past) book(p[0], p[1], p[2], wdSafe(p[3]), p[4], p[5], p[6], p[7]);
  const future = [
    [1, 'Corte', 1, 0, '18:00'], [0, 'Semipermanente', 2, 1, '10:00'], [2, 'Mechas / balayage / babylights', 0, 1, '09:00'],
    [3, 'Kapping', 3, 2, '16:00'], [4, 'Keratina / alisado', 1, 3, '16:00'], [5, 'Spa de manos', 3, 11, '12:00'],
  ];
  for (const f of future) {
    const date = wdSafe(f[3]);
    if (T.weekday(date) === 6) continue;
    book(f[0], f[1], f[2], date, f[4], 'confirmada', null);
  }
  run(`INSERT INTO requests(client_id,service_ids,est_duration,preference,flexibility,urgency,event_date,professional_id,accepts_alternatives,status,created_at,notes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, cids[3], JSON.stringify([sids['Peinado para eventos']]), 95, 'Sábado por la mañana', 'baja', 'alta', d(5), pids[1], 1, 'abierta', T.addDays(T.today(), -1) + ' 18:00', 'Casamiento (demo)');
  run(`INSERT INTO requests(client_id,service_ids,est_duration,preference,flexibility,urgency,professional_id,accepts_alternatives,status,lost_reason,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, cids[4], JSON.stringify([sids['Esculpidas / extensiones']]), 140, 'Tarde', 'alta', 'media', null, 1, 'perdida', 'Sin horario compatible', T.addDays(T.today(), -6) + ' 11:00');
  run(`INSERT INTO reviews(client_id,service_id,professional_id,rating,comment,photo_consent,status,published,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    cids[0], sids['Corte'], pids[1], 5, 'Martín es un genio, me encantó el corte. (opinión demo)', 0, 'aprobada', 1, T.addDays(T.today(), -39) + ' 20:00');
  run(`INSERT INTO reviews(client_id,service_id,professional_id,rating,comment,photo_consent,status,published,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    cids[5], sids['Esculpidas / extensiones'], pids[2], 4, 'Muy prolijas, la espera fue un poco larga. (opinión demo)', 0, 'pendiente', 0, T.addDays(T.today(), -7) + ' 20:00');
}

module.exports = { seed };
