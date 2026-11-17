'use strict';
/* تحويل الفيديو إلى صوت: استخراج الموسيقى أو الكلام من فيديو (أو ملف صوتي)، اختيار جزء منه،
   ثم تنزيله بصيغة M4A أو WAV أو إضافته إلى المشروع. المعالجة نفسها في js/audiotools.js */

const AudioExtract = (() => {
  const S = window.studio;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const el = {
    modal: $('#audModal'), body: $('#audBody'), name: $('#audName'), busy: $('#audBusy'), file: $('#fileAud'),
  };
  const MIN_SEL = 0.1;

  const st = {
    file: null, name: '', buf: null, peaks: null, peaksW: 0,
    sel: { s: 0, e: 0 }, cursor: 0,
    format: 'm4a', bitrate: 192000, normalize: false, fadeIn: 0, fadeOut: 0,
    clipId: null, mute: true, m4a: true,
  };

  const isOpen = () => !el.modal.hidden;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const fmtSize = n => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} ${tt('ك.ب', 'KB')}` : `${(n / 1048576).toFixed(1)} ${tt('م.ب', 'MB')}`);
  const baseName = () => st.name.replace(/\.[^.\\/]+$/, '') || 'audio';
  const r1 = n => Math.round(n * 10) / 10;
  async function busy(msg) {
    el.busy.hidden = !msg;
    if (msg) { el.busy.textContent = msg; await pause(30); }
  }

  AudioTools.canM4A().then(ok => { st.m4a = ok; if (!ok) st.format = 'wav'; });

  /* ================= التحميل ================= */
  /** يفك صوت الملف. يرمي خطأً بالعربية يصلح لعرضه مباشرة */
  async function decode(file) {
    let buf;
    try { buf = await decodeAudioFile(file); } catch (e) { throw new Error(tt('هذا الملف بلا صوت، أو أن صيغة صوته غير مدعومة في المتصفح', 'This file has no sound, or its audio format is not supported by the browser')); }
    if (!buf || buf.length < buf.sampleRate * 0.05) throw new Error(tt('هذا الملف بلا صوت', 'This file has no sound'));
    return buf;
  }

  async function load(file, sel, clipId = null) {
    stop();
    await busy(tt('جارٍ قراءة الصوت…', 'Reading the audio…'));
    try {
      const buf = await decode(file);
      Object.assign(st, { file, name: file.name, buf, peaks: null, clipId, cursor: 0 });
      const d = buf.duration;
      st.sel = sel ? { s: clamp(sel.s, 0, d - MIN_SEL), e: clamp(sel.e, sel.s + MIN_SEL, d) } : { s: 0, e: d };
      st.cursor = st.sel.s;
      st.fadeIn = 0; st.fadeOut = 0;
      if (AudioTools.process(buf, { start: st.sel.s, end: st.sel.e }).peak < 1e-3) S.toast(tt('الصوت في هذا الجزء صامت تقريباً', 'The audio in this part is almost silent'), 'err');
    } catch (e) {
      console.error(e);
      S.toast(`${file.name}: ${e.message}`, 'err');
    }
    busy(false);
    render();
  }

  const isMedia = f => /^(video|audio)\//.test(f.type || '') || /\.(mp4|mov|webm|mkv|m4v|avi|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name || '');

  function addFiles(list) {
    const files = [...list].filter(isMedia);
    if (!files.length) return S.toast(tt('اختر ملف فيديو أو ملفاً صوتياً', 'Choose a video or audio file'), 'err');
    if (files.length > 1) S.toast(tt('يُفتح ملف واحد في كل مرة — فُتح الأول', 'One file at a time — the first one was opened'), 'err');
    return load(files[0]);
  }

  function show() {
    S.pause();
    el.modal.hidden = false;
  }

  function open(files) {
    show();
    if (files && files.length) return addFiles(files);
    render();
  }

  /** يفتح صوت مقطع فيديو من المشروع، والمدى المحدد = جزؤه الظاهر في الفيديو */
  function openClip(clip) {
    show();
    st.mute = true;
    return load(clip.file, { s: clip.in, e: clip.out }, clip.id);
  }

  function close() {
    stop();
    el.modal.hidden = true;
  }

  /* ================= العرض ================= */
  const slider = (k, label, min, max, step, val, unit = '') =>
    `<label class="row"><span>${label}</span><input type="range" data-k="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${val}${unit}</output></label>`;
  const chips = (k, opts, on) =>
    `<div class="chips" data-k="${k}">${opts.map(([v, l, dis]) => `<button type="button" class="chip${String(v) === String(on) ? ' on' : ''}" data-v="${v}"${dis ? ` disabled title="${tt('متصفحك لا يدعم ترميز AAC', 'Your browser cannot encode AAC')}"` : ''}>${l}</button>`).join('')}</div>`;

  function clip() { return st.clipId ? state.clips.find(c => c.id === st.clipId) || null : null; }

  function render() {
    if (!st.buf) {
      el.name.textContent = '';
      el.body.innerHTML = `<div class="empty-card aud-empty">
          <svg class="ic big"><use href="#i-wave"/></svg>
          <h1>${tt('استخرج الصوت من فيديو', 'Extract the sound from a video')}</h1>
          <p>${tt('اسحب ملف فيديو وأفلته هنا، أو اختره من جهازك. يمكنك بعدها اختيار جزء منه، ثم تنزيله ملفاً صوتياً أو إضافته موسيقى إلى مشروعك.', 'Drag and drop a video file here, or pick it from your device. Then choose a part of it and download it as an audio file or add it to your project as music.')}</p>
          <div class="empty-actions"><button class="btn primary" data-act="pick">${tt('اختيار فيديو', 'Choose video')}</button></div>
          <small>${tt('يجري كل شيء على جهازك — لا يُرفع شيء إلى الإنترنت.', 'Everything runs on your device — nothing is uploaded.')}</small>
        </div>`;
      return;
    }
    const c = clip(), len = st.sel.e - st.sel.s;
    el.name.textContent = st.name;
    el.body.innerHTML = `
      <div class="aud-wave" dir="ltr"><canvas id="audWave"></canvas></div>
      <div class="aud-transport">
        <button class="btn icon play" data-act="play" title="${tt('استماع (مسافة)', 'Listen (Space)')}"><svg class="ic"><use id="audPlayIcon" href="#i-play"/></svg></button>
        <span class="time" id="audTime" dir="ltr"></span>
        <div class="spacer"></div>
        <button class="btn small" data-act="all">${tt('تحديد الكل', 'Select all')}</button>
      </div>
      <div class="aud-grid">
        <div>
          <h3>${tt('الجزء المختار', 'Selected part')}</h3>
          <label class="row"><span>${tt('البداية', 'Start')}</span><input type="number" data-k="s" min="0" step="0.1" value="${r1(st.sel.s)}" dir="ltr"><span class="unit">${tt('ث', 's')}</span></label>
          <label class="row"><span>${tt('النهاية', 'End')}</span><input type="number" data-k="e" min="0" step="0.1" value="${r1(st.sel.e)}" dir="ltr"><span class="unit">${tt('ث', 's')}</span></label>
          <p class="sub">${tt('المدة', 'Length')} <b id="audLen" dir="ltr">${fmtTime(len)}</b> ${tt('من', 'of')} <span dir="ltr">${fmtTime(st.buf.duration)}</span></p>
          <h3>${tt('تحسينات', 'Enhancements')}</h3>
          <label class="row check"><input type="checkbox" data-k="normalize"${st.normalize ? ' checked' : ''}><span>${tt('توحيد مستوى الصوت', 'Normalize the volume')}</span></label>
          ${slider('fadeIn', tt('ظهور تدريجي', 'Fade in'), 0, 5, 0.1, st.fadeIn, tt('ث', 's'))}
          ${slider('fadeOut', tt('اختفاء تدريجي', 'Fade out'), 0, 5, 0.1, st.fadeOut, tt('ث', 's'))}
        </div>
        <div>
          <h3>${tt('صيغة الملف', 'File format')}</h3>
          ${chips('format', [['m4a', 'M4A (AAC)', !st.m4a], ['wav', 'WAV']], st.format)}
          <p class="sub wrap">${st.format === 'm4a' ? tt('حجم صغير، ويعمل على الهواتف وواتساب وكل المشغّلات.', 'Small, and plays on phones, WhatsApp and every player.') : tt('بلا ضغط ولا فقدان في الجودة، لكن حجمه كبير.', 'Uncompressed with no quality loss, but large.')}</p>
          ${st.format === 'm4a' ? chips('bitrate', AudioTools.BITRATES.map(b => [b, `${b / 1000} ${tt('ك.ب/ث', 'kbps')}`]), st.bitrate) : ''}
          <p class="ex-summary" id="audInfo"></p>
          ${c ? `<label class="row check"><input type="checkbox" data-k="mute"${st.mute ? ' checked' : ''}><span>${tt('كتم صوت المقطع الأصلي عند الإضافة', 'Mute the original clip when adding')}</span></label>` : ''}
        </div>
      </div>
      <div class="dialog-actions">
        <button class="btn" data-act="add" title="${tt('يُضاف إلى مسار الموسيقى', 'Added to the music track')}${c ? tt(' في موضع المقطع نفسه', ' at the clip’s position') : ''}"><svg class="ic"><use href="#i-music"/></svg><span>${tt('إضافة إلى المشروع', 'Add to project')}</span></button>
        <button class="btn primary" data-act="download"><svg class="ic"><use href="#i-download"/></svg><span>${tt('تنزيل الصوت', 'Download audio')}</span></button>
      </div>`;
    st.peaks = null;
    draw();
    info();
  }

  function info() {
    const len = st.sel.e - st.sel.s, box = $('#audInfo'), lenEl = $('#audLen');
    if (lenEl) lenEl.textContent = fmtTime(len);
    if (!box) return;
    const ch = Math.min(2, st.buf.numberOfChannels);
    const size = AudioTools.estimate(len, st.format, st.bitrate, ch, st.buf.sampleRate);
    box.innerHTML = `${AudioTools.FORMATS[st.format].label} · ${ch === 1 ? tt('أحادي', 'Mono') : tt('ستيريو', 'Stereo')} · ${tt('الحجم التقريبي', 'Approx. size')} <b>${fmtSize(size)}</b>`;
  }

  /* ---------- الموجة ---------- */
  function draw() {
    const cv = $('#audWave');
    if (!cv || !st.buf) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(10, Math.round(cv.clientWidth * dpr)), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const bars = Math.floor(W / (3 * dpr));
    if (!st.peaks || st.peaksW !== bars) { st.peaks = AudioTools.peaks(st.buf, bars); st.peaksW = bars; }
    const g = cv.getContext('2d'), D = st.buf.duration;
    const xs = st.sel.s / D * W, xe = st.sel.e / D * W, bw = W / bars;
    let top = 0;
    for (const p of st.peaks) if (p > top) top = p;
    const k = top > 1e-4 ? 1 / top : 0;

    g.clearRect(0, 0, W, H);
    for (let i = 0; i < bars; i++) {
      const x = i * bw, h = Math.max(dpr * 1.5, st.peaks[i] * k * (H - 8 * dpr));
      const inside = x + bw / 2 >= xs && x + bw / 2 <= xe;
      g.fillStyle = inside ? '#2ee0b2' : '#3a4251';
      g.fillRect(x + bw * 0.15, (H - h) / 2, bw * 0.7, h);
    }
    // المناطق المستبعدة أغمق، وحدود الجزء المختار بمقبضين
    g.fillStyle = 'rgba(13,15,19,.55)';
    g.fillRect(0, 0, xs, H); g.fillRect(xe, 0, W - xe, H);
    g.fillStyle = '#fff';
    for (const x of [xs, xe]) {
      g.fillRect(x - dpr, 0, 2 * dpr, H);
      g.fillRect(x - 4 * dpr, H / 2 - 12 * dpr, 8 * dpr, 24 * dpr);
    }
    const xc = st.cursor / D * W;
    g.fillStyle = THEME.color();
    g.fillRect(xc - dpr, 0, 2 * dpr, H);

    const t = $('#audTime');
    if (t) t.textContent = `${fmtTime(st.cursor)} / ${fmtTime(st.buf.duration)}`;
  }

  /** تحديد الجزء بالسحب على الموجة: مقبضا البداية والنهاية، أو سحب جديد من أي نقطة */
  function waveDrag(e) {
    const cv = e.currentTarget, rect = cv.getBoundingClientRect(), D = st.buf.duration;
    const tAt = ev => clamp((ev.clientX - rect.left) / rect.width, 0, 1) * D;
    const near = 10 / rect.width * D, t0 = tAt(e), old = { ...st.sel };
    let mode = Math.abs(t0 - st.sel.s) < near ? 's' : Math.abs(t0 - st.sel.e) < near ? 'e' : 'new';
    let moved = false;
    const onMove = ev => {
      const t = tAt(ev);
      if (!moved && Math.abs(ev.clientX - e.clientX) < 3) return;
      moved = true;
      if (mode === 's') st.sel.s = clamp(t, 0, st.sel.e - MIN_SEL);
      else if (mode === 'e') st.sel.e = clamp(t, st.sel.s + MIN_SEL, D);
      else {
        st.sel = t > t0 ? { s: t0, e: Math.max(t, t0 + MIN_SEL) } : { s: Math.min(t, t0 - MIN_SEL), e: t0 };
        st.sel.s = Math.max(0, st.sel.s); st.sel.e = Math.min(D, st.sel.e);
      }
      st.cursor = clamp(st.cursor, st.sel.s, st.sel.e);
      draw(); info(); syncInputs();
    };
    const onUp = () => {
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      if (!moved) { // نقرة: تحريك موضع الاستماع
        st.sel = old;
        st.cursor = clamp(t0, st.sel.s, st.sel.e - 0.01);
        if (playing) play(); else draw();
      } else if (playing) play();
    };
    cv.setPointerCapture(e.pointerId);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
  }

  function syncInputs() {
    for (const k of ['s', 'e']) {
      const inp = el.body.querySelector(`[data-k="${k}"]`);
      if (inp && document.activeElement !== inp) inp.value = r1(st.sel[k]);
    }
  }

  /* ---------- الاستماع ---------- */
  let actx = null, src = null, playing = false, from = 0, at = 0;
  function play() {
    stop(true);
    if (!st.buf) return;
    actx = actx || new AudioContext();
    actx.resume();
    if (st.cursor >= st.sel.e - 0.02 || st.cursor < st.sel.s) st.cursor = st.sel.s;
    const s = actx.createBufferSource();
    s.buffer = st.buf;
    s.connect(actx.destination);
    from = st.cursor; at = actx.currentTime;
    s.start(0, from, st.sel.e - from);
    s.onended = () => { if (src === s) { stop(); st.cursor = st.sel.s; draw(); } };
    src = s; playing = true;
    setIcon();
    requestAnimationFrame(tick);
  }
  function stop(keep) {
    if (src) { src.onended = null; try { src.stop(); } catch (e) {} src = null; }
    if (playing && !keep && actx) st.cursor = Math.min(st.sel.e, from + actx.currentTime - at);
    playing = false;
    setIcon();
  }
  function tick() {
    if (!playing || !isOpen()) return;
    st.cursor = Math.min(st.sel.e, from + actx.currentTime - at);
    draw();
    requestAnimationFrame(tick);
  }
  function setIcon() { const i = $('#audPlayIcon'); if (i) i.setAttribute('href', playing ? '#i-pause' : '#i-play'); }

  /* ================= الاستخراج ================= */
  const processed = () => AudioTools.process(st.buf, { start: st.sel.s, end: st.sel.e, normalize: st.normalize, fadeIn: st.fadeIn, fadeOut: st.fadeOut });

  async function download() {
    if (!st.buf) return;
    stop();
    try {
      await busy(tt('جارٍ تجهيز الصوت…', 'Preparing the audio…'));
      const r = await AudioTools.encode(processed(), st.format, {
        bitrate: st.bitrate,
        onProgress: p => { el.busy.textContent = tt('جارٍ الترميز…', 'Encoding…') + ` ${Math.round(p * 100)}%`; },
      });
      ImageTools.download(r.blob, `${baseName()}.${r.ext}`);
      S.toast(tt(`تم حفظ الصوت بصيغة ${r.ext.toUpperCase()} (${fmtSize(r.bytes.length)})`, `Audio saved as ${r.ext.toUpperCase()} (${fmtSize(r.bytes.length)})`), 'ok');
      if (r.ext !== AudioTools.FORMATS[st.format].ext) S.toast(tt('متصفحك لا يدعم ترميز M4A، فحُفظ الملف بصيغة WAV', 'Your browser cannot encode M4A, so the file was saved as WAV'), 'err');
    } catch (e) {
      console.error(e);
      S.toast(tt('تعذّر حفظ الصوت: ', 'Could not save the audio: ') + (e.message || e), 'err');
    }
    busy(false);
  }

  /**
   * يضيف الصوت المعالج إلى مسار الموسيقى. إن جاء من مقطع (بسرعته العادية) يوضع تحته تماماً فيبقى متزامناً معه.
   * يعيد عنصر الصوت الجديد. يستخدمه المساعد أيضاً.
   */
  async function addToProject(pcm, name, fromClip, mute) {
    const before = new Set(state.audios.map(a => a.id));
    const file = new File([AudioTools.wav(pcm)], name, { type: 'audio/wav' });
    await S.addFiles([file]);
    const item = state.audios.find(a => !before.has(a.id));
    if (!item) throw new Error(tt('تعذّرت إضافة الصوت', 'Could not add the audio'));
    if (fromClip.clip && state.clips.includes(fromClip.clip)) {
      const c = fromClip.clip;
      layout();
      // بسرعة غير 1 يبدأ الصوت مع المقطع نفسه ثم ينحرف عنه، لأن الصوت يُشغَّل بسرعته الأصلية
      item.start = Math.max(0, c._start + (fromClip.start - c.in) / (c.speed || 1));
      if (mute) c.muted = true;
    }
    item.fadeOut = 0; // التلاشي (إن طُلب) مطبّق في الملف نفسه
    S.refresh(); S.commit();
    return item;
  }

  async function add() {
    if (!st.buf) return;
    stop();
    const c = clip();
    try {
      await busy(tt('جارٍ الإضافة إلى المشروع…', 'Adding to the project…'));
      const item = await addToProject(processed(), `${baseName()}.wav`, { clip: c, start: st.sel.s }, st.mute);
      close();
      S.select({ kind: 'audio', id: item.id });
      S.toast(c && st.mute ? tt('أُضيف الصوت إلى مسار الموسيقى وكُتم صوت المقطع', 'Audio added to the music track and the clip was muted') : tt('أُضيف الصوت إلى مسار الموسيقى', 'Audio added to the music track'), 'ok');
    } catch (e) {
      console.error(e);
      S.toast(tt('تعذّرت الإضافة: ', 'Could not add: ') + (e.message || e), 'err');
    }
    busy(false);
  }

  /* ================= الأحداث ================= */
  el.body.addEventListener('pointerdown', e => {
    if (e.target.id === 'audWave' && e.button === 0 && st.buf) { e.preventDefault(); waveDrag(e); }
  });

  el.body.addEventListener('input', e => {
    const t = e.target, k = t.dataset.k;
    if (!k || !st.buf) return;
    if (t.type === 'range') {
      st[k] = +t.value;
      const out = t.parentElement.querySelector('output');
      if (out) out.textContent = t.value + (t.dataset.unit || '');
    } else if (t.type === 'checkbox') st[k] = t.checked;
  });

  el.body.addEventListener('change', e => {
    const t = e.target, k = t.dataset.k;
    if ((k !== 's' && k !== 'e') || !st.buf) return;
    const D = st.buf.duration, v = +t.value;
    if (!isFinite(v)) return syncInputs();
    if (k === 's') st.sel.s = clamp(v, 0, st.sel.e - MIN_SEL);
    else st.sel.e = clamp(v, st.sel.s + MIN_SEL, D);
    st.cursor = clamp(st.cursor, st.sel.s, st.sel.e);
    t.value = r1(st.sel[k]);
    draw(); info();
  });

  el.body.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'pick') el.file.click();
      else if (a === 'play') (playing ? stop() : play());
      else if (a === 'all') { st.sel = { s: 0, e: st.buf.duration }; syncInputs(); draw(); info(); }
      else if (a === 'download') download();
      else if (a === 'add') add();
      return;
    }
    const chip = e.target.closest('.chip');
    if (!chip || chip.disabled) return;
    const k = chip.parentElement.dataset.k;
    if (k === 'format') st.format = chip.dataset.v;
    else if (k === 'bitrate') st.bitrate = +chip.dataset.v;
    stop();
    render();
  });

  $('#btnAudio').onclick = () => open();
  $('#audOpen').onclick = () => el.file.click();
  $('#audClose').onclick = close;
  el.file.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  el.modal.addEventListener('pointerdown', e => { if (e.target === el.modal) close(); });

  window.addEventListener('keydown', e => {
    if (!isOpen()) return;
    const typing = (e.target.tagName || '').toLowerCase() === 'input' && e.target.type === 'number';
    if (e.key === 'Escape') close();
    else if (e.code === 'Space' && !typing && st.buf) { e.preventDefault(); playing ? stop() : play(); }
  });
  window.addEventListener('resize', () => { if (isOpen()) draw(); });

  return { open, openClip, addFiles, close, isOpen, decode, addToProject };
})();
