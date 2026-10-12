// طبقة قاعدة بيانات مزدوجة:
// - إذا وُجد DATABASE_URL → Postgres سحابية (Neon) للإنتاج
// - وإلا → SQLite محلية للتشغيل على الجهاز
const path = require('path');

const USE_PG = !!process.env.DATABASE_URL;
let sqliteDb = null;
let pool = null;

if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
} else {
  const { DatabaseSync } = require('node:sqlite');
  sqliteDb = new DatabaseSync(path.join(__dirname, 'data.db'));
}

// SQLite تستعمل ? و Postgres تستعمل $1, $2...
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

async function all(sql, params = []) {
  if (USE_PG) return (await pool.query(toPg(sql), params)).rows;
  return sqliteDb.prepare(sql).all(...params);
}

async function get(sql, params = []) {
  if (USE_PG) return (await pool.query(toPg(sql), params)).rows[0];
  return sqliteDb.prepare(sql).get(...params);
}

async function run(sql, params = []) {
  if (USE_PG) {
    let q = toPg(sql);
    if (/^\s*insert/i.test(q) && !/returning/i.test(q)) q += ' RETURNING id';
    const r = await pool.query(q, params);
    return { lastInsertRowid: r.rows[0] ? Number(r.rows[0].id) : null };
  }
  const r = sqliteDb.prepare(sql).run(...params);
  return { lastInsertRowid: Number(r.lastInsertRowid) };
}

async function init() {
  if (USE_PG) {
    await run(`CREATE TABLE IF NOT EXISTS cases (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      patient_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      target_amount REAL DEFAULT 0,
      wish_number TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await run(`CREATE TABLE IF NOT EXISTS donations (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      verified_at TIMESTAMPTZ,
      verified_by TEXT DEFAULT ''
    )`);
    await run(`CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const cols = await all(
      `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'cases'`
    );
    if (!cols.some(c => c.name === 'patient_name')) {
      await run(`ALTER TABLE cases ADD COLUMN patient_name TEXT DEFAULT ''`);
    }
    const dcols = await all(
      `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'donations'`
    );
    if (!dcols.some(c => c.name === 'verified_by')) {
      await run(`ALTER TABLE donations ADD COLUMN verified_by TEXT DEFAULT ''`);
    }
  } else {
    sqliteDb.exec(`CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      patient_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      target_amount REAL DEFAULT 0,
      wish_number TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      donor_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      verified_at TEXT,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )`);
    const cols = sqliteDb.prepare('PRAGMA table_info(cases)').all();
    if (!cols.some(c => c.name === 'patient_name')) {
      sqliteDb.exec("ALTER TABLE cases ADD COLUMN patient_name TEXT DEFAULT ''");
    }
    await run(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    const dcols = sqliteDb.prepare('PRAGMA table_info(donations)').all();
    if (!dcols.some(c => c.name === 'verified_by')) {
      sqliteDb.exec("ALTER TABLE donations ADD COLUMN verified_by TEXT DEFAULT ''");
    }
  }

  const row = await get('SELECT COUNT(*) AS c FROM cases');
  if (Number(row.c) === 0) {
    await run(`INSERT INTO cases (title, patient_name, description, target_amount, wish_number, status)
      VALUES (?, ?, ?, ?, ?, 'active')`,
      ['عملية جراحية عاجلة - مثال', 'اسم المريض - مثال',
       'هذا مثال لحالة تجريبية. احذفها من لوحة المشرف وأضف الحالة الحقيقية الأولى.',
       1000, '06XXXXXXXX']);
  }
  console.log(USE_PG ? 'DB: Postgres' : 'DB: SQLite local');
}

// ---- كلمات سر المشرفين (scrypt مدمجة، بدون مكتبات) ----
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

// حساب رئيسي افتراضي من ADMIN_PASSWORD عند أول تشغيل
async function ensureMasterAdmin(masterPassword) {
  const row = await get('SELECT COUNT(*) AS c FROM admins');
  if (Number(row.c) === 0) {
    await run('INSERT INTO admins (username, password_hash) VALUES (?, ?)',
      ['admin', hashPassword(masterPassword)]);
    console.log('Seeded master admin account: admin');
  }
}

module.exports = { all, get, run, init, ensureMasterAdmin, hashPassword, verifyPassword, USE_PG };
