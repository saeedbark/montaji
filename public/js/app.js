'use strict';
/* واجهة المحرر: الاستيراد، المعاينة، الخط الزمني، الخصائص، التصدير */

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const els = {
    canvas: $('#preview'), wrap: $('#canvasWrap'), empty: $('#empty'), props: $('#props'),
    tlScroll: $('#tlScroll'), tlInner: $('#tlInner'), tlRows: $('#tlRows'),
    playhead: $('#playhead'), dropMark: $('#dropMark'),
    time: $('#timeLabel'), playIcon: $('#playIcon'), zoom: $('#zoom'), ratio: $('#ratio'),
    fileMedia: $('#fileMedia'), fileMusic: $('#fileMusic'), toasts: $('#toasts'), busy: $('#busy'),
    btnUndo: $('#btnUndo'), btnRedo: $('#btnRedo'), dropOverlay: $('#dropOverlay'),
    btnProps: $('#btnProps'),
  };
  const pctx = els.canvas.getContext('2d');
  // عرض أسماء المسارات يحدده CSS (‎--label-w‎) ويضيق على الهاتف
  let LABEL_W = 76;
  const readLabelW = () => { LABEL_W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--label-w')) || 76; };
  readLabelW();

  /* على الهاتف لوحة الخصائص درج سفلي يُفتح عند الطلب (انظر «الهاتف» في style.css) */
  const sheetMode = window.matchMedia('(max-width: 640px)');
  function setSheet(on) {
    on = !!on && sheetMode.matches;
    document.body.classList.toggle('props-open', on);
    els.btnProps.setAttribute('aria-expanded', String(on));
  }
  const sheetOpen = () => document.body.classList.contains('props-open');
  sheetMode.addEventListener('change', () => setSheet(false));
  let dirty = true;
  let lastTs = 0;

  /* ================= إشعارات ================= */
  function toast(msg, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = msg;
    els.toasts.append(d);
    setTimeout(() => d.classList.add('out'), 3400);
    setTimeout(() => d.remove(), 3900);
  }

  /* ================= التراجع والإعادة ================= */
  const hist = { stack: [], idx: -1, timer: null };
  const snap = () => ({
    name: state.name,
    ratio: state.ratio,
    clips: state.clips.map(c => ({ ...c })),
    overlays: state.overlays.map(o => ({ ...o })),
    audios: state.audios.map(a => ({ ...a })),
    texts: state.texts.map(x => ({ ...x })),
    effects: state.effects.map(x => ({ ...x })),
    captions: copyCaptions(state.captions),
  });
  // kf و words لا يُعدَّلان في مكانهما أبداً (يُستبدلان بكائن جديد)، فتكفي النسخة السطحية لكل عنصر
  function copyCaptions(c) {
    return { lang: c.lang || '', style: { ...CAPTION_STYLE, ...c.style }, items: (c.items || []).map(it => ({ ...it })) };
  }
  function pushHist() {
    clearTimeout(hist.timer); hist.timer = null;
    hist.stack.length = hist.idx + 1;
    hist.stack.push(snap());
    if (hist.stack.length > 80) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    updateHistButtons();
  }
  function commit() { clearTimeout(hist.timer); hist.timer = setTimeout(pushHist, 350); }
  function restore(s) {
    pauseAllMedia();
    state.name = s.name || '';
    state.ratio = s.ratio;
    state.clips = s.clips.map(c => ({ ...c }));
    state.audios = s.audios.map(a => ({ ...a }));
    state.texts = s.texts.map(x => ({ ...x }));
    state.effects = (s.effects || []).map(x => ({ ...x }));
    state.overlays = (s.overlays || []).map(o => ({ ...o }));
    state.captions = copyCaptions(s.captions || emptyCaptions());
    if (!selObj()) state.sel = null;
    els.ratio.value = state.ratio;
    applyRatio();
    refresh();
    renderProps();
    updateHistButtons();
  }
  function undo() { if (hist.timer) pushHist(); if (hist.idx <= 0) return; hist.idx--; restore(hist.stack[hist.idx]); }
  function redo() { if (hist.timer) pushHist(); if (hist.idx >= hist.stack.length - 1) return; hist.idx++; restore(hist.stack[hist.idx]); }
  function updateHistButtons() {
    els.btnUndo.disabled = hist.idx <= 0;
    els.btnRedo.disabled = hist.idx >= hist.stack.length - 1;
  }

  /* ================= أدوات الحالة ================= */
  function selObj() {
    const s = state.sel;
    if (!s) return null;
    return listOf(s.kind).find(o => o.id === s.id) || null;
  }
  const listOf = kind => (kind === 'clip' ? state.clips : kind === 'overlay' ? state.overlays : kind === 'audio' ? state.audios
    : kind === 'effect' ? state.effects : kind === 'caption' ? state.captions.items : state.texts);
  const setList = (kind, arr) => {
    if (kind === 'clip') state.clips = arr; else if (kind === 'overlay') state.overlays = arr; else if (kind === 'audio') state.audios = arr;
    else if (kind === 'effect') state.effects = arr; else if (kind === 'caption') state.captions.items = arr; else state.texts = arr;
  };
  const isEmpty = () => !state.clips.length && !state.overlays.length && !state.audios.length && !state.texts.length && !state.effects.length;
  /** الزمن المحلي للمؤشر داخل العنصر (لقراءة الإطارات المفتاحية وكتابتها) */
  const ltOf = (kind, obj) => clamp(view.t - itemStart(kind, obj), 0, Math.max(0, itemLen(kind, obj)));

  /** إعادة حساب وعرض كل ما يتأثر بتغيّر المشروع (دون تسجيل في سجل التراجع) */
  function refresh() {
    layout();
    view.t = clamp(view.t, 0, view.total);
    if (view.playing && view.total <= 0) view.playing = false;
    renderTimeline();
    syncMedia();
    updateTransport();
    els.empty.hidden = !isEmpty();
    dirty = true;
    document.title = state.name ? `${state.name} — مونتاجي` : 'مونتاجي';
    const info = $('#projInfo');
    if (info) info.innerHTML = projectInfo();
    document.dispatchEvent(new Event('studio:change'));
  }
  function touch() { refresh(); commit(); }
  function setRatio(r) { state.ratio = r; els.ratio.value = r; applyRatio(); }

  function applyRatio() {
    const [w, h] = outputSize(state.ratio, 720);
    els.canvas.width = w; els.canvas.height = h;
    els.wrap.style.setProperty('--ar', w / h); // تملأ به المعاينة مساحتها (style.css)
    dirty = true;
  }

  /* ================= استيراد الملفات ================= */
  const lookDefaults = () => ({ filter: 'none', bright: 100, contrast: 100, sat: 100, fit: 'blur', motion: 'none', transition: 'none' });

  function createVideo(url) {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.playsInline = true;
    v.src = url;
    v.addEventListener('seeked', () => {
      if (v._pend != null) { const p = v._pend; v._pend = null; softSeek(v, p); }
      dirty = true;
    });
    v.addEventListener('loadeddata', () => {
      // تحريك بسيط يضمن أن الإطار الأول مرسوم فعلاً قبل استخدامه
      if (v.currentTime === 0 && !v.seeking) v.currentTime = 0.001;
      dirty = true;
    });
    return v;
  }
  const loadVideo = url => new Promise((res, rej) => {
    const v = createVideo(url);
    v.addEventListener('loadeddata', () => res(v), { once: true });
    v.addEventListener('error', () => rej(new Error('تعذّر قراءة الفيديو')), { once: true });
  });

  async function videoDuration(v) {
    if (isFinite(v.duration) && v.duration > 0) return v.duration;
    // بعض الملفات (مثل تسجيلات webm) لا تحمل مدتها — نجبر المتصفح على حسابها
    await new Promise(r => {
      const h = () => { if (isFinite(v.duration)) { v.removeEventListener('durationchange', h); r(); } };
      v.addEventListener('durationchange', h);
      v.currentTime = 1e7;
      setTimeout(r, 4000);
    });
    await seekExact(v, 0);
    return isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
  }

  async function videoThumb(v, at) {
    await seekExact(v, at);
    const cv = document.createElement('canvas');
    cv.height = 96;
    cv.width = Math.max(32, Math.round(96 * v.videoWidth / v.videoHeight));
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.7);
  }

  function waveform(buf) {
    const W = Math.round(clamp(buf.duration * 30, 240, 3600)), H = 44;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / W));
    g.fillStyle = 'rgba(46, 224, 178, .75)';
    for (let x = 0; x < W; x += 2) {
      let peak = 0;
      const s = x * step;
      for (let i = 0; i < step * 2; i += 8) { const v = Math.abs(data[s + i] || 0); if (v > peak) peak = v; }
      const h = Math.max(1.5, peak * (H - 6));
      g.fillRect(x, (H - h) / 2, 1.4, h);
    }
    return cv.toDataURL('image/png');
  }

  // دوال make تبني العنصر من ملفه دون وضعه في المشروع: يستعملها الاستيراد وفتح مشروع محفوظ
  async function makeImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('تعذّر قراءة الصورة'));
      img.src = url;
    });
    return {
      id: uid(), type: 'image', name: file.name, url, file, el: img,
      w: img.naturalWidth, h: img.naturalHeight, srcDur: Infinity,
      in: 0, out: 4, speed: 1, volume: 1, muted: true, thumb: url, ...lookDefaults(),
    };
  }

  async function makeVideo(file) {
    const url = URL.createObjectURL(file);
    const v = await loadVideo(url);
    if (!v.videoWidth) { URL.revokeObjectURL(url); return makeAudio(file); } // ملف صوتي داخل حاوية فيديو
    const dur = await videoDuration(v);
    const thumb = await videoThumb(v, Math.min(0.5, dur / 3));
    await seekExact(v, 0);
    return {
      id: uid(), type: 'video', name: file.name, url, file, el: v,
      w: v.videoWidth, h: v.videoHeight, srcDur: dur,
      in: 0, out: dur, speed: 1, volume: 1, muted: false, thumb, ...lookDefaults(),
    };
  }

  async function makeAudio(file) {
    const buf = await decodeAudioFile(file);
    const url = URL.createObjectURL(file);
    const el = new Audio(url);
    el.preload = 'auto';
    layout();
    const start = state.audios.length ? clamp(view.t, 0, Math.max(0, view.total - 0.5)) : 0;
    const item = {
      id: uid(), name: file.name, url, file, el, buf, srcDur: buf.duration,
      start, in: 0, out: buf.duration, volume: 0.8, fadeIn: 0, fadeOut: 1.5, wave: waveform(buf),
    };
    Beats.ensure(item); // الإيقاع يُحسب مرة واحدة عند الإضافة
    return item;
  }
  const makers = { image: makeImage, video: makeVideo, audio: makeAudio };
  // العنصر الذي له buf صوت (ولو جاء من حاوية فيديو)، وغيره مقطع على المسار الرئيسي
  const isAudioItem = it => !!it.buf;

  const kindOf = f => {
    const t = f.type || '';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
    return null;
  };

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    // ملف مشروع محفوظ (بالسحب والإفلات مثلاً): يُفتح مكان المشروع الحالي
    const saved = files.find(f => ProjectIO.isProjectFile(f));
    if (saved) return ProjectIO.open(saved);
    const wasEmpty = isEmpty();
    els.busy.hidden = false;
    let added = 0;
    for (const f of files) {
      try {
        const k = kindOf(f);
        if (!k) { toast(`نوع الملف غير مدعوم: ${f.name}`, 'err'); continue; }
        const it = await makers[k](f);
        (isAudioItem(it) ? state.audios : state.clips).push(it);
        added++;
        refresh();
      } catch (e) {
        console.error(e);
        toast(`تعذّر فتح الملف: ${f.name}`, 'err');
      }
    }
    els.busy.hidden = true;
    if (added) {
      touch();
      if (wasEmpty || view.total * view.pps > els.tlScroll.clientWidth * 3) fitTimeline();
      renderProps();
    }
  }

  /**
   * يستبدل المشروع الحالي بمشروع محفوظ، خطوةَ تراجع واحدة (Ctrl+Z يعيد ما كان مفتوحاً).
   * data من ProjectTools.normalize، و files: معرّف الوسيط ← File.
   * الملف المشترك بين عدة مقاطع (بعد تقسيم أو تكرار) يُقرأ مرة واحدة ثم يُنسخ عنصره.
   * ← أسماء العناصر التي تعذّر تحميل ملفها فتُركت
   */
  async function loadProject(data, files, onProgress) {
    if (view.exporting) throw new Error('انتظر انتهاء التصدير أولاً');
    const templates = new Map(), skipped = new Set();
    const wanted = new Set([...data.clips, ...(data.overlays || []), ...data.audios].map(o => o.media));
    let done = 0;
    const build = async (rec, kind) => {
      let it = null, tpl = templates.get(rec.media);
      if (tpl === undefined) {
        const f = files.get(rec.media);
        try { if (f) it = await makers[kind === 'audio' ? 'audio' : rec.type](f); } catch (e) { console.error(e); }
        if (it && isAudioItem(it) !== (kind === 'audio')) it = null; // ملف لم يعد من النوع المحفوظ
        templates.set(rec.media, it && { ...it });
        if (onProgress) onProgress(++done, wanted.size);
      } else if (tpl) it = cloneItem(kind === 'audio' ? 'audio' : 'clip', tpl);
      if (!it) { skipped.add(rec.name || rec.media); return null; }
      const { media, type, ...props } = rec;
      return Object.assign(it, props);
    };

    const clips = [], audios = [];
    for (const rec of data.clips) {
      const c = await build(rec, 'clip');
      if (!c) continue;
      if (c.type === 'video') {
        c.in = clamp(c.in, 0, Math.max(0, c.srcDur - MIN_LEN));
        c.out = clamp(c.out, c.in + MIN_LEN * c.speed, c.srcDur);
      } else { c.in = 0; c.out = clamp(c.out, MIN_LEN, 120); }
      clips.push(c);
    }
    const overlays = [];
    for (const rec of data.overlays || []) {
      const made = await build({ ...rec }, 'overlay');
      if (!made) continue;
      const o = { ...asOverlay(made, rec.start), ...rec, id: made.id };
      delete o.media;
      if (o.type === 'video') {
        o.in = clamp(o.in, 0, Math.max(0, o.srcDur - MIN_LEN));
        o.out = clamp(o.out, o.in + MIN_LEN * o.speed, o.srcDur);
      } else { o.in = 0; o.out = clamp(o.out, MIN_LEN, 600); o.speed = 1; }
      if (rec.kf) o.kf = rec.kf;
      overlays.push(o);
    }
    for (const rec of data.audios) {
      const a = await build(rec, 'audio');
      if (!a) continue;
      a.in = clamp(a.in, 0, Math.max(0, a.srcDur - MIN_LEN));
      a.out = clamp(a.out, a.in + MIN_LEN, a.srcDur);
      audios.push(a);
    }

    if (view.playing) pause();
    pauseAllMedia();
    state.name = data.name || '';
    state.clips = clips;
    state.audios = audios;
    state.texts = data.texts.map(x => ({ ...x }));
    state.effects = data.effects.map(x => ({ ...x }));
    state.overlays = overlays;
    state.captions = copyCaptions(data.captions || emptyCaptions());
    state.sel = null;
    setRatio(data.ratio);
    view.t = 0;
    refresh();
    pushHist();
    fitTimeline();
    renderProps();
    return [...skipped];
  }

  /* ---------- الطبقات ---------- */
  /** أدنى صف لا تتداخل فيه الطبقة زمنياً مع غيرها */
  function freeTrack(start, len, except) {
    for (let tr = 0; tr < 20; tr++) {
      if (!state.overlays.some(o => o !== except && (o.track || 0) === tr && start < o.start + overlayLen(o) - 1e-6 && o.start < start + len - 1e-6)) return tr;
    }
    return 20;
  }

  /** يحوّل عنصراً بنته دوال make (صورة أو فيديو) إلى طبقة بخصائصها الافتراضية */
  function asOverlay(it, start) {
    const o = {
      id: it.id, type: it.type, name: it.name, url: it.url, file: it.file, el: it.el, w: it.w, h: it.h, srcDur: it.srcDur, thumb: it.thumb,
      start: Math.max(0, start || 0), in: it.in, out: it.out, speed: it.speed || 1, track: 0,
      x: 0.5, y: 0.5, scale: 0.4, rot: 0, opacity: 1,
      mask: 'none', radius: 0.08, border: 0, borderColor: '#ffffff', shadow: false, blend: 'normal',
      filter: it.filter || 'none', anim: 'none', volume: it.volume != null ? it.volume : 1, muted: !!it.muted,
    };
    // الصورة الطويلة جداً لا تخرج من الإطار: يُضبط العرض كي لا يتجاوز ارتفاعها 70% منه
    const [W, H] = outputSize(state.ratio, 720);
    o.scale = +Math.min(0.4, 0.7 * H * o.w / (o.h * W)).toFixed(3);
    return o;
  }

  /** طبقة ← مقطع في المسار الرئيسي */
  const asClip = o => ({
    id: o.id, type: o.type, name: o.name, url: o.url, file: o.file, el: o.el, w: o.w, h: o.h, srcDur: o.srcDur, thumb: o.thumb,
    in: o.in, out: o.out, speed: o.speed || 1, volume: o.volume, muted: o.type === 'image' ? true : o.muted,
    ...lookDefaults(), filter: o.filter || 'none',
  });

  async function addOverlayFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return [];
    els.busy.hidden = false;
    layout();
    const made = [];
    for (const f of files) {
      try {
        const k = kindOf(f);
        if (k !== 'image' && k !== 'video') { toast(`الطبقة صورة أو فيديو فقط: ${f.name}`, 'err'); continue; }
        const it = await makers[k](f);
        if (isAudioItem(it)) { toast(`الملف صوت بلا صورة: ${f.name}`, 'err'); continue; }
        const o = asOverlay(it, clamp(view.t, 0, Math.max(0, view.total - 0.5)));
        if (o.type === 'image' && view.total > 0) o.out = clamp(view.total - o.start, 1, 4);
        o.track = freeTrack(o.start, overlayLen(o));
        state.overlays.push(o);
        made.push(o);
      } catch (e) {
        console.error(e);
        toast(`تعذّر فتح الملف: ${f.name}`, 'err');
      }
    }
    els.busy.hidden = true;
    if (made.length) {
      state.sel = { kind: 'overlay', id: made[made.length - 1].id };
      touch();
      renderProps();
    }
    return made;
  }

  /** ينقل مقطعاً من المسار الرئيسي إلى طبقة فوقه في الموضع نفسه */
  function toOverlay(clip) {
    layout();
    const o = asOverlay(clip, clip._start);
    if (clip.kf) { const kf = {}; for (const k of ['opacity', 'volume']) if (clip.kf[k]) kf[k] = clip.kf[k]; if (Object.keys(kf).length) o.kf = kf; }
    state.clips = state.clips.filter(c => c !== clip);
    for (const e of state.effects) if (e.at === clip.id) e.at = null;
    layout();
    o.track = freeTrack(o.start, overlayLen(o));
    state.overlays.push(o);
    return o;
  }

  /** ينقل طبقة إلى المسار الرئيسي، قبل المقطع الذي يُعرض عند بدايتها */
  function toMain(o) {
    layout();
    const c = asClip(o);
    if (o.kf) { const kf = {}; for (const k of ['opacity', 'volume']) if (o.kf[k]) kf[k] = o.kf[k]; if (Object.keys(kf).length) c.kf = kf; }
    state.overlays = state.overlays.filter(x => x !== o);
    let at = state.clips.findIndex(k => k._start + clipLen(k) / 2 > o.start);
    if (at < 0) at = state.clips.length;
    state.clips.splice(at, 0, c);
    layout();
    return c;
  }

  function addText() {
    layout();
    const start = clamp(view.t, 0, Math.max(0, view.total - 0.5));
    const dur = view.total > 0 ? clamp(view.total - start, 1, 3) : 3;
    const tx = {
      id: uid(), text: 'اكتب نصك هنا', start, dur,
      x: 0.5, y: 0.82, size: 0.08, color: '#ffffff', font: 'segoe', bold: true,
      stroke: true, strokeColor: '#000000', bg: false, bgColor: '#000000', shadow: true, anim: 'fade',
    };
    state.texts.push(tx);
    state.sel = { kind: 'text', id: tx.id };
    touch();
    renderProps();
    setSheet(true);
    const ta = $('textarea', els.props);
    if (ta) { ta.focus(); ta.select(); }
  }

  /** تأثير جديد عند المؤشر: إن كان المؤشر قريباً من قطع يُوضع متمركزاً عليه ومربوطاً به */
  function addEffect(type = 'zoomBlur') {
    layout();
    const def = Render.EFFECTS[type];
    const fx = { id: uid(), type, start: 0, dur: def.dur, amount: 1, at: null, atMode: 'cut', x: 0.5, y: 0.5, r: 0.3, w: 0.4, h: 0.2 };
    const near = state.clips.slice(1).find(c => Math.abs(c._start - view.t) < 0.35);
    if (near && def.shape === 'burst') fx.at = near.id;
    else fx.start = clamp(view.t, 0, Math.max(0, view.total - 0.2));
    state.effects.push(fx);
    state.sel = { kind: 'effect', id: fx.id };
    touch();
    renderProps();
    setSheet(true);
  }

  /* ================= مزامنة التشغيل ================= */
  function softSeek(v, time) {
    const max = isFinite(v.duration) ? Math.max(0, v.duration - 0.03) : time;
    time = clamp(time, 0, max);
    if (Math.abs(v.currentTime - time) < 0.02) { v._pend = null; return; }
    if (v.seeking) { v._pend = time; return; }
    v.currentTime = time;
  }

  function pauseAllMedia() {
    for (const c of state.clips) if (c.type === 'video' && !c.el.paused) c.el.pause();
    for (const o of state.overlays) if (o.type === 'video' && !o.el.paused) o.el.pause();
    for (const a of state.audios) if (!a.el.paused) a.el.pause();
  }

  // أقصى عدد لفيديوهات الطبقات التي تُشغَّل معاً في المعاينة (التصدير لا حدّ له)
  const MAX_LIVE = 4;
  let warnedLive = false;
  function syncOverlays(t) {
    let active = 0;
    for (const o of state.overlays) {
      if (o.type !== 'video') continue;
      const v = o.el, lt = t - o.start, on = lt >= 0 && lt < overlayLen(o);
      if (on && ++active > MAX_LIVE) {
        if (!v.paused) v.pause();
        if (!warnedLive) { warnedLive = true; toast(`أكثر من ${MAX_LIVE} فيديوهات فوق بعضها: المعاينة تشغّل ${MAX_LIVE} منها فقط، والتصدير يشملها كلها`, 'err'); }
        continue;
      }
      if (!on) {
        if (!v.paused) v.pause();
        if (lt < 0 && lt > -1.5) softSeek(v, o.in); // تجهيز الإطار الأول قبل ظهور الطبقة
        continue;
      }
      const want = o.in + lt * o.speed;
      v.muted = o.muted;
      v.volume = clamp(prop(o, 'volume', lt), 0, 1);
      if (v.playbackRate !== o.speed) v.playbackRate = o.speed;
      if (view.playing && t < view.total) {
        if (v.paused) {
          if (Math.abs(v.currentTime - want) > 0.08) v.currentTime = want;
          v.play().catch(() => {});
        } else if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
      } else {
        if (!v.paused) v.pause();
        softSeek(v, Math.min(want, o.out));
      }
    }
  }

  function syncMedia() {
    if (view.exporting) return;
    const t = view.t, cs = state.clips;
    const i = clipIndexAt(t);
    const live = t < view.total;
    const mainLive = t < view.main; // بعد نهاية المسار الرئيسي (طبقة تتجاوزه) يتوقف آخر مقطع
    syncOverlays(t);
    cs.forEach((c, k) => {
      if (c.type !== 'video') return;
      const v = c.el;
      if (k === i) {
        const want = c.in + (t - c._start) * c.speed;
        v.muted = c.muted;
        v.volume = clamp(prop(c, 'volume', t - c._start), 0, 1);
        if (v.playbackRate !== c.speed) v.playbackRate = c.speed;
        if (view.playing && mainLive) {
          if (v.paused) {
            if (Math.abs(v.currentTime - want) > 0.08) v.currentTime = want;
            v.play().catch(() => {});
          } else if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
        } else {
          if (!v.paused) v.pause();
          softSeek(v, Math.min(want, c.out));
        }
      } else {
        if (!v.paused) v.pause();
        if (k === i - 1) { if (t - cs[i]._start < trDur(cs[i])) softSeek(v, c.out - 0.04); }
        else if (k === i + 1) softSeek(v, c.in);
      }
    });
    for (const a of state.audios) {
      const el = a.el, lt = t - a.start;
      const on = view.playing && live && lt >= 0 && lt < audioLen(a);
      if (on) {
        const want = a.in + lt;
        el.volume = clamp(audioGain(a, lt), 0, 1);
        if (el.paused) { el.currentTime = want; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
      } else if (!el.paused) el.pause();
    }
  }

  function play() {
    if (view.total <= 0) return;
    if (view.t >= view.total - 0.03) view.t = 0;
    view.playing = true;
    lastTs = performance.now();
    syncMedia();
    els.playIcon.setAttribute('href', '#i-pause');
    dirty = true;
  }
  function pause() {
    view.playing = false;
    syncMedia();
    syncKfInputs();
    els.playIcon.setAttribute('href', '#i-play');
    dirty = true;
  }
  const togglePlay = () => (view.playing ? pause() : play());

  function setTime(t) {
    view.t = clamp(t, 0, view.total);
    syncMedia();
    updateTransport();
    syncKfInputs();
    dirty = true;
  }

  function updateTransport() {
    els.playhead.style.left = (LABEL_W + view.t * view.pps) + 'px';
    els.time.textContent = `${fmtTime(view.t)} / ${fmtTime(view.total)}`;
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (view.exporting) return;
    if (view.playing) {
      view.t += Math.min(0.25, (ts - lastTs) / 1000);
      lastTs = ts;
      if (view.t >= view.total) { view.t = view.total; pause(); }
      else syncMedia();
      updateTransport();
      // إبقاء المؤشر ظاهراً أثناء التشغيل
      const x = LABEL_W + view.t * view.pps, sc = els.tlScroll;
      if (x > sc.scrollLeft + sc.clientWidth - 30 || x < sc.scrollLeft + LABEL_W) sc.scrollLeft = x - LABEL_W - 40;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      const selText = !view.playing && state.sel && state.sel.kind === 'text' ? state.sel.id : null;
      const selFx = !view.playing && state.sel && state.sel.kind === 'effect' ? state.sel.id : null;
      const selOverlay = !view.playing && state.sel && state.sel.kind === 'overlay' ? state.sel.id : null;
      const selCaption = !view.playing && state.sel && state.sel.kind === 'caption';
      Render.frame(pctx, els.canvas.width, els.canvas.height, view.t, { selText, selFx, selOverlay, selCaption });
    }
  }

  /* ================= الخط الزمني ================= */
  function assignLanes(items, lenOf) {
    const ends = [];
    for (const it of [...items].sort((a, b) => a.start - b.start)) {
      let l = ends.findIndex(e => e <= it.start + 1e-6);
      if (l < 0) { l = ends.length; ends.push(0); }
      ends[l] = it.start + lenOf(it);
      it._lane = l;
    }
    return Math.max(1, ends.length);
  }

  function renderTimeline() {
    const pps = view.pps, total = view.total;
    let maxEnd = total;
    for (const a of state.audios) maxEnd = Math.max(maxEnd, a.start + audioLen(a));
    for (const x of state.texts) maxEnd = Math.max(maxEnd, x.start + x.dur);
    for (const x of state.effects) maxEnd = Math.max(maxEnd, x.start + x.dur);
    for (const x of state.captions.items) maxEnd = Math.max(maxEnd, x.end);
    const W = Math.max(els.tlScroll.clientWidth - LABEL_W - 2, (maxEnd + 3) * pps);
    const sel = state.sel;
    const isSel = (kind, id) => (sel && sel.kind === kind && sel.id === id ? ' sel' : '');
    // نقاط الإطارات المفتاحية على العنصر: النقر ينقل المؤشر إليها والسحب يغيّر وقتها
    const dots = o => kfTimes(o).map(t => `<i class="kf" data-kt="${t}" style="left:${t * pps}px" title="إطار مفتاحي"></i>`).join('');

    // الترجمة: صف واحد، يظهر حين توجد كتل
    const CL = 26;
    const caps = state.captions.items.map(x =>
      `<div class="item caption${isSel('caption', x.id)}" data-kind="caption" data-id="${x.id}" style="left:${x.start * pps}px;width:${Math.max(6, (x.end - x.start) * pps - 1)}px;height:${CL}px">
        <span class="name">${esc(x.text)}</span><i class="h l"></i><i class="h r"></i></div>`).join('');

    // الطبقات: كل صف track، والأعلى يُرسم فوق
    const OL = 40;
    const maxTrack = state.overlays.reduce((m, o) => Math.max(m, o.track || 0), 0);
    const overlays = state.overlays.map(o => {
      const len = overlayLen(o);
      return `<div class="item overlay ${o.type}${isSel('overlay', o.id)}" data-kind="overlay" data-id="${o.id}" style="left:${o.start * pps}px;width:${Math.max(6, len * pps)}px;top:${(maxTrack - (o.track || 0)) * (OL + 4)}px;height:${OL}px">
        <div class="thumbs" style="background-image:url('${o.thumb}')"></div>${dots(o)}
        <span class="name">${esc(o.name)}</span><i class="h l"></i><i class="h r"></i></div>`;
    }).join('');

    // المسطرة
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => s * pps >= 68) || 600;
    let ticks = '';
    for (let t = 0; t * pps < W; t += step) ticks += `<span class="tick" style="left:${t * pps}px">${fmtTime(t).replace(/\.0$/, '')}</span>`;

    // النصوص
    const TL = 30, AL = 40;
    const tLanes = assignLanes(state.texts, x => x.dur);
    const texts = state.texts.map(x =>
      `<div class="item text${isSel('text', x.id)}" data-kind="text" data-id="${x.id}" style="left:${x.start * pps}px;width:${Math.max(6, x.dur * pps)}px;top:${x._lane * (TL + 4)}px;height:${TL}px">
        ${dots(x)}<span class="name">${esc(x.text.split('\n')[0] || 'نص')}</span><i class="h l"></i><i class="h r"></i></div>`).join('');

    // المقاطع
    const clips = state.clips.map(c => {
      const len = clipLen(c);
      return `<div class="item clip ${c.type}${isSel('clip', c.id)}" data-kind="clip" data-id="${c.id}" style="left:${c._start * pps}px;width:${Math.max(6, len * pps - 2)}px">
        <div class="thumbs" style="background-image:url('${c.thumb}')"></div>
        ${c.transition !== 'none' ? '<span class="tr-badge" title="انتقال">⇄</span>' : ''}${dots(c)}
        <span class="name">${esc(c.name)}</span><span class="dur">${len.toFixed(1)}ث</span><i class="h l"></i><i class="h r"></i></div>`;
    }).join('');

    // التأثيرات
    const EL = 26;
    const eLanes = assignLanes(state.effects, x => x.dur);
    const effects = state.effects.map(x =>
      `<div class="item effect${x.at ? ' anchored' : ''}${isSel('effect', x.id)}" data-kind="effect" data-id="${x.id}" title="${x.at ? 'مربوط بالقطع: يتبعه عند تغيير التوقيت' : ''}" style="left:${x.start * pps}px;width:${Math.max(6, x.dur * pps)}px;top:${x._lane * (EL + 4)}px;height:${EL}px">
        ${dots(x)}<span class="name">${esc((Render.EFFECTS[x.type] || {}).label || x.type)}</span><i class="h l"></i><i class="h r"></i></div>`).join('');

    // الموسيقى
    const aLanes = assignLanes(state.audios, audioLen);
    const audios = state.audios.map(a => {
      const len = audioLen(a);
      // علامات الضربات (الأطول = بداية المازورة) — تُخفى إن تزاحمت
      const b = a.beats;
      const marks = b && b.period * pps >= 5 ? b.beats.filter(x => x.t >= a.in && x.t < a.out)
        .map(x => `<i class="beat${x.down ? ' down' : ''}" style="left:${(x.t - a.in) * pps}px"></i>`).join('') : '';
      return `<div class="item audio${isSel('audio', a.id)}" data-kind="audio" data-id="${a.id}" style="left:${a.start * pps}px;width:${Math.max(6, len * pps)}px;top:${a._lane * (AL + 4)}px;height:${AL}px;background-image:url('${a.wave}');background-size:${a.srcDur * pps}px 100%;background-position:${-a.in * pps}px 0">
        ${marks}${dots(a)}<span class="name">${esc(a.name)}</span><i class="h l"></i><i class="h r"></i></div>`;
    }).join('');

    els.tlRows.innerHTML =
      `<div class="tl-ruler"><div class="tl-label"></div><div class="tl-lane" style="width:${W}px">${ticks}</div></div>
       ${caps ? `<div class="tl-track caption"><div class="tl-label">الترجمة</div><div class="tl-lane" style="width:${W}px;height:${CL}px">${caps}</div></div>` : ''}
       <div class="tl-track text"><div class="tl-label">النصوص</div><div class="tl-lane" style="width:${W}px;height:${tLanes * (TL + 4) - 4}px">${texts || '<span class="tl-hint">اضغط «نص» لإضافة عنوان أو تعليق</span>'}</div></div>
       ${overlays ? `<div class="tl-track overlay"><div class="tl-label">الطبقات</div><div class="tl-lane" style="width:${W}px;height:${(maxTrack + 1) * (OL + 4) - 4}px">${overlays}</div></div>` : ''}
       <div class="tl-track main"><div class="tl-label">المقاطع</div><div class="tl-lane" style="width:${W}px">${clips || '<span class="tl-hint">ارفع صوراً أو مقاطع فيديو لتظهر هنا</span>'}</div></div>
       <div class="tl-track effect"><div class="tl-label">التأثيرات</div><div class="tl-lane" style="width:${W}px;height:${eLanes * (EL + 4) - 4}px">${effects || '<span class="tl-hint">اضغط «تأثير» لإضافة تكبير ضبابي أو وميض أو أبيض وأسود</span>'}</div></div>
       <div class="tl-track audio"><div class="tl-label">الموسيقى</div><div class="tl-lane" style="width:${W}px;height:${aLanes * (AL + 4) - 4}px">${audios || '<span class="tl-hint">اضغط «موسيقى» لإضافة مقطع صوتي</span>'}</div></div>
       ${total > 0 ? `<div class="tl-end" style="left:${LABEL_W + total * pps}px;right:0"></div>` : ''}`;
    els.tlInner.style.width = (LABEL_W + W) + 'px';
    updateTransport();
  }

  function fitTimeline() {
    layout();
    if (view.total <= 0) return;
    view.pps = clamp((els.tlScroll.clientWidth - LABEL_W - 40) / view.total, 8, 220);
    els.zoom.value = view.pps;
    renderTimeline();
    els.tlScroll.scrollLeft = 0;
  }

  let kfSel = null; // آخر نقطة إطار مفتاحي نُقرت في الخط الزمني { id, t }: يحذفها Delete

  function select(sel) {
    state.sel = sel;
    kfSel = null;
    els.tlRows.querySelectorAll('.item.sel').forEach(n => n.classList.remove('sel'));
    if (sel) {
      const n = els.tlRows.querySelector(`.item[data-id="${sel.id}"]`);
      if (n) n.classList.add('sel');
    }
    renderProps();
    dirty = true;
  }

  const timeAtX = clientX => (clientX - els.tlInner.getBoundingClientRect().left - LABEL_W) / view.pps;

  function dragSession(move, up) {
    const m = ev => move(ev);
    const u = ev => {
      window.removeEventListener('pointermove', m);
      window.removeEventListener('pointerup', u);
      window.removeEventListener('pointercancel', u);
      up && up(ev);
    };
    window.addEventListener('pointermove', m);
    window.addEventListener('pointerup', u);
    window.addEventListener('pointercancel', u);
  }

  function snapTime(t, exclude) {
    const cands = [0, view.t, view.total];
    for (const c of state.clips) cands.push(c._start);
    let best = t, bd = 7 / view.pps;
    for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  els.tlInner.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const itemEl = e.target.closest('.item');
    if (!itemEl) {
      if (e.target.closest('.tl-label')) return;
      if (!e.target.closest('.tl-ruler') && state.sel) select(null);
      if (view.playing) pause();
      setTime(timeAtX(e.clientX));
      dragSession(ev => setTime(timeAtX(ev.clientX)));
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const kind = itemEl.dataset.kind, id = itemEl.dataset.id;
    // على الهاتف: اللمسة الأولى تحدد العنصر، ولمسه ثانيةً دون سحب يفتح خصائصه
    const again = !!state.sel && state.sel.kind === kind && state.sel.id === id;
    select({ kind, id });
    const obj = selObj();
    if (!obj) return;
    const handle = e.target.classList.contains('h') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
    const x0 = e.clientX, y0 = e.clientY, o = { ...obj };
    let moved = false;
    const live = () => { layout(); renderTimeline(); syncMedia(); dirty = true; };

    // نقطة إطار مفتاحي: النقر ينقل المؤشر إليها، والسحب يغيّر وقتها داخل العنصر
    if (e.target.classList.contains('kf')) {
      const kt0 = +e.target.dataset.kt, kf0 = obj.kf, base = itemStart(kind, obj), len = itemLen(kind, obj);
      if (view.playing) pause();
      setTime(base + kt0);
      kfSel = { id, t: kt0 };
      dragSession(ev => {
        const dpx = ev.clientX - x0;
        if (!moved && Math.abs(dpx) < 3) return;
        moved = true;
        const nt = clamp(kt0 + dpx / view.pps, 0, len);
        obj.kf = kf0; // من الأصل في كل حركة، كي لا يُمحى إطار آخر مرّت فوقه النقطة
        moveKeys(obj, kt0, nt);
        kfSel = { id, t: nt };
        view.t = clamp(base + nt, 0, view.total);
        live();
      }, () => { if (moved) { touch(); renderProps(); } });
      return;
    }
    // كتلة الترجمة لا تتجاوز جارتيها
    const capAt = kind === 'caption' ? state.captions.items.indexOf(obj) : -1;
    const capLo = capAt > 0 ? state.captions.items[capAt - 1].end : 0;
    const capHi = capAt >= 0 && capAt < state.captions.items.length - 1 ? state.captions.items[capAt + 1].start : Infinity;

    if (kind === 'clip' && !handle) {
      // إعادة الترتيب بالسحب
      let target = -1;
      const from = state.clips.indexOf(obj);
      dragSession(ev => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 5) return;
        moved = true;
        itemEl.classList.add('dragging');
        itemEl.style.transform = `translateX(${dx}px)`;
        const pt = timeAtX(ev.clientX);
        const others = state.clips.filter(c => c !== obj);
        target = others.filter(c => c._start + clipLen(c) / 2 < pt).length;
        const markT = target < others.length ? others[target]._start : (others.length ? others[others.length - 1]._start + clipLen(others[others.length - 1]) : 0);
        // موضع العلامة محسوب بالتخطيط الحالي (قبل النقل)
        els.dropMark.hidden = false;
        els.dropMark.style.left = (LABEL_W + markT * view.pps) + 'px';
      }, () => {
        els.dropMark.hidden = true;
        if (!moved) { if (again) setSheet(true); return; }
        if (target >= 0 && target !== from) {
          state.clips.splice(from, 1);
          state.clips.splice(target, 0, obj);
        }
        touch();
      });
      return;
    }

    dragSession(ev => {
      const dpx = ev.clientX - x0;
      if (!moved && Math.abs(dpx) < 3) return;
      moved = true;
      const dx = dpx / view.pps;
      if (kind === 'clip') {
        if (obj.type === 'image') {
          obj.out = clamp(o.out + (handle === 'r' ? dx : -dx), MIN_LEN, 120);
        } else if (handle === 'l') {
          obj.in = clamp(o.in + dx * o.speed, 0, o.out - MIN_LEN * o.speed);
        } else {
          obj.out = clamp(o.out + dx * o.speed, o.in + MIN_LEN * o.speed, o.srcDur);
        }
      } else if (kind === 'audio') {
        if (!handle) {
          let s = Math.max(0, o.start + dx);
          const sn = snapTime(s);
          if (sn !== s) s = sn; else { const e2 = snapTime(s + audioLen(o)); if (e2 !== s + audioLen(o)) s = Math.max(0, e2 - audioLen(o)); }
          obj.start = s;
        } else if (handle === 'l') {
          const d = clamp(dx, Math.max(-o.in, -o.start), audioLen(o) - MIN_LEN);
          obj.in = o.in + d; obj.start = o.start + d;
        } else {
          obj.out = clamp(o.out + dx, o.in + MIN_LEN, o.srcDur);
        }
      } else if (kind === 'overlay') {
        const len = overlayLen(o);
        if (!handle) {
          let s = Math.max(0, o.start + dx);
          const sn = snapTime(s);
          if (sn !== s) s = sn; else { const e2 = snapTime(s + len); if (e2 !== s + len) s = Math.max(0, e2 - len); }
          obj.start = s;
          obj.track = clamp(Math.round((o.track || 0) - (ev.clientY - y0) / 44), 0, 20); // السحب لأعلى يرفع الطبقة صفاً
        } else if (obj.type === 'image') {
          if (handle === 'l') { const d = clamp(dx, -o.start, o.out - MIN_LEN); obj.start = o.start + d; obj.out = o.out - d; }
          else obj.out = Math.max(MIN_LEN, snapTime(o.start + o.out + dx) - o.start);
        } else if (handle === 'l') {
          const d = clamp(dx, Math.max(-o.in / o.speed, -o.start), len - MIN_LEN);
          obj.in = o.in + d * o.speed; obj.start = o.start + d;
        } else obj.out = clamp(o.out + dx * o.speed, o.in + MIN_LEN * o.speed, o.srcDur);
      } else if (kind === 'caption') {
        const len = o.end - o.start;
        let s = o.start, en = o.end;
        if (!handle) { s = clamp(o.start + dx, capLo, Math.max(capLo, capHi - len)); en = s + len; }
        else if (handle === 'l') s = clamp(o.start + dx, capLo, o.end - MIN_LEN);
        else en = clamp(o.end + dx, o.start + MIN_LEN, capHi);
        Object.assign(obj, CaptionTools.retime(o, s, en));
      } else { // نص أو تأثير
        if (kind === 'effect') obj.at = null; // تحريكه يدوياً يفك ربطه بالقطع
        if (!handle) {
          let s = Math.max(0, o.start + dx);
          const sn = snapTime(s);
          if (sn !== s) s = sn; else { const e2 = snapTime(s + o.dur); if (e2 !== s + o.dur) s = Math.max(0, e2 - o.dur); }
          obj.start = s;
        } else if (handle === 'l') {
          const d = clamp(dx, -o.start, o.dur - MIN_LEN);
          obj.start = o.start + d; obj.dur = o.dur - d;
        } else {
          obj.dur = Math.max(MIN_LEN, snapTime(o.start + o.dur + dx) - o.start);
        }
      }
      live();
    }, () => { if (moved) { touch(); renderProps(); } else if (again) setSheet(true); });
  });

  /* ================= عمليات التحرير ================= */
  function removeSel() {
    const obj = selObj();
    if (!obj) return;
    const k = state.sel.kind;
    if (obj.el && obj.el.pause) obj.el.pause();
    setList(k, listOf(k).filter(x => x !== obj));
    state.sel = null;
    touch();
    renderProps();
  }

  function cloneItem(kind, obj) {
    const n = { ...obj, id: uid() };
    if ((kind === 'clip' || kind === 'overlay') && obj.type === 'video') n.el = createVideo(obj.url);
    if (kind === 'audio') { n.el = new Audio(obj.url); n.el.preload = 'auto'; }
    return n;
  }

  /**
   * يقسم عنصراً عند زمن المشروع t ويعيد الجزء الثاني (بعد إضافته)، أو null إن كان t خارج العنصر.
   * الإطارات المفتاحية تُوزَّع على الجزأين مع إطار عند نقطة القطع، فلا تقفز الحركة. تستعمله الواجهة والمساعد.
   */
  function splitItem(kind, obj, t) {
    layout();
    const s = itemStart(kind, obj), len = itemLen(kind, obj);
    if (!(t > s + 0.08 && t < s + len - 0.08)) return null;
    if (kind === 'caption') {
      const parts = CaptionTools.splitAt(obj, t);
      if (!parts) return null;
      const items = state.captions.items, i = items.indexOf(obj);
      Object.assign(obj, parts[0]);
      items.splice(i + 1, 0, parts[1]);
      return parts[1];
    }
    const n = cloneItem(kind, obj);
    const [kfA, kfB] = splitKf(obj, t - s);
    if (kfA) obj.kf = kfA; else delete obj.kf;
    if (kfB) n.kf = kfB; else delete n.kf;
    if (kind === 'clip') {
      const cut = obj.in + (t - obj._start) * obj.speed;
      if (obj.type === 'image') { n.in = 0; n.out = obj.out - cut; } // الصورة لا زمن مصدر لها
      else n.in = cut;
      n.transition = 'none'; obj.out = cut;
      state.clips.splice(state.clips.indexOf(obj) + 1, 0, n);
    } else if (kind === 'overlay') {
      const cut = obj.in + (t - obj.start) * obj.speed;
      if (obj.type === 'image') { n.in = 0; n.out = obj.out - cut; } else n.in = cut;
      n.start = t; obj.out = cut;
      state.overlays.push(n);
    } else if (kind === 'audio') {
      const cut = obj.in + (t - obj.start);
      n.in = cut; n.start = t; n.fadeIn = 0; obj.out = cut; obj.fadeOut = 0;
      state.audios.push(n);
    } else {
      if (kind === 'effect') { obj.at = null; n.at = null; }
      n.start = t; n.dur = obj.start + obj.dur - t; obj.dur = t - obj.start;
      listOf(kind).push(n);
    }
    return n;
  }

  /** نسخة من العنصر توضع بعده مباشرة */
  function dupItem(kind, obj) {
    if (kind === 'caption') {
      const items = state.captions.items, i = items.indexOf(obj), len = obj.end - obj.start;
      const room = (items[i + 1] ? items[i + 1].start : Infinity) - obj.end;
      if (room < CaptionTools.MIN) return null;
      const n = { ...CaptionTools.retime(obj, obj.end, obj.end + Math.min(len, room)), id: uid() };
      items.splice(i + 1, 0, n);
      return n;
    }
    const n = cloneItem(kind, obj);
    if (kind === 'clip') state.clips.splice(state.clips.indexOf(obj) + 1, 0, n);
    else if (kind === 'audio') { n.start = obj.start + audioLen(obj); state.audios.push(n); }
    else if (kind === 'overlay') { n.start = obj.start + overlayLen(obj); n.track = freeTrack(n.start, overlayLen(n)); state.overlays.push(n); }
    else { if (kind === 'effect') n.at = null; n.start = obj.start + obj.dur; listOf(kind).push(n); }
    return n;
  }

  function dupSel() {
    const obj = selObj();
    if (!obj) return toast('حدّد عنصراً أولاً لتكراره');
    const k = state.sel.kind;
    const n = dupItem(k, obj);
    if (!n) return toast('لا مكان لنسخة بعد هذه الكتلة');
    state.sel = { kind: k, id: n.id };
    touch();
    renderProps();
  }

  function splitAtPlayhead() {
    layout();
    const t = view.t;
    let kind = state.sel && state.sel.kind, obj = selObj();
    const inside = (s, len) => t > s + 0.08 && t < s + len - 0.08;
    const covers = () => obj && inside(itemStart(kind, obj), itemLen(kind, obj));
    if (!covers()) {
      const i = clipIndexAt(t);
      obj = i >= 0 ? state.clips[i] : null; kind = 'clip';
      if (!covers()) return toast('ضع المؤشر داخل المقطع الذي تريد تقسيمه');
    }
    const n = splitItem(kind, obj, t);
    if (!n) return toast(kind === 'caption' ? 'هذه الكتلة كلمة واحدة فلا تُقسم' : 'ضع المؤشر داخل المقطع الذي تريد تقسيمه');
    state.sel = { kind, id: n.id };
    touch();
    renderProps();
  }

  /* ================= لوحة الخصائص ================= */
  const chips = (k, opts, cur, num) =>
    `<div class="chips" data-k="${k}"${num ? ' data-num="1"' : ''}>${opts.map(([v, l]) => `<button type="button" class="chip${String(v) === String(cur) ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const slider = (k, label, min, max, step, val, unit = '', scale = 1) =>
    `<label class="row"><span>${label}</span><input type="range" data-k="${k}" data-scale="${scale}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${val}${unit}</output></label>`;
  /* ---------- الإطارات المفتاحية في اللوحة ---------- */
  const KF_NEAR = 0.03; // المؤشر «على» إطار إن كان أقرب من هذا
  const fmtK = (v, step) => +(+v).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);
  const keyHere = (obj, key, lt) => hasKf(obj, key) && obj.kf[key].some(k => Math.abs(k.t - lt) < KF_NEAR);
  /** شريط لخاصية قابلة للتحريك: يعرض قيمتها عند المؤشر، ومعه زر ◇ يثبّتها إطاراً مفتاحياً */
  const kslider = (obj, kind, key, label, min, max, step, unit = '', scale = 1) => {
    const lt = ltOf(kind, obj), val = fmtK(prop(obj, key, lt) / scale, step);
    return `<label class="row"><span><button type="button" class="kf-btn${hasKf(obj, key) ? ' on' : ''}" data-kf="${key}" title="إطار مفتاحي عند المؤشر">${keyHere(obj, key, lt) ? '◆' : '◇'}</button>${label}</span><input type="range" data-k="${key}" data-kfk="1" data-scale="${scale}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${clamp(val, min, max)}"><output>${val}${unit}</output></label>`;
  };
  function kfHereHtml(obj, lt) {
    const times = kfTimes(obj);
    if (!times.length) return '';
    const at = times.find(t => Math.abs(t - lt) < KF_NEAR);
    let h = `<div class="actions"><button class="btn small" data-act="kfPrev">الإطار السابق</button><button class="btn small" data-act="kfNext">الإطار التالي</button></div>`;
    if (at != null) {
      let e = 'smooth';
      for (const k in obj.kf) { const x = obj.kf[k].find(q => Math.abs(q.t - at) < KF_NEAR); if (x) { e = x.e; break; } }
      h += `<p class="sub" style="white-space:normal;margin-top:8px">الحركة من هذا الإطار إلى الذي يليه:</p>`
        + chips('kfEase', [['smooth', 'ناعمة'], ['linear', 'خطية'], ['hold', 'قفزة']], e)
        + `<button class="link-btn" data-act="kfDelHere">حذف إطارات هذا الموضع</button>`;
    }
    return h + `<button class="link-btn" data-act="kfClear">حذف كل الإطارات (${times.length})</button>`;
  }
  const kfSection = (obj, kind) => `<h3>الإطارات المفتاحية</h3>
    <p class="sub" style="white-space:normal">اضغط ◇ بجانب خاصية لتثبيت قيمتها عند المؤشر، ثم انقل المؤشر وغيّر القيمة فتتحرك بين الموضعين.</p>
    <div id="kfHere">${kfHereHtml(obj, ltOf(kind, obj))}</div>`;

  /** يحدّث أشرطة الخصائص المتحركة وأزرارها عند تحرك المؤشر، دون إعادة بناء اللوحة */
  function syncKfInputs() {
    const obj = selObj(), kind = obj && state.sel.kind;
    if (!obj || !KF_PROPS[kind] || !anyKf(obj) || view.playing) return;
    const lt = ltOf(kind, obj);
    els.props.querySelectorAll('input[data-kfk]').forEach(inp => {
      const key = inp.dataset.k, row = inp.parentElement;
      const v = fmtK(prop(obj, key, lt) / (+inp.dataset.scale || 1), +inp.step);
      inp.value = v;
      const out = row.querySelector('output'), btn = row.querySelector('.kf-btn');
      if (out) out.textContent = v + (inp.dataset.unit || '');
      if (btn) btn.textContent = keyHere(obj, key, lt) ? '◆' : '◇';
    });
    const here = $('#kfHere', els.props);
    if (here) here.innerHTML = kfHereHtml(obj, lt);
  }

  const check = (k, label, on, extra = '') =>
    `<label class="row check"><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}><span>${label}</span>${extra}</label>`;
  const actions = () =>
    `<div class="actions">
      <button class="btn small" data-act="split"><svg class="ic"><use href="#i-split"/></svg>تقسيم</button>
      <button class="btn small" data-act="dup"><svg class="ic"><use href="#i-copy"/></svg>تكرار</button>
      <button class="btn small danger" data-act="del"><svg class="ic"><use href="#i-trash"/></svg>حذف</button>
    </div>`;

  /** تفاصيل المشروع في لوحة الخصائص حين لا يكون عنصر محدداً. تُحدَّث مع كل تغيير */
  function projectInfo() {
    if (isEmpty()) return '';
    const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const [W, H] = outputSize(state.ratio, 1080);
    const vids = state.clips.filter(c => c.type === 'video').length, imgs = state.clips.length - vids;
    return `<h2>تفاصيل المشروع</h2><p class="sub" title="${esc(state.name)}">${state.name ? esc(state.name) : 'مشروع لم يُحفظ بعد'}</p>
      <dl class="proj-info">
        ${row('المدة', `<span dir="ltr">${fmtTime(view.total)}</span>`)}
        ${row('المقاس', `<span dir="ltr">${state.ratio} · ${W}×${H}</span>`)}
        ${row('المقاطع', `${state.clips.length}${state.clips.length ? ` <small>(${vids} فيديو · ${imgs} صورة)</small>` : ''}`)}
        ${state.overlays.length ? row('الطبقات', state.overlays.length) : ''}
        ${row('النصوص', state.texts.length)}
        ${state.captions.items.length ? row('الترجمة', `${state.captions.items.length} <small>كتلة</small>`) : ''}
        ${row('التأثيرات', state.effects.length)}
        ${row('الموسيقى', state.audios.length)}
      </dl>
      <div class="actions proj-actions">
        <button class="btn small" data-act="projSave"><svg class="ic"><use href="#i-save"/></svg>حفظ المشروع</button>
        <button class="btn small" data-act="projOpen"><svg class="ic"><use href="#i-folder"/></svg>فتح مشروع</button>
      </div>`;
  }

  function renderProps() {
    const obj = selObj();
    const kind = obj && state.sel.kind;
    let h = '';
    if (!obj) {
      h = `<div id="projInfo">${projectInfo()}</div><h2>كيف أبدأ؟</h2>
        <ol class="guide">
          <li><b>ارفع ملفاتك</b><br>صور ومقاطع فيديو — تُضاف تلقائياً بالترتيب.</li>
          <li><b>رتّب وقُصّ</b><br>اسحب المقطع لتغيير مكانه، واسحب حافته لتقصيره.</li>
          <li><b>أضف موسيقى ونصوصاً</b><br>ثم اضغط على أي عنصر لتعديل خصائصه هنا.</li>
          <li><b>صدّر الفيديو</b><br>اختر الدقة حتى 4K ونزّل ملف MP4.</li>
        </ol>
        <div class="keys">
          <kbd>مسافة</kbd> تشغيل/إيقاف · <kbd>S</kbd> تقسيم · <kbd>Delete</kbd> حذف<br>
          <kbd>Ctrl+Z</kbd> تراجع · <kbd>←</kbd> <kbd>→</kbd> تحريك المؤشر<br>
          <kbd>Ctrl+S</kbd> حفظ المشروع · <kbd>Ctrl+O</kbd> فتح مشروع
        </div>`;
    } else if (kind === 'clip') {
      const isVid = obj.type === 'video';
      h = `<h2>${isVid ? 'مقطع فيديو' : 'صورة'}</h2><p class="sub" title="${esc(obj.name)}">${esc(obj.name)}</p>`;
      if (!isVid) {
        h += `<button class="btn small wide" data-act="imgEdit"><svg class="ic"><use href="#i-wand"/></svg>تعديل الصورة: قص، إزالة الخلفية…</button>`;
        h += slider('out', 'مدة العرض', 0.5, 15, 0.1, +Math.min(15, obj.out).toFixed(1), 'ث');
      }
      else {
        h += `<h3>السرعة</h3>` + chips('speed', [[0.5, '0.5×'], [1, 'عادية'], [1.5, '1.5×'], [2, '2×']], obj.speed, true);
        h += kslider(obj, 'clip', 'volume', 'صوت المقطع', 0, 100, 1, '%', 0.01);
        h += check('muted', 'كتم صوت المقطع', obj.muted);
        h += `<button class="btn small wide" data-act="audExtract"><svg class="ic"><use href="#i-wave"/></svg>استخراج الصوت: تنزيله أو فصله كموسيقى</button>`;
        h += `<button class="btn small wide" data-act="vidSplit"><svg class="ic"><use href="#i-split"/></svg>تقسيم الفيديو إلى ملفات منفصلة</button>`;
      }
      h += `<h3>الانتقال عند الدخول</h3>` + chips('transition', [['none', 'بدون'], ['fade', 'تلاشٍ'], ['slide', 'انزلاق'], ['zoom', 'تكبير'], ['wipe', 'مسح'], ['black', 'إظلام']], obj.transition);
      if (obj.transition !== 'none') h += slider('trLen', 'طول الانتقال', 0.1, 1.5, 0.05, +(obj.trLen > 0 ? obj.trLen : 0.6).toFixed(2), 'ث');
      h += `<button class="link-btn" data-act="trAll">تطبيق هذا الانتقال على كل المقاطع</button>`;
      if (state.audios.length) h += check('pulse', 'نبضة مع إيقاع الموسيقى', obj.pulse);
      h += `<h3>حركة الكاميرا</h3>` + chips('motion', [['none', 'ثابت'], ['zoomIn', 'تقريب'], ['zoomOut', 'تبعيد'], ['panRight', 'يمين'], ['panLeft', 'يسار'], ['panUp', 'لأعلى'], ['panDown', 'لأسفل'], ['handheld', 'كاميرا محمولة']], obj.motion);
      h += `<h3>ملاءمة الإطار</h3>` + chips('fit', [['blur', 'خلفية ضبابية'], ['contain', 'حواف سوداء'], ['cover', 'ملء الإطار']], obj.fit);
      h += `<h3>الفلتر</h3>` + chips('filter', Object.entries(Render.FILTERS).map(([k, f]) => [k, f.label]), obj.filter);
      h += `<h3>تعديل الألوان</h3>`
        + slider('bright', 'السطوع', 50, 150, 1, obj.bright, '%')
        + slider('contrast', 'التباين', 50, 150, 1, obj.contrast, '%')
        + slider('sat', 'التشبّع', 0, 200, 1, obj.sat, '%');
      h += `<h3>التكبير والموضع</h3>`
        + kslider(obj, 'clip', 'zoom', 'التكبير', 20, 300, 1, '%', 0.01)
        + kslider(obj, 'clip', 'panX', 'إزاحة أفقية', -100, 100, 1, '%', 0.01)
        + kslider(obj, 'clip', 'panY', 'إزاحة عمودية', -100, 100, 1, '%', 0.01)
        + kslider(obj, 'clip', 'opacity', 'الشفافية', 0, 100, 1, '%', 0.01);
      h += `<button class="btn small wide" data-act="clipToOverlay"><svg class="ic"><use href="#i-layers"/></svg>تحويل إلى طبقة فوق الفيديو</button>`;
      h += kfSection(obj, 'clip') + actions();
    } else if (kind === 'overlay') {
      const isVid = obj.type === 'video';
      h = `<h2>طبقة ${isVid ? 'فيديو' : 'صورة'}</h2><p class="sub" title="${esc(obj.name)}">${esc(obj.name)}</p>`
        + `<p class="sub" style="white-space:normal">اسحبها في المعاينة لتحريكها، واسحب زاوية لتكبيرها، والمقبض العلوي لتدويرها.</p>`
        + kslider(obj, 'overlay', 'x', 'أفقياً', -20, 120, 1, '%', 0.01)
        + kslider(obj, 'overlay', 'y', 'عمودياً', -20, 120, 1, '%', 0.01)
        + kslider(obj, 'overlay', 'scale', 'الحجم', 2, 200, 1, '%', 0.01)
        + kslider(obj, 'overlay', 'rot', 'التدوير', -180, 180, 1, '°')
        + kslider(obj, 'overlay', 'opacity', 'الشفافية', 0, 100, 1, '%', 0.01);
      if (isVid) {
        h += `<h3>السرعة</h3>` + chips('speed', [[0.5, '0.5×'], [1, 'عادية'], [1.5, '1.5×'], [2, '2×']], obj.speed, true)
          + kslider(obj, 'overlay', 'volume', 'صوت الطبقة', 0, 100, 1, '%', 0.01)
          + check('muted', 'كتم صوت الطبقة', obj.muted);
      } else h += slider('out', 'مدة العرض', 0.5, 30, 0.1, +Math.min(30, obj.out).toFixed(1), 'ث');
      h += `<h3>القناع</h3>` + chips('mask', Object.entries(Render.MASKS), obj.mask);
      if (obj.mask === 'round') h += slider('radius', 'استدارة الزوايا', 0, 50, 1, Math.round((obj.radius != null ? obj.radius : 0.08) * 100), '%', 0.01);
      h += `<label class="row"><span>الإطار</span><input type="range" data-k="border" data-scale="0.001" data-unit="" min="0" max="40" step="1" value="${Math.round((obj.border || 0) * 1000)}"><input type="color" data-k="borderColor" value="${obj.borderColor || '#ffffff'}"></label>`
        + check('shadow', 'ظل', obj.shadow)
        + `<h3>وضع المزج</h3>` + chips('blend', Object.entries(Render.BLENDS).map(([k, b]) => [k, b.label]), obj.blend)
        + `<h3>حركة الدخول والخروج</h3>` + chips('anim', [['none', 'بدون'], ['fade', 'تلاشٍ'], ['rise', 'صعود'], ['pop', 'نبضة']], obj.anim)
        + `<h3>الفلتر</h3>` + chips('filter', Object.entries(Render.FILTERS).map(([k, f]) => [k, f.label]), obj.filter)
        + `<h3>الترتيب</h3><div class="actions"><button class="btn small" data-act="ovUp">إلى الأمام</button><button class="btn small" data-act="ovDown">إلى الخلف</button></div>`
        + `<button class="btn small wide" data-act="ovToMain" style="margin-top:8px"><svg class="ic"><use href="#i-media"/></svg>تحويل إلى المسار الرئيسي</button>`
        + kfSection(obj, 'overlay') + actions();
    } else if (kind === 'caption') {
      const st = state.captions.style, n = state.captions.items.length;
      h = `<h2>ترجمة</h2><p class="sub"><span dir="ltr">${fmtTime(obj.start)} – ${fmtTime(obj.end)}</span> · كتلة من ${n}</p>`
        + `<textarea data-k="capText" rows="2" dir="auto">${esc(obj.text)}</textarea>`
        + `<div class="actions">
            <button class="btn small" data-act="split"><svg class="ic"><use href="#i-split"/></svg>تقسيم</button>
            <button class="btn small" data-act="capMerge">دمج مع التالية</button>
            <button class="btn small danger" data-act="del"><svg class="ic"><use href="#i-trash"/></svg>حذف</button>
          </div>`
        + `<h3>نمط الترجمة <small>(لكل الكتل)</small></h3>`
        + `<label class="row"><span>الخط</span><select data-k="cs.font">${Object.entries(Render.FONTS).map(([k, f]) => `<option value="${k}"${k === st.font ? ' selected' : ''}>${f.label}</option>`).join('')}</select></label>`
        + slider('cs.size', 'الحجم', 2, 20, 0.5, +(st.size * 100).toFixed(1), '', 0.01)
        + slider('cs.y', 'الموضع', 5, 95, 1, Math.round(st.y * 100), '%', 0.01)
        + `<label class="row"><span>لون النص</span><input type="color" data-k="cs.color" value="${st.color}"><span></span></label>`
        + `<label class="row"><span>لون التمييز</span><input type="color" data-k="cs.hl" value="${st.hl}"><span></span></label>`
        + check('cs.bg', 'خلفية', st.bg, `<input type="color" data-k="cs.bgColor" value="${st.bgColor}">`)
        + check('cs.outline', 'حدّ خارجي', st.outline)
        + `<h3>تمييز الكلمة المنطوقة</h3>` + chips('cs.mode', Object.entries(Render.CAPTION_MODES), st.mode)
        + `<h3>الملف</h3><div class="actions"><button class="btn small" data-act="capSrt">تصدير SRT</button><button class="btn small" data-act="capVtt">تصدير VTT</button></div>`
        + `<button class="link-btn" data-act="capOpen">إعادة التفريغ…</button>`
        + `<button class="link-btn" data-act="capClear">حذف الترجمة كلها</button>`;
    } else if (kind === 'audio') {
      h = `<h2>موسيقى</h2><p class="sub" title="${esc(obj.name)}">${esc(obj.name)}</p>`
        + kslider(obj, 'audio', 'volume', 'مستوى الصوت', 0, 100, 1, '%', 0.01)
        + slider('fadeIn', 'ظهور تدريجي', 0, 5, 0.1, obj.fadeIn, 'ث')
        + slider('fadeOut', 'اختفاء تدريجي', 0, 5, 0.1, obj.fadeOut, 'ث')
        + `<p class="sub" style="white-space:normal;margin-top:12px">اسحب الموسيقى على الخط الزمني لتغيير موضعها. إن كانت أطول من الفيديو فستُقصّ عند نهايته مع اختفاء تدريجي.</p>`;
      const b = Beats.ensure(obj);
      if (b && b.bpm) {
        h += `<h3>الإيقاع</h3><p class="sub" style="white-space:normal">السرعة <b dir="ltr">${Math.round(b.bpm)} BPM</b> · ضربة كل <span dir="ltr">${b.period.toFixed(2)}</span> ث</p>`
          + chips('beatN', [[0, 'الضربات القوية فقط'], [1, 'كل ضربة'], [2, 'كل ضربتين'], [4, 'كل 4 ضربات']], beatChoice, true)
          + `<button class="btn small primary" data-act="beatSync" style="width:100%;margin-top:8px">مزامنة القص مع الإيقاع</button>`;
      }
      h += kfSection(obj, 'audio') + actions();
    } else if (kind === 'effect') {
      const def = Render.EFFECTS[obj.type] || {};
      const cut = obj.at && state.clips.find(c => c.id === obj.at);
      h = `<h2>تأثير</h2><p class="sub">${esc(def.label || obj.type)}</p>`
        + `<h3>النوع</h3>` + chips('type', Object.entries(Render.EFFECTS).map(([k, f]) => [k, f.label]), obj.type)
        + kslider(obj, 'effect', 'amount', 'الشدّة', 0, 100, 1, '%', 0.01);
      if (!(cut && obj.atMode === 'clip')) h += slider('dur', 'المدة', 0.1, 10, 0.05, +Math.min(10, obj.dur).toFixed(2), 'ث');
      if (def.region) {
        h += `<h3>${def.rect ? 'الجزء المضاء' : 'مكان المنتج'}</h3><p class="sub" style="white-space:normal">${def.rect ? 'اسحب المستطيل في المعاينة فوق الجزء الذي يومض.' : 'اسحب الدائرة في المعاينة فوق المنتج.'}</p>`
          + slider('fxX', 'أفقياً', 0, 100, 1, Math.round((obj.x != null ? obj.x : 0.5) * 100), '%', 0.01)
          + slider('fxY', 'عمودياً', 0, 100, 1, Math.round((obj.y != null ? obj.y : 0.5) * 100), '%', 0.01)
          + (def.rect
            ? slider('fxW', 'العرض', 2, 100, 1, Math.round((obj.w > 0 ? obj.w : 0.4) * 100), '%', 0.01)
              + slider('fxH', 'الارتفاع', 2, 100, 1, Math.round((obj.h > 0 ? obj.h : 0.2) * 100), '%', 0.01)
            : slider('fxR', 'الحجم', 5, 100, 1, Math.round((obj.r > 0 ? obj.r : 0.3) * 100), '%', 0.01));
      }
      if (cut) {
        h += `<p class="sub" style="white-space:normal;margin-top:10px">${obj.atMode === 'clip' ? 'يغطي المقطع' : 'متمركز على القطع عند دخول المقطع'} «${esc(cut.name)}» ويتبعه إن تغيّر التوقيت.</p>`
          + `<button class="link-btn" data-act="fxUnlink">فك الربط وتثبيته في مكانه</button>`;
      }
      h += `<button class="btn small wide" data-act="fxAllCuts" style="margin-top:10px"><svg class="ic"><use href="#i-spark"/></svg>ضعه على كل القطوع</button>`;
      h += kfSection(obj, 'effect') + actions();
    } else {
      h = `<h2>نص</h2><p class="sub">اسحب النص داخل المعاينة لتحريكه</p>`
        + `<textarea data-k="text" rows="3" dir="auto">${esc(obj.text)}</textarea>`
        + kslider(obj, 'text', 'size', 'الحجم', 3, 22, 0.5, '', 0.01)
        + slider('dur', 'المدة', 0.5, 20, 0.1, +Math.min(20, obj.dur).toFixed(1), 'ث')
        + `<label class="row"><span>الخط</span><select data-k="font">${Object.entries(Render.FONTS).map(([k, f]) => `<option value="${k}"${k === obj.font ? ' selected' : ''}>${f.label}</option>`).join('')}</select></label>`
        + `<label class="row"><span>اللون</span><input type="color" data-k="color" value="${obj.color}"><span></span></label>`
        + check('bold', 'خط عريض', obj.bold)
        + check('stroke', 'حدّ خارجي', obj.stroke, `<input type="color" data-k="strokeColor" value="${obj.strokeColor}">`)
        + check('bg', 'خلفية للنص', obj.bg, `<input type="color" data-k="bgColor" value="${obj.bgColor}">`)
        + check('shadow', 'ظل', obj.shadow)
        + `<h3>الموضع</h3>` + chips('pos', [['top', 'أعلى'], ['mid', 'وسط'], ['bottom', 'أسفل']], obj.y < 0.3 ? 'top' : obj.y > 0.7 ? 'bottom' : 'mid')
        + kslider(obj, 'text', 'x', 'أفقياً', -20, 120, 1, '%', 0.01)
        + kslider(obj, 'text', 'y', 'عمودياً', -20, 120, 1, '%', 0.01)
        + kslider(obj, 'text', 'opacity', 'الشفافية', 0, 100, 1, '%', 0.01)
        + kslider(obj, 'text', 'rot', 'التدوير', -180, 180, 1, '°')
        + `<h3>حركة الظهور</h3>` + chips('anim', [['none', 'بدون'], ['fade', 'تلاشٍ'], ['rise', 'صعود'], ['pop', 'نبضة']], obj.anim)
        + kfSection(obj, 'text') + actions();
    }
    // إعادة بناء لوحة العنصر نفسه (إطار مفتاحي جديد مثلاً) لا تعيد التمرير إلى الأعلى
    const keep = obj && lastProps === obj.id ? els.props.scrollTop : 0;
    lastProps = obj ? obj.id : null;
    els.props.innerHTML = h;
    els.props.scrollTop = keep;
    els.btnProps.classList.toggle('on', !!obj);
    if (!obj && hadSel) setSheet(false); // حُذف العنصر أو أُلغي تحديده: لا يبقى الدرج مفتوحاً على لا شيء
    hadSel = !!obj;
  }
  let hadSel = false, lastProps = null;

  let beatChoice = 2; // عدد الضربات لكل مقطع في زر المزامنة

  /** زر «مزامنة القص مع الإيقاع» في لوحة الموسيقى — نفس أداة المساعد */
  async function beatSync(audioId) {
    if (!state.clips.length) return toast('أضف صوراً أو مقاطع أولاً', 'err');
    const opts = beatChoice ? { beats_per_clip: beatChoice } : { hits_only: true };
    const r = await Agent.run('sync_to_beat', { audio_id: audioId, ...opts, pulse: true }, { commit: true });
    if (r.error) return toast('تعذّرت المزامنة: ' + r.data.error, 'err');
    renderProps();
    toast(`تمت مزامنة القص مع الإيقاع (${Math.round(r.data.bpm)} BPM)`, 'ok');
    if (r.data.warning) toast('الموسيقى أقصر من الفيديو — كرّرها أو قلّل الضربات لكل مقطع', 'err');
  }

  function setProp(obj, k, v) {
    if (k === 'beatN') { beatChoice = v; return; }
    const kind = state.sel.kind, lt = ltOf(kind, obj);
    if (k === 'kfEase') { // انسيابية الإطار الذي يقف عليه المؤشر
      const at = kfTimes(obj).find(t => Math.abs(t - lt) < KF_NEAR);
      if (at != null) { setKeyEase(obj, at, v); touch(); }
      return;
    }
    if (k.startsWith('cs.')) state.captions.style[k.slice(3)] = v; // نمط الترجمة: لكل الكتل
    else if (k === 'capText') Object.assign(obj, CaptionTools.setText(obj, v));
    else if (k === 'pos') { setVal(obj, 'y', { top: 0.15, mid: 0.5, bottom: 0.82 }[v], lt); setVal(obj, 'x', 0.5, lt); }
    else if (/^fx[XYRWH]$/.test(k)) obj[{ fxX: 'x', fxY: 'y', fxR: 'r', fxW: 'w', fxH: 'h' }[k]] = v;
    else if (k === 'out' && (kind === 'clip' || kind === 'overlay')) obj.out = Math.max(MIN_LEN, v);
    else if (k === 'dur') obj.dur = Math.max(kind === 'effect' ? 0.1 : MIN_LEN, v);
    else if (KF_PROPS[kind] && k in KF_PROPS[kind]) setVal(obj, k, v, lt); // إطار عند المؤشر إن كانت الخاصية متحركة
    else obj[k] = v;
    touch();
    if (k === 'transition' || k === 'mask' || (k === 'type' && kind === 'effect')) renderProps(); // يتغيّر ما يظهر في اللوحة
    else if (k === 'pos') syncKfInputs();
  }

  els.props.addEventListener('input', e => {
    const el = e.target, k = el.dataset.k, obj = selObj();
    if (!k || !obj) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'range') {
      v = +el.value * (+el.dataset.scale || 1);
      const out = el.parentElement.querySelector('output');
      if (out) out.textContent = el.value + (el.dataset.unit || '');
    } else v = el.value;
    setProp(obj, k, v);
  });

  els.props.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const group = chip.parentElement, obj = selObj();
      if (!obj) return;
      group.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === chip));
      setProp(obj, group.dataset.k, group.dataset.num ? +chip.dataset.v : chip.dataset.v);
      return;
    }
    // زر ◇: يثبّت قيمة الخاصية إطاراً مفتاحياً عند المؤشر، أو يحذف الإطار الموجود هناك
    const kb = e.target.closest('.kf-btn');
    if (kb) {
      e.preventDefault(); // الزر داخل label: لا ينتقل التركيز إلى الشريط
      const obj = selObj();
      if (!obj) return;
      const kind = state.sel.kind, key = kb.dataset.kf, lt = ltOf(kind, obj);
      if (keyHere(obj, key, lt)) removeKey(obj, key, lt);
      else setKey(obj, key, lt, prop(obj, key, lt));
      touch();
      renderProps();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a.startsWith('kf')) {
      const obj = selObj();
      if (!obj) return;
      const kind = state.sel.kind, lt = ltOf(kind, obj), times = kfTimes(obj);
      if (a === 'kfPrev' || a === 'kfNext') {
        const t = a === 'kfPrev' ? [...times].reverse().find(x => x < lt - KF_NEAR) : times.find(x => x > lt + KF_NEAR);
        if (t == null) return toast(a === 'kfPrev' ? 'لا إطار قبل المؤشر' : 'لا إطار بعد المؤشر');
        if (view.playing) pause();
        setTime(itemStart(kind, obj) + t);
        return;
      }
      if (a === 'kfDelHere') { const at = times.find(t => Math.abs(t - lt) < KF_NEAR); if (at != null) removeKey(obj, null, at); }
      else if (a === 'kfClear') clearKeys(obj);
      touch();
      renderProps();
      return;
    }
    if (a === 'clipToOverlay' || a === 'ovToMain') {
      const obj = selObj();
      if (!obj) return;
      if (obj.el && obj.el.pause) obj.el.pause();
      const n = a === 'ovToMain' ? toMain(obj) : toOverlay(obj);
      state.sel = { kind: a === 'ovToMain' ? 'clip' : 'overlay', id: n.id };
      touch();
      renderProps();
      return;
    }
    if (a === 'ovUp' || a === 'ovDown') {
      const obj = selObj();
      if (!obj) return;
      obj.track = clamp((obj.track || 0) + (a === 'ovUp' ? 1 : -1), 0, 20);
      touch();
      return;
    }
    if (a.startsWith('cap')) {
      if (a === 'capOpen') return Captions.open();
      if (a === 'capSrt' || a === 'capVtt') return Captions.exportFile(a === 'capSrt' ? 'srt' : 'vtt');
      const items = state.captions.items, obj = selObj();
      if (a === 'capClear') { state.captions.items = []; state.sel = null; }
      else if (a === 'capMerge' && obj) {
        const i = items.indexOf(obj), next = items[i + 1];
        if (!next) return toast('لا كتلة بعد هذه لتُدمج معها');
        Object.assign(obj, CaptionTools.merge(obj, next));
        items.splice(i + 1, 1);
      }
      touch();
      renderProps();
      return;
    }
    if (a === 'split') splitAtPlayhead();
    else if (a === 'dup') dupSel();
    else if (a === 'del') removeSel();
    else if (a === 'beatSync') beatSync(state.sel.id);
    else if (a === 'imgEdit') { const obj = selObj(); if (obj) ImageStudio.openClip(obj); }
    else if (a === 'audExtract') { const obj = selObj(); if (obj) AudioExtract.openClip(obj); }
    else if (a === 'vidSplit') { const obj = selObj(); if (obj) VideoSplit.openClip(obj); }
    else if (a === 'projSave') ProjectIO.save();
    else if (a === 'projOpen') ProjectIO.pick();
    else if (a === 'fxUnlink') { const obj = selObj(); if (obj) { obj.at = null; touch(); renderProps(); } }
    else if (a === 'fxAllCuts') {
      const obj = selObj();
      if (!obj) return;
      if (state.clips.length < 2) return toast('لا توجد قطوع: أضف مقطعين على الأقل', 'err');
      const dur = Math.min(obj.dur, 1.5);
      const cuts = state.clips.slice(1);
      // القطوع التي عليها تأثير من النوع نفسه، كي لا يتكرر تأثيران على قطع واحد
      const taken = new Set(state.effects.filter(e => e !== obj && e.type === obj.type && e.at && e.atMode !== 'clip').map(e => e.at));
      const onCut = obj.at && obj.atMode !== 'clip' && cuts.some(c => c.id === obj.at) && !taken.has(obj.at);
      if (!onCut) {
        const free = cuts.find(c => !taken.has(c.id));
        if (!free) return toast('هذا التأثير موجود على كل القطوع مسبقاً', 'err');
        obj.at = free.id; obj.atMode = 'cut';
      }
      obj.dur = dur;
      taken.add(obj.at);
      for (const c of cuts) {
        if (taken.has(c.id)) continue;
        state.effects.push({ ...obj, id: uid(), at: c.id, atMode: 'cut', dur });
      }
      touch();
      renderProps();
      toast(`تم وضع «${Render.EFFECTS[obj.type].label}» على كل القطوع (${cuts.length})`, 'ok');
    }
    else if (a === 'trAll') {
      const obj = selObj();
      if (!obj) return;
      state.clips.forEach((c, i) => { if (i > 0) c.transition = obj.transition; });
      touch();
      toast('تم تطبيق الانتقال على كل المقاطع', 'ok');
    }
  });

  /* ================= سحب النص داخل المعاينة ================= */
  els.canvas.addEventListener('pointerdown', e => {
    const r = els.canvas.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
    const hit = [...state.texts].reverse().find(x => x._box && view.t >= x.start && view.t <= x.start + x.dur
      && nx >= x._box.x0 && nx <= x._box.x1 && ny >= x._box.y0 && ny <= x._box.y1);
    // تأثير منتج محدد: النقر أو السحب في المعاينة يضع مركزه فوق المنتج. النص الظاهر تحت المؤشر له الأولوية
    const fx = state.sel && state.sel.kind === 'effect' ? selObj() : null;
    if (!hit && fx && (Render.EFFECTS[fx.type] || {}).region) {
      e.preventDefault();
      if (view.playing) pause();
      const place = ev => {
        const p = Render.unzoom(fx, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, view.t);
        fx.x = clamp(p.x, 0, 1);
        fx.y = clamp(p.y, 0, 1);
        dirty = true;
      };
      place(e);
      dragSession(place, () => { commit(); renderProps(); });
      return;
    }
    if (!hit) {
      // كتلة الترجمة الظاهرة: النقر يحددها، والسحب العمودي يغيّر موضع الترجمة كلها
      const cap = state.captions, b = cap._box;
      if (b && cap._cur && nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1) {
        e.preventDefault();
        if (view.playing) pause();
        select({ kind: 'caption', id: cap._cur });
        const y0 = cap.style.y;
        let moved = false;
        dragSession(ev => {
          if (!moved && Math.abs(ev.clientY - e.clientY) < 3) return;
          moved = true;
          cap.style.y = clamp(y0 + (ev.clientY - e.clientY) / r.height, 0.05, 0.95);
          dirty = true;
        }, () => { if (moved) { commit(); renderProps(); } });
        return;
      }
      return overlayPointer(e, r, nx, ny);
    }
    e.preventDefault();
    if (view.playing) pause();
    select({ kind: 'text', id: hit.id });
    const lt = ltOf('text', hit), o = { x: prop(hit, 'x', lt), y: prop(hit, 'y', lt) };
    let moved = false;
    dragSession(ev => {
      moved = true;
      let x = clamp(o.x + (ev.clientX - e.clientX) / r.width, 0.02, 0.98);
      let y = clamp(o.y + (ev.clientY - e.clientY) / r.height, 0.03, 0.97);
      if (Math.abs(x - 0.5) < 0.015) x = 0.5;
      if (Math.abs(y - 0.5) < 0.015) y = 0.5;
      setVal(hit, 'x', x, lt); setVal(hit, 'y', y, lt); // يسجّل إطاراً إن كان الموضع متحركاً
      dirty = true;
    }, () => { if (moved) { touch(); renderProps(); } });
  });

  /** سحب طبقة في المعاينة: تحريك، تكبير من الزوايا، وتدوير من المقبض العلوي. يعمل بالفأرة وباللمس */
  function overlayPointer(e, r, nx, ny) {
    const cur = state.sel && state.sel.kind === 'overlay' ? selObj() : null;
    let ov = null, mode = cur ? Render.overlayHit(cur, nx, ny, true) : null;
    if (mode) ov = cur;
    else {
      ov = [...Render.overlaysInOrder()].reverse().find(o => Render.overlayHit(o, nx, ny, false)) || null; // الأعلى أولاً
      mode = ov ? 'move' : null;
    }
    if (!ov) return;
    e.preventDefault();
    if (view.playing) pause();
    if (ov !== cur) select({ kind: 'overlay', id: ov.id });
    const g = ov._g, lt = ltOf('overlay', ov);
    const o = { x: prop(ov, 'x', lt), y: prop(ov, 'y', lt), scale: prop(ov, 'scale', lt), rot: prop(ov, 'rot', lt) };
    // موضع المؤشر بإحداثيات المعاينة، نسبةً إلى مركز الطبقة
    const rel = ev => [(ev.clientX - r.left) / r.width * g.W - g.cx, (ev.clientY - r.top) / r.height * g.H - g.cy];
    const [ax, ay] = rel(e), d0 = Math.hypot(ax, ay) || 1, a0 = Math.atan2(ay, ax);
    let moved = false;
    dragSession(ev => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      if (mode === 'move') {
        let x = o.x + (ev.clientX - e.clientX) / r.width, y = o.y + (ev.clientY - e.clientY) / r.height;
        if (Math.abs(x - 0.5) < 0.012) x = 0.5;
        if (Math.abs(y - 0.5) < 0.012) y = 0.5;
        setVal(ov, 'x', clamp(x, -0.5, 1.5), lt); setVal(ov, 'y', clamp(y, -0.5, 1.5), lt);
      } else {
        const [bx, by] = rel(ev);
        if (mode === 'scale') setVal(ov, 'scale', clamp(o.scale * Math.hypot(bx, by) / d0, 0.02, 3), lt);
        else {
          let rot = o.rot + (Math.atan2(by, bx) - a0) * 180 / Math.PI;
          rot = ((rot + 540) % 360) - 180;
          if (Math.abs(rot) < 3) rot = 0; else if (Math.abs(Math.abs(rot) - 90) < 3) rot = 90 * Math.sign(rot);
          setVal(ov, 'rot', rot, lt);
        }
      }
      dirty = true;
    }, () => { if (moved) { touch(); renderProps(); } });
  }

  /* ================= التصدير ================= */
  const ex = {
    modal: $('#exportModal'), form: $('#exForm'), prog: $('#exProgress'), done: $('#exDone'),
    res: $('#exRes'), fps: $('#exFps'), q: $('#exQuality'), summary: $('#exSummary'),
    bar: $('#exBar'), status: $('#exStatus'), pct: $('#exPct'),
    video: $('#exVideo'), info: $('#exInfo'), link: $('#exLink'),
    abort: null, url: null,
  };
  const exShow = which => { ex.form.hidden = which !== 'form'; ex.prog.hidden = which !== 'prog'; ex.done.hidden = which !== 'done'; };

  function exSummary() {
    const [W, H] = outputSize(state.ratio, +ex.res.value);
    const mb = (Exporter.bitrateFor(W, H, +ex.fps.value, ex.q.value) + 192000) * view.total / 8 / 1048576;
    ex.summary.innerHTML = `<span dir="ltr">${W}×${H}</span> · ملف MP4 · المدة ${fmtTime(view.total)} · الحجم التقريبي ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} م.ب`;
  }

  function openExport() {
    layout();
    if (view.total <= 0) return toast('أضف صوراً أو مقاطع أولاً', 'err');
    if (!Exporter.supported()) return toast('متصفحك لا يدعم التصدير. استخدم Chrome أو Edge بإصدار حديث.', 'err');
    pause();
    exSummary();
    exShow('form');
    ex.modal.hidden = false;
  }

  function closeExport() {
    if (ex.abort) return; // التصدير جارٍ
    ex.video.pause();
    ex.modal.hidden = true;
  }

  async function startExport() {
    exShow('prog');
    ex.bar.style.width = '0%'; ex.pct.textContent = '0%';
    ex.abort = new AbortController();
    pause();
    view.exporting = true;
    pauseAllMedia();
    try {
      const r = await Exporter.run({
        res: +ex.res.value, fps: +ex.fps.value, quality: ex.q.value, signal: ex.abort.signal,
        onProgress: (p, msg, left) => {
          ex.bar.style.width = (p * 100).toFixed(1) + '%';
          ex.pct.textContent = Math.round(p * 100) + '%';
          ex.status.textContent = msg + (left != null && left > 1 ? ` — المتبقي نحو ${left > 90 ? Math.round(left / 60) + ' د' : Math.ceil(left) + ' ث'}` : '');
        },
      });
      if (ex.url) URL.revokeObjectURL(ex.url);
      ex.url = URL.createObjectURL(r.blob);
      const d = new Date(), p2 = n => String(n).padStart(2, '0');
      ex.video.src = ex.url;
      ex.link.href = ex.url;
      ex.link.download = `montaji-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}-${r.H >= r.W ? r.W : r.H}p.mp4`;
      ex.info.innerHTML = `الفيديو جاهز ✓ · <span dir="ltr">${r.W}×${r.H}</span> · ${r.fps} إطار/ث · ${(r.blob.size / 1048576).toFixed(1)} م.ب`
        + (r.audioDropped ? '<br>تنبيه: تعذّر ترميز الصوت على هذا المتصفح، فالملف بلا صوت.' : '');
      exShow('done');
      return { ok: true, width: r.W, height: r.H, fps: r.fps, size_mb: +(r.blob.size / 1048576).toFixed(1), file: ex.link.download, blob: r.blob };
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('فشل التصدير: ' + (e.message || e), 'err'); }
      exShow('form');
      return { ok: false, error: e.name === 'AbortError' ? 'أوقف المستخدم التصدير' : String(e.message || e) };
    } finally {
      ex.abort = null;
      view.exporting = false;
      syncMedia();
      dirty = true;
    }
  }

  /** تصدير يبدأ مباشرة بإعدادات محددة (يستخدمه المساعد الذكي) */
  async function exportVideo(o = {}) {
    layout();
    if (view.total <= 0) return { ok: false, error: 'المشروع فارغ' };
    if (!Exporter.supported()) return { ok: false, error: 'المتصفح لا يدعم التصدير — استخدم Chrome أو Edge' };
    if (ex.abort) return { ok: false, error: 'هناك تصدير جارٍ بالفعل' };
    if (o.res) ex.res.value = o.res;
    if (o.fps) ex.fps.value = o.fps;
    if (o.quality) ex.q.value = o.quality;
    ex.video.pause();
    ex.modal.hidden = false;
    const r = await startExport();
    const { blob, ...out } = r;
    // الحفظ في مجلد exports/ عبر الخادم المحلي: عميل MCP لا يستطيع الضغط على زر التنزيل
    if (r.ok && o.saveAs) {
      // فشل الحفظ لا يُلغي التصدير: الفيديو جاهز وزر التنزيل ظاهر، فنعيد النتيجة مع سبب الفشل
      let res, j;
      try {
        res = await fetch('/api/export/save?name=' + encodeURIComponent(o.saveAs), { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: blob });
        j = await res.json().catch(() => ({}));
      } catch (e) {
        return { ...out, save_error: 'the local server could not be reached: ' + (e.message || e) };
      }
      if (!res.ok || !j.ok) return { ...out, save_error: j.error || `HTTP ${res.status}` };
      out.saved_to = j.path;
      toast('حُفظ الفيديو في مجلد exports', 'ok');
    }
    return out;
  }

  $('#btnExport').onclick = openExport;
  $('#exCancel').onclick = closeExport;
  $('#exClose').onclick = closeExport;
  $('#exStart').onclick = startExport;
  $('#exAbort').onclick = () => ex.abort && ex.abort.abort();
  [ex.res, ex.fps, ex.q].forEach(s => s.addEventListener('change', exSummary));
  ex.modal.addEventListener('pointerdown', e => { if (e.target === ex.modal) closeExport(); });

  /* ================= مثال جاهز ================= */
  function sampleImage(c1, c2, seed) {
    const cv = document.createElement('canvas');
    cv.width = 1920; cv.height = 1280;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, cv.width, cv.height);
    grad.addColorStop(0, c1); grad.addColorStop(1, c2);
    g.fillStyle = grad; g.fillRect(0, 0, cv.width, cv.height);
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 16; i++) {
      g.globalAlpha = 0.06 + rnd() * 0.12;
      g.fillStyle = i % 3 ? '#fff' : '#000';
      g.beginPath();
      g.arc(rnd() * cv.width, rnd() * cv.height, 60 + rnd() * 340, 0, Math.PI * 2);
      g.fill();
    }
    // toDataURL متزامن ويعمل حتى لو كانت الصفحة في الخلفية (بعكس toBlob)
    const bin = atob(cv.toDataURL('image/jpeg', 0.92).split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  async function sampleMusic() {
    const sr = 48000, dur = 14;
    const oc = new OfflineAudioContext(2, sr * dur, sr);
    const master = oc.createGain(); master.gain.value = 0.5; master.connect(oc.destination);
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
    const bar = 1.75;
    const tone = (freq, at, len, type, vol, attack) => {
      const o = oc.createOscillator(), g = oc.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, at + len);
      o.connect(g).connect(master);
      o.start(at); o.stop(at + len + 0.05);
    };
    for (let b = 0; b < dur / bar; b++) {
      const ch = chords[b % chords.length], at = b * bar;
      ch.forEach(f => tone(f, at, bar * 1.15, 'sine', 0.16, 0.25));
      tone(ch[0] / 2, at, bar, 'triangle', 0.22, 0.03);
      const arp = [ch[0], ch[1], ch[2], ch[1] * 2, ch[2], ch[1]];
      arp.forEach((f, i) => tone(f * 2, at + i * bar / 6, 0.5, 'triangle', 0.1, 0.012));
    }
    const buf = await oc.startRendering();
    return new Blob([AudioTools.wav(AudioTools.process(buf))], { type: 'audio/wav' });
  }

  async function loadSample() {
    els.busy.hidden = false;
    try {
      const pal = [['#ff7a59', '#7a1f5c'], ['#12c2a0', '#0b3a6e'], ['#ffd166', '#e0456b']];
      const files = [];
      for (let i = 0; i < pal.length; i++) files.push(new File([await sampleImage(pal[i][0], pal[i][1], 7 + i * 13)], `صورة-${i + 1}.jpg`, { type: 'image/jpeg' }));
      files.push(new File([await sampleMusic()], 'لحن-تجريبي.wav', { type: 'audio/wav' }));
      await addFiles(files);
      const motions = ['zoomIn', 'panRight', 'zoomOut'];
      state.clips.forEach((c, i) => { c.motion = motions[i % 3]; if (i) c.transition = ['fade', 'slide'][(i - 1) % 2]; });
      const base = { x: 0.5, size: 0.1, color: '#ffffff', font: 'segoe', bold: true, stroke: false, strokeColor: '#000000', bg: false, bgColor: '#000000', shadow: true };
      state.texts.push({ ...base, id: uid(), text: 'أهلاً بك في مونتاجي', start: 0.3, dur: 3.4, y: 0.5, anim: 'rise' });
      state.texts.push({ ...base, id: uid(), text: 'جرّب تعديل أي عنصر ثم صدّر الفيديو', start: 8.4, dur: 3.3, y: 0.82, size: 0.065, bg: true, anim: 'fade' });
      touch();
      fitTimeline();
    } catch (e) {
      console.error(e);
      toast('تعذّر إنشاء المثال', 'err');
    }
    els.busy.hidden = true;
  }

  /* ================= ربط الأزرار والاختصارات ================= */
  $('#btnAddMedia').onclick = () => els.fileMedia.click();
  $('#btnEmptyAdd').onclick = () => els.fileMedia.click();
  $('#btnAddMusic').onclick = () => els.fileMusic.click();
  $('#btnAddText').onclick = addText;
  $('#btnAddEffect').onclick = () => addEffect();
  $('#btnAddOverlay').onclick = () => $('#fileOverlay').click();
  $('#fileOverlay').onchange = e => { addOverlayFiles(e.target.files); e.target.value = ''; };
  $('#btnCaptions').onclick = () => Captions.open();
  $('#btnCapExport').onclick = () => Captions.exportFile('srt');
  $('#btnSample').onclick = loadSample;
  els.fileMedia.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  els.fileMusic.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('#btnPlay').onclick = togglePlay;
  $('#btnStart').onclick = () => { setTime(0); els.tlScroll.scrollLeft = 0; };
  $('#btnSplit').onclick = splitAtPlayhead;
  $('#btnDup').onclick = dupSel;
  $('#btnDel').onclick = () => (selObj() ? removeSel() : toast('حدّد عنصراً أولاً لحذفه'));
  $('#btnFit').onclick = fitTimeline;
  els.btnProps.onclick = () => setSheet(!sheetOpen());
  $('#propsClose').onclick = () => setSheet(false);
  els.btnUndo.onclick = undo;
  els.btnRedo.onclick = redo;
  els.zoom.oninput = () => { view.pps = +els.zoom.value; renderTimeline(); };
  els.ratio.onchange = () => { state.ratio = els.ratio.value; applyRatio(); touch(); };

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'textarea' || tag === 'select' || (tag === 'input' && !['range', 'checkbox', 'color'].includes(e.target.type));
    if (ProjectIO.isBusy()) { if (e.ctrlKey || e.metaKey) e.preventDefault(); return; }
    if (!ex.modal.hidden) { if (e.key === 'Escape') closeExport(); return; }
    if (ImageStudio.isOpen() || AudioExtract.isOpen() || VideoSplit.isOpen()) return; // للنوافذ الأدوات اختصاراتها
    if (Captions.isOpen()) { if (e.key === 'Escape') Captions.close(); return; }
    // حفظ وفتح المشروع يعملان حتى أثناء الكتابة، كي لا يفتح المتصفح نافذة «حفظ الصفحة»
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.code === 'KeyS' || e.code === 'KeyO')) {
      e.preventDefault();
      if (e.code === 'KeyS') ProjectIO.save(); else ProjectIO.pick();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 'd') { e.preventDefault(); dupSel(); }
      return;
    }
    if (typing) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const obj = selObj();
      if (!obj) return;
      e.preventDefault();
      // نُقرت نقطة إطار مفتاحي للتو: يُحذف الإطار لا العنصر
      if (kfSel && kfSel.id === obj.id && kfTimes(obj).some(t => Math.abs(t - kfSel.t) < 0.02)) {
        removeKey(obj, null, kfSel.t);
        kfSel = null;
        touch();
        renderProps();
      } else removeSel();
    }
    else if (e.code === 'KeyS') splitAtPlayhead();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (view.playing) pause();
      setTime(view.t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / 30));
    } else if (e.key === 'Escape') select(null);
  });

  // السحب والإفلات من مدير الملفات
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; els.dropOverlay.hidden = false; } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; els.dropOverlay.hidden = true; } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; els.dropOverlay.hidden = true;
    if (ImageStudio.isOpen()) ImageStudio.addFiles(e.dataTransfer.files);
    else if (AudioExtract.isOpen()) AudioExtract.addFiles(e.dataTransfer.files);
    else if (VideoSplit.isOpen()) VideoSplit.addFiles(e.dataTransfer.files);
    else addFiles(e.dataTransfer.files);
  });

  // القوائم المنسدلة («مشروع» و«أدوات»): تُغلق عند اختيار عنصر أو النقر خارجها أو Escape
  const menus = [...document.querySelectorAll('.menu-wrap')].map(w => ({ wrap: w, btn: $('.btn', w), menu: $('.menu', w) }));
  const toggleMenu = (m, on) => { m.menu.hidden = !on; m.btn.setAttribute('aria-expanded', String(on)); };
  for (const m of menus) {
    m.btn.onclick = () => { const on = m.menu.hidden; menus.forEach(o => toggleMenu(o, o === m && on)); };
    m.menu.addEventListener('click', e => { if (e.target.closest('.menu-item')) toggleMenu(m, false); });
  }
  window.addEventListener('pointerdown', e => { for (const m of menus) if (!m.menu.hidden && !m.wrap.contains(e.target)) toggleMenu(m, false); });
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    for (const m of menus) if (!m.menu.hidden) { toggleMenu(m, false); m.btn.focus(); }
  }, true);

  window.addEventListener('resize', () => { readLabelW(); renderTimeline(); });
  window.addEventListener('beforeunload', e => { if (!isEmpty()) { e.preventDefault(); e.returnValue = ''; } });

  /* ================= البدء ================= */
  applyRatio();
  refresh();
  renderProps();
  pushHist();
  requestAnimationFrame(loop);

  // واجهة يستخدمها المساعد الذكي (js/agent.js) ووحدة التحكم
  window.studio = {
    state, view, addFiles, loadProject, isEmpty, loadSample, setTime, play, pause,
    refresh, commit, pushHist, undo, redo, select, renderProps, fitTimeline, setRatio, cloneItem, exportVideo, toast, addEffect,
    touch, listOf, setList, splitItem, dupItem, addOverlayFiles, asOverlay, toOverlay, toMain, freeTrack,
  };
})();
