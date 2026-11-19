const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+ — no native build needed
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.transaction = fn => (...args) => {
  db.exec('BEGIN');
  try { const r = fn(...args); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','employee')),
  department TEXT,
  monthly_limit REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- One row per login→logout
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  login_at TEXT NOT NULL,
  logout_at TEXT
);

-- Login, work updates and logout — each with selfie + GPS
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES sessions(id),
  type TEXT NOT NULL CHECK (type IN ('login','update','logout')),
  photo TEXT NOT NULL,
  note TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  address TEXT,
  captured_at TEXT NOT NULL,
  server_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  photo TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  is_group INTEGER NOT NULL DEFAULT 0,
  lat REAL, lng REAL, accuracy REAL, address TEXT,
  captured_at TEXT NOT NULL,
  server_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT
);

-- Who the bill is charged to. A normal bill has one share (the person who paid);
-- a group bill has one share per person, adding up to the bill amount.
CREATE TABLE IF NOT EXISTS bill_shares (
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  PRIMARY KEY (bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_entries_user_time ON entries(user_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_bills_time ON bills(captured_at);
CREATE INDEX IF NOT EXISTS idx_shares_user ON bill_shares(user_id);
`);

if (!db.prepare(`PRAGMA table_info(users)`).all().some(c => c.name === 'username')) db.exec(`ALTER TABLE users ADD COLUMN username TEXT`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

const defaults = { report_times: JSON.stringify(['10:00', '13:00', '16:00', '18:30']), company_name: JSON.stringify('My Company') };
for (const [k, v] of Object.entries(defaults)) db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`).run(k, v);

if (!db.prepare(`SELECT 1 FROM users WHERE role='super_admin'`).get()) {
  const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@company.com').toLowerCase();
  const pass = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123';
  db.prepare(`INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,'super_admin',?)`)
    .run('Super Admin', email, bcrypt.hashSync(pass, 10), new Date().toISOString());
  console.log(`Created super admin: ${email} / ${pass}  — change this password after first login`);
}

module.exports = { db, DATA_DIR, UPLOAD_DIR };
