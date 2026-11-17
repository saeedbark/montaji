'use strict';
/* تقسيم الفيديو: يقطع ملف فيديو إلى أجزاء تُحفظ ملفات MP4 منفصلة (كل مدة، أجزاء متساوية، أو أوقات محددة)،
   أو تُوضع مقاطع متتابعة على الخط الزمني.
   MP4/MOV بترميز H.264 أو HEVC وصوت AAC يُنسخ مباشرة بلا إعادة ترميز (js/videotools.js): سريع وبلا فقدان،
   والقطع عند أقرب إطار مفتاحي. غيره (WebM مثلاً) يُعاد ترميزه إطاراً إطاراً بـWebCodecs، والقطع دقيق. */

const VideoSplit = (() => {
  const S = window.studio;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const SR = 48000;
  const EVERY = [15, 30, 60, 90];

  const el = {
    modal: $('#splitModal'), body: $('#splitBody'), name: $('#splitName'), file: $('#fileSplit'),
    busy: $('#splitBusy'), busyText: $('#splitBusyText'), bar: $('#splitBarFill'), barWrap: $('#splitBar'), abort: $('#splitAbort'),
  };

  const st = {
    ctx: null, range: { s: 0, e: 0 }, mode: 'every', every: 30, count: 3, timesText: '', audio: true,
    exact: false, // قطع دقيق بإعادة الترميز حتى لو أمكن النسخ المباشر
    parts: [], job: null,
  };

  const isOpen = () => !el.modal.hidden;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const r1 = n => Math.round(n * 10) / 10;
  const fmtSize = n => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} ${tt('ك.ب', 'KB')}` : `${(n / 1048576).toFixed(1)} ${tt('م.ب', 'MB')}`);
  const abortError = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };
  const nParts = n => (I18N.lang === 'en' ? `${n} parts` : n === 2 ? 'جزأين' : n <= 10 ? `${n} أجزاء` : `${n} جزءاً`);
  const baseName = name => String(name || '').replace(/\.[^.\\/]+$/, '') || 'video';
  function partNames(name, n) {
    const w = Math.max(2, String(n).length);
    return [...Array(n)].map((_, i) => `${baseName(name)}_${String(i + 1).padStart(w, '0')}.mp4`);
  }

  /* ================= تجهيز الملف ================= */

  /** يحمّل بيانات الفيديو في عنصر video. WebM المسجَّل بـMediaRecorder بلا مدة، فنقفز إلى النهاية لنعرفها */
  function loadMeta(v, url) {
    return new Promise(res => {
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true; clearTimeout(timer);
        v.onloadedmetadata = v.onerror = v.ondurationchange = null;
        res(ok);
      };
      const timer = setTimeout(() => finish(false), 20000);
      v.onerror = () => finish(false);
      v.onloadedmetadata = async () => {
        if (!isFinite(v.duration)) {
          await new Promise(r => {
            const t = setTimeout(r, 6000);
            v.ondurationchange = () => { if (isFinite(v.duration)) { clearTimeout(t); r(); } };
            v.currentTime = 1e9;
          });
          v.currentTime = 0;
        }
        finish(isFinite(v.duration) && v.duration > 0 && v.videoWidth > 0);
      };
      v.src = url;
    });
  }

  /**
   * يجهّز ملفاً للتقسيم: يقرأ بنية MP4 إن أمكن (للنسخ المباشر)، ويحمّله في عنصر video (للمعاينة وإعادة الترميز).
   * يرمي خطأً بالعربية يصلح لعرضه مباشرة.
   */
  async function prepare(file) {
    let info = null;
    try { info = await VideoTools.parseMp4(VideoTools.blobSource(file)); } catch (e) { info = null; }
    const copy = !!(info && info.copy);
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true;
    const playable = await loadMeta(v, url);
    if (!playable && !copy) {
      URL.revokeObjectURL(url);
      throw new Error(tt('تعذّرت قراءة هذا الفيديو، أو أن صيغته غير مدعومة في المتصفح', 'This video could not be read, or its format is not supported by the browser'));
    }
    return {
      file, url, v, playable, info: copy ? info : null,
      dur: copy ? info.duration : v.duration,
      hasAudio: copy ? !!info.audio : null, // null: لا نعرف قبل فك الصوت
      pcm: undefined,
    };
  }

  function release(ctx) {
    if (!ctx) return;
    ctx.v.pause();
    ctx.v.removeAttribute('src');
    ctx.v.load();
    URL.revokeObjectURL(ctx.url);
  }

  /** الأجزاء الفعلية: بعد المحاذاة إلى الإطارات المفتاحية في النسخ المباشر، وبالمواضع نفسها في إعادة الترميز */
  function partsFor(ctx, o) {
    const start = clamp(o.start ?? 0, 0, ctx.dur), end = clamp(o.end ?? ctx.dur, start, ctx.dur);
    const cuts = VideoTools.planCuts({ start, end, mode: o.mode, every: o.every, count: o.count, times: o.times });
    if (end - start < VideoTools.MIN_PART) return [];
    if (!ctx.info || o.exact) return VideoTools.exactParts(start, end, cuts);
    if (o.mode === 'every') return VideoTools.copyParts(ctx.info, { start, end, every: Math.max(VideoTools.MIN_PART, +o.every || 0) });
    return VideoTools.copyParts(ctx.info, { start, end, cuts });
  }

  /* ================= إعادة الترميز (لغير MP4) ================= */

  const waitDequeue = enc => Promise.race([
    new Promise(r => enc.addEventListener('dequeue', r, { once: true })),
    new Promise(r => setTimeout(r, 1500)),
  ]);

  async function pcmOf(ctx) {
    if (ctx.pcm === undefined) {
      try { ctx.pcm = await decodeAudioFile(ctx.file); } catch (e) { ctx.pcm = null; }
      if (ctx.pcm && ctx.pcm.length < SR * 0.05) ctx.pcm = null;
      ctx.hasAudio = !!ctx.pcm;
    }
    return ctx.pcm;
  }

  async function encodePart(ctx, part, { audio, signal, onProgress }) {
    if (!Exporter.supported()) throw new Error(tt('متصفحك لا يدعم ترميز الفيديو. استخدم Chrome أو Edge بإصدار حديث.', 'Your browser cannot encode video. Use a recent Chrome or Edge.'));
    if (!ctx.playable) throw new Error(tt('المتصفح لا يستطيع عرض هذا الفيديو، فلا يمكن إعادة ترميزه', 'The browser cannot play this video, so it cannot be re-encoded'));
    const v = ctx.v;
    v.pause();
    const k = Math.min(1, 3840 / Math.max(v.videoWidth, v.videoHeight), 2160 / Math.min(v.videoWidth, v.videoHeight));
    const W = even(v.videoWidth * k), H = even(v.videoHeight * k), fps = 30;
    const vcfg = await Exporter.pickVideoConfig(W, H, fps, Exporter.bitrateFor(W, H, fps, 'high'));
    const pcm = audio ? await pcmOf(ctx) : null;
    const acfg = pcm ? await Exporter.pickAudioConfig() : null;

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: vcfg.mux, width: W, height: H, frameRate: fps },
      audio: acfg ? { codec: acfg.mux, numberOfChannels: 2, sampleRate: SR } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let failure = null;
    const fail = e => { failure = failure || e; };
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d', { alpha: false });
    const venc = new VideoEncoder({ output: (c, m) => { try { muxer.addVideoChunk(c, m); } catch (e) { fail(e); } }, error: fail });
    venc.configure(vcfg.config);

    try {
      const N = Math.max(1, Math.round((part.end - part.start) * fps)), us = 1e6 / fps;
      for (let i = 0; i < N; i++) {
        if (signal && signal.aborted) throw abortError();
        if (failure) throw failure;
        await seekExact(v, part.start + i / fps);
        g.drawImage(v, 0, 0, W, H);
        const f = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
        venc.encode(f, { keyFrame: i % (fps * 2) === 0 });
        f.close();
        if (venc.encodeQueueSize > 6) await waitDequeue(venc);
        if (i % 4 === 0 && onProgress) onProgress(0.92 * i / N);
      }
      await venc.flush();
      if (failure) throw failure;

      if (acfg) {
        const aenc = new AudioEncoder({ output: (c, m) => { try { muxer.addAudioChunk(c, m); } catch (e) { fail(e); } }, error: fail });
        aenc.configure(acfg.config);
        const L = pcm.getChannelData(0), R = pcm.numberOfChannels > 1 ? pcm.getChannelData(1) : L;
        const s0 = Math.min(pcm.length, Math.round(part.start * SR)), s1 = Math.min(pcm.length, Math.round(part.end * SR));
        for (let off = s0; off < s1; off += 4800) {
          if (signal && signal.aborted) throw abortError();
          if (failure) throw failure;
          const n = Math.min(4800, s1 - off), data = new Float32Array(n * 2);
          data.set(L.subarray(off, off + n), 0);
          data.set(R.subarray(off, off + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off - s0) / SR * 1e6), data });
          aenc.encode(ad);
          ad.close();
          if (aenc.encodeQueueSize > 30) await waitDequeue(aenc);
        }
        await aenc.flush();
        aenc.close();
        if (failure) throw failure;
      }
      muxer.finalize();
      if (onProgress) onProgress(1);
      return new Uint8Array(muxer.target.buffer);
    } finally {
      try { if (venc.state !== 'closed') venc.close(); } catch (e) {}
    }
  }

  /* ================= التقسيم ================= */

  /** يصنع جزءاً واحداً. يعيد Uint8Array لملف MP4 */
  function makePart(ctx, part, opts) {
    if (ctx.info && !opts.exact) return VideoTools.copyPart(VideoTools.blobSource(ctx.file), ctx.info, part, Mp4Muxer, opts);
    return encodePart(ctx, part, opts);
  }

  /** يصنع الأجزاء واحداً بعد الآخر ويسلّم كلاً منها لـsink فور جاهزيته، فلا تجتمع كلها في الذاكرة */
  async function run(ctx, parts, indices, { audio, exact, signal, onProgress, sink }) {
    const names = partNames(ctx.file.name, parts.length), out = [];
    for (let q = 0; q < indices.length; q++) {
      const i = indices[q];
      const bytes = await makePart(ctx, parts[i], {
        audio, exact, signal,
        onProgress: p => onProgress && onProgress((q + p) / indices.length, i),
      });
      const blob = new Blob([bytes], { type: 'video/mp4' });
      out.push({ index: i, name: names[i], size: blob.size, ...(await sink(blob, names[i])) });
    }
    return out;
  }

  /** يحفظ الملف في مجلد exports/ عبر الخادم المحلي */
  async function saveToExports(blob, name) {
    let res, j;
    try {
      res = await fetch('/api/export/save?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: blob });
      j = await res.json().catch(() => ({}));
    } catch (e) { throw new Error('the local server could not be reached: ' + (e.message || e)); }
    if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return { saved_to: j.path };
  }

  /**
   * يقسم ملفاً ويحفظ الأجزاء في مجلد exports/ (يستخدمه المساعد الذكي).
   * o: { start, end, mode, every, count, times, audio, exact }
   */
  async function splitToFiles(file, o) {
    const ctx = await prepare(file);
    try {
      let exact = !!o.exact && !!ctx.info, fallback = false, mismatch = false;
      // النسخ المباشر يقطع عند الإطارات المفتاحية؛ إن كانت بعيدة عن المواضع المطلوبة (ملف بإطار مفتاحي واحد مثلاً)
      // تتغير الأجزاء كلياً، فنعيد الترميز بقطع دقيق بدلاً منه
      if (ctx.info && !exact) {
        const want = partsFor(ctx, { ...o, exact: true }), got = partsFor(ctx, o);
        if (want.length && !VideoTools.copyFits(got, want, o.mode === 'every' ? +o.every || 0 : 0)) {
          if (Exporter.supported()) exact = fallback = true; else mismatch = true;
        }
      }
      const parts = partsFor(ctx, { ...o, exact });
      if (!parts.length) throw new Error('The range is too short to split.');
      if ((!ctx.info || exact) && !Exporter.supported()) throw new Error('This browser cannot encode video. Use a recent Chrome or Edge.');
      const files = await run(ctx, parts, parts.map((_, i) => i), { audio: o.audio !== false, exact, sink: saveToExports });
      return {
        method: ctx.info && !exact ? 'copy' : 'reencode',
        ...(fallback ? { keyframe_fallback: true } : {}),
        ...(mismatch ? { keyframe_mismatch: true } : {}),
        source_duration: r1(ctx.dur),
        parts: files.map(f => ({
          file: f.name, saved_to: f.saved_to, size_kb: Math.round(f.size / 1024),
          start: r1(parts[f.index].start), end: r1(parts[f.index].end), duration: r1(parts[f.index].end - parts[f.index].start),
        })),
      };
    } finally { release(ctx); }
  }

  /* ================= النافذة ================= */

  function show() {
    S.pause();
    el.modal.hidden = false;
  }

  function open(files) {
    show();
    if (files && files.length) return addFiles(files);
    render();
  }

  /** يفتح ملف مقطع من المشروع، والنطاق = الجزء المستخدم منه في المشروع */
  function openClip(clip) {
    show();
    return load(clip.file, { s: clip.in, e: clip.out }, clip.id);
  }

  function close() {
    if (st.job) st.job.abort();
    stopPlay();
    el.modal.hidden = true;
  }

  const isVideo = f => /^video\//.test(f.type || '') || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.name || '');

  function addFiles(list) {
    const files = [...list].filter(isVideo);
    if (!files.length) return S.toast(tt('اختر ملف فيديو', 'Choose a video file'), 'err');
    if (files.length > 1) S.toast(tt('يُفتح فيديو واحد في كل مرة — فُتح الأول', 'One video at a time — the first one was opened'), 'err');
    return load(files[0]);
  }

  async function load(file, range, clipId = null) {
    stopPlay();
    busy(tt('جارٍ قراءة الفيديو…', 'Reading the video…'));
    try {
      const ctx = await prepare(file);
      release(st.ctx);
      st.ctx = ctx;
      const d = ctx.dur;
      st.range = range ? { s: clamp(range.s, 0, d), e: clamp(range.e, 0, d) } : { s: 0, e: d };
      if (st.range.e - st.range.s < VideoTools.MIN_PART) st.range = { s: 0, e: d };
      // من مقطع في المشروع: نتذكره (ليُقسَّم في مكانه) ونتذكر الجزء المستخدم منه إن لم يكن الفيديو كله
      ctx.clipId = clipId;
      ctx.clipRange = range && !(same(st.range.s, 0) && same(st.range.e, d)) ? { ...st.range } : null;
      st.timesText = '';
      if (st.mode === 'count' && d < st.count * VideoTools.MIN_PART) st.count = 2;
    } catch (e) {
      console.error(e);
      S.toast(`${file.name}: ${e.message}`, 'err');
    }
    busy(false);
    render();
  }

  const same = (a, b) => Math.abs(a - b) < 0.051;
  const canExact = ctx => !!(ctx.info && ctx.playable && Exporter.supported());
  const projectClip = ctx => (ctx.clipId ? state.clips.find(c => c.id === ctx.clipId) || null : null);
  function rangeKind() {
    const c = st.ctx, r = st.range;
    if (c.clipRange && same(r.s, c.clipRange.s) && same(r.e, c.clipRange.e)) return 'clip';
    return same(r.s, 0) && same(r.e, c.dur) ? 'all' : '';
  }

  const opts = () => ({
    start: st.range.s, end: st.range.e, mode: st.mode, every: st.every, count: st.count,
    times: VideoTools.parseTimes(st.timesText).times,
    exact: st.exact && canExact(st.ctx),
  });

  const chips = (k, list, on, cls = '') =>
    `<div class="chips ${cls}" data-k="${k}">${list.map(([v, l]) => `<button type="button" class="chip${String(v) === String(on) ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const numRow = (k, label, val, unit, min, step) =>
    `<label class="row"><span>${label}</span><input type="number" data-k="${k}" min="${min}" step="${step}" value="${val}" dir="ltr"><span class="unit">${unit}</span></label>`;

  function render() {
    const ctx = st.ctx;
    if (!ctx) {
      el.name.textContent = '';
      el.body.innerHTML = `<div class="empty-card aud-empty">
          <svg class="ic big"><use href="#i-split"/></svg>
          <h1>${tt('قسّم فيديو إلى أجزاء', 'Split a video into parts')}</h1>
          <p>${tt('اسحب ملف فيديو وأفلته هنا، أو اختره من جهازك. اختر بعدها كيف تقسمه — كل 30 ثانية مثلاً لحالات واتساب وإنستغرام — ونزّل كل جزء ملف MP4 مستقلاً.', 'Drag and drop a video file here, or pick it from your device. Then choose how to split it — every 30 seconds for WhatsApp or Instagram stories, say — and download each part as its own MP4 file.')}</p>
          <div class="empty-actions"><button class="btn primary" data-act="pick">${tt('اختيار فيديو', 'Choose video')}</button></div>
          <small>${tt('يجري كل شيء على جهازك — لا يُرفع شيء إلى الإنترنت.', 'Everything runs on your device — nothing is uploaded.')}</small>
        </div>`;
      return;
    }
    el.name.textContent = ctx.file.name;
    let how = '';
    if (st.mode === 'every') {
      how = chips('every', EVERY.map(s => [s, `${s} ${tt('ث', 's')}`]), st.every) + numRow('every', tt('مدة الجزء', 'Part length'), r1(st.every), tt('ث', 's'), VideoTools.MIN_PART, 1);
    } else if (st.mode === 'count') {
      how = numRow('count', tt('عدد الأجزاء', 'Number of parts'), st.count, '', 2, 1);
    } else {
      how = `<textarea class="split-times" data-k="times" rows="2" dir="ltr" placeholder="0:30, 1:15, 2:00">${esc(st.timesText)}</textarea>
        <p class="sub wrap">${tt('اكتب مواضع القطع مفصولة بفواصل، أو شغّل الفيديو واضغط «قطع هنا» عند كل موضع.', 'Write the cut points separated by commas, or play the video and press “Cut here” at each point.')}</p>`;
    }
    const exact = st.exact && canExact(ctx), inProject = projectClip(ctx);
    const method = !ctx.info
      ? tt(`<b>إعادة ترميز</b> — صيغة هذا الملف لا تسمح بالنسخ المباشر، فيُرمَّز كل جزء من جديد (30 إطاراً/ث). القطع دقيق لكنه أبطأ.`, `<b>Re-encode</b> — this file’s format does not allow a direct copy, so each part is encoded again (30 fps). Cuts are exact but slower.`)
      : exact
        ? tt(`<b>قطع دقيق بإعادة الترميز</b> — يقع كل قطع عند الموضع المطلوب تماماً، لكن التقسيم أبطأ ويُضغط الفيديو من جديد (30 إطاراً/ث).`, `<b>Exact cuts by re-encoding</b> — every cut lands exactly where you asked, but splitting is slower and the video is compressed again (30 fps).`)
        : tt(`<b>نسخ مباشر بلا إعادة ترميز</b> — سريع وبالجودة الأصلية نفسها. يقع كل قطع عند أقرب إطار مفتاحي قبله، لذا قد تختلف المواضع قليلاً عمّا طلبت.`, `<b>Direct copy, no re-encoding</b> — fast and at the original quality. Each cut lands on the nearest keyframe before it, so points may differ slightly from what you asked.`);
    const ranges = [['all', tt('الفيديو كاملاً', 'Whole video')]];
    if (ctx.clipRange) ranges.push(['clip', tt('الجزء المستخدم في المشروع', 'Part used in the project')]);
    el.body.innerHTML = `
      <div class="split-stage" id="splitStage">${ctx.playable ? '' : `<p class="sub">${tt('المتصفح لا يستطيع عرض هذا الفيديو، لكن يمكن تقسيمه.', 'The browser cannot play this video, but it can still be split.')}</p>`}</div>
      <div class="split-track" id="splitTrack" dir="ltr"></div>
      <div class="aud-transport">
        <button class="btn icon play" data-act="play" title="${tt('تشغيل / إيقاف (مسافة)', 'Play / pause (Space)')}"${ctx.playable ? '' : ' disabled'}><svg class="ic"><use id="splitPlayIcon" href="#i-play"/></svg></button>
        <span class="time" id="splitTime" dir="ltr"></span>
        <div class="spacer"></div>
        ${st.mode === 'times' ? `<button class="btn small" data-act="cut" title="${tt('إضافة موضع قطع عند المؤشر (C)', 'Add a cut point at the playhead (C)')}"><svg class="ic"><use href="#i-split"/></svg>${tt('قطع هنا', 'Cut here')}</button>` : ''}
      </div>
      <div class="aud-grid">
        <div>
          <h3>${tt('طريقة التقسيم', 'How to split')}</h3>
          ${chips('mode', [['every', tt('كل مدة', 'Every…')], ['count', tt('أجزاء متساوية', 'Equal parts')], ['times', tt('أوقات محددة', 'Set times')]], st.mode, 'tabs')}
          <div class="split-how">${how}</div>
          <h3>${tt('النطاق', 'Range')}</h3>
          ${chips('range', ranges, rangeKind())}
          ${numRow('s', tt('من', 'From'), r1(st.range.s), tt('ث', 's'), 0, 0.1)}
          ${numRow('e', tt('إلى', 'To'), r1(st.range.e), tt('ث', 's'), 0, 0.1)}
          <label class="row check"><input type="checkbox" data-k="audio"${st.audio ? ' checked' : ''}${ctx.hasAudio === false ? ' disabled' : ''}><span>${ctx.hasAudio === false ? tt('هذا الفيديو بلا صوت', 'This video has no sound') : tt('إبقاء الصوت', 'Keep the sound')}</span></label>
          ${canExact(ctx) ? `<label class="row check" title="${tt('بلا هذا الخيار يُنسخ الفيديو كما هو، فيقع القطع عند أقرب إطار مفتاحي', 'Without this the video is copied as is, so cuts land on the nearest keyframe')}"><input type="checkbox" data-k="exact"${st.exact ? ' checked' : ''}><span>${tt('قطع دقيق عند المواضع المطلوبة (إعادة ترميز، أبطأ)', 'Exact cuts at the requested points (re-encode, slower)')}</span></label>` : ''}
        </div>
        <div>
          <h3>${tt('الأجزاء', 'Parts')} <span id="splitCount"></span></h3>
          <ol class="split-list" id="splitList"></ol>
          <p class="ex-summary">${method}</p>
        </div>
      </div>
      <div class="dialog-actions split-actions">
        <button class="btn" data-act="add"${ctx.playable ? '' : ' disabled'} title="${inProject ? tt('يُقسَّم المقطع في مكانه على الخط الزمني', 'The clip is split in place on the timeline') : tt('يُضاف الفيديو إلى آخر الخط الزمني مقسَّماً', 'The video is added, split, at the end of the timeline')} — ${tt('القطع في المشروع عند المواضع المطلوبة تماماً', 'cuts in the project land exactly where asked')}"><svg class="ic"><use href="#i-media"/></svg><span>${inProject ? tt('تقسيم المقطع في المشروع', 'Split the clip in the project') : tt('إضافة الأجزاء إلى المشروع', 'Add the parts to the project')}</span></button>
        <button class="btn primary" data-act="all"><svg class="ic"><use href="#i-download"/></svg><span id="splitAllLabel">${tt('تنزيل كل الأجزاء', 'Download all parts')}</span></button>
      </div>`;
    if (ctx.playable) $('#splitStage').append(ctx.v);
    update();
  }

  /** يعيد حساب الأجزاء ويرسم القائمة والشريط دون إعادة بناء الحقول (كي لا يضيع موضع الكتابة) */
  function update() {
    const ctx = st.ctx;
    if (!ctx) return;
    st.parts = partsFor(ctx, opts());
    const n = st.parts.length, names = partNames(ctx.file.name, n);
    $('#splitCount').textContent = `(${n})`;
    $('#splitAllLabel').textContent = n > 1 ? tt(`تنزيل كل الأجزاء (${n})`, `Download all parts (${n})`) : tt('تنزيل الجزء', 'Download the part');
    el.body.querySelector('[data-act="all"]').disabled = !n;
    el.body.querySelector('[data-act="add"]').disabled = !n || !ctx.playable;
    const kind = rangeKind();
    el.body.querySelectorAll('[data-k="range"] .chip').forEach(c => c.classList.toggle('on', c.dataset.v === kind));
    $('#splitList').innerHTML = n ? st.parts.map((p, i) => `
      <li data-i="${i}" title="${esc(names[i])}">
        <span class="n">${i + 1}</span>
        <span class="t" dir="ltr">${fmtTime(p.start)} – ${fmtTime(p.end)}</span>
        <span class="d" dir="ltr">${fmtTime(p.end - p.start)}</span>
        <button class="btn small icon" data-act="one" data-i="${i}" title="${tt('تنزيل هذا الجزء', 'Download this part')}" aria-label="${tt('تنزيل الجزء', 'Download part')} ${i + 1}"><svg class="ic"><use href="#i-download"/></svg></button>
      </li>`).join('') : `<li class="none">${tt('النطاق أقصر من أن يُقسم', 'The range is too short to split')}</li>`;

    const D = ctx.dur || 1, pc = t => `${(t / D * 100).toFixed(3)}%`;
    $('#splitTrack').innerHTML =
      `<i class="dim" style="left:0;width:${pc(st.range.s)}"></i><i class="dim" style="left:${pc(st.range.e)};right:0"></i>` +
      st.parts.map((p, i) => `<b class="seg${i % 2 ? ' alt' : ''}" style="left:${pc(p.start)};width:${pc(p.end - p.start)}"><span>${i + 1}</span></b>`).join('') +
      '<i class="head" id="splitHead"></i>';
    tick(true);
  }

  /* ---------- المعاينة ---------- */
  let playing = false;
  function play() {
    const v = st.ctx && st.ctx.v;
    if (!v || !st.ctx.playable) return;
    if (v.currentTime >= st.ctx.dur - 0.05) v.currentTime = 0;
    v.play().catch(() => {});
    playing = true;
    setIcon();
    requestAnimationFrame(() => tick());
  }
  function stopPlay() {
    if (st.ctx) st.ctx.v.pause();
    playing = false;
    setIcon();
  }
  function tick(once) {
    const ctx = st.ctx, head = $('#splitHead'), time = $('#splitTime');
    if (!ctx || !isOpen()) return;
    const t = ctx.v.currentTime || 0;
    if (head) head.style.left = `${(t / (ctx.dur || 1) * 100).toFixed(3)}%`;
    if (time) time.textContent = `${fmtTime(t)} / ${fmtTime(ctx.dur)}`;
    if (playing && ctx.v.paused) { playing = false; setIcon(); }
    if (!once && playing) requestAnimationFrame(() => tick());
  }
  function setIcon() { const i = $('#splitPlayIcon'); if (i) i.setAttribute('href', playing ? '#i-pause' : '#i-play'); }

  function seekFromTrack(e) {
    const ctx = st.ctx, track = e.currentTarget;
    if (!ctx || !ctx.playable) return;
    const rect = track.getBoundingClientRect();
    const at = ev => { ctx.v.currentTime = clamp((ev.clientX - rect.left) / rect.width, 0, 1) * ctx.dur; tick(true); };
    at(e);
    const move = ev => at(ev);
    const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
    track.setPointerCapture(e.pointerId);
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  }

  function cutHere() {
    if (!st.ctx || st.mode !== 'times') return;
    const t = r1(st.ctx.v.currentTime || 0);
    const { times } = VideoTools.parseTimes(st.timesText);
    if (times.some(x => Math.abs(x - t) < 0.05)) return;
    st.timesText = [...times, t].sort((a, b) => a - b).map(fmtTime).join(', ');
    const ta = el.body.querySelector('[data-k="times"]');
    if (ta) ta.value = st.timesText;
    update();
  }

  /* ---------- التنزيل ---------- */
  function busy(msg, progress) {
    el.busy.hidden = !msg;
    if (!msg) return;
    el.busyText.textContent = msg;
    el.barWrap.hidden = progress === undefined;
    el.abort.hidden = progress === undefined;
    if (progress !== undefined) el.bar.style.width = `${Math.round(progress * 100)}%`;
  }

  async function download(indices) {
    const ctx = st.ctx;
    if (!ctx || st.job || !indices.length) return;
    const exact = opts().exact;
    if ((!ctx.info || exact) && !Exporter.supported()) return S.toast(tt('متصفحك لا يدعم ترميز الفيديو. استخدم Chrome أو Edge بإصدار حديث.', 'Your browser cannot encode video. Use a recent Chrome or Edge.'), 'err');
    stopPlay();
    const ctl = new AbortController();
    st.job = ctl;
    const total = st.parts.length, parts = st.parts.slice();
    let bytes = 0;
    busy(tt('جارٍ التحضير…', 'Preparing…'), 0);
    try {
      const files = await run(ctx, parts, indices, {
        audio: st.audio, exact, signal: ctl.signal,
        onProgress: (p, i) => busy(tt(`جارٍ تجهيز الجزء ${i + 1} من ${total}…`, `Preparing part ${i + 1} of ${total}…`), p),
        sink: async (blob, name) => {
          bytes += blob.size;
          ImageTools.download(blob, name);
          await pause(indices.length > 1 ? 350 : 0); // المتصفح يتجاهل التنزيلات المتلاحقة جداً
          return {};
        },
      });
      S.toast(files.length > 1 ? tt(`نُزّل ${nParts(files.length)} (${fmtSize(bytes)})`, `Downloaded ${nParts(files.length)} (${fmtSize(bytes)})`) : tt(`نُزّل الجزء (${fmtSize(bytes)})`, `Part downloaded (${fmtSize(bytes)})`), 'ok');
      if (st.audio && ctx.hasAudio === false) render(); // عرفنا الآن أن الفيديو بلا صوت
    } catch (e) {
      if (e.name === 'AbortError') S.toast(tt('أُوقف التقسيم', 'Splitting stopped'));
      else { console.error(e); S.toast(tt('تعذّر التقسيم: ', 'Could not split: ') + (e.message || e), 'err'); }
    } finally {
      st.job = null;
      busy(false);
    }
  }

  /**
   * يضع الأجزاء مقاطع متتابعة على الخط الزمني. القطع هنا عند المواضع المطلوبة تماماً (المحرر لا يحتاج إطاراً مفتاحياً).
   * إن فُتحت النافذة من مقطع في المشروع يُقسَّم في مكانه، وإلا يُضاف الفيديو إلى آخر المشروع. خطوة تراجع واحدة.
   */
  async function addToProject() {
    const ctx = st.ctx;
    if (!ctx || st.job || !ctx.playable) return;
    const o = opts();
    stopPlay();
    busy(tt('جارٍ الإضافة إلى المشروع…', 'Adding to the project…'));
    try {
      let base = projectClip(ctx);
      const inPlace = !!base;
      if (!base) {
        const before = new Set(state.clips.map(c => c.id));
        await S.addFiles([ctx.file]);
        base = state.clips.find(c => !before.has(c.id) && c.type === 'video');
        if (!base) throw new Error(tt('تعذّر فتح الفيديو في المحرر', 'Could not open the video in the editor'));
      }
      const max = base.srcDur || ctx.dur, start = Math.min(o.start, max), end = Math.min(o.end, max);
      const parts = VideoTools.exactParts(start, end, VideoTools.planCuts({ ...o, start, end }));
      const clips = parts.map((p, i) => {
        const n = i ? S.cloneItem('clip', base) : base;
        n.in = p.start; n.out = p.end;
        if (i) n.transition = 'none';
        return n;
      });
      state.clips.splice(state.clips.indexOf(base), 1, ...clips);
      S.refresh(); S.commit();
      busy(false);
      close();
      S.select({ kind: 'clip', id: clips[0].id });
      S.renderProps();
      S.toast(clips.length > 1
        ? (inPlace ? tt(`قُسّم المقطع إلى ${nParts(clips.length)} على الخط الزمني`, `Clip split into ${nParts(clips.length)} on the timeline`) : tt(`أُضيف الفيديو إلى المشروع في ${nParts(clips.length)}`, `Video added to the project in ${nParts(clips.length)}`))
        : (inPlace ? tt('ضُبط المقطع على النطاق المختار', 'Clip trimmed to the chosen range') : tt('أُضيف الفيديو إلى المشروع', 'Video added to the project')), 'ok');
    } catch (e) {
      console.error(e);
      S.toast(tt('تعذّرت الإضافة: ', 'Could not add: ') + (e.message || e), 'err');
      busy(false);
    }
  }

  /* ================= الأحداث ================= */
  el.body.addEventListener('pointerdown', e => {
    if (e.target.closest('#splitTrack') && e.button === 0) { e.preventDefault(); seekFromTrack({ currentTarget: $('#splitTrack'), clientX: e.clientX, pointerId: e.pointerId }); }
  });

  el.body.addEventListener('input', e => {
    const t = e.target, k = t.dataset.k;
    if (!k || !st.ctx) return;
    if (k === 'times') { st.timesText = t.value; update(); }
    else if (k === 'audio') st.audio = t.checked;
    else if (k === 'exact') { st.exact = t.checked; render(); }
    else if (k === 'every' || k === 'count') {
      const v = +t.value;
      if (!isFinite(v) || v <= 0) return;
      if (k === 'every') {
        st.every = Math.max(VideoTools.MIN_PART, v);
        el.body.querySelectorAll('[data-k="every"] .chip').forEach(c => c.classList.toggle('on', +c.dataset.v === st.every));
      } else st.count = clamp(Math.round(v), 2, 100);
      update();
    }
  });

  el.body.addEventListener('change', e => {
    const t = e.target, k = t.dataset.k;
    if (!st.ctx) return;
    if (k === 's' || k === 'e') {
      const v = +t.value, D = st.ctx.dur;
      if (isFinite(v)) {
        if (k === 's') st.range.s = clamp(v, 0, st.range.e - VideoTools.MIN_PART);
        else st.range.e = clamp(v, st.range.s + VideoTools.MIN_PART, D);
      }
      t.value = r1(st.range[k]);
      update();
    } else if (k === 'times') {
      const { bad } = VideoTools.parseTimes(st.timesText);
      if (bad.length) S.toast(tt(`مواضع غير مفهومة: ${bad.join('، ')} — اكتبها هكذا: 1:30 أو 90`, `Could not read: ${bad.join(', ')} — write them like 1:30 or 90`), 'err');
    } else if (k === 'every' || k === 'count') t.value = k === 'every' ? r1(st.every) : st.count;
  });

  el.body.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'pick') el.file.click();
      else if (a === 'play') (playing ? stopPlay() : play());
      else if (a === 'cut') cutHere();
      else if (a === 'add') addToProject();
      else if (a === 'all') download(st.parts.map((_, i) => i));
      else if (a === 'one') download([+act.dataset.i]);
      return;
    }
    const li = e.target.closest('.split-list li[data-i]');
    if (li && st.ctx && st.ctx.playable) { st.ctx.v.currentTime = st.parts[+li.dataset.i].start; tick(true); return; }
    const chip = e.target.closest('.chip');
    if (!chip || !st.ctx) return;
    const k = chip.parentElement.dataset.k;
    if (k === 'mode') { st.mode = chip.dataset.v; render(); }
    else if (k === 'range') {
      st.range = chip.dataset.v === 'clip' && st.ctx.clipRange ? { ...st.ctx.clipRange } : { s: 0, e: st.ctx.dur };
      for (const key of ['s', 'e']) el.body.querySelector(`input[data-k="${key}"]`).value = r1(st.range[key]);
      update();
    }
    else if (k === 'every') {
      st.every = +chip.dataset.v;
      chip.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === chip));
      const inp = el.body.querySelector('input[data-k="every"]');
      if (inp) inp.value = st.every;
      update();
    }
  });

  $('#btnSplitVideo').onclick = () => open();
  $('#splitOpen').onclick = () => el.file.click();
  $('#splitClose').onclick = close;
  el.abort.onclick = () => st.job && st.job.abort();
  el.file.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  el.modal.addEventListener('pointerdown', e => { if (e.target === el.modal && !st.job) close(); });

  window.addEventListener('keydown', e => {
    if (!isOpen()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'textarea' || (tag === 'input' && e.target.type === 'number');
    if (e.key === 'Escape') { if (st.job) st.job.abort(); else close(); }
    else if (typing || st.job) return;
    else if (e.code === 'Space' && st.ctx) { e.preventDefault(); playing ? stopPlay() : play(); }
    else if (e.code === 'KeyC') cutHere();
  });

  return { open, openClip, addFiles, close, isOpen, splitToFiles, addToProject };
})();
