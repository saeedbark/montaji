'use strict';
/* كشف إيقاع الموسيقى (BPM ومواضع الضربات) لمزامنة القص مع النغمة.
   الطريقة: منحنى «بدايات الأصوات» من طاقة ثلاث حزم ترددية ← تقدير السرعة بالارتباط الذاتي
   ← تتبّع الضربات بالبرمجة الديناميكية (Ellis 2007). يعمل محلياً دون أي مكتبة. */

const Beats = (() => {
  const FPS = 100; // إطارات منحنى البدايات في الثانية

  /** منحنى قوة البدايات: ارتفاع الطاقة المفاجئ في الحزم المنخفضة (الطبل) والكاملة والعالية (الصنج والتصفيق) */
  function onsetEnvelope(buf) {
    const sr = buf.sampleRate, hop = Math.round(sr / FPS), n = buf.length;
    const chans = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
    const frames = Math.floor(n / hop);
    const low = new Float32Array(frames), full = new Float32Array(frames), high = new Float32Array(frames);
    const aLow = 1 - Math.exp(-2 * Math.PI * 150 / sr);
    let lp = 0, prev = 0;
    for (let f = 0; f < frames; f++) {
      let el = 0, ef = 0, eh = 0;
      for (let i = f * hop, end = i + hop; i < end; i++) {
        let x = 0;
        for (const c of chans) x += c[i];
        x /= chans.length;
        lp += aLow * (x - lp);
        const hp = x - prev; prev = x;
        el += lp * lp; ef += x * x; eh += hp * hp;
      }
      low[f] = Math.sqrt(el / hop); full[f] = Math.sqrt(ef / hop); high[f] = Math.sqrt(eh / hop);
    }
    const out = new Float32Array(frames), lowOut = new Float32Array(frames);
    const bands = [[low, 1.2], [full, 1], [high, 0.8]];
    for (const [band, w] of bands) {
      let mx = 1e-9;
      for (const v of band) if (v > mx) mx = v;
      let last = 0;
      for (let f = 0; f < frames; f++) {
        const L = Math.log1p(100 * band[f] / mx);
        const d = Math.max(0, L - last) * w;
        last = L;
        out[f] += d;
        if (band === low) lowOut[f] = d;
      }
    }
    // طرح المتوسط المحلي يُبقي القمم الحادة فقط (الضربات) ويتجاهل تغيّر مستوى الصوت العام
    const W = 15, env = new Float32Array(frames);
    let sum = 0;
    for (let f = 0; f < Math.min(frames, W); f++) sum += out[f];
    for (let f = 0; f < frames; f++) {
      const a = f - W - 1, b = f + W;
      if (b < frames) sum += out[b];
      if (a >= 0) sum -= out[a];
      const cnt = Math.min(frames - 1, b) - Math.max(0, a + 1) + 1;
      env[f] = Math.max(0, out[f] - sum / cnt);
    }
    let sd = 0;
    for (const v of env) sd += v * v;
    sd = Math.sqrt(sd / Math.max(1, frames)) || 1;
    for (let f = 0; f < frames; f++) env[f] /= sd;
    return { env, low: lowOut };
  }

  /** تقدير طول النبضة بالإطارات عبر الارتباط الذاتي مع ميل خفيف نحو 120 نبضة/د */
  function estimatePeriod(env) {
    const N = env.length;
    const minL = Math.floor(FPS * 60 / 200), maxL = Math.min(Math.ceil(FPS * 60 / 60), Math.floor(N / 2));
    if (maxL <= minL + 2) return FPS * 60 / 120;
    const acf = new Float32Array(2 * maxL + 2);
    for (let L = 1; L < acf.length && L < N; L++) {
      let s = 0;
      for (let i = 0; i + L < N; i++) s += env[i] * env[i + L];
      acf[L] = s / (N - L);
    }
    let best = minL, bestScore = -Infinity;
    const score = new Float32Array(maxL + 2);
    for (let L = minL; L <= maxL; L++) {
      const bpm = FPS * 60 / L;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
      score[L] = w * (acf[L] + 0.5 * (acf[2 * L] || 0));
      if (score[L] > bestScore) { bestScore = score[L]; best = L; }
    }
    // تنعيم بالقطع المكافئ للحصول على طول غير صحيح بدقة أعلى
    const a = score[best - 1], b = score[best], c = score[best + 1];
    if (best > minL && best < maxL && a + c - 2 * b < 0) return best + 0.5 * (a - c) / (a - 2 * b + c);
    return best;
  }

  /** تتبّع الضربات: كل ضربة تختار سابقتها بحيث تقارب المسافةُ طولَ النبضة وتقع على قمة قوية */
  function track(env, P) {
    const N = env.length, tight = 100;
    const local = new Float32Array(N);
    const r = Math.max(1, Math.round(P / 16));
    for (let i = 0; i < N; i++) {
      let s = 0, ws = 0;
      for (let k = -r; k <= r; k++) {
        const j = i + k;
        if (j < 0 || j >= N) continue;
        const w = Math.exp(-0.5 * (k / (r / 2 || 1)) ** 2);
        s += env[j] * w; ws += w;
      }
      local[i] = s / ws;
    }
    const cum = new Float32Array(N), back = new Int32Array(N).fill(-1);
    const lo = Math.round(P / 2), hi = Math.round(2 * P);
    for (let i = 0; i < N; i++) {
      let best = 0, arg = -1;
      for (let j = i - hi; j <= i - lo; j++) {
        if (j < 0) continue;
        const v = cum[j] - tight * Math.log((i - j) / P) ** 2;
        if (arg < 0 || v > best) { best = v; arg = j; }
      }
      cum[i] = local[i] + (arg >= 0 ? Math.max(0, best) : 0);
      back[i] = arg >= 0 && best > 0 ? arg : -1;
    }
    let end = N - 1;
    for (let i = Math.max(0, N - Math.round(P)); i < N; i++) if (cum[i] > cum[end]) end = i;
    const out = [];
    for (let i = end; i >= 0; i = back[i]) out.push(i);
    out.reverse();
    // حذف الضربات «الصامتة» في المقدمة والخاتمة
    let rms = 0;
    for (const b of out) rms += local[b] * local[b];
    const th = 0.25 * Math.sqrt(rms / Math.max(1, out.length));
    let s = 0, e = out.length;
    while (s < e && local[out[s]] < th) s++;
    while (e > s && local[out[e - 1]] < th) e--;
    return out.slice(s, e);
  }

  /** يحلّل AudioBuffer ويعيد { bpm, period, beats: [{ t, s, down }] } بأزمنة الملف الأصلي */
  function analyze(buf) {
    const { env, low } = onsetEnvelope(buf);
    if (env.length < FPS * 2) return { bpm: 0, period: 0, beats: [] };
    const P = estimatePeriod(env);
    const frames = track(env, P);
    const peak = (arr, f) => { let m = 0; for (let k = -3; k <= 3; k++) m = Math.max(m, arr[f + k] || 0); return m; };
    const strength = frames.map(f => peak(env, f));
    const lowStr = frames.map(f => peak(low, f));
    // بداية المازورة: الطور (من 4) الذي تكون ضرباته الأقوى في حزمة الطبل
    let phase = 0, bestMean = -1;
    for (let ph = 0; ph < 4; ph++) {
      let s = 0, c = 0;
      for (let i = ph; i < frames.length; i += 4) { s += lowStr[i] + 0.5 * strength[i]; c++; }
      if (c && s / c > bestMean) { bestMean = s / c; phase = ph; }
    }
    const mx = Math.max(1e-9, ...strength);
    const beats = frames.map((f, i) => ({
      t: Math.max(0, (f - 0.5) / FPS),
      s: Math.round(strength[i] / mx * 100) / 100,
      down: (i - phase) % 4 === 0 && i >= phase,
    }));
    return { bpm: Math.round(FPS * 60 / P * 10) / 10, period: P / FPS, beats };
  }

  /** يحلّل عنصر موسيقى مرة واحدة ويحفظ النتيجة عليه */
  function ensure(a) {
    if (!a.beats && a.buf) {
      try { a.beats = analyze(a.buf); } catch (e) { console.warn('beat analysis failed', a.name, e); a.beats = { bpm: 0, period: 0, beats: [] }; }
    }
    return a.beats;
  }

  /** شبكة الضربات بزمن المشروع من كل عناصر الموسيقى (أو من عنصر واحد) */
  let cache = { key: '', grid: null };
  function grid(onlyId) {
    const list = state.audios.filter(a => !onlyId || a.id === onlyId);
    const key = list.map(a => `${a.id}:${a.start}:${a.in}:${a.out}`).join('|');
    if (cache.key === key && cache.grid) return cache.grid;
    const tracks = [];
    let period = 0, bpm = 0, longest = 0;
    for (const a of list) {
      const b = ensure(a);
      if (!b || !b.beats.length) continue;
      if (audioLen(a) > longest) { longest = audioLen(a); period = b.period; bpm = b.bpm; }
      tracks.push({ start: a.start, in: a.in, out: a.out, len: audioLen(a), beats: b.beats });
    }
    // تعليق صوتي فوق الموسيقى لا يضيف ضربات على مقاطع الكلام (انظر AudioTools.mergeBeats)
    const merged = AudioTools.mergeBeats(tracks, Math.max(0.08, period * 0.35));
    cache = { key, grid: { bpm, period, beats: merged, times: Float64Array.from(merged.map(x => x.t)) } };
    return cache.grid;
  }

  /** شدة «النبضة» عند الزمن t (0..1): تقفز عند كل ضربة ثم تخبو بسرعة */
  function pulse(t) {
    if (!state.audios.length) return 0;
    const g = grid();
    const T = g.times;
    if (!T.length || t < T[0]) return 0;
    let lo = 0, hi = T.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; }
    const dt = t - T[lo];
    const b = g.beats[lo];
    if (dt > 0.6 || b.s < 0.08) return 0; // لا نبضة على ضربات واقعة في الصمت
    return Math.exp(-dt / 0.11) * (0.35 + 0.65 * Math.min(1, b.s * 1.4)) * (b.down ? 1 : 0.8);
  }

  return { analyze, ensure, grid, pulse, onsetEnvelope, estimatePeriod };
})();
