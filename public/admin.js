function key() { return localStorage.getItem('admin_token') || localStorage.getItem('admin_key') || ''; }
function me() { return localStorage.getItem('admin_user') || ''; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json', 'x-admin-key': key() }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'خطأ');
  return data;
}

async function login() {
  const username = document.getElementById('uname').value.trim();
  const password = document.getElementById('pw').value;
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!r.ok) return alert('بيانات الدخول غير صحيحة');
  const data = await r.json();
  localStorage.setItem('admin_token', data.token);
  localStorage.setItem('admin_user', data.username);
  localStorage.setItem('admin_role', data.role || 'admin');
  localStorage.removeItem('admin_key');
  show();
}
function logout() { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); localStorage.removeItem('admin_role'); localStorage.removeItem('admin_key'); location.reload(); }
function isMaster() { return localStorage.getItem('admin_role') === 'master'; }
function show() {
  if (!key()) return;
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('panel').style.display = 'block';
  document.getElementById('meName').textContent = me() + (isMaster() ? ' (مشرف عام)' : '');
  document.getElementById('adminsCard').style.display = isMaster() ? 'block' : 'none';
  loadAll();
}
function loadAll() { loadCasesAdmin(); loadDonations(); if (isMaster()) loadAdmins(); }

let CASES = [];
const statusLabelA = (s) => s === 'active' ? 'نشطة' : s === 'archived' ? '🗄 مؤرشفة' : 'مغلقة';
async function loadCasesAdmin() {
  CASES = await api('/api/cases');
  document.getElementById('casesAdmin').innerHTML = CASES.map(c => `
    <div style="border:1px solid #e6eaef;border-radius:10px;padding:10px;margin:8px 0">
      <b>#${c.id} ${esc(c.title)}</b>
      <span class="badge ${c.status}">${statusLabelA(c.status)}</span>
      ${c.patient_name ? `<div style="font-size:13px">🧑‍⚕️ المريض/الحالة: <b>${esc(c.patient_name)}</b></div>` : ''}
      <div style="font-size:13px;color:#666">الهدف ${c.target_amount}$ — موثق ${c.totals.verified}$ — منتظر ${c.totals.pending}$ — عدد ${c.totals.count_all}</div>
      <div class="admin-bar">
        <button class="small ghost" onclick="setStatus(${c.id},'${c.status === 'active' ? 'closed' : 'active'}')">${c.status === 'active' ? 'إغلاق' : 'فتح'}</button>
        ${c.status === 'archived'
          ? `<button class="small ghost" onclick="setStatus(${c.id},'closed')">إخراج من الأرشيف</button>`
          : `<button class="small ghost" onclick="archiveCase(${c.id})">🗄 أرشفة</button>`}
        <button class="small ghost" onclick="delCase(${c.id})">حذف</button>
      </div>
    </div>`).join('') || 'لا حالات';
}

let DONATIONS = [];
async function loadDonations() {
  const status = document.getElementById('filterStatus').value;
  DONATIONS = await api('/api/admin/donations' + (status ? `?status=${status}` : ''));
  const pend = DONATIONS.filter(d => d.status === 'pending');
  const ver = DONATIONS.filter(d => d.status === 'verified');
  document.getElementById('stats').innerHTML =
    `<div class="totals"><span>⏳ بانتظار التوثيق: <b>${pend.reduce((s, d) => s + d.amount, 0)} $ (${pend.length})</b></span>
     <span>✅ موثق: <b>${ver.reduce((s, d) => s + d.amount, 0)} $ (${ver.length})</b></span></div>`;
  document.getElementById('donationsAdmin').innerHTML = DONATIONS.length ? `<table>
    <tr><th>الحالة</th><th>المتبرع</th><th>الهاتف</th><th>المبلغ</th><th>الطريقة</th><th>الحالة</th><th></th></tr>
    ${DONATIONS.map(d => `<tr>
      <td>${esc(d.case_title)}</td>
      <td>${esc(d.donor_name)}</td>
      <td dir="ltr"><a href="tel:${esc(d.phone)}">${esc(d.phone)}</a></td>
      <td><b>${d.amount} $</b></td>
      <td>${d.method === 'wish' ? '📲 ويش' : '🤝 يد بيد'}</td>
      <td>${d.status === 'verified' ? `<span class="badge verified">✅ موثق</span>${d.verified_by ? `<div style="font-size:11px;color:#666">بواسطة ${esc(d.verified_by)}</div>` : ''}` : '<span class="badge pending">⏳ منتظر</span>'}</td>
      <td style="white-space:nowrap">
        ${d.status === 'pending'
          ? `<button class="small" onclick="verify(${d.id})">توثيق الاستلام ✅</button>`
          : `<button class="small ghost" onclick="unverify(${d.id})">إلغاء التوثيق</button>`}
        <button class="small ghost" onclick="delDon(${d.id})">حذف</button>
      </td>
    </tr>`).join('')}</table>` : 'لا تبرعات';
}

