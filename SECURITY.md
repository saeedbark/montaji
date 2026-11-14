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

## للاستعمال المحلي فقط

مونتاجي مصمَّم ليعمل على جهاز المستخدم وحده، **وليس خدمة تُستضاف للآخرين**. الخادم بلا تسجيل دخول ولا حد لعدد الطلبات، والحماية كلها قائمة على أنه لا يُرى إلا من الجهاز نفسه:

- يستمع على `127.0.0.1` فقط، ويرفض أي `Host` أو `Origin` غير العنوان المحلي.
- **لا تفتحه للإنترنت أو للشبكة** بأي طريقة: استضافة على خادم، نفق (ngrok، Cloudflare Tunnel…)، Reverse proxy، أو نشر منفذه من Docker أو الراوتر. من يصل إليه يستطيع استعمال مفتاح الذكاء الاصطناعي على حسابك، والتحكم بالمحرر عبر MCP، وكتابة ملفات في `exports/` و `projects/`.
- المشاكل الناتجة عن تشغيله بهذه الطرق، أو بعد تعديل عنوان الاستماع أو فحص المصدر، **خارج نطاق هذه السياسة**.

**Local use only.** Montaji is not meant to be hosted for others. The server has no authentication or rate limiting and relies on being reachable only from the same machine. Do not expose it through hosting, tunnels, reverse proxies or published ports; anyone who reaches it can spend your AI key, drive the editor over MCP and write into `exports/` and `projects/`. Reports that depend on such a setup, or on changing the listen address or the origin check, are out of scope.

## الإصدارات المدعومة

الإصلاحات الأمنية تُطبَّق على آخر إصدار في الفرع `main`.
