// Proveedor de IA FALSO compatible con /chat/completions, solo para pruebas automáticas
// del bucle de herramientas. No es IA: responde con un guion fijo.
const http = require('http');
const PORT = Number(process.argv[2] || 4011);
http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  const body = JSON.parse(b || '{}');
  if (req.headers.authorization !== 'Bearer test-key') { res.writeHead(401); return res.end('{}'); }
  const msgs = body.messages || []; const last = msgs.at(-1);
  const lastUser = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
  const reply = m => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: m }], usage: { total_tokens: 42 } })); };
  const call = (name, args) => reply({ role: 'assistant', content: null, tool_calls: [{ id: 'c' + Date.now(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  if (/caida/.test(lastUser)) { res.writeHead(503); return res.end('down'); }
  if (last.role === 'tool') {
    const out = JSON.parse(last.content);
    const prev = msgs.at(-2)?.tool_calls?.[0]?.function?.name;
    if (prev === 'check_availability' && out.opciones?.length && /reserv/.test(lastUser)) return call('propose_booking', { option: 1, first_name: 'Ana', last_name: 'Fake', phone: '1155599999' });
    if (prev === 'business_stats') return reply({ role: 'assistant', content: `Turnos por estado: ${JSON.stringify(out.por_estado)} (período ${out.periodo.from} a ${out.periodo.to}).` });
    return reply({ role: 'assistant', content: `[fake] Resultado de ${prev}: ${JSON.stringify(out).slice(0, 200)}` });
  }
  if (/reserv|lugar/.test(lastUser)) return call('check_availability', { services: [{ service_id: 1, answers: { largo: 'Corto' } }], days: 5 });
  if (/tuvimos/.test(lastUser)) return call('business_stats', { from: '2026-10-01', to: '2026-11-30' });
  if (/ignora/.test(lastUser)) return call('get_client_history', {});
  return reply({ role: 'assistant', content: '[fake] Hola, ¿en qué te ayudo?' });
}).listen(PORT, '127.0.0.1', () => console.log('fake llm on', PORT));
