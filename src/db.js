// Capa de datos: SQLite embebido (node:sqlite, sin dependencias nativas).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'turnia.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT,
  role TEXT CHECK(role IN ('owner','manager','employee')), professional_id INTEGER,
  permissions TEXT DEFAULT '[]', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, name TEXT, category TEXT, subcategory TEXT, description TEXT,
  price_min REAL, price_max REAL, base_duration INTEGER, extra_time INTEGER DEFAULT 0,
  prep_time INTEGER DEFAULT 0, cleanup_time INTEGER DEFAULT 0, min_advance_hours INTEGER DEFAULT 2,
  deposit_amount REAL DEFAULT 0, deposit_terms TEXT, cancel_hours INTEGER DEFAULT 24,
  late_cancel_terms TEXT, requirements TEXT, complex INTEGER DEFAULT 0, questions TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS professionals (
  id INTEGER PRIMARY KEY, name TEXT, photo TEXT, bio TEXT, specialties TEXT, color TEXT,
  all_services INTEGER DEFAULT 0, capacity INTEGER DEFAULT 1, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS professional_services (
  professional_id INTEGER, service_id INTEGER, PRIMARY KEY (professional_id, service_id));
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY, professional_id INTEGER, weekday INTEGER, start TEXT, end TEXT);
CREATE TABLE IF NOT EXISTS breaks (
  id INTEGER PRIMARY KEY, professional_id INTEGER, weekday INTEGER, date TEXT,
  start TEXT, end TEXT, type TEXT DEFAULT 'descanso');
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY, professional_id INTEGER, start_date TEXT, end_date TEXT,
  start_time TEXT, end_time TEXT, type TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, phone TEXT UNIQUE, email TEXT,
  registered INTEGER DEFAULT 0, password_hash TEXT, preferences TEXT, notes TEXT,
  created_at TEXT, demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, client_id INTEGER, status TEXT, mode TEXT,
  start_at TEXT, end_at TEXT, price_min REAL, price_max REAL, discount REAL DEFAULT 0, promo_id INTEGER,
  deposit_required REAL DEFAULT 0, deposit_paid REAL DEFAULT 0, deposit_status TEXT DEFAULT 'no_requerida',
  notes TEXT, source TEXT, created_at TEXT, cancel_reason TEXT, cancel_penalty REAL DEFAULT 0,
  refund_status TEXT, reminder_sent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS appointment_items (
  id INTEGER PRIMARY KEY, appointment_id INTEGER, service_id INTEGER, professional_id INTEGER,
  start_at TEXT, end_at TEXT, block_start TEXT, block_end TEXT, answers TEXT, est_duration INTEGER,
  actual_duration INTEGER, price_min REAL, price_max REAL, signature TEXT);
CREATE INDEX IF NOT EXISTS idx_items_pro ON appointment_items(professional_id, block_start);
CREATE TABLE IF NOT EXISTS appointment_history (
  id INTEGER PRIMARY KEY, appointment_id INTEGER, action TEXT, detail TEXT, user TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, client_id INTEGER, service_ids TEXT, est_duration INTEGER, preference TEXT,
  flexibility TEXT, urgency TEXT, event_date TEXT, professional_id INTEGER, accepts_alternatives INTEGER,
  status TEXT DEFAULT 'abierta', lost_reason TEXT, notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY, request_id INTEGER, appointment_id INTEGER, proposal TEXT,
  status TEXT DEFAULT 'sugerida', detail TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY, name TEXT, description TEXT, type TEXT, value REAL, service_id INTEGER,
  professional_id INTEGER, weekdays TEXT, audience TEXT DEFAULT 'all', start_date TEXT, end_date TEXT,
  max_uses INTEGER, uses INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, appointment_id INTEGER, client_id INTEGER, service_id INTEGER,
  professional_id INTEGER, rating INTEGER, comment TEXT, photos TEXT DEFAULT '[]',
  photo_consent INTEGER DEFAULT 0, status TEXT DEFAULT 'pendiente', published INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY, question TEXT, answer TEXT, keywords TEXT);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, type TEXT, message TEXT, ref TEXT, created_at TEXT, read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, appointment_id INTEGER, kind TEXT, amount REAL, note TEXT, at TEXT);
`);

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

// Transacción exclusiva: garantiza que validación + inserción sean atómicas.
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getSetting(key, def) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? JSON.parse(r.value) : def;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}

module.exports = { db, all, get, run, tx, getSetting, setSetting };