async function createCase() {
  try {
    await api('/api/admin/cases', { method: 'POST', body: JSON.stringify({
      title: document.getElementById('nTitle').value,
      patient_name: document.getElementById('nPatient').value,
      description: document.getElementById('nDesc').value,
      target_amount: document.getElementById('nTarget').value,
      wish_number: document.getElementById('nWish').value,
    })});
    alert('تم نشر الحالة');
    location.reload();
  } catch (e) { alert(e.message); }
}
async function setStatus(id, status) {
  await api('/api/admin/cases/' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
  loadAll();
}
async function toggleCase(id) {
  const c = CASES.find(x => x.id === id);
  setStatus(id, c.status === 'active' ? 'closed' : 'active');
}
async function archiveCase(id) {
  if (!confirm('أرشفة هذه الحملة؟ ستختفي من القائمة الرئيسية وتبقى في الأرشيف.')) return;
  setStatus(id, 'archived');
}
async function delCase(id) {
  if (!confirm('حذف الحالة وكل تبرعاتها؟')) return;
  await api('/api/admin/cases/' + id, { method: 'DELETE' });
  loadAll();
}
async function verify(id) { await api(`/api/admin/donations/${id}/verify`, { method: 'POST' }); loadAll(); }
async function unverify(id) { await api(`/api/admin/donations/${id}/unverify`, { method: 'POST' }); loadAll(); }
async function delDon(id) {
  if (!confirm('حذف هذا التبرع؟')) return;
  await api('/api/admin/donations/' + id, { method: 'DELETE' });
  loadAll();
}
async function loadAdmins() {
  try {
    const list = await api('/api/admin/admins');
    document.getElementById('adminsList').innerHTML = list.map(a =>
      `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e6eaef;padding:6px 0;font-size:14px">
        <span>👤 <b>${esc(a.username)}</b> ${a.role === 'master' ? '<span class="badge verified">عام</span>' : ''}</span>
        <button class="small ghost" onclick="delAdmin(${a.id},'${esc(a.username)}')">حذف</button>
      </div>`).join('') || 'لا مشرفين';
  } catch { document.getElementById('adminsList').innerHTML = 'تعذر التحميل'; }
}
async function createAdmin() {
  try {
    await api('/api/admin/admins', { method: 'POST', body: JSON.stringify({
      username: document.getElementById('aName').value,
      password: document.getElementById('aPass').value,
    })});
    alert('تمت إضافة المشرف');
    document.getElementById('aName').value = '';
    document.getElementById('aPass').value = '';
    loadAdmins();
  } catch (e) { alert(e.message); }
}
async function delAdmin(id, name) {
  if (!confirm(`حذف المشرف ${name}؟`)) return;
  try { await api('/api/admin/admins/' + id, { method: 'DELETE' }); loadAdmins(); }
  catch (e) { alert(e.message); }
}
function exportCSV() {
  const rows = [['id','case','donor','phone','amount','method','status','date'],
    ...DONATIONS.map(d => [d.id, d.case_title, d.donor_name, d.phone, d.amount, d.method, d.status, d.created_at])];
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: 'text/csv' }));
  a.download = 'donations.csv';
  a.click();
}

show();
