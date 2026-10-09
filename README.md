# 🤝 نظام تبرعات القرية

موقع لإدارة جمع التبرعات للحالات الطارئة والمرضى، بأسلوب مجموعة القرية نفسه لكن مؤتمت:

- المشرف ينشر **حالة** (مريض / عملية / طارئ) مع المبلغ المستهدف ورقم Wish.
- المتبرع يسجّل: **الاسم + رقم الهاتف + المبلغ + الطريقة (يدا بيد 🤝 / ويش 📲)**.
- التبرع يظهر للجميع بحالة **⏳ بانتظار التوثيق** — بدون رقم الهاتف (الهاتف للمشرف فقط).
- المشرف يستلم المبلغ (يدا بيد أو يتحقق من Wish) ثم يضغط **توثيق الاستلام ✅** فيتحول التبرع لموثق.
- مجاميع تلقائية: الموثق / المنتظر / الهدف + شريط تقدم.

## التشغيل محليا

```bash
npm install
# كلمة سر المشرف (غيّرها)
set ADMIN_PASSWORD=كلمة_قوية & node server.js
# ثم افتح:
# http://localhost:3000        ← صفحة المتبرعين
# http://localhost:3000/admin.html ← لوحة المشرف
```

على Linux/Mac:
```bash
ADMIN_PASSWORD=كلمة_قوية PORT=3000 node server.js
```

## النشر أونلاين (مجاني - Render)

1. ارفع هذا المجلد إلى GitHub.
2. في [render.com](https://render.com) ← New + ← Web Service ← اختر الريبو.
3. الإعدادات:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Environment Variables: `ADMIN_PASSWORD` = كلمة سر المشرف.
4. ستحصل على رابط `https://xxx.onrender.com` شاركه في مجموعة القرية.
   - `/` للمتبرعين، `/admin.html` للمشرفين.

> ملاحظة: ملف `data.db` يُخزّن على السيرفر. في الخطة المجانية قد يُمسح عند إعادة التشغيل — للاحتفاظ الدائم اربط Disk في Render (مسار `/opt/render/project/src` أو انقل `data.db` لمسار الـ Disk) أو أخبرني لأحوّله لـ Postgres/Supabase.

## الحسابات

- لا يوجد حسابات للمتبرعين — فقط الاسم والهاتف.
- المشرف: دخول واحد بكلمة سر (`ADMIN_PASSWORD`). غيّر القيمة الافتراضية `admin123` فورا.

## API

- `GET /api/cases` — الحالات + المجاميع
- `GET /api/cases/:id` — حالة + تبرعاتها (بدون هواتف)
- `POST /api/cases/:id/donate` — `{donor_name, phone, amount, method: cash|wish}`
- `POST /api/admin/login` — `{password}`
- `GET /api/admin/donations` — مع الهواتف (هيدر `x-admin-key`)
- `POST /api/admin/donations/:id/verify` — توثيق ✅
- `POST /api/admin/donations/:id/unverify` — إلغاء التوثيق
