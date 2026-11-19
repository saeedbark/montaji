'use strict';
/* لغة الواجهة: العربية (الافتراضية) أو الإنجليزية.
   - في الكود: tt('النص العربي', 'English text') يعيد نص اللغة الحالية، فتبقى الترجمة بجانب أصلها.
   - نصوص index.html الثابتة تُترجم من القاموس STATIC أدناه (المفتاح هو النص العربي كما في الصفحة).
   - الجداول التي تُبنى مرة واحدة (الفلاتر، الخطوط…) تُمرَّر إلى I18N.localize فتصير تسمياتها حيّة.
   - عند تبديل اللغة تُستدعى دوال onChange لإعادة رسم ما بُني بالكود.
   يُحمَّل قبل كل ملفات js/ ويعمل في Node أيضاً (يعيد العربي دائماً). */

const I18N = (() => {
  const KEY = 'montaji.lang';
  const hasDom = typeof document !== 'undefined';
  let lang = 'ar';
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'ar' || s === 'en') lang = s;
  } catch (e) { /* وضع خاص أو Node */ }
  // ‎?lang=en‎ في العنوان (من رابط الدليل مثلاً) يختار اللغة ويحفظها
  if (hasDom) {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'ar' || q === 'en') {
      lang = q;
      try { localStorage.setItem(KEY, q); } catch (e) { /* وضع خاص */ }
    }
  }

  const t = (ar, en) => (lang === 'en' && en != null ? en : ar);

  /** نصوص index.html: العربي ← الإنجليزي. تُطابَق بعد إزالة علامات الاتجاه وتوحيد المسافات */
  const STATIC = {
    'مونتاجي': 'Montaji',
    'حفظ المشروع أو فتح مشروع محفوظ': 'Save the project or open a saved one',
    'مشروع': 'Project',
    'مشروع جديد': 'New project',
    'ابدأ من الصفر · Ctrl+Z يعيد المشروع الحالي': 'Start from scratch · Ctrl+Z brings the current one back',
    'فتح مشروع (استيراد)': 'Open project (import)',
    'افتح ملف مشروع محفوظ .montaji بكل تفاصيله · Ctrl+O': 'Open a saved .montaji project with everything in it · Ctrl+O',
    'حفظ المشروع': 'Save project',
    'ملف واحد فيه الخط الزمني وملفات الوسائط · Ctrl+S': 'One file with the timeline and all media · Ctrl+S',
    'تصدير الترجمة': 'Export captions',
    'ملف SRT يفتحه يوتيوب ومشغّلات الفيديو': 'An SRT file for YouTube and video players',
    'رفع صور ومقاطع فيديو': 'Add photos and video clips',
    'صور وفيديو': 'Media',
    'إضافة موسيقى أو تسجيل صوتي': 'Add music or a voice recording',
    'موسيقى': 'Music',
    'إضافة نص فوق الفيديو': 'Add text over the video',
    'نص': 'Text',
    'إضافة صورة أو فيديو فوق المسار الرئيسي: شعار، صورة داخل صورة…': 'Add a photo or video above the main track: a logo, picture-in-picture…',
    'طبقة': 'Overlay',
    'إضافة تأثير: تكبير ضبابي، وميض، أبيض وأسود…': 'Add an effect: zoom blur, flash, black and white…',
    'تأثير': 'Effect',
    'أدوات الصور والصوت': 'Image and audio tools',
    'أدوات': 'Tools',
    'ترجمة تلقائية': 'Auto captions',
    'حوّل كلام الفيديو إلى نص متزامن على الخط الزمني': 'Turn speech into captions synced on the timeline',
    'استوديو الصور': 'Image studio',
    'قص، إزالة الخلفية، تحويل PNG و JPEG': 'Crop, remove background, convert PNG and JPEG',
    'دمج الصور': 'Merge images',
    'اجمع عدة صور في صورة واحدة': 'Combine several images into one',
    'تحويل الفيديو إلى صوت': 'Video to audio',
    'استخرج الموسيقى ونزّلها M4A أو WAV': 'Extract the sound and download it as M4A or WAV',
    'تقسيم الفيديو': 'Split video',
    'قسّمه إلى أجزاء، كل جزء ملف MP4 مستقل': 'Cut it into parts, each one its own MP4 file',
    'جارٍ تحميل الملفات…': 'Loading files…',
    'مقاس الفيديو': 'Video size',
    'المقاس': 'Size',
    '16:9 أفقي (يوتيوب)': '16:9 landscape (YouTube)',
    '9:16 عمودي (تيك توك / ريلز)': '9:16 portrait (TikTok / Reels)',
    '1:1 مربع': '1:1 square',
    '4:5 إنستغرام': '4:5 Instagram',
    'المساعد الذكي: اطلب المونتاج بالكلام': 'AI assistant: describe the edit you want',
    'المساعد': 'Assistant',
    'دليل الاستخدام': 'User guide',
    'حفظ': 'Save',
    'حفظ المشروع (Ctrl+S)': 'Save project (Ctrl+S)',
    'تراجع (Ctrl+Z)': 'Undo (Ctrl+Z)',
    'إعادة (Ctrl+Y)': 'Redo (Ctrl+Y)',
    'تصدير الفيديو': 'Export video',
    'المساعد الذكي': 'AI assistant',
    'اختر النموذج': 'Choose the model',
    'النموذج': 'Model',
    'المحادثات السابقة': 'Previous chats',
    'مفتاح الذكاء الاصطناعي': 'AI key',
    'محادثة جديدة': 'New chat',
    'إخفاء المساعد': 'Hide the assistant',
    'عرض لوحة المساعد': 'Assistant panel width',
    'اسحب لتغيير العرض — نقرتان للعرض الافتراضي': 'Drag to resize — double-click for the default width',
    'إرفاق صور ومقاطع وموسيقى': 'Attach photos, clips and music',
    'اطلب ما تريد… مثل: رتّب المقاطع وأضف عنواناً وانتقالات': 'Ask for anything… e.g. order the clips and add a title and transitions',
    'إرسال (Enter)': 'Send (Enter)',
    'ابدأ مشروعك': 'Start your project',
    'اسحب الصور ومقاطع الفيديو والموسيقى وأفلتها هنا، أو اضغط الزر لاختيارها من جهازك.': 'Drag and drop photos, video clips and music here, or press the button to pick them from your device.',
    'اختيار ملفات': 'Choose files',
    'فتح مشروع محفوظ': 'Open a saved project',
    'جرّب مثالاً جاهزاً': 'Try a sample',
    'التحرير والتصدير يجريان على جهازك — ملفاتك لا تُرفع إلى الإنترنت.': 'Editing and export run on your device — your files are never uploaded.',
    'العودة إلى البداية': 'Back to start',
    'تشغيل / إيقاف (مسافة)': 'Play / pause (Space)',
    'حفظ الإطار الحالي كصورة': 'Save the current frame as an image',
    'الخصائص': 'Properties',
    'إخفاء الخصائص': 'Hide properties',
    'تغيير ارتفاع الخط الزمني': 'Timeline height',
    'اسحب لأعلى أو لأسفل لتغيير الارتفاع · نقرتان للإرجاع': 'Drag up or down to resize · double-click to reset',
    'خصائص العنصر المحدد': 'Properties of the selected item',
    'خصائص': 'Properties',
    'تقسيم عند المؤشر (S)': 'Split at the playhead (S)',
    'تقسيم': 'Split',
    'تكرار العنصر المحدد': 'Duplicate the selected item',
    'تكرار': 'Duplicate',
    'حذف العنصر المحدد (Delete)': 'Delete the selected item (Delete)',
    'حذف': 'Delete',
    'اسحب المقاطع لإعادة ترتيبها · اسحب الحواف للقص': 'Drag clips to reorder · drag the edges to trim',
    'إظهار المشروع كاملاً': 'Fit the whole project',
    'تكبير الخط الزمني': 'Timeline zoom',
    'تكبير': 'Zoom',
    'أبقِ هذه الصفحة مفتوحة حتى ينتهي.': 'Keep this page open until it finishes.',
    'الدقة': 'Resolution',
    'عدد الإطارات': 'Frame rate',
    '24 إطار/ثانية': '24 fps',
    '30 إطار/ثانية': '30 fps',
    '60 إطار/ثانية': '60 fps',
    'الجودة': 'Quality',
    'عادية (حجم أصغر)': 'Normal (smaller file)',
    'عالية': 'High',
    'فائقة (حجم أكبر)': 'Ultra (larger file)',
    'إلغاء': 'Cancel',
    'ابدأ التصدير': 'Start export',
    'جارٍ التحضير…': 'Preparing…',
    'أبقِ هذه الصفحة مفتوحة حتى ينتهي التصدير.': 'Keep this page open until the export finishes.',
    'إيقاف التصدير': 'Stop export',
    'إغلاق': 'Close',
    'تنزيل الفيديو': 'Download video',
    'فتح صور أخرى من جهازك': 'Open more images from your device',
    'فتح صور': 'Open images',
    'دمج الصور المفتوحة في صورة واحدة': 'Merge the open images into one',
    'دمج': 'Merge',
    'إلغاء كل التعديلات على هذه الصورة': 'Undo every change to this image',
    'الأصل': 'Original',
    'إغلاق (Esc)': 'Close (Esc)',
    'افتح صورة لتبدأ': 'Open an image to start',
    'اسحب الصور وأفلتها هنا، أو اخترها من جهازك. يمكنك فتح عدة صور لتحويلها دفعة واحدة.': 'Drag and drop images here, or pick them from your device. Open several to convert them in one go.',
    'اختيار صور': 'Choose images',
    'جارٍ المعالجة…': 'Processing…',
    'فتح فيديو آخر من جهازك': 'Open another video from your device',
    'فتح فيديو': 'Open video',
    'إيقاف': 'Stop',
    'أفلت الملفات هنا لإضافتها': 'Drop the files here to add them',
  };

  const norm = s => s.replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();
  const DICT = new Map(Object.entries(STATIC).map(([a, e]) => [norm(a), e]));
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  let nodes = null; // [[عقدة نص, الأصل]] و [[عنصر, خاصية, الأصل]] من الصفحة الثابتة

  /** يجمع نصوص الصفحة الثابتة مرة واحدة عند أول تطبيق، فلا يمسّ ما يرسمه الكود لاحقاً */
  function collect() {
    nodes = { text: [], attr: [] };
    const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      const k = norm(n.nodeValue);
      if (k && DICT.has(k) && !n.parentElement.closest('script,style')) nodes.text.push([n, n.nodeValue, DICT.get(k)]);
    }
    for (const el of document.querySelectorAll(ATTRS.map(a => `[${a}]`).join(','))) {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && DICT.has(norm(v))) nodes.attr.push([el, a, v, DICT.get(norm(v))]);
      }
    }
  }

  function apply() {
    if (!hasDom) return;
    const root = document.documentElement;
    // الخادم المحلي يقرأ اللغة من هذه الكوكي ليرسل رسائل الخطأ بها (server/http.js: langOf)
    document.cookie = `montaji_lang=${lang}; path=/; max-age=31536000; SameSite=Strict`;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (!nodes) collect();
    const en = lang === 'en';
    for (const [n, ar, e] of nodes.text) n.nodeValue = en ? keepSpace(ar, e) : ar;
    for (const [el, a, ar, e] of nodes.attr) el.setAttribute(a, en ? e : ar);
    // زر اللغة يعرض اللغة الأخرى، ورابط الدليل يفتح نسخة اللغة الحالية
    const b = document.getElementById('btnLang');
    if (b) {
      b.textContent = en ? 'ع' : 'EN';
      b.lang = en ? 'ar' : 'en';
      b.title = en ? 'العربية' : 'English';
      b.setAttribute('aria-label', en ? 'التبديل إلى العربية' : 'Switch to English');
      b.onclick = () => set(en ? 'ar' : 'en');
    }
    const g = document.getElementById('lnkGuide');
    if (g) g.href = en ? 'guide.en.html' : 'guide.html';
  }
  /** يبقي المسافات حول النص الأصلي كما هي */
  const keepSpace = (ar, e) => ar.replace(/^(\s*)[\s\S]*?(\s*)$/, (_, a, b) => a + e + b);

  const subs = [];
  function set(l) {
    if (l !== 'ar' && l !== 'en') return;
    lang = l;
    try { localStorage.setItem(KEY, l); } catch (e) { /* وضع خاص */ }
    apply();
    for (const f of subs) { try { f(lang); } catch (e) { console.error(e); } }
  }

  /** يجعل تسميات جدول ثابت تتبع اللغة: { k: ['ع', 'En'] } أو { k: { label: ['ع', 'En'], … } } */
  function localize(table) {
    for (const k of Object.keys(table)) {
      const v = table[k];
      if (Array.isArray(v)) Object.defineProperty(table, k, { get: () => t(v[0], v[1]), enumerable: true });
      else if (v && Array.isArray(v.label)) {
        const [ar, en] = v.label;
        Object.defineProperty(v, 'label', { get: () => t(ar, en), enumerable: true });
      }
    }
    return table;
  }

  apply();
  return {
    get lang() { return lang; },
    t, set, apply, localize,
    toggle: () => set(lang === 'ar' ? 'en' : 'ar'),
    onChange: f => subs.push(f),
  };
})();
const tt = I18N.t;

if (typeof module !== 'undefined') module.exports = I18N;
