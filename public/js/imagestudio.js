'use strict';
/* استوديو الصور: قص وتدوير وألوان، إزالة الخلفية، والتحويل بين الصيغ — نافذة مستقلة عن الخط الزمني.
   هذا الملف للواجهة فقط؛ المعالجة نفسها في js/imagetools.js */

const ImageStudio = (() => {
  const S = window.studio;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const el = {
    modal: $('#imgModal'), stage: $('#imgStage'), view: $('#imgView'), empty: $('#imgEmpty'), busy: $('#imgBusy'),
    panel: $('#imgPanel'), strip: $('#imgStrip'), name: $('#imgName'), file: $('#fileImg'),
    undo: $('#imgUndo'), reset: $('#imgReset'),
  };
  const vctx = el.view.getContext('2d');
  const MAX_UNDO = 6; // كل خطوة تراجع نسخة كاملة من الصورة، فالعدد محدود حفاظاً على الذاكرة
  const ASPECTS = [['free', 'حر'], ['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:5', '4:5'], ['4:3', '4:3']];
  const FORMAT_NOTES = {
    jpeg: 'أصغر حجماً ومناسب للصور الفوتوغرافية. لا يدعم الشفافية.',
    png: 'بلا فقدان في الجودة ويدعم الشفافية، لكن حجمه أكبر.',
    webp: 'حجم صغير مع دعم الشفافية. تدعمه المتصفحات الحديثة.',
  };

  const st = {
    items: [], cur: -1, tab: 'edit',
    cropping: false, crop: null, aspect: 'free',
    bg: { how: 'auto', tolerance: 22, feather: 1, contiguous: true, last: null },
    fillColor: '#ffffff',
    out: { format: 'jpeg', quality: 90, matte: '#ffffff' },
    clipId: null,  // معرّف مقطع من المشروع يُعدَّل هنا
    stash: null,   // صور المستخدم المفتوحة، تُحفظ جانباً أثناء تعديل مقطع
  };

  const cur = () => st.items[st.cur] || null;
  const isOpen = () => !el.modal.hidden;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  async function busy(on) { el.busy.hidden = !on; if (on) await pause(30); } // مهلة قصيرة ليُرسم المؤشر قبل العمل الثقيل
  const fmtSize = n => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} ك.ب` : `${(n / 1048576).toFixed(1)} م.ب`);
  const baseName = it => it.name.replace(/\.[^.\\/]+$/, '') || 'image';

  function newItem(name, src) {
    const thumb = src instanceof Blob ? URL.createObjectURL(src) : ImageTools.thumb(src);
    return { id: uid(), name, src, cv: null, undo: [], edited: false, fill: null, thumb, thumb0: thumb, filter: 'none', bright: 100, contrast: 100, sat: 100 };
  }

  async function ensure(it) {
    if (it.cv) return;
    it.cv = it.src instanceof Blob ? await ImageTools.load(it.src) : ImageTools.fromSource(it.src);
  }

  /** الصورة النهائية: التعديلات المحفوظة + الفلتر والألوان + لون الخلفية الجديدة */
  function finalCanvas(it, cv = it.cv) {
    const f = Render.filterCss(it);
    if (!f && !it.fill) return cv;
    const out = ImageTools.canvas(cv.width, cv.height), g = out.getContext('2d');
    if (it.fill) { g.fillStyle = it.fill; g.fillRect(0, 0, out.width, out.height); }
    g.filter = f || 'none';
    g.drawImage(cv, 0, 0);
    return out;
  }

  /* ================= الرسم ================= */
  function draw() {
    const it = cur(), ready = !!(it && it.cv);
    el.empty.hidden = !!it;
    el.view.hidden = !ready;
    if (!ready) return;
    const W = it.cv.width, H = it.cv.height;
    const aw = el.stage.clientWidth - 32, ah = el.stage.clientHeight - 32;
    if (aw <= 0 || ah <= 0) return;
    const k = Math.min(aw / W, ah / H, 4);
    const dw = Math.max(1, Math.round(W * k)), dh = Math.max(1, Math.round(H * k));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(dw * dpr), ph = Math.round(dh * dpr);
    if (el.view.width !== pw || el.view.height !== ph) { el.view.width = pw; el.view.height = ph; }
    el.view.style.width = dw + 'px'; el.view.style.height = dh + 'px';
    el.view.dataset.mode = st.cropping ? 'crop' : st.tab === 'bg' && st.bg.how === 'pick' ? 'pick' : '';

    vctx.clearRect(0, 0, pw, ph);
    if (it.fill) { vctx.fillStyle = it.fill; vctx.fillRect(0, 0, pw, ph); }
    vctx.filter = Render.filterCss(it) || 'none';
    vctx.imageSmoothingQuality = 'high';
    vctx.drawImage(it.cv, 0, 0, pw, ph);
    vctx.filter = 'none';
    if (st.cropping && st.crop) drawCrop(pw, ph, dpr);
  }

  function drawCrop(pw, ph, dpr) {
    const c = st.crop, x = c.x * pw, y = c.y * ph, w = c.w * pw, h = c.h * ph;
    vctx.save();
    vctx.fillStyle = 'rgba(0,0,0,.6)';
    vctx.beginPath(); vctx.rect(0, 0, pw, ph); vctx.rect(x, y, w, h); vctx.fill('evenodd');
    vctx.strokeStyle = '#fff'; vctx.lineWidth = 1.5 * dpr;
    vctx.strokeRect(x, y, w, h);
    vctx.globalAlpha = 0.35; vctx.lineWidth = dpr;
    vctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) { vctx.moveTo(x + w * f, y); vctx.lineTo(x + w * f, y + h); vctx.moveTo(x, y + h * f); vctx.lineTo(x + w, y + h * f); }
    vctx.stroke();
    vctx.globalAlpha = 1; vctx.fillStyle = '#fff';
    const s = 9 * dpr;
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) vctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    vctx.restore();
    const out = $('#cropSize'), it = cur();
    if (out) out.textContent = `${Math.round(c.w * it.cv.width)}×${Math.round(c.h * it.cv.height)}`;
  }

  /* ================= اللوحة الجانبية ================= */
  const chips = (k, opts, on, cls = 'chips') =>
    `<div class="${cls}" data-k="${k}">${opts.map(([v, l]) => `<button type="button" class="chip${String(v) === String(on) ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const slider = (k, label, min, max, step, val, unit = '') =>
    `<label class="row"><span>${label}</span><input type="range" data-k="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${val}${unit}</output></label>`;

  function renderPanel() {
    const it = cur(), top = el.panel.scrollTop;
    if (!it || !it.cv) {
      el.panel.innerHTML = `<h2>ماذا يفعل الاستوديو؟</h2>
        <ol class="guide">
          <li><b>تعديل الصورة</b><br>قص، تدوير، قلب، تغيير الحجم، وفلاتر وألوان.</li>
          <li><b>إزالة الخلفية</b><br>تلقائياً من الحواف، أو بالنقر على اللون المراد حذفه.</li>
          <li><b>تحويل الصيغة</b><br>بين PNG و JPEG و WebP، لصورة واحدة أو لعدة صور دفعة واحدة.</li>
        </ol>
        <p class="sub wrap">كل شيء يجري على جهازك؛ صورك لا تُرفع إلى أي مكان.</p>`;
      return;
    }
    const W = it.cv.width, H = it.cv.height, b = st.bg, o = st.out;
    let h = chips('tab', [['edit', 'تعديل'], ['bg', 'الخلفية'], ['save', 'حفظ وتحويل']], st.tab, 'chips tabs');

    if (st.tab === 'edit') {
      h += `<h3>تدوير وقلب</h3><div class="btn-grid">
          <button class="btn small" data-act="rotL">تدوير يساراً</button>
          <button class="btn small" data-act="rotR">تدوير يميناً</button>
          <button class="btn small" data-act="flipH">قلب أفقي</button>
          <button class="btn small" data-act="flipV">قلب عمودي</button>
        </div>
        <h3>القص</h3>`;
      if (st.cropping) {
        h += chips('aspect', ASPECTS, st.aspect)
          + `<p class="sub wrap">اسحب داخل الصورة لتحديد المنطقة، أو اسحب زواياها. المساحة المحددة: <b id="cropSize" dir="ltr"></b></p>
            <div class="btn-grid"><button class="btn small primary" data-act="cropApply">تطبيق القص</button><button class="btn small" data-act="cropCancel">إلغاء</button></div>`;
      } else h += `<button class="btn small wide" data-act="cropStart">قص الصورة</button>`;
      h += `<h3>الحجم <span dir="ltr">(${W}×${H})</span></h3>
        <div class="size-row" dir="ltr">
          <input type="number" data-k="rw" min="1" max="16000" value="${W}" aria-label="العرض">
          <span>×</span>
          <input type="number" data-k="rh" min="1" max="16000" value="${H}" aria-label="الارتفاع">
          <button class="btn small" data-act="resize">تطبيق</button>
        </div>
        <div class="chips">${[75, 50, 25].map(p => `<button type="button" class="chip" data-act="scale" data-v="${p}">${p}%</button>`).join('')}</div>
        <h3>الفلتر</h3>` + chips('filter', Object.entries(Render.FILTERS).map(([k, f]) => [k, f.label]), it.filter)
        + `<h3>تعديل الألوان</h3>`
        + slider('bright', 'السطوع', 50, 150, 1, it.bright, '%')
        + slider('contrast', 'التباين', 50, 150, 1, it.contrast, '%')
        + slider('sat', 'التشبّع', 0, 200, 1, it.sat, '%')
        + `<button class="link-btn" data-act="lookReset">إلغاء الفلتر وتعديل الألوان</button>`;
    } else if (st.tab === 'bg') {
      h += `<h3>إزالة الخلفية</h3>` + chips('how', [['auto', 'تلقائي'], ['pick', 'بالنقر على اللون']], b.how)
        + `<p class="sub wrap">${b.how === 'auto'
          ? 'يحذف اللون المحيط بالصورة ابتداءً من حوافها. يناسب الخلفيات الموحّدة: صور المنتجات، الشعارات، والخلفية الخضراء.'
          : 'انقر في الصورة على اللون الذي تريد حذفه، وكرّر النقر لحذف مناطق أخرى.'}</p>`
        + slider('tolerance', 'الحساسية', 1, 100, 1, b.tolerance)
        + slider('feather', 'نعومة الحواف', 0, 6, 1, b.feather)
        + `<label class="row check"><input type="checkbox" data-k="contiguous"${b.contiguous ? ' checked' : ''}><span>المناطق المتصلة فقط</span></label>`
        + (b.how === 'auto' ? `<button class="btn primary wide" data-act="bgRun">إزالة الخلفية</button>` : '')
        + `<p class="sub wrap">بعد الإزالة حرّك «الحساسية» لضبط النتيجة: زِدها إن بقي جزء من الخلفية، وأنقصها إن حُذف جزء من العنصر.</p>
          <h3>الخلفية الجديدة</h3>` + chips('fillMode', [['none', 'شفافة'], ['color', 'لون']], it.fill ? 'color' : 'none')
        + (it.fill ? `<label class="row"><span>اللون</span><input type="color" data-k="fill" value="${it.fill}"><span></span></label>` : '');
    } else {
      const lossy = ImageTools.FORMATS[o.format].lossy;
      h += `<h3>الصيغة</h3>` + chips('format', Object.entries(ImageTools.FORMATS).map(([k, f]) => [k, f.label]), o.format)
        + `<p class="sub wrap">${FORMAT_NOTES[o.format]}</p>`
        + (lossy ? slider('quality', 'الجودة', 30, 100, 1, o.quality, '%') : '')
        + (o.format === 'jpeg' && !it.fill ? `<label class="row"><span>لون الشفافية</span><input type="color" data-k="matte" value="${o.matte}"><span></span></label>` : '')
        + `<p class="ex-summary" id="imgInfo"><span dir="ltr">${W}×${H}</span> · جارٍ حساب الحجم…</p>
          <div class="save-actions">
            <button class="btn primary" data-act="download"><svg class="ic"><use href="#i-download"/></svg>تنزيل الصورة</button>`
        + (st.items.length > 1 ? `<button class="btn" data-act="downloadAll">تحويل كل الصور (${st.items.length}) في ملف ZIP</button>` : '')
        + (st.clipId ? `<button class="btn" data-act="applyClip">تطبيق على المقطع في المشروع</button>`
          : `<button class="btn" data-act="addProject">إضافة إلى مشروع الفيديو</button>`)
        + `</div>`;
      scheduleInfo();
    }
    el.panel.innerHTML = h;
    el.panel.scrollTop = top;
  }

  let infoTimer = 0, infoSeq = 0;
  /** الحجم الفعلي للملف الناتج (بترميز حقيقي في الخلفية) */
  function scheduleInfo() {
    clearTimeout(infoTimer);
    infoTimer = setTimeout(async () => {
      const it = cur();
      if (!it || !it.cv || st.tab !== 'save' || !$('#imgInfo')) return;
      const seq = ++infoSeq, o = st.out;
      const size = await ImageTools.sizeOf(finalCanvas(it), o.format, o.quality / 100, o.matte);
      const box = $('#imgInfo');
      if (seq !== infoSeq || !box || cur() !== it) return;
      let s = `<span dir="ltr">${it.cv.width}×${it.cv.height}</span> · الحجم بعد الحفظ <b>${fmtSize(size)}</b>`;
      if (it.src instanceof Blob && it.src.size) {
        const d = Math.round((1 - size / it.src.size) * 100);
        s += `<br>الملف الأصلي ${fmtSize(it.src.size)}` + (d > 0 ? ` — أصغر بنسبة ${d}%` : d < 0 ? ` — أكبر بنسبة ${-d}%` : '');
      }
      box.innerHTML = s;
    }, 250);
  }

  function renderStrip() {
    el.strip.hidden = st.items.length < 2;
    el.strip.innerHTML = st.items.map((it, i) =>
      `<div class="strip-item${i === st.cur ? ' on' : ''}" data-i="${i}" title="${esc(it.name)}">
        <img src="${it.thumb}" alt="">${it.edited ? '<i class="dot" title="معدَّلة"></i>' : ''}
        <button type="button" class="strip-x" data-x="${i}" title="إزالة من القائمة" aria-label="إزالة">×</button>
      </div>`).join('');
  }

  function refresh() {
    const it = cur();
    el.name.textContent = it ? it.name : '';
    el.undo.disabled = !(it && it.undo.length);
    el.reset.disabled = !(it && it.edited);
    draw();
    renderPanel();
    renderStrip();
  }

  /* ================= فتح الصور والتنقل بينها ================= */
  async function setCur(i) {
    const prev = cur();
    if (prev && !prev.edited && st.items.length > 1) prev.cv = null; // غير المعدَّلة تُعاد قراءتها من ملفها عند الحاجة
    st.cur = i;
    st.cropping = false; st.bg.last = null;
    const it = cur();
    if (it && !it.cv) {
      await busy(true);
      try { await ensure(it); } catch (e) {
        console.error(e);
        S.toast(`تعذّر فتح الصورة: ${it.name}`, 'err');
        st.items.splice(i, 1);
        st.cur = st.items.length ? Math.min(i, st.items.length - 1) : -1;
        busy(false);
        return st.cur >= 0 ? setCur(st.cur) : refresh();
      }
      busy(false);
    }
    refresh();
  }

  const isImage = f => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name || '');

  async function addFiles(fileList) {
    const files = [...fileList], imgs = files.filter(isImage);
    if (imgs.length < files.length) S.toast('الاستوديو يفتح الصور فقط', 'err');
    if (!imgs.length) return;
    if (st.clipId) leaveClip();
    const first = st.items.length;
    for (const f of imgs) st.items.push(newItem(f.name, f));
    await setCur(first);
  }

  function show() {
    S.pause();
    el.modal.hidden = false;
    refresh();
  }

  function leaveClip() {
    st.clipId = null;
    st.items = st.stash || [];
    st.stash = null;
    st.cur = st.items.length ? 0 : -1;
  }

  function open(files) {
    show();
    if (files && files.length) return addFiles(files);
    if (cur() && !cur().cv) return setCur(st.cur);
  }

  /** يفتح لوحة جاهزة (لقطة من الفيديو مثلاً) كصورة جديدة */
  function openCanvas(cv, name) {
    show();
    st.items.push(newItem(name, cv));
    st.tab = 'save';
    return setCur(st.items.length - 1);
  }

  /** يفتح صورة مقطع من المشروع؛ «تطبيق» يعيدها إليه */
  function openClip(clip) {
    if (!st.clipId) st.stash = st.items;
    st.clipId = clip.id;
    st.items = [newItem(clip.name, ImageTools.fromSource(clip.el, clip.w, clip.h))];
    st.tab = 'edit';
    show();
    return setCur(0);
  }

  function close() {
    el.modal.hidden = true;
    st.cropping = false;
    if (st.clipId) leaveClip();
  }

  /* ================= التعديلات ================= */
  function pushUndo(it) {
    it.undo.push(it.cv);
    if (it.undo.length > MAX_UNDO) it.undo.shift();
  }

  /** ينفّذ تعديلاً يعيد لوحة جديدة، ويسجّله للتراجع */
  async function mutate(fn) {
    const it = cur();
    if (!it || !it.cv) return;
    await busy(true);
    try {
      const out = fn(it.cv);
      if (out && out !== it.cv) { pushUndo(it); it.cv = out; it.edited = true; it.thumb = ImageTools.thumb(out); }
    } catch (e) {
      console.error(e);
      S.toast('تعذّر تنفيذ التعديل: ' + (e.message || e), 'err');
    }
    busy(false);
    st.bg.last = null;
    refresh();
  }

  function undo() {
    const it = cur();
    if (!it || !it.undo.length) return;
    it.cv = it.undo.pop();
    it.thumb = ImageTools.thumb(it.cv);
    st.bg.last = null; st.cropping = false;
    refresh();
  }

  async function reset() {
    const it = cur();
    if (!it) return;
    Object.assign(it, { cv: null, undo: [], edited: false, fill: null, thumb: it.thumb0, filter: 'none', bright: 100, contrast: 100, sat: 100 });
    await setCur(st.cur);
  }

  /**
   * إزالة الخلفية. seed = نقطة النقر (بكسل) أو null للبدء من الحواف.
   * retune: إعادة آخر إزالة بإعدادات جديدة من الصورة نفسها، دون خطوة تراجع إضافية
   */
  async function runBg(seed, retune) {
    const it = cur(), b = st.bg;
    if (!it || !it.cv) return;
    if (retune && !(b.last && b.last.item === it)) return;
    const base = retune ? b.last.base : it.cv;
    if (retune) seed = b.last.seed;
    await busy(true);
    let r;
    try {
      r = ImageTools.removeBg(base, { tolerance: b.tolerance, feather: b.feather, contiguous: b.contiguous, seed });
    } catch (e) {
      console.error(e);
      busy(false);
      return S.toast('تعذّرت إزالة الخلفية: ' + (e.message || e), 'err');
    }
    busy(false);
    if (!retune) pushUndo(it);
    it.cv = r.canvas; it.edited = true; it.thumb = ImageTools.thumb(r.canvas);
    b.last = { item: it, base, seed };
    // الشفافية تضيع في JPEG، فنقترح PNG ما لم يختر المستخدم لوناً للخلفية
    if (!it.fill && st.out.format === 'jpeg') st.out.format = 'png';
    if (!retune) {
      if (r.share < 0.01) S.toast(seed ? 'لم يُحذف شيء يُذكر — زِد الحساسية' : 'لم أجد خلفية بلون موحّد — زِد الحساسية أو جرّب «بالنقر على اللون»', 'err');
      else if (r.share > 0.97) S.toast('حُذفت الصورة كلها تقريباً — أنقص الحساسية', 'err');
    }
    refresh();
  }

  let tuneTimer = 0;
  const retune = () => { clearTimeout(tuneTimer); tuneTimer = setTimeout(() => runBg(null, true), 140); };

  /* ---------- القص ---------- */
  /** نسبة العرض إلى الارتفاع بالإحداثيات النسبية (0..1) للصورة الحالية؛ 0 = حر */
  function normAspect() {
    if (st.aspect === 'free') return 0;
    const [a, b] = st.aspect.split(':').map(Number), it = cur();
    return (a / b) * (it.cv.height / it.cv.width);
  }
  function defaultCrop() {
    const R = normAspect();
    if (!R) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    let w = 1, h = 1 / R;
    if (h > 1) { h = 1; w = R; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  function cropDrag(e) {
    const rect = el.view.getBoundingClientRect();
    const P = ev => ({ x: clamp((ev.clientX - rect.left) / rect.width, 0, 1), y: clamp((ev.clientY - rect.top) / rect.height, 0, 1) });
    const p0 = P(e), c0 = { ...st.crop }, R = normAspect(), MIN = 0.03;
    const tx = 12 / rect.width, ty = 12 / rect.height;
    let ex = null, ey = null, move = false;
    if (p0.x > c0.x - tx && p0.x < c0.x + c0.w + tx && p0.y > c0.y - ty && p0.y < c0.y + c0.h + ty) {
      if (Math.abs(p0.x - c0.x) < tx) ex = 'l'; else if (Math.abs(p0.x - c0.x - c0.w) < tx) ex = 'r';
      if (Math.abs(p0.y - c0.y) < ty) ey = 't'; else if (Math.abs(p0.y - c0.y - c0.h) < ty) ey = 'b';
      move = !ex && !ey;
    }
    // الطرف الثابت المقابل للحافة المسحوبة؛ والنقر خارج المستطيل يبدأ مستطيلاً جديداً من نقطة النقر
    let ax = ex === 'l' ? c0.x + c0.w : c0.x, ay = ey === 't' ? c0.y + c0.h : c0.y;
    if (!move && !ex && !ey) { ax = p0.x; ay = p0.y; ex = 'r'; ey = 'b'; }
    const midX = c0.x + c0.w / 2, midY = c0.y + c0.h / 2;

    const onMove = ev => {
      const p = P(ev);
      if (move) {
        st.crop = { ...c0, x: clamp(c0.x + p.x - p0.x, 0, 1 - c0.w), y: clamp(c0.y + p.y - p0.y, 0, 1 - c0.h) };
      } else {
        let w = ex ? Math.max(MIN, Math.abs(p.x - ax)) : c0.w, h = ey ? Math.max(MIN, Math.abs(p.y - ay)) : c0.h;
        if (R) {
          if (ex && ey) { if (w / h > R) w = h * R; else h = w / R; }
          else if (ex) { h = Math.min(w / R, 2 * Math.min(midY, 1 - midY)); w = h * R; }
          else { w = Math.min(h * R, 2 * Math.min(midX, 1 - midX)); h = w / R; }
        }
        w = Math.min(w, 1); h = Math.min(h, 1);
        const x = ex ? (p.x < ax ? ax - w : ax) : midX - w / 2, y = ey ? (p.y < ay ? ay - h : ay) : midY - h / 2;
        st.crop = { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h };
      }
      draw();
    };
    const onUp = () => {
      el.view.removeEventListener('pointermove', onMove);
      el.view.removeEventListener('pointerup', onUp);
      el.view.removeEventListener('pointercancel', onUp);
    };
    el.view.setPointerCapture(e.pointerId);
    el.view.addEventListener('pointermove', onMove);
    el.view.addEventListener('pointerup', onUp);
    el.view.addEventListener('pointercancel', onUp);
  }

  function applyCrop() {
    const c = st.crop;
    st.cropping = false;
    if (!c) return refresh();
    return mutate(cv => ImageTools.crop(cv, c.x * cv.width, c.y * cv.height, c.w * cv.width, c.h * cv.height));
  }

  el.view.addEventListener('pointerdown', e => {
    const it = cur();
    if (!it || !it.cv || e.button !== 0) return;
    if (st.cropping) { e.preventDefault(); return cropDrag(e); }
    if (el.view.dataset.mode !== 'pick') return;
    const rect = el.view.getBoundingClientRect();
    runBg({
      x: Math.floor(clamp((e.clientX - rect.left) / rect.width, 0, 0.9999) * it.cv.width),
      y: Math.floor(clamp((e.clientY - rect.top) / rect.height, 0, 0.9999) * it.cv.height),
    });
  });

  /* ================= الحفظ والتحويل ================= */
  function encodeCur() {
    const it = cur(), o = st.out;
    return ImageTools.encode(finalCanvas(it), o.format, o.quality / 100, o.matte);
  }

  async function downloadCur() {
    const it = cur();
    await busy(true);
    try {
      const r = encodeCur();
      ImageTools.download(r.blob, `${baseName(it)}.${r.ext}`);
      S.toast(`تم حفظ الصورة بصيغة ${r.ext.toUpperCase()} (${fmtSize(r.bytes.length)})`, 'ok');
    } catch (e) { console.error(e); S.toast('تعذّر حفظ الصورة: ' + (e.message || e), 'err'); }
    busy(false);
  }

  /** يحوّل كل الصور المفتوحة بإعدادات الحفظ الحالية ويجمعها في ملف ZIP واحد */
  async function downloadAll() {
    const o = st.out, files = [], used = new Set();
    let failed = 0;
    el.busy.hidden = false;
    for (let i = 0; i < st.items.length; i++) {
      const it = st.items[i];
      el.busy.textContent = `جارٍ التحويل ${i + 1} من ${st.items.length}…`;
      await pause(20);
      try {
        const cv = it.cv || await ImageTools.load(it.src); // غير المفتوحة تُقرأ مؤقتاً ولا تبقى في الذاكرة
        const r = ImageTools.encode(finalCanvas(it, cv), o.format, o.quality / 100, o.matte);
        let name = `${baseName(it)}.${r.ext}`;
        for (let k = 2; used.has(name.toLowerCase()); k++) name = `${baseName(it)}-${k}.${r.ext}`;
        used.add(name.toLowerCase());
        files.push({ name, bytes: r.bytes });
      } catch (e) { console.error(e); failed++; }
    }
    el.busy.hidden = true;
    el.busy.textContent = 'جارٍ المعالجة…';
    if (!files.length) return S.toast('تعذّر تحويل الصور', 'err');
    ImageTools.download(new Blob([ImageTools.zip(files)], { type: 'application/zip' }), 'montaji-images.zip');
    S.toast(`تم تحويل ${files.length} صورة` + (failed ? ` (تعذّر فتح ${failed})` : ''), failed ? 'err' : 'ok');
  }

  /** يضع لوحة مكان صورة مقطع في المشروع (يستخدمها المساعد أيضاً). الأصل يبقى في سجل التراجع */
  function setClipImage(clip, cv) {
    clip.el = cv; clip.w = cv.width; clip.h = cv.height;
    clip.thumb = ImageTools.thumb(cv);
  }

  function applyClip() {
    const it = cur(), clip = state.clips.find(c => c.id === st.clipId);
    if (!clip) { S.toast('المقطع لم يعد موجوداً في المشروع', 'err'); return close(); }
    setClipImage(clip, ImageTools.fromSource(finalCanvas(it)));
    close();
    S.refresh(); S.pushHist(); S.renderProps();
    S.toast('تم تحديث الصورة في المشروع', 'ok');
  }

  async function addProject() {
    const it = cur();
    await busy(true);
    try {
      // PNG دائماً: بلا فقدان ويحفظ الشفافية، وحجم الملف لا يهم داخل المشروع
      const r = ImageTools.encode(finalCanvas(it), 'png');
      const file = new File([r.blob], `${baseName(it)}.png`, { type: r.mime });
      busy(false);
      close();
      await S.addFiles([file]);
      S.toast('أُضيفت الصورة إلى المشروع', 'ok');
    } catch (e) { console.error(e); busy(false); S.toast('تعذّرت إضافة الصورة: ' + (e.message || e), 'err'); }
  }

  /** لقطة من المعاينة بدقة 1080 تُفتح في الاستوديو (لصورة مصغّرة للفيديو مثلاً) */
  async function snapshot() {
    layout();
    if (view.total <= 0) return S.toast('أضف صوراً أو مقاطع أولاً', 'err');
    S.pause();
    for (let i = 0; i < 40 && state.clips.some(c => c.type === 'video' && (c.el.seeking || c.el._pend != null)); i++) await pause(40);
    const [W, H] = outputSize(state.ratio, 1080);
    const cv = ImageTools.canvas(W, H);
    Render.frame(cv.getContext('2d'), W, H, view.t);
    if (st.clipId) leaveClip();
    return openCanvas(cv, `لقطة-${view.t.toFixed(1)}ث.png`);
  }

  /* ================= الأحداث ================= */
  el.panel.addEventListener('input', e => {
    const t = e.target, k = t.dataset.k, it = cur();
    if (!k || !it) return;
    if (t.type === 'range') {
      const out = t.parentElement.querySelector('output');
      if (out) out.textContent = t.value + (t.dataset.unit || '');
    }
    const v = t.type === 'checkbox' ? t.checked : t.type === 'range' || t.type === 'number' ? +t.value : t.value;
    if (k === 'bright' || k === 'contrast' || k === 'sat') { it[k] = v; it.edited = true; el.reset.disabled = false; draw(); }
    else if (k === 'tolerance' || k === 'feather' || k === 'contiguous') { st.bg[k] = v; retune(); }
    else if (k === 'fill') { it.fill = st.fillColor = v; it.edited = true; draw(); }
    else if (k === 'quality' || k === 'matte') { st.out[k] = v; scheduleInfo(); }
    else if (k === 'rw' || k === 'rh') {
      // العرض والارتفاع مرتبطان للحفاظ على تناسب الصورة
      const other = el.panel.querySelector(`[data-k="${k === 'rw' ? 'rh' : 'rw'}"]`), r = it.cv.width / it.cv.height;
      if (other && v > 0) other.value = Math.max(1, Math.round(k === 'rw' ? v / r : v * r));
    }
  });

  const acts = {
    rotL: () => mutate(cv => ImageTools.rotate(cv, 270)),
    rotR: () => mutate(cv => ImageTools.rotate(cv, 90)),
    flipH: () => mutate(cv => ImageTools.flip(cv, true)),
    flipV: () => mutate(cv => ImageTools.flip(cv, false)),
    cropStart: () => { st.cropping = true; st.crop = defaultCrop(); refresh(); },
    cropCancel: () => { st.cropping = false; refresh(); },
    cropApply: applyCrop,
    scale: b => mutate(cv => ImageTools.resize(cv, cv.width * b.dataset.v / 100, cv.height * b.dataset.v / 100)),
    resize: () => {
      const w = Math.round(+el.panel.querySelector('[data-k="rw"]').value), h = Math.round(+el.panel.querySelector('[data-k="rh"]').value);
      if (!(w >= 1 && h >= 1 && w <= 16000 && h <= 16000)) return S.toast('اكتب أبعاداً بين 1 و 16000 بكسل', 'err');
      return mutate(cv => (w === cv.width && h === cv.height ? cv : ImageTools.resize(cv, w, h)));
    },
    lookReset: () => { Object.assign(cur(), { filter: 'none', bright: 100, contrast: 100, sat: 100 }); refresh(); },
    bgRun: () => runBg(null),
    download: downloadCur,
    downloadAll,
    applyClip,
    addProject,
  };

  el.panel.addEventListener('click', e => {
    const it = cur();
    if (!it || !it.cv) return;
    const act = e.target.closest('[data-act]');
    if (act) return acts[act.dataset.act] && acts[act.dataset.act](act);
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const k = chip.parentElement.dataset.k, v = chip.dataset.v;
    if (k === 'tab') { st.tab = v; st.cropping = false; }
    else if (k === 'aspect') { st.aspect = v; st.crop = defaultCrop(); }
    else if (k === 'how') st.bg.how = v;
    else if (k === 'fillMode') { it.fill = v === 'color' ? st.fillColor : null; it.edited = true; }
    else if (k === 'filter') { it.filter = v; it.edited = true; }
    else if (k === 'format') st.out.format = v;
    refresh();
  });

  el.strip.addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (x) {
      const i = +x.dataset.x;
      st.items.splice(i, 1);
      if (i < st.cur) { st.cur--; return refresh(); }
      if (i === st.cur) { st.cur = -1; return st.items.length ? setCur(Math.min(i, st.items.length - 1)) : refresh(); }
      return refresh();
    }
    const item = e.target.closest('[data-i]');
    if (item && +item.dataset.i !== st.cur) setCur(+item.dataset.i);
  });

  $('#btnImages').onclick = () => open();
  $('#btnSnap').onclick = snapshot;
  $('#imgOpen').onclick = () => el.file.click();
  $('#imgPick').onclick = () => el.file.click();
  $('#imgClose').onclick = close;
  el.undo.onclick = undo;
  el.reset.onclick = reset;
  el.file.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  el.modal.addEventListener('pointerdown', e => { if (e.target === el.modal) close(); });

  window.addEventListener('keydown', e => {
    if (!isOpen()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' && e.target.type === 'number';
    if (e.key === 'Escape') { if (st.cropping) acts.cropCancel(); else close(); }
    else if (e.key === 'Enter' && st.cropping) applyCrop();
    else if (e.key === 'Enter' && typing) acts.resize();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
  });

  new ResizeObserver(() => { if (isOpen()) draw(); }).observe(el.stage);

  return { open, openClip, openCanvas, addFiles, close, isOpen, snapshot, setClipImage };
})();
