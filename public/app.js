async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'خطأ');
  return data;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function load() {
  const box = document.getElementById('cases');
  box.innerHTML = '<div class="card">جاري التحميل…</div>';
  try {
    const cases = await api('/api/cases');
    if (!cases.length) { box.innerHTML = '<div class="card">لا توجد حالات حاليا.</div>'; return; }
    const live = cases.filter(c => c.status !== 'archived');
    const archived = cases.filter(c => c.status === 'archived');
    box.innerHTML = '';
    const statusLabel = (s) => s === 'active' ? '● نشطة' : s === 'archived' ? '🗄 مؤرشفة' : 'مغلقة';
    const renderCase = (c) => {
      const pct = c.target_amount > 0 ? Math.min(100, Math.round(100 * c.totals.verified / c.target_amount)) : 0;
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `
        <div class="meta">
          <span class="badge ${c.status}">${statusLabel(c.status)}</span>
          <span>#${c.id}</span>
        </div>
        <h2 class="case-title">${esc(c.title)}</h2>
        ${c.patient_name ? `<div style="font-size:14px;color:#39424d">🧑‍⚕️ المريض/الحالة: <b>${esc(c.patient_name)}</b></div>` : ''}
        <div class="case-desc">${esc(c.description)}</div>
        <div class="totals">
          <span>الهدف: <b>${c.target_amount} $</b></span>
          <span>الموثق ✅: <b>${c.totals.verified} $</b></span>
          <span>بالانتظار ⏳: <b>${c.totals.pending} $</b></span>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        ${c.wish_number ? `<div class="wish-box">📲 التحويل عبر Wish على الرقم: <b dir="ltr">${esc(c.wish_number)}</b> — بعد التحويل سجّل تبرعك بالأسفل واختر "ويش".</div>` : ''}
        ${c.status === 'active' ? `
        <details open>
          <summary style="cursor:pointer;font-weight:700;margin:8px 0">➕ سجّل تبرعك هنا</summary>
          <form data-case="${c.id}" class="donate-form">
            <label>الاسم الكامل</label>
            <input name="donor_name" required placeholder="مثال: فلان الفلاني">
            <label>رقم الهاتف (لتواصل المشرف فقط — لا يظهر للجميع)</label>
            <input name="phone" required placeholder="06XXXXXXXX" dir="ltr">
            <label>المبلغ ($)</label>
            <input name="amount" type="number" min="1" step="any" required placeholder="10">
            <label>طريقة التسليم</label>
            <div class="method-tabs">
              <button type="button" data-m="cash" class="on">🤝 يدا بيد</button>
              <button type="button" data-m="wish" class="">📲 ويش</button>
            </div>
            <input type="hidden" name="method" value="cash">
            <div class="notice">سيظهر تبرعك بحالة "⏳ بانتظار التوثيق" حتى يستلمه المشرف ويوثقه ✅.</div>
            <button type="submit">تأكيد التبرع</button>
          </form>
        </details>` : c.status === 'archived'
          ? '<div class="notice">هذه الحالة مؤرشفة 🗄 — شكرا للمتبرعين.</div>'
          : '<div class="notice">هذه الحالة مغلقة — شكرا للمتبرعين.</div>'}
        <h3 style="margin:14px 0 6px">قائمة التبرعات</h3>
        <div data-donations="${c.id}">…</div>
      `;
      box.appendChild(el);
      loadDonations(c.id);
    };
    live.forEach(renderCase);
    if (archived.length) {
      const btn = document.createElement('div');
      btn.className = 'card';
      btn.innerHTML = `<button class="ghost" id="toggleArchive">🗄 عرض الحملات المؤرشفة (${archived.length})</button><div id="archBox" style="display:none"></div>`;
      box.appendChild(btn);
      btn.querySelector('#toggleArchive').onclick = () => {
        const ab = btn.querySelector('#archBox');
        const open = ab.style.display !== 'none';
        if (open) { ab.style.display = 'none'; ab.innerHTML = ''; btn.querySelector('#toggleArchive').textContent = `🗄 عرض الحملات المؤرشفة (${archived.length})`; return; }
        ab.style.display = 'block';
        btn.querySelector('#toggleArchive').textContent = 'إخفاء الأرشيف';
        ab.innerHTML = '';
        archived.forEach(c => {
          const pct = c.target_amount > 0 ? Math.min(100, Math.round(100 * c.totals.verified / c.target_amount)) : 0;
          const el = document.createElement('div');
          el.className = 'card';
          el.innerHTML = `
            <div class="meta"><span class="badge archived">🗄 مؤرشفة</span><span>#${c.id}</span></div>
            <h2 class="case-title">${esc(c.title)}</h2>
            ${c.patient_name ? `<div style="font-size:14px">🧑‍⚕️ المريض/الحالة: <b>${esc(c.patient_name)}</b></div>` : ''}
            <div class="case-desc">${esc(c.description)}</div>
            <div class="totals"><span>الموثق ✅: <b>${c.totals.verified} $</b></span><span>عدد التبرعات: <b>${c.totals.count_all}</b></span></div>
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div data-donations="${c.id}">…</div>`;
          ab.appendChild(el);
          loadDonations(c.id);
        });
      };
    }
    wireForms();
  } catch (e) {
    box.innerHTML = `<div class="card">تعذر التحميل: ${esc(e.message)}</div>`;
  }
}

async function loadDonations(caseId) {
  const div = document.querySelector(`[data-donations="${caseId}"]`);
  try {
    const d = await api('/api/cases/' + caseId);
    if (!d.donations.length) { div.innerHTML = '<div class="notice">لا تبرعات بعد — كن أول متبرع.</div>'; return; }
    div.innerHTML = `<table>
      <tr><th>المتبرع</th><th>المبلغ</th><th>الطريقة</th><th>التاريخ</th><th>الحالة</th></tr>
      ${d.donations.map(x => `<tr>
        <td>${esc(x.donor_name)}</td>
        <td><b>${x.amount} $</b></td>
        <td>${x.method === 'wish' ? '📲 ويش' : '🤝 يد بيد'}</td>
        <td>${esc((x.created_at || '').slice(0, 10))}</td>
        <td>${x.status === 'verified' ? `<span class="badge verified">✅ موثق</span>${x.verified_by ? `<div style="font-size:11px;color:#666">وثّقه ${esc(x.verified_by)}</div>` : ''}` : '<span class="badge pending">⏳ بانتظار التوثيق</span>'}</td>
      </tr>`).join('')}
    </table>`;
  } catch { div.innerHTML = 'تعذر تحميل التبرعات'; }
}

function wireForms() {
  document.querySelectorAll('.method-tabs').forEach(tabs => {
    const hidden = tabs.parentElement.querySelector('input[name=method]');
    tabs.querySelectorAll('button').forEach(b => b.onclick = (e) => {
      e.preventDefault();
      tabs.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      hidden.value = b.dataset.m;
    });
  });
  document.querySelectorAll('.donate-form').forEach(f => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const body = {
        donor_name: fd.get('donor_name'),
        phone: fd.get('phone'),
        amount: fd.get('amount'),
        method: fd.get('method'),
      };
      try {
        await api(`/api/cases/${f.dataset.case}/donate`, { method: 'POST', body: JSON.stringify(body) });
        alert('شكرا! تم تسجيل تبرعك وسيوثق بعد الاستلام ✅');
        f.reset();
        load();
      } catch (err) { alert(err.message); }
    };
  });
}

load();
