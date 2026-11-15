'use strict';
/* معالجة الصوت: قص المدى، توحيد المستوى، التلاشي، وترميز WAV و M4A (AAC).
   الجزء الحسابي يعمل على أي كائن يشبه AudioBuffer فيُختبر في Node (يُحمَّل الملف هناك أيضاً). */

const AudioTools = (() => {
  const FORMATS = {
    m4a: { label: 'M4A (AAC)', mime: 'audio/mp4', ext: 'm4a' },
    wav: { label: 'WAV', mime: 'audio/wav', ext: 'wav' },
  };
  const BITRATES = [128000, 192000, 256000];
  const PEAK = 0.891; // -1 dBFS: هامش صغير يمنع التشوّه بعد الترميز

  const lim = (v, a, b) => Math.min(b, Math.max(a, v));

  /** قنوات الصوت، وما زاد على قناتين (5.1 مثلاً) يُخفض إلى ستيريو */
  function stereo(buf) {
    const n = buf.numberOfChannels, ch = [];
    for (let i = 0; i < Math.min(n, 2); i++) ch.push(buf.getChannelData(i));
    if (n <= 2) return ch;
    // ترتيب 5.1 في Web Audio: يسار، يمين، وسط، صب، يسار خلفي، يمين خلفي
    const k = Math.SQRT1_2, C = buf.getChannelData(2);
    const SL = n > 4 ? buf.getChannelData(4) : null, SR = n > 5 ? buf.getChannelData(5) : null;
    const L = new Float32Array(buf.length), R = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      L[i] = ch[0][i] + k * C[i] + (SL ? k * SL[i] : 0);
      R[i] = ch[1][i] + k * C[i] + (SR ? k * SR[i] : 0);
    }
    return [L, R];
  }

  /**
   * يقتطع مدى من الصوت ويطبّق عليه المعالجة. النتيجة نسخة جديدة: { sampleRate, channels, length, duration, peak }
   *   start, end   بالثواني من بداية الملف
   *   normalize    رفع (أو خفض) المستوى كي تبلغ أعلى قمة -1 dBFS
   *   fadeIn, fadeOut  بالثواني
   */
  function process(buf, o = {}) {
    const sr = buf.sampleRate, len = buf.length;
    const s = Math.round(lim(o.start == null ? 0 : +o.start, 0, len / sr) * sr);
    const e = Math.max(s, Math.round(lim(o.end == null ? len / sr : +o.end, 0, len / sr) * sr));
    const n = e - s;
    const channels = stereo(buf).map(c => c.slice(s, e));

    let peak = 0;
    for (const c of channels) for (let i = 0; i < n; i++) { const v = c[i] < 0 ? -c[i] : c[i]; if (v > peak) peak = v; }
    const gain = o.normalize && peak > 1e-4 ? PEAK / peak : 1;

    const fi = Math.min(n, Math.round(Math.max(0, +o.fadeIn || 0) * sr));
    const fo = Math.min(n - fi, Math.round(Math.max(0, +o.fadeOut || 0) * sr));
    for (const c of channels) {
      if (gain !== 1) for (let i = 0; i < n; i++) c[i] *= gain;
      for (let i = 0; i < fi; i++) c[i] *= i / fi;
      for (let i = n - fo; i < n; i++) c[i] *= (n - 1 - i) / fo; // آخر عيّنة صفر تماماً
    }
    return { sampleRate: sr, channels, length: n, duration: n / sr, peak: peak * gain };
  }

  /**
   * صوت أحادي بتردد 16 كيلوهرتز لمحرّكات تفريغ الكلام: { sampleRate, channels: [mono], length, duration }.
   * كل عيّنة ناتجة متوسط العيّنات الأصلية التي تغطيها، وهذا يكفي مرشّحاً ضد التعرّج للكلام.
   */
  function toMono16k(buf, start, end) {
    const sr = buf.sampleRate, OUT = 16000;
    const s = Math.round(lim(start == null ? 0 : +start, 0, buf.length / sr) * sr);
    const e = Math.max(s, Math.round(lim(end == null ? buf.length / sr : +end, 0, buf.length / sr) * sr));
    const ch = [];
    for (let i = 0; i < Math.min(2, buf.numberOfChannels); i++) ch.push(buf.getChannelData(i));
    const step = sr / OUT, n = Math.floor((e - s) / step), mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = s + Math.floor(i * step), b = Math.max(a + 1, Math.min(e, s + Math.floor((i + 1) * step)));
      let sum = 0;
      for (const c of ch) for (let j = a; j < b; j++) sum += c[j];
      mono[i] = sum / ((b - a) * ch.length);
    }
    return { sampleRate: OUT, channels: [mono], length: n, duration: n / OUT };
  }

  /**
   * يقطّع مدة طويلة إلى أجزاء لا تتجاوز max ثانية مع تداخل بسيط، كي يبقى كل ملف تحت حد المزوّد
   * (WAV أحادي 16 كيلوهرتز = 32 كيلوبايت للثانية، و25 ميغابايت ≈ 13 دقيقة). ← [{ start, end }]
   */
  function sttChunks(duration, max = 600, overlap = 2) {
    if (!(duration > 0)) return [];
    if (duration <= max) return [{ start: 0, end: duration }];
    const n = Math.ceil((duration - overlap) / (max - overlap)), len = (duration + (n - 1) * overlap) / n, out = [];
    for (let i = 0; i < n; i++) {
      const start = i * (len - overlap);
      out.push({ start, end: i === n - 1 ? duration : start + len });
    }
    return out;
  }

  /** أعلى قيمة مطلقة في كل عمود من width عموداً (لرسم الموجة) */
  function peaks(buf, width) {
    const ch = [];
    for (let i = 0; i < Math.min(2, buf.numberOfChannels); i++) ch.push(buf.getChannelData(i));
    const out = new Float32Array(width), per = buf.length / width;
    // في الملفات الطويلة نكتفي بعيّنة من كل عمود: الشكل نفسه بجزء من الوقت
    const step = Math.max(1, Math.floor(per / 400));
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let i = Math.floor(x * per), end = Math.min(buf.length, Math.floor((x + 1) * per)); i < end; i += step) {
        for (const c of ch) { const v = c[i] < 0 ? -c[i] : c[i]; if (v > m) m = v; }
      }
      out[x] = m;
    }
    return out;
  }

  /** ملف WAV بعيّنات 16 بت */
  function wav(clip) {
    const { channels: ch, length: n, sampleRate: sr } = clip, k = ch.length;
    const out = new Uint8Array(44 + n * k * 2), dv = new DataView(out.buffer);
    const tag = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); dv.setUint32(4, 36 + n * k * 2, true); tag(8, 'WAVE');
    tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, k, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * k * 2, true); dv.setUint16(32, k * 2, true); dv.setUint16(34, 16, true);
    tag(36, 'data'); dv.setUint32(40, n * k * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < k; c++) {
        const v = lim(ch[c][i], -1, 1);
        dv.setInt16(o, Math.round(v < 0 ? v * 32768 : v * 32767), true);
        o += 2;
      }
    }
    return out;
  }

  /* ================= المتصفح فقط ================= */
  const aacConfig = (clip, bitrate) => ({ codec: 'mp4a.40.2', sampleRate: clip.sampleRate, numberOfChannels: clip.channels.length, bitrate });

  /** هل يستطيع هذا المتصفح ترميز AAC؟ (Chrome و Edge على ويندوز وماك نعم، وبعض توزيعات لينكس لا) */
  async function canM4A(sampleRate = 48000, channels = 2) {
    if (typeof AudioEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') return false;
    try {
      return !!(await AudioEncoder.isConfigSupported(aacConfig({ sampleRate, channels: Array(channels) }, 192000))).supported;
    } catch (e) { return false; }
  }

  const breathe = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

  /** ترميز AAC داخل حاوية MP4 (ملف .m4a) */
  async function m4a(clip, { bitrate = 192000, onProgress, signal } = {}) {
    const k = clip.channels.length, sr = clip.sampleRate;
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      audio: { codec: 'aac', numberOfChannels: k, sampleRate: sr },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let failure = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) { failure = failure || e; } },
      error: e => { failure = failure || e; },
    });
    try {
      enc.configure(aacConfig(clip, bitrate));
      const CH = 9600;
      for (let off = 0, i = 0; off < clip.length; off += CH, i++) {
        if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        if (failure) throw failure;
        const n = Math.min(CH, clip.length - off), data = new Float32Array(n * k);
        clip.channels.forEach((c, j) => data.set(c.subarray(off, off + n), j * n));
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: k, timestamp: Math.round(off / sr * 1e6), data });
        enc.encode(ad);
        ad.close();
        if (i % 40 === 0) { onProgress && onProgress(off / clip.length); await breathe(); }
      }
      await enc.flush();
      if (failure) throw failure;
      muxer.finalize();
      return new Uint8Array(muxer.target.buffer);
    } finally {
      try { if (enc.state !== 'closed') enc.close(); } catch (e) {}
    }
  }

  /** { bytes, blob, ext, mime } — إن تعذّر AAC يُرجع WAV ويذكر ذلك في ext */
  async function encode(clip, format, opts = {}) {
    let fmt = FORMATS[format] ? format : 'm4a';
    if (fmt === 'm4a' && !(await canM4A(clip.sampleRate, clip.channels.length))) fmt = 'wav';
    const bytes = fmt === 'm4a' ? await m4a(clip, opts) : wav(clip);
    const f = FORMATS[fmt];
    return { bytes, ext: f.ext, mime: f.mime, blob: new Blob([bytes], { type: f.mime }) };
  }

  /** الحجم التقريبي للملف الناتج بالبايت */
  const estimate = (seconds, format, bitrate = 192000, channels = 2, sampleRate = 48000) =>
    format === 'wav' ? 44 + seconds * sampleRate * channels * 2 : seconds * bitrate / 8 * 1.02;

  return { FORMATS, BITRATES, process, toMono16k, sttChunks, peaks, wav, canM4A, m4a, encode, estimate };
})();

if (typeof module !== 'undefined') module.exports = AudioTools;
