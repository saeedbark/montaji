# مونتاجي — Montaji

[![CI](https://github.com/saeedbark/montaji/actions/workflows/ci.yml/badge.svg)](https://github.com/saeedbark/montaji/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2018-brightgreen)
![Dependencies](https://img.shields.io/badge/dependencies-0-success)

**العربية** · [English](README.en.md)

محرر فيديو بسيط باللغة العربية يعمل داخل المتصفح وعلى جهازك، ومعه مساعد ذكي تطلب منه المونتاج بالكلام فينفّذه أمامك. مفتوح المصدر، بلا حساب، وبلا أي مكتبات للتثبيت.

- رفع الصور ومقاطع الفيديو والموسيقى، بالزر أو بالسحب والإفلات
- ترتيب المقاطع وقصّها وتقسيمها، مع تراجع وإعادة
- موسيقى مع ظهور واختفاء تدريجي، ونصوص متحركة فوق الفيديو
- انتقالات وفلاتر وحركة كاميرا، ومقاسات 16:9 و 9:16 و 1:1 و 4:5
- مزامنة القص مع إيقاع الموسيقى تلقائياً
- تصدير ملف MP4 بدقة تصل إلى 4K
- **مساعد ذكي** يعمل بمفتاحك الخاص (Gemini أو OpenAI أو Claude أو غيرها، أو محلياً عبر Ollama)
- **خادم MCP** يتيح لأي عميل خارجي (Claude Code، Cursor…) التحكم بالمحرر

## التشغيل

1. ثبّت [Node.js](https://nodejs.org) بإصدار 18 أو أحدث.
2. نزّل المشروع: زر **Code ← Download ZIP** في صفحة GitHub، أو:

   ```bash
   git clone https://github.com/saeedbark/montaji.git
   ```

3. شغّله:
   - **ويندوز:** انقر مرتين على `start.bat`
   - **ماك / لينكس:** نفّذ `./start.sh`
   - **أو من الطرفية على أي نظام:**

     ```bash
     npm start
     ```

يفتح المحرر على `http://localhost:5173`. لا حاجة إلى `npm install`، فالمشروع بلا مكتبات.

التصدير يحتاج Google Chrome أو Microsoft Edge بإصدار حديث. لتغيير المنفذ شغّل الخادم بالمتغيّر `PORT`.

## المساعد الذكي

عند أول تشغيل يُنشأ ملف باسم `.env` في مجلد البرنامج (نسخة من `.env.example`).

1. افتح `.env` بأي محرر نصوص.
2. ضع مفتاحك بعد علامة `=` في السطر المناسب، مثلاً:

   ```
   GEMINI_API_KEY=ضع-مفتاحك-هنا
   ```

3. احفظ الملف، ثم اضغط زر «المساعد» في المحرر. لا حاجة لإعادة التشغيل.

| المزوّد | المتغيّر | من أين أحصل على المفتاح |
| --- | --- | --- |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (فيه باقة مجانية) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic Claude | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| أي خدمة متوافقة مع OpenAI | `AI_PROVIDER=custom` مع `AI_BASE_URL` و `AI_API_KEY` و `AI_MODEL` | Groq، DeepSeek، Mistral، LM Studio… |
| Ollama (محلي بلا إنترنت) | `AI_PROVIDER=ollama` مع `AI_MODEL` | [ollama.com](https://ollama.com) |

لتغيير النموذج اكتب اسمه في `AI_MODEL`. وإن وضعت أكثر من مفتاح فحدّد المزوّد في `AI_PROVIDER`.

### كيف أستخدمه؟

ارفع ملفاتك (بزر المشبك في لوحة المساعد أو بالسحب والإفلات) ثم اكتب ما تريد:

- «اصنع فيديو جاهزاً من ملفاتي: رتّبها وأضف انتقالات وعنواناً»
- «حوّله إلى فيديو عمودي لتيك توك واجعل كل صورة 3 ثوانٍ»
- «اقتطع أول 10 ثوانٍ من الفيديو الثاني واكتم صوته وأخفض الموسيقى»
- «صدّر الفيديو بدقة 1080»

المساعد يعدّل الخط الزمني مباشرة، وكل ما يفعله في الرد الواحد يُلغى بضغطة «تراجع» واحدة.

### الخصوصية

- التحرير والتصدير يجريان على جهازك بالكامل، وملفاتك الأصلية لا تُرفع إلى أي مكان.
- المفتاح يبقى في `.env` على جهازك: يقرؤه الخادم المحلي فقط، ولا يصل إلى المتصفح، وهو مستثنى من Git.
- عند استخدام المساعد يُرسَل إلى المزوّد الذي اخترته: نص رسائلك، ووصف المشروع (أسماء الملفات والمدد والنصوص)، وصور مصغّرة من ملفاتك كي «يرى» محتواها. لإيقاف إرسال الصور اكتب `AI_VISION=off` في `.env`.

## خادم MCP

الخادم نفسه يعمل كخادم [MCP](https://modelcontextprotocol.io) على العنوان `http://localhost:5173/mcp`، فيستطيع أي عميل يدعم MCP أن يحرّر المشروع المفتوح في المتصفح: يضيف ملفات من جهازك بمسارها، يرتّب ويقصّ ويضيف النصوص، ويصدّر الفيديو.

Claude Code:

```bash
claude mcp add --transport http montaji http://localhost:5173/mcp
```

Cursor وغيره (ملف إعدادات MCP):

```json
{ "mcpServers": { "montaji": { "url": "http://localhost:5173/mcp" } } }
```

أبقِ صفحة المحرر مفتوحة أثناء العمل، فالأدوات تُنفَّذ داخلها. هذا الخادم لا يحتاج مفتاحاً؛ النموذج هنا هو نموذج العميل نفسه.

الأدوات: `get_project` `import_media` `set_ratio` `update_clips` `reorder_clips` `split` `add_text` `update_texts` `update_audio` `analyze_audio` `sync_to_beat` `duplicate_item` `delete_items` `view_frame` `seek` `undo` `export_video`

### المزامنة مع الإيقاع

عند إضافة موسيقى يحلّل المحرر إيقاعها محلياً (السرعة BPM ومواضع الضربات) ويرسم الضربات على مسار الموسيقى. من لوحة الموسيقى اضغط «مزامنة القص مع الإيقاع» فيُعاد توقيت كل المقاطع لتقع كل قصّة على ضربة، مع «نبضة» خفيفة للصورة عند كل ضربة. خيار «الضربات القوية فقط» مناسب للنغمات القصيرة ذات المؤثرات (ضربات ثم صمت ثم انفجار). المساعد وعملاء MCP يستخدمون الأداة نفسها `sync_to_beat`.

## الشرح

- دليل الاستخدام خطوة بخطوة: زر «؟» داخل المحرر، أو الملف `public/guide.html`
- شرح مصوّر قصير: `public/media/guide.mp4`

## هيكل المشروع

```
montaji/
├─ server/                 الخادم المحلي (Node.js بلا مكتبات)
│  ├─ index.js             نقطة البدء والتوجيه
│  ├─ config.js            ملف .env ومزوّدو الذكاء الاصطناعي
│  ├─ http.js              أدوات HTTP وتقديم ملفات الواجهة
│  ├─ chat.js              ‎/api/chat وسيط الشات (المفتاح يبقى هنا)
│  ├─ bridge.js            ‎/api/bridge القناة بين الخادم وتبويب المحرر
│  └─ mcp.js               ‎/mcp خادم MCP
├─ public/                 كل ما يُحمَّل في المتصفح
│  ├─ index.html           صفحة المحرر
│  ├─ guide.html           دليل الاستخدام
│  ├─ css/style.css
│  ├─ js/
│  │  ├─ core.js           الحالة المشتركة ودوال مساعدة
│  │  ├─ beats.js          كشف إيقاع الموسيقى (BPM والضربات)
│  │  ├─ render.js         رسم الإطارات والمؤثرات
│  │  ├─ export.js         التصدير إلى MP4 (WebCodecs)
│  │  ├─ app.js            واجهة المحرر والخط الزمني
│  │  ├─ tools.js          تعريف أدوات المساعد (مشترك بين الشات و MCP)
│  │  ├─ agent.js          تنفيذ الأدوات على المشروع
│  │  └─ chat.js           لوحة المساعد وحلقة المحادثة
│  ├─ vendor/              مكتبة mp4-muxer (رخصة MIT)
│  └─ media/               فيديو الشرح
├─ test/                   اختبارات (node --test)
├─ docs/ARCHITECTURE.md    شرح البنية وتدفق البيانات
└─ .github/                قوالب البلاغات وطلبات الدمج و CI
```

التفاصيل في [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## المساهمة

المشروع مفتوح للجميع، والمساهمات مرحّب بها مهما كانت صغيرة.

- وجدت خللاً أو عندك اقتراح؟ [افتح بلاغاً](https://github.com/saeedbark/montaji/issues/new/choose).
- تريد المشاركة بالكود؟ اقرأ [دليل المساهمة](CONTRIBUTING.md)، وابدأ بالبلاغات الموسومة [`good first issue`](https://github.com/saeedbark/montaji/labels/good%20first%20issue).
- ثغرة أمنية؟ لا تفتح بلاغاً علنياً؛ اتبع [سياسة الأمان](SECURITY.md).

```bash
npm test    # يشغّل الاختبارات، بلا أي تثبيت
```

## الرخصة

[MIT](LICENSE). يتضمن المشروع مكتبة [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) برخصة MIT ([نص الرخصة](public/vendor/mp4-muxer.LICENSE.txt)).
