'use strict';
/* تحليل مقطع مرجعي — الجزء الذي لا يحتاج متصفحاً:
   - كشف القصّات من إطارات مصغّرة (قص حاد، تلاشٍ متقاطع، مرور بالأسود، وميض) بمقارنة توزيع الألوان،
     فتصمد أمام التصوير اليدوي وحركة الكاميرا السريعة
   - تحويل القصّات إلى لقطات، ووصف إيقاعها بعدد الضربات لكل لقطة
   - توزيع وسائط المستخدم على اللقطات
   يصلح لأي فيديو (ليس لمشاريع مونتاجي فقط) لأنه يقرأ الصورة نفسها لا بيانات المشروع.
   يعمل في Node أيضاً (test/reftools.test.js). القراءة من الفيديو في js/reference.js */

const RefTools = (() => {
  // [أدنى فرق في توزيع الألوان ليُعدّ قصاً، نسبته إلى ما حوله]
  const SENSITIVITY = { low: [0.3, 3], normal: [0.2, 2.5], high: [0.13, 2] };
  const DARK = 14;       // متوسط سطوع يُعدّ «أسود»
  const STILL = 0.9;     // متوسط فرق البكسلات بين الإطارات تحته اللقطة ثابتة (صورة بلا حركة)

  const median = list => {
    if (!list.length) return 0;
    const s = Array.from(list).sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  /**
   * بصمة إطار من بكسلاته RGBA: g = الصورة رمادية (لقياس الحركة والسطوع)،
   * h = توزيع الألوان في 64 خانة (4 مستويات لكل قناة) مجموعها 1.
   * توزيع الألوان لا يتغيّر كثيراً حين تتحرك الكاميرا، فيفرّق القص عن الحركة حيث يفشل فرق البكسلات
   */
  function signature(rgba) {
    const n = rgba.length >> 2, g = new Uint8Array(n), h = new Float32Array(64);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const r = rgba[i], gr = rgba[i + 1], b = rgba[i + 2];
      g[j] = (r * 77 + gr * 150 + b * 29) >> 8;
      h[(r >> 6) * 16 + (gr >> 6) * 4 + (b >> 6)] += 1 / n;
    }
    return { g, h };
  }
  /** فرق توزيع الألوان بين إطارين: 0 (متطابقان) إلى 1 (لا لون مشترك) */
  function hdist(a, b) {
    let s = 0;
    for (let i = 0; i < 64; i++) s += Math.abs(a.h[i] - b.h[i]);
    return s / 2;
  }
  /** متوسط الفرق المطلق بين الصورتين الرماديتين (0 إلى 255) */
  function dist(a, b) {
    let s = 0;
    for (let i = 0; i < a.g.length; i++) s += Math.abs(a.g[i] - b.g[i]);
    return s / a.g.length;
  }
  function brightness(a) {
    let s = 0;
    for (let i = 0; i < a.g.length; i++) s += a.g[i];
    return s / a.g.length;
  }

  /**
   * يكشف القصّات في سلسلة إطارات مأخوذة على فترات متساوية.
   * frames: بصمات من signature، times: زمن كل إطار بالثواني.
   * ← { cuts: [{ i, t, kind: 'cut' | 'fade' | 'black', flash? }], flashes: [t], d, h, luma, step }
   *   i = أول إطار من اللقطة الجديدة. القص الحاد يقع بين الإطارين i-1 و i (يُدقَّق زمنه في المتصفح).
   *   flashes = ومضات داخل اللقطة (إضاءة تومض ثم تعود الصورة كما كانت): مؤثر لا قص.
   */
  function detect(frames, times, { sensitivity = 'normal', minShot = 0.25, duration } = {}) {
    const n = frames.length;
    const d = new Float32Array(n), h = new Float32Array(n), luma = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      luma[i] = brightness(frames[i]);
      if (i) { d[i] = dist(frames[i], frames[i - 1]); h[i] = hdist(frames[i], frames[i - 1]); }
    }
    const step = n > 1 ? (times[n - 1] - times[0]) / (n - 1) : 0.1;
    const end = duration > 0 ? duration : n ? times[n - 1] + step : 0;
    const [hMin, ratio] = SENSITIVITY[sensitivity] || SENSITIVITY.normal;
    let cuts = [];
    const flashes = [];

    // 1) القص الحاد: قفزة مفردة في توزيع الألوان، أعلى بكثير مما حولها، ولا تعود الصورة بعدها كما كانت
    for (let i = 1; i < n; i++) {
      if (h[i] < hMin) continue;
      const near = [];
      for (let j = Math.max(1, i - 5); j <= Math.min(n - 1, i + 5); j++) if (j !== i) near.push(h[j]);
      if (h[i] < ratio * median(near)) continue;
      // إطار بعد القفزة يشبه إطاراً قبلها = وميض أو إطار دخيل: الصورة عادت، فليس قصاً
      let back = Infinity;
      for (let a = Math.max(0, i - 4); a < i; a++) {
        for (let b = i; b <= Math.min(n - 1, i + 3); b++) if (b - a > 1) back = Math.min(back, hdist(frames[a], frames[b]));
      }
      if (back <= Math.max(0.1, 0.45 * h[i])) {
        if (luma[i] - luma[i - 1] > 15) flashes.push(times[i]);
        continue;
      }
      if (h[i] < h[i - 1] || (i + 1 < n && h[i] < h[i + 1])) continue;
      cuts.push({ i, t: times[i], kind: 'cut', score: h[i] });
    }

    // 2) المرور بالأسود: فترة قصيرة مظلمة داخل الفيديو = انتقال واحد في منتصفها
    for (let a = -1, i = 0; i <= n; i++) {
      const dark = i < n && luma[i] < DARK;
      if (dark && a < 0) a = i;
      if (dark || a < 0) continue;
      const b = i - 1, len = (b - a + 1) * step;
      if (len <= 1.5) {
        cuts = cuts.filter(c => c.i < a || c.i > b + 1);
        if (a > 0 && b < n - 1) cuts.push({ i: Math.round((a + b) / 2), t: (times[a] + times[b]) / 2, kind: 'black', score: 2 });
      }
      a = -1;
    }

    // 3) التلاشي المتقاطع: تغيّر كبير موزّع على عدة إطارات، قبله وبعده هدوء.
    //    شرط الهدوء يستبعد حركة الكاميرا المستمرة، فيفوتنا تلاشٍ بين لقطتين متحركتين (أهون من قصّات وهمية)
    const fades = [];
    for (const span of [0.35, 0.7, 1.1]) {
      const k = Math.max(2, Math.round(span / step));
      let best = null;
      for (let i = k + 3; i < n - 3; i++) {
        const f = hdist(frames[i], frames[i - k]);
        let ok = f >= hMin * 1.25 && !cuts.some(c => c.i > i - k - 2 && c.i <= i + 2);
        if (ok) {
          let mx = 0, sum = 0;
          for (let j = i - k + 1; j <= i; j++) { mx = Math.max(mx, h[j]); sum += h[j]; }
          const inside = sum / k;
          ok = mx <= f * 0.6
            && median(h.subarray(i - k - 2, i - k + 1)) <= inside * 0.4
            && median(h.subarray(i + 1, i + 4)) <= inside * 0.4;
        }
        if (ok) { if (!best || f > best.f) best = { i, f, k }; }
        else if (best) { fades.push(best); best = null; }
      }
      if (best) fades.push(best);
    }
    for (const x of fades.sort((p, q) => q.f - p.f)) {
      const mid = x.i - Math.round(x.k / 2);
      if (cuts.some(c => Math.abs(c.i - mid) <= x.k)) continue;
      cuts.push({ i: mid, t: times[mid], kind: 'fade', score: x.f, length: x.k * step });
    }

    // 4) قصّتان أقرب من أقصر لقطة: تبقى الأقوى (اهتزاز الكاميرا بعد القص يُحسب مرتين مثلاً)
    cuts.sort((p, q) => p.t - q.t);
    const out = [];
    for (const c of cuts) {
      if (c.t < minShot || c.t > end - minShot) continue;
      const last = out[out.length - 1];
      if (last && c.t - last.t < minShot + step / 2) { if (c.score > last.score) out[out.length - 1] = c; }
      else out.push(c);
    }

    // 5) وميض أبيض على القص: إطار أسطع بكثير من اللقطتين حوله
    for (const c of out) {
      if (c.kind !== 'cut') continue;
      let peak = 0;
      for (let j = Math.max(0, c.i - 2); j <= Math.min(n - 1, c.i + 2); j++) peak = Math.max(peak, luma[j]);
      const before = median(luma.subarray(Math.max(0, c.i - 8), Math.max(0, c.i - 3)));
      const after = median(luma.subarray(Math.min(n, c.i + 3), Math.min(n, c.i + 8)));
      if (peak > 165 && peak - Math.max(before, after) > 45) c.flash = true;
    }
    // الومضات المتقاربة (إضاءة ترفّ) تُعدّ واحدة، وما وقع على قص فهو وميض ذلك القص
    const lone = [];
    for (const t of flashes) {
      if (out.some(c => Math.abs(c.t - t) < 0.3)) continue;
      if (!lone.length || t - lone[lone.length - 1] > 0.2) lone.push(t);
    }
    return { cuts: out, flashes: lone, d, h, luma, step };
  }

  /**
   * اللقطات من القصّات. transition = كيف تدخل اللقطة (الأولى 'none')،
   * motion = 'still' إن كانت الصورة ثابتة داخل اللقطة (صورة فوتوغرافية بلا حركة كاميرا) وإلا 'moving'
   */
  function buildShots(cuts, duration, d, times) {
    const bounds = [0, ...cuts.map(c => c.t), duration];
    const shots = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const start = bounds[i], end = bounds[i + 1], cut = cuts[i - 1];
      const margin = Math.min(0.2, (end - start) / 4);
      let sum = 0, count = 0;
      for (let j = 1; j < times.length; j++) {
        if (times[j - 1] >= start + margin && times[j] <= end - margin) { sum += d[j]; count++; }
      }
      shots.push({
        start, end, duration: end - start,
        transition: cut ? cut.kind : 'none',
        ...(cut && cut.flash ? { flash: true } : {}),
        ...(cut && cut.length ? { fade: cut.length } : {}),
        motion: count && sum / count < STILL ? 'still' : 'moving',
      });
    }
    return shots;
  }

  /**
   * إيقاع المونتاج: كم ضربة تدوم كل لقطة، ونسبة القصّات الواقعة على ضربة.
   * beatTimes بالثواني و period طول الضربة. ← null إن لم يكن للموسيقى إيقاع واضح
   */
  function rhythm(shots, beatTimes, period) {
    if (!(period > 0) || !beatTimes || beatTimes.length < 4) return null;
    const tol = Math.min(0.12, period * 0.3);
    const cutTimes = shots.slice(1).map(s => s.start);
    let on = 0;
    for (const t of cutTimes) if (beatTimes.some(b => Math.abs(b - t) <= tol)) on++;
    return {
      on_beat: cutTimes.length ? on / cutTimes.length : 0,
      pattern: shots.map(s => Math.max(0.5, Math.round(s.duration / period * 2) / 2)),
    };
  }

  /** أقرب مقاس يدعمه المحرر لأبعاد الفيديو */
  function nearestRatio(w, h) {
    const list = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
    const r = Math.log((w || 16) / (h || 9));
    let best = '16:9', bd = Infinity;
    for (const [name, v] of Object.entries(list)) {
      const diff = Math.abs(Math.log(v) - r);
      if (diff < bd) { bd = diff; best = name; }
    }
    return best;
  }

  /**
   * أي وسيط يأخذ كل لقطة: مصفوفة فهارس الوسائط بطول عدد اللقطات المستعملة.
   * fill 'loop': تُعاد الوسائط من أولها إن كانت أقل من اللقطات. 'trim': يقصر الفيديو إلى عدد الوسائط.
   */
  function assign(shotCount, mediaCount, fill = 'loop') {
    if (!(shotCount > 0) || !(mediaCount > 0)) return [];
    const n = fill === 'trim' ? Math.min(shotCount, mediaCount) : shotCount;
    return Array.from({ length: n }, (_, i) => i % mediaCount);
  }

  /**
   * قصّ فيديو المستخدم ليملأ لقطة مدتها want: يؤخذ وسطه إن كان أطول،
   * ويُبطَّأ (حتى ربع السرعة) إن كان أقصر كي لا تنزاح القصّات التالية عن الإيقاع
   */
  function fitVideo(srcDur, want) {
    if (srcDur >= want) { const start = (srcDur - want) / 2; return { in: start, out: start + want, speed: 1 }; }
    return { in: 0, out: srcDur, speed: Math.min(1, Math.max(0.25, srcDur / want)) };
  }

  /** شبكة «ورقة اللقطات»: أبعاد الخلية وعدد الأعمدة لصور بنسبة w:h */
  function sheetLayout(count, w, h, cell = 200) {
    const k = cell / Math.max(w, h);
    const cw = Math.max(2, Math.round(w * k)), ch = Math.max(2, Math.round(h * k));
    const cols = Math.min(count, w >= h ? 4 : 6);
    return { cw, ch, cols, rows: Math.ceil(count / cols) };
  }

  return { SENSITIVITY, signature, hdist, dist, detect, buildShots, rhythm, nearestRatio, assign, fitVideo, sheetLayout, median };
})();

if (typeof module !== 'undefined') module.exports = RefTools;
