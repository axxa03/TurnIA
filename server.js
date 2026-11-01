// TurnIA — servidor HTTP sin dependencias externas (Node >= 22.13).
process.env.TZ = 'America/Argentina/Buenos_Aires';
const fs = require('fs');
const path = require('path');
const http = require('http');

// Carga .env simple (sin dependencias).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const { seed } = require('./src/seed');
const api = require('./src/api');
seed();

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (url.pathname.startsWith('/api/')) return api.handle(req, res, url);
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) file = path.join(PUBLIC, 'admin.html');
  else if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, process.env.HOST || "127.0.0.1", () => console.log(`[TurnIA] escuchando en http://localhost:${PORT}`));
