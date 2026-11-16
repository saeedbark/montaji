'use strict';
/* المقطع المرجعي: يقرأ أي ملف فيديو (من أي برنامج أو منصة) ويستخرج «قالبه»:
   مواضع القصّات ومدة كل لقطة ونوع الانتقال، إيقاع الموسيقى وعدد الضربات لكل لقطة، وورقة صور مصغّرة للّقطات.
   الحساب في js/reftools.js؛ هنا قراءة الإطارات والصوت من الملف. يستعمله المساعد عبر analyze_reference و apply_reference */

const Reference = (() => {
  const G = 32;             // الإطار المصغّر G×G: يكفي لكشف القص ويتجاهل التفاصيل الصغيرة
  const Z = 64;              // إطار قياس الزوم Z×Z: أدق من إطار كشف القص
  const MAX_SAMPLES = 900;   // أقصى عدد إطارات تُقرأ (12 في الثانية حتى 75 ثانية، ثم تتباعد)
  const SHEET_CELLS = 24, MAX_SHEETS = 3;
  let current = null;        // آخر مقطع حُلّل: يبقى في الذاكرة حتى تحديث الصفحة

  function loadVideo(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      const timer = setTimeout(() => reject(new Error('The video took too long to load.')), 30000);
      v.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(v); }, { once: true });
      v.addEventListener('error', () => { clearTimeout(timer); reject(new Error('This browser cannot play the video (unsupported format or codec). MP4 (H.264) and WebM work.')); }, { once: true });
      v.src = url;
    });
  }

  // بعض الملفات (تسجيلات webm) لا تحمل مدتها: نجبر المتصفح على حسابها
  async function durationOf(v) {
    if (!(isFinite(v.duration) && v.duration > 0)) {
      await new Promise(r => {
        const h = () => { if (isFinite(v.duration)) { v.removeEventListener('durationchange', h); r(); } };
        v.addEventListener('durationchange', h);
        v.currentTime = 1e7;
        setTimeout(r, 4000);
      });
    }
    return isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  }

  function grabber() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = G;
    const g = cv.getContext('2d', { willReadFrequently: true });
    return v => {
      g.drawImage(v, 0, 0, G, G);
      return RefTools.signature(g.getImageData(0, 0, G, G).data);
    };
  }

  /** ورقة اللقطات: صورة واحدة فيها إطار من كل لقطة برقمها ومدتها، ليرى النموذج المقطع كله بنظرة */
  async function contactSheets(v, shots) {
    const every = Math.ceil(shots.length / (SHEET_CELLS * MAX_SHEETS));
    const shown = shots.map((s, i) => ({ s, n: i + 1 })).filter((_, i) => i % every === 0);
    const sheets = [];
    for (let p = 0; p < shown.length; p += SHEET_CELLS) {
      const page = shown.slice(p, p + SHEET_CELLS);
      const { cw, ch, cols, rows } = RefTools.sheetLayout(page.length, v.videoWidth, v.videoHeight);
      const gap = 6, cv = document.createElement('canvas');
      cv.width = cols * (cw + gap) + gap; cv.height = rows * (ch + gap) + gap;
      const g = cv.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
      g.font = 'bold 15px Segoe UI, Arial, sans-serif'; g.textBaseline = 'top';
      for (let k = 0; k < page.length; k++) {
        const { s, n } = page[k];
        const x = gap + (k % cols) * (cw + gap), y = gap + Math.floor(k / cols) * (ch + gap);
        // قليلاً بعد بداية اللقطة: يتجاوز الانتقال ويبقى داخل اللقطات القصيرة
        await seekExact(v, s.start + Math.min(s.duration * 0.4, 1.5));
        g.drawImage(v, x, y, cw, ch);
        const tag = `${n} · ${s.duration.toFixed(1)}s`;
        g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(x, y, g.measureText(tag).width + 10, 22);
        g.fillStyle = '#fff'; g.fillText(tag, x + 5, y + 3);
      }
      sheets.push(cv.toDataURL('image/jpeg', 0.75));
    }
    return sheets;
  }

  /**
   * يحلّل ملف فيديو ويحفظ قالبه. ← { ...القالب, sheets: [dataURL] }
   * clipId: معرّف المقطع إن كان المرجع مقطعاً في المشروع (يُستبعد من الوسائط عند التطبيق)
   */
  async function analyze(file, { sensitivity = 'normal', clipId = null } = {}) {
    const url = URL.createObjectURL(file);
    let v;
    try {
      v = await loadVideo(url);
      if (!v.videoWidth) throw new Error('This file has no picture: the reference must be a video.');
      const duration = await durationOf(v);
      if (duration < 0.5) throw new Error('The video is too short to analyze.');

      const step = Math.max(1 / 12, duration / MAX_SAMPLES), grab = grabber();
      const frames = [], times = [];
      for (let t = 0; t < duration - 0.02; t += step) {
        await seekExact(v, t);
        frames.push(grab(v)); times.push(t);
      }
      const found = RefTools.detect(frames, times, { sensitivity, duration });

      // تدقيق زمن القص الحاد بالتنصيف بين الإطارين اللذين وقع بينهما (إلى نحو 5 مللي ثانية)
      for (const c of found.cuts) {
        if (c.kind !== 'cut') continue;
        const A = frames[c.i - 1], B = frames[c.i];
        let lo = times[c.i - 1], hi = times[c.i];
        for (let k = 0; k < 4; k++) {
          const mid = (lo + hi) / 2;
          await seekExact(v, mid);
          const f = grab(v);
          if (RefTools.hdist(f, A) <= RefTools.hdist(f, B)) lo = mid; else hi = mid;
        }
        c.t = hi;
      }
      const shots = RefTools.markLooks(RefTools.buildShots(found.cuts, duration, found.d, times), frames, times, found.luma);
      const fades = RefTools.edgeFades(found.luma, times);

      // زوم الكاميرا في كل لقطة: ثلاثة إطارات أدق (أولها ووسطها وآخرها) يُقاس بينها التكبير
      const big = document.createElement('canvas');
      big.width = big.height = Z;
      const bg = big.getContext('2d', { willReadFrequently: true });
      const gray = async t => {
        await seekExact(v, t);
        bg.drawImage(v, 0, 0, Z, Z);
        const px = bg.getImageData(0, 0, Z, Z).data, out = new Float32Array(Z * Z);
        for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) / 256;
        return out;
      };
      for (const s of shots) {
        if (s.duration < 0.6 || s.motion === 'still') continue;
        const m = Math.min(0.17, s.duration / 5);
        const A = await gray(s.start + m), M = await gray((s.start + s.end) / 2), B = await gray(s.end - m);
        const zoom = RefTools.zoomOf(RefTools.zoomBetween(A, B, Z), RefTools.zoomBetween(A, M, Z), RefTools.zoomBetween(M, B, Z));
        if (zoom) s.zoom = zoom;
      }
      // مؤثر الانتقال عند كل قص حاد: هل تفقد الصورة تفاصيلها لبضعة إطارات حول القص (ضباب تكبير أو سحب سريع)؟
      // الوميض الأبيض يمحو التفاصيل أيضاً، فالقص الوامض مستثنى
      for (let k = 0; k < found.cuts.length; k++) {
        const c = found.cuts[k], prev = shots[k], next = shots[k + 1];
        if (c.kind !== 'cut' || c.flash || Math.min(prev.duration, next.duration) < 0.4) continue;
        const calm = sh => Math.min(0.3, sh.duration / 2);
        const before = RefTools.sharpness(await gray(c.t - calm(prev)), Z), after = RefTools.sharpness(await gray(c.t + calm(next)), Z);
        const samples = [];
        for (const dt of [-0.08, -0.04, 0, 0.04, 0.08]) samples.push({ dt, ...RefTools.sharpness(await gray(c.t + dt), Z) });
        const effect = RefTools.blurAt(samples, before, after);
        if (effect) next.effect = effect;
      }
      const sheets = await contactSheets(v, shots);

      // الصوت: إيقاعه يحدّد كم ضربة تدوم كل لقطة، فيُعاد بناء الإيقاع نفسه على موسيقى أخرى
      let audio = null, beats = null, rhythm = null;
      try { audio = await decodeAudioFile(file); } catch (e) { /* فيديو بلا صوت */ }
      if (audio && audio.duration > 0.5) {
        let peak = 0;
        const ch = audio.getChannelData(0);
        for (let i = 0; i < ch.length; i += 32) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
        if (peak < 1e-3) audio = null; // مسار صوت صامت
        else {
          beats = Beats.analyze(audio);
          if (beats.bpm) rhythm = RefTools.rhythm(shots, beats.beats.map(b => b.t), beats.period);
        }
      } else audio = null;

      current = {
        name: file.name, clipId, width: v.videoWidth, height: v.videoHeight, duration,
        ratio: RefTools.nearestRatio(v.videoWidth, v.videoHeight), shots, flashes: found.flashes, fades, audio, beats, rhythm,
        series: { times, d: found.d, h: found.h, luma: found.luma }, // للفحص من وحدة التحكم: Reference.current().series
      };
      return { ...current, sheets };
    } finally {
      if (v) { v.removeAttribute('src'); v.load(); }
      URL.revokeObjectURL(url);
    }
  }

  return { analyze, current: () => current, clear: () => { current = null; } };
})();
