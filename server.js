// نظام تبرعات القرية - سيرفر
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const USE_PG_MODE = !!process.env.DATABASE_URL;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// تغليف الدوال async لالتقاط الأخطاء في Express 4
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function totalsForCase(caseId) {
  return db.get(`
    SELECT
      COUNT(*) AS count_all,
      COALESCE(SUM(amount),0) AS pledged,
      COALESCE(SUM(CASE WHEN status='verified' THEN amount ELSE 0 END),0) AS verified,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) AS pending
    FROM donations WHERE case_id = ?
  `, [caseId]);
}

// ---- API عام ----
app.get('/api/cases', ah(async (req, res) => {
  const cases = await db.all('SELECT * FROM cases ORDER BY id DESC');
  const order = { active: 0, closed: 1, archived: 2 };
  cases.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  res.json(await Promise.all(cases.map(async (c) => ({ ...c, totals: await totalsForCase(c.id) }))));
}));

app.get('/api/cases/:id', ah(async (req, res) => {
  const c = await db.get('SELECT * FROM cases WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'الحالة غير موجودة' });
  const donations = await db.all(`
    SELECT id, donor_name, amount, method, status, verified_by, created_at
    FROM donations WHERE case_id = ? ORDER BY id DESC
  `, [c.id]);
  res.json({ ...c, totals: await totalsForCase(c.id), donations });
}));

app.post('/api/cases/:id/donate', ah(async (req, res) => {
  const c = await db.get('SELECT * FROM cases WHERE id = ?', [req.params.id]);
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

  const info = await db.run(`
    INSERT INTO donations (case_id, donor_name, phone, amount, method, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `, [c.id, donor_name, phone, amount, method]);

  res.json({ ok: true, id: info.lastInsertRowid });
}));

// ---- حماية المشرف (حسابات منفصلة + جلسات) ----
const crypto = require('crypto');
const sessions = new Map(); // token -> username

function requireAdmin(req, res, next) {
  const k = req.headers['x-admin-key'] || req.query.key;
  if (!k) return res.status(401).json({ error: 'غير مصرح' });
  if (k === ADMIN_PASSWORD) { req.admin = 'admin'; return next(); } // توافق قديم
  if (sessions.has(k)) { req.admin = sessions.get(k); return next(); }
  return res.status(401).json({ error: 'غير مصرح' });
}

app.post('/api/admin/login', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  // دخول حديث: اسم + كلمة سر
  if (username) {
    const a = await db.get('SELECT * FROM admins WHERE username = ?', [username]);
    if (!a || !db.verifyPassword(password, a.password_hash)) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, a.username);
    return res.json({ ok: true, token, username: a.username, role: a.role || 'admin' });
  }
  // دخول قديم: كلمة السر المشتركة فقط
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, 'admin');
    return res.json({ ok: true, token, username: 'admin', role: 'master' });
  }
  res.status(401).json({ error: 'كلمة السر غير صحيحة' });
}));

// إدارة المشرفين: للمشرف العام (master) فقط
const requireMaster = [requireAdmin, ah(async (req, res, next) => {
  const row = await db.get('SELECT role FROM admins WHERE username = ?', [req.admin]);
  if (!row || (row.role || 'admin') !== 'master') {
    return res.status(403).json({ error: 'هذه الصلاحية للمشرف العام فقط' });
  }
  next();
})];

// إدارة المشرفين
app.get('/api/admin/admins', requireMaster, ah(async (req, res) => {
  res.json(await db.all('SELECT id, username, role, created_at FROM admins ORDER BY id ASC'));
}));

app.post('/api/admin/admins', requireMaster, ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 2) return res.status(400).json({ error: 'اسم المشرف مطلوب' });
  if (password.length < 6) return res.status(400).json({ error: 'كلمة السر 6 أحرف على الأقل' });
  const exists = await db.get('SELECT id FROM admins WHERE username = ?', [username]);
  if (exists) return res.status(400).json({ error: 'هذا الاسم موجود' });
  const info = await db.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)',
    [username, db.hashPassword(password)]);
  res.json({ ok: true, id: info.lastInsertRowid });
}));

