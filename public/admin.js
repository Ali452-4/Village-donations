function key() { return localStorage.getItem('admin_key') || ''; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json', 'x-admin-key': key() }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'خطأ');
  return data;
}

async function login() {
  const password = document.getElementById('pw').value;
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!r.ok) return alert('كلمة السر غير صحيحة');
  localStorage.setItem('admin_key', password);
  show();
}
function logout() { localStorage.removeItem('admin_key'); location.reload(); }
function show() {
  if (!key()) return;
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('panel').style.display = 'block';
  loadAll();
}
function loadAll() { loadCasesAdmin(); loadDonations(); }

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
      <td>${d.status === 'verified' ? '<span class="badge verified">✅ موثق</span>' : '<span class="badge pending">⏳ منتظر</span>'}</td>
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
