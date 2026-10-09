// نظام تبرعات القرية - سيرفر بسيط (بدون مكتبات native)
const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- قاعدة البيانات (SQLite مدمجة في Node) ----
const dbPath = path.join(__dirname, 'data.db');
const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
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
);
`);

// ترحيل قواعد البيانات القديمة: إضافة عمود اسم المريض إن لم يوجد
try {
  const cols = db.prepare('PRAGMA table_info(cases)').all().map(c => c.name);
  if (!cols.includes('patient_name')) db.exec("ALTER TABLE cases ADD COLUMN patient_name TEXT DEFAULT ''");
} catch {}

const caseCount = db.prepare('SELECT COUNT(*) AS c FROM cases').get().c;
if (caseCount === 0) {
  db.prepare(`INSERT INTO cases (title, patient_name, description, target_amount, wish_number, status)
    VALUES (?, ?, ?, ?, ?, 'active')`).run(
    'عملية جراحية عاجلة - مثال',
    'اسم المريض - مثال',
    'هذا مثال لحالة تجريبية. احذفها من لوحة المشرف وأضف الحالة الحقيقية الأولى.',
    1000,
    '06XXXXXXXX'
  );
}

function totalsForCase(caseId) {
  return db.prepare(`
    SELECT
      COUNT(*) AS count_all,
      COALESCE(SUM(amount),0) AS pledged,
      COALESCE(SUM(CASE WHEN status='verified' THEN amount ELSE 0 END),0) AS verified,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) AS pending
    FROM donations WHERE case_id = ?
  `).get(caseId);
}

// ---- API عام ----
app.get('/api/cases', (req, res) => {
  const cases = db.prepare('SELECT * FROM cases ORDER BY status ASC, id DESC').all();
  res.json(cases.map(c => ({ ...c, totals: totalsForCase(c.id) })));
});

app.get('/api/cases/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'الحالة غير موجودة' });
  const donations = db.prepare(`
    SELECT id, donor_name, amount, method, status, created_at
    FROM donations WHERE case_id = ? ORDER BY id DESC
  `).all(c.id);
  res.json({ ...c, totals: totalsForCase(c.id), donations });
});

app.post('/api/cases/:id/donate', (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'الحالة غير موجودة' });
  if (c.status !== 'active') return res.status(400).json({ error: 'هذه الحالة مغلقة أو مؤرشفة' });

  let { donor_name, phone, amount, method } = req.body;
  donor_name = String(donor_name || '').trim();
  phone = String(phone || '').trim();
  amount = Number(amount);
  method = method === 'wish' ? 'wish' : 'cash';

  if (donor_name.length < 2) return res.status(400).json({ error: 'اكتب الاسم' });
  if (phone.length < 5) return res.status(400).json({ error: 'اكتب رقم الهاتف للتواصل' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'مبلغ غير صحيح' });

  const info = db.prepare(`
    INSERT INTO donations (case_id, donor_name, phone, amount, method, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(c.id, donor_name, phone, amount, method);

  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

// ---- حماية المشرف ----
function requireAdmin(req, res, next) {
  const k = req.headers['x-admin-key'] || req.query.key;
  if (k !== ADMIN_PASSWORD) return res.status(401).json({ error: 'غير مصرح' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: 'كلمة السر غير صحيحة' });
});

app.post('/api/admin/cases', requireAdmin, (req, res) => {
  const title = String(req.body.title || '').trim();
  const patient_name = String(req.body.patient_name || '').trim();
  const description = String(req.body.description || '').trim();
  const target_amount = Number(req.body.target_amount) || 0;
  const wish_number = String(req.body.wish_number || '').trim();
  if (title.length < 2) return res.status(400).json({ error: 'عنوان الحالة مطلوب' });
  const info = db.prepare(`
    INSERT INTO cases (title, patient_name, description, target_amount, wish_number, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(title, patient_name, description, target_amount, wish_number);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.patch('/api/admin/cases/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'غير موجودة' });
  const status = ['active', 'closed', 'archived'].includes(req.body.status) ? req.body.status : c.status;
  const next = {
    title: req.body.title !== undefined ? String(req.body.title) : c.title,
    patient_name: req.body.patient_name !== undefined ? String(req.body.patient_name) : (c.patient_name || ''),
    description: req.body.description !== undefined ? String(req.body.description) : c.description,
    target_amount: req.body.target_amount !== undefined ? Number(req.body.target_amount) : c.target_amount,
    wish_number: req.body.wish_number !== undefined ? String(req.body.wish_number) : c.wish_number,
    status,
  };
  db.prepare('UPDATE cases SET title=?, patient_name=?, description=?, target_amount=?, wish_number=?, status=? WHERE id=?')
    .run(next.title, next.patient_name, next.description, next.target_amount, next.wish_number, next.status, c.id);
  res.json({ ok: true });
});

app.delete('/api/admin/cases/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM donations WHERE case_id = ?').run(req.params.id);
  db.prepare('DELETE FROM cases WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/donations', requireAdmin, (req, res) => {
  const { case_id, status } = req.query;
  let sql = 'SELECT d.*, c.title AS case_title FROM donations d JOIN cases c ON c.id = d.case_id WHERE 1=1';
  const params = [];
  if (case_id) { sql += ' AND d.case_id = ?'; params.push(case_id); }
  if (status === 'pending' || status === 'verified') { sql += ' AND d.status = ?'; params.push(status); }
  sql += ' ORDER BY d.id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/admin/donations/:id/verify', requireAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  db.prepare("UPDATE donations SET status='verified', verified_at=datetime('now') WHERE id=?").run(d.id);
  res.json({ ok: true });
});

app.post('/api/admin/donations/:id/unverify', requireAdmin, (req, res) => {
  db.prepare("UPDATE donations SET status='pending', verified_at=NULL WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/donations/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM donations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