app.delete('/api/admin/admins/:id', requireMaster, ah(async (req, res) => {
  const a = await db.get('SELECT * FROM admins WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  if (a.username === req.admin) return res.status(400).json({ error: 'لا يمكنك حذف حسابك' });
  const count = await db.get('SELECT COUNT(*) AS c FROM admins');
  if (Number(count.c) <= 1) return res.status(400).json({ error: 'لا يمكن حذف آخر مشرف' });
  await db.run('DELETE FROM admins WHERE id = ?', [a.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/cases', requireAdmin, ah(async (req, res) => {
  const title = String(req.body.title || '').trim();
  const patient_name = String(req.body.patient_name || '').trim();
  const description = String(req.body.description || '').trim();
  const target_amount = Number(req.body.target_amount) || 0;
  const wish_number = String(req.body.wish_number || '').trim();
  if (title.length < 2) return res.status(400).json({ error: 'عنوان الحالة مطلوب' });
  const info = await db.run(`
    INSERT INTO cases (title, patient_name, description, target_amount, wish_number, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `, [title, patient_name, description, target_amount, wish_number]);
  res.json({ ok: true, id: info.lastInsertRowid });
}));

app.patch('/api/admin/cases/:id', requireAdmin, ah(async (req, res) => {
  const c = await db.get('SELECT * FROM cases WHERE id = ?', [req.params.id]);
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
  await db.run('UPDATE cases SET title=?, patient_name=?, description=?, target_amount=?, wish_number=?, status=? WHERE id=?',
    [next.title, next.patient_name, next.description, next.target_amount, next.wish_number, next.status, c.id]);
  res.json({ ok: true });
}));

app.delete('/api/admin/cases/:id', requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM donations WHERE case_id = ?', [req.params.id]);
  await db.run('DELETE FROM cases WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/donations', requireAdmin, ah(async (req, res) => {
  const { case_id, status } = req.query;
  let sql = 'SELECT d.*, c.title AS case_title FROM donations d JOIN cases c ON c.id = d.case_id WHERE 1=1';
  const params = [];
  if (case_id) { sql += ' AND d.case_id = ?'; params.push(case_id); }
  if (status === 'pending' || status === 'verified') { sql += ' AND d.status = ?'; params.push(status); }
  sql += ' ORDER BY d.id DESC';
  res.json(await db.all(sql, params));
}));

app.post('/api/admin/donations/:id/verify', requireAdmin, ah(async (req, res) => {
  const d = await db.get('SELECT * FROM donations WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  if (db.USE_PG) await db.run("UPDATE donations SET status='verified', verified_at=NOW(), verified_by=? WHERE id=?", [req.admin, d.id]);
  else await db.run("UPDATE donations SET status='verified', verified_at=datetime('now'), verified_by=? WHERE id=?", [req.admin, d.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/donations/:id/unverify', requireAdmin, ah(async (req, res) => {
  await db.run("UPDATE donations SET status='pending', verified_at=NULL, verified_by='' WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/admin/donations/:id', requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM donations WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/health', (req, res) => res.json({ ok: true }));

// ---- نص صفحة "من نحن" (قابل للتعديل من لوحة المشرف) ----
app.get('/api/about', ah(async (req, res) => {
  const row = await db.get('SELECT text FROM settings WHERE key = ?', ['about_text']);
  res.json({ text: row ? row.text : '' });
}));

app.get('/api/admin/about', requireAdmin, ah(async (req, res) => {
  const row = await db.get('SELECT text FROM settings WHERE key = ?', ['about_text']);
  res.json({ text: row ? row.text : '' });
}));

app.put('/api/admin/about', requireAdmin, ah(async (req, res) => {
  const text = String(req.body.text || '');
  if (USE_PG_MODE) {
    await db.run(
      `INSERT INTO settings (key, text) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET text = EXCLUDED.text`,
      ['about_text', text]
    );
  } else {
    const exists = await db.get('SELECT key FROM settings WHERE key = ?', ['about_text']);
    if (exists) await db.run('UPDATE settings SET text = ? WHERE key = ?', [text, 'about_text']);
    else await db.run('INSERT INTO settings (key, text) VALUES (?, ?)', ['about_text', text]);
  }
  res.json({ ok: true });
}));

// معالج أخطاء عام
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ في السيرفر' });
});

db.init().then(() => db.ensureMasterAdmin(ADMIN_PASSWORD)).then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch((e) => {
  console.error('DB init failed:', e);
  process.exit(1);
});
