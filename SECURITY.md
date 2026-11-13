# سياسة الأمان — Security Policy

## الإبلاغ عن ثغرة

**لا تفتح بلاغاً علنياً عن ثغرة أمنية.** استخدم الإبلاغ الخاص في GitHub:

[github.com/saeedbark/montaji/security/advisories/new](https://github.com/saeedbark/montaji/security/advisories/new)

اذكر في البلاغ: وصف الثغرة، خطوات إعادة إنتاجها، الأثر المتوقع، وإصدار المشروع أو رقم الإيداع. سنرد عليك في أقرب وقت، وننشر الإصلاح ثم نذكر اسمك في سجل التغييرات إن رغبت.

**Please do not open a public issue for security problems.** Report them privately through GitHub's [private vulnerability reporting](https://github.com/saeedbark/montaji/security/advisories/new) with steps to reproduce and the affected commit.

## ما الذي يُعدّ ثغرة؟

مونتاجي يعمل على جهاز المستخدم، وأهم ما يحميه: **مفتاح الذكاء الاصطناعي في `.env`** و**ملفات المستخدم**. أمثلة لما نريد معرفته:

- قراءة `.env` أو أي ملف خارج `public/` عبر الخادم.
- موقع خارجي يستطيع مخاطبة `/api/*` أو `/mcp` (تجاوز فحص `Host` / `Origin`).
- وصول المفتاح إلى المتصفح أو إلى أي جهة غير المزوّد الذي اختاره المستخدم.
- تنفيذ سكربت داخل صفحة المحرر عبر اسم ملف أو نص أو رد من النموذج (XSS).
- قراءة ملفات من الجهاز عبر `/api/media` بغير الطريق المقصود.

خارج النطاق: برامج أخرى تعمل على الجهاز نفسه بصلاحيات المستخدم (تستطيع قراءة `.env` مباشرة)، وما يفعله عميل MCP وثق به المستخدم وربطه بنفسه.

## الإصدارات المدعومة

الإصلاحات الأمنية تُطبَّق على آخر إصدار في الفرع `main`.
