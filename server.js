// نظام تبرعات القرية - سيرفر
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

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
    SELECT id, donor_name, amount, method, status, created_at
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
  if (db.USE_PG) await db.run("UPDATE donations SET status='verified', verified_at=NOW() WHERE id=?", [d.id]);
  else await db.run("UPDATE donations SET status='verified', verified_at=datetime('now') WHERE id=?", [d.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/donations/:id/unverify', requireAdmin, ah(async (req, res) => {
  await db.run("UPDATE donations SET status='pending', verified_at=NULL WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/admin/donations/:id', requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM donations WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/health', (req, res) => res.json({ ok: true }));

// معالج أخطاء عام
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ في السيرفر' });
});

db.init().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch((e) => {
  console.error('DB init failed:', e);
  process.exit(1);
});
