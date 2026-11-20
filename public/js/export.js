'use strict';
/* تصدير المشروع إلى ملف MP4 عالي الدقة باستخدام WebCodecs + mp4-muxer
   يُرسم كل إطار بدقته الكاملة (لا تسجيل للشاشة) فتكون النتيجة حادّة ودقيقة. */

const Exporter = (() => {
  const SR = 48000;
  const audioCache = new Map(); // url -> AudioBuffer | null

  const supported = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

  // يُفسح المجال للواجهة دون التأثر بتقييد المؤقتات في التبويبات الخلفية
  const breathe = () => new Promise(r => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

  const abortError = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };

  const bitrateFor = ExportTools.bitrateFor;

  async function pickVideoConfig(W, H, fps, bitrate) {
    const load = W * H * fps;
    // مستويات H.264 (High) مرتبة تصاعدياً: 4.0, 4.2, 5.0, 5.1, 5.2
    const levels = [
      ['640028', 1920 * 1088 * 30],
      ['64002A', 1920 * 1088 * 61],
      ['640032', 2560 * 1920 * 30],
      ['640033', 4096 * 2304 * 30],
      ['640034', Infinity],
    ];
    const start = levels.findIndex(l => load <= l[1]);
    const tries = levels.slice(Math.max(0, start)).map(l => ({ codec: 'avc1.' + l[0], mux: 'avc' }));
    tries.push({ codec: 'avc1.4d0034', mux: 'avc' }, { codec: 'avc1.42003e', mux: 'avc' });
    tries.push({ codec: 'vp09.00.51.08', mux: 'vp9' }, { codec: 'vp09.00.40.08', mux: 'vp9' });

    for (const tr of tries) {
      const config = { codec: tr.codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' };
      if (tr.mux === 'avc') config.avc = { format: 'avc' };
      try {
        const r = await VideoEncoder.isConfigSupported(config);
        if (r.supported) return { config, mux: tr.mux };
      } catch (e) { /* جرّب التالي */ }
    }
    throw new Error(tt('هذه الدقة غير مدعومة على جهازك — جرّب دقة أقل.', 'This resolution is not supported on your device — try a lower one.'));
  }

  async function pickAudioConfig(bitrate = 192000) {
    if (typeof AudioEncoder === 'undefined') return null;
    const tries = [
      { config: { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate }, mux: 'aac' },
      { config: { codec: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: Math.min(bitrate, 160000) }, mux: 'opus' },
    ];
    for (const tr of tries) {
      try { if ((await AudioEncoder.isConfigSupported(tr.config)).supported) return tr; } catch (e) {}
    }
    return null;
  }

  async function clipAudio(c) {
    if (audioCache.has(c.url)) return audioCache.get(c.url);
    let buf = null;
    try { buf = await decodeAudioFile(c.file); } catch (e) { buf = null; } // فيديو بلا صوت
    audioCache.set(c.url, buf);
    return buf;
  }

  /** يمزج صوت المقاطع والموسيقى في مسار واحد بطول الفيديو */
  async function mixAudio(D) {
    const jobs = [];
    const silent = o => o.muted || (o.volume <= 0 && !hasKf(o, 'volume'));
    for (const c of state.clips) {
      if (c.type !== 'video' || silent(c)) continue;
      const buf = await clipAudio(c);
      if (buf) jobs.push({ buf, when: c._start, offset: c.in, dur: c.out - c.in, rate: c.speed, vol: c.volume, item: c });
    }
    for (const o of state.overlays) {
      if (o.type !== 'video' || silent(o) || o.start >= D) continue;
      const buf = await clipAudio(o);
      if (buf) jobs.push({ buf, when: o.start, offset: o.in, dur: o.out - o.in, rate: o.speed, vol: o.volume, item: o });
    }
    for (const a of state.audios) {
      if ((a.volume <= 0 && !hasKf(a, 'volume')) || a.start >= D || !a.buf) continue;
      jobs.push({ buf: a.buf, when: a.start, offset: a.in, dur: audioLen(a), rate: 1, vol: a.volume, fadeIn: a.fadeIn, fadeOut: a.fadeOut, item: a });
    }
    if (!jobs.length) return null;

    const oc = new OfflineAudioContext(2, Math.ceil(D * SR), SR);
    for (const j of jobs) {
      const src = oc.createBufferSource();
      src.buffer = j.buf;
      src.playbackRate.value = j.rate;
      const g = oc.createGain();
      const end = Math.min(j.when + j.dur / j.rate, D);
      const fi = Math.min(j.fadeIn || 0, end - j.when);
      const fo = Math.min(j.fadeOut || 0, end - j.when - fi);
      if (hasKf(j.item, 'volume') && end - j.when > 0.02) {
        // مستوى صوت متحرك: منحنى واحد (50 نقطة في الثانية) يجمع الإطارات المفتاحية والتلاشي
        const len = end - j.when, n = Math.max(2, Math.ceil(len * 50) + 1), curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const lt = len * i / (n - 1);
          let k = 1;
          if (fi > 0) k = Math.min(k, lt / fi);
          if (fo > 0) k = Math.min(k, (len - lt) / fo);
          curve[i] = clamp(k, 0, 1) * clamp(prop(j.item, 'volume', lt), 0, 1);
        }
        g.gain.setValueCurveAtTime(curve, j.when, len);
      }
      else if (fi > 0) { g.gain.setValueAtTime(0, j.when); g.gain.linearRampToValueAtTime(j.vol, j.when + fi); }
      else g.gain.setValueAtTime(j.vol, j.when);
      if (!hasKf(j.item, 'volume') && fo > 0) { g.gain.setValueAtTime(j.vol, end - fo); g.gain.linearRampToValueAtTime(0, end); }
      src.connect(g).connect(oc.destination);
      src.start(j.when, j.offset, j.dur);
    }
    return oc.startRendering();
  }

  /** يجهّز عناصر الفيديو على الإطار المطلوب بالضبط */
  async function prepareFrame(t) {
    const jobs = [];
    const i = clipIndexAt(t);
    if (i >= 0) {
      const c = state.clips[i];
      const lt = t - c._start;
      if (c.type === 'video') jobs.push(seekExact(c.el, c.in + lt * c.speed));
      const prev = state.clips[i - 1];
      if (prev && prev.type === 'video' && lt < trDur(c)) jobs.push(seekExact(prev.el, prev.out - 0.04));
    }
    // كل فيديوهات الطبقات الظاهرة في هذا الإطار، بالتوازي
    for (const o of state.overlays) {
      const lt = t - o.start;
      if (o.type === 'video' && lt >= 0 && lt < overlayLen(o)) jobs.push(seekExact(o.el, o.in + lt * o.speed));
    }
    if (jobs.length) await Promise.all(jobs);
  }

  const waitDequeue = enc => Promise.race([
    new Promise(r => enc.addEventListener('dequeue', r, { once: true })),
    new Promise(r => setTimeout(r, 1500)),
  ]);

  /** quality: small | normal | high | ultra | size (ومعه sizeMB: الحجم المطلوب بالميغابايت) */
  async function run({ res, fps, quality, sizeMB, signal, onProgress }) {
    if (!supported()) throw new Error(tt('متصفحك لا يدعم التصدير. استخدم Chrome أو Edge بإصدار حديث.', 'Your browser cannot export. Use a recent Chrome or Edge.'));
    const D = layout();
    if (D <= 0) throw new Error(tt('المشروع فارغ.', 'The project is empty.'));
    const [W, H] = outputSize(state.ratio, res);

    onProgress(0, tt('جارٍ تجهيز الصوت…', 'Preparing the audio…'));
    const mix = await mixAudio(D);
    // الخطة بعد معرفة الصوت: في «حجم محدد» يأخذ الفيديو حصة الصوت إن لم يكن هناك صوت
    const p = ExportTools.plan({ W, H, fps, duration: D, quality, targetMB: sizeMB, hasAudio: !!mix });
    const acfg = mix ? await pickAudioConfig(p.audio) : null;
    if (signal.aborted) throw abortError();

    onProgress(0, tt('جارٍ التحضير…', 'Preparing…'));
    await Render.fontsReady; // كي لا تُرسم النصوص بالخط البديل
    const vcfg = await pickVideoConfig(W, H, fps, p.video);
    if (signal.aborted) throw abortError();

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
    const ctx = canvas.getContext('2d', { alpha: false });

    const venc = new VideoEncoder({
      output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { fail(e); } },
      error: fail,
    });
    venc.configure(vcfg.config);

    const N = Math.max(1, Math.round(D * fps));
    const frameUs = 1e6 / fps;
    const gop = p.gop;
    const t0 = performance.now();

    try {
      for (let i = 0; i < N; i++) {
        if (signal.aborted) throw abortError();
        if (failure) throw failure;
        const t = Math.min(i / fps, D - 0.0001);
        await prepareFrame(t);
        Render.frame(ctx, W, H, t);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
        venc.encode(vf, { keyFrame: i % gop === 0 });
        vf.close();
        if (venc.encodeQueueSize > 6) await waitDequeue(venc);
        if (i % 4 === 0) {
          const el = (performance.now() - t0) / 1000;
          const left = i > 8 ? el / i * (N - i) : null;
          onProgress(0.94 * i / N, tt('جارٍ تصدير الإطارات…', 'Exporting frames…'), left);
          await breathe();
        }
      }
      await venc.flush();
      if (failure) throw failure;

      if (mix && acfg) {
        onProgress(0.95, tt('جارٍ ترميز الصوت…', 'Encoding the audio…'));
        const aenc = new AudioEncoder({
          output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) { fail(e); } },
          error: fail,
        });
        aenc.configure(acfg.config);
        const L = mix.getChannelData(0);
        const R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
        const CH = 4800;
        for (let off = 0; off < mix.length; off += CH) {
          if (signal.aborted) throw abortError();
          if (failure) throw failure;
          const n = Math.min(CH, mix.length - off);
          const data = new Float32Array(n * 2);
          data.set(L.subarray(off, off + n), 0);
          data.set(R.subarray(off, off + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / SR * 1e6), data });
          aenc.encode(ad);
          ad.close();
          if (aenc.encodeQueueSize > 30) await waitDequeue(aenc);
        }
        await aenc.flush();
        aenc.close();
        if (failure) throw failure;
      }

      onProgress(0.99, tt('جارٍ إنهاء الملف…', 'Finishing the file…'));
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      onProgress(1, tt('تم', 'Done'));
      return { blob, W, H, fps, hasAudio: !!(mix && acfg), audioDropped: !!(mix && !acfg), codec: vcfg.mux };
    } finally {
      try { if (venc.state !== 'closed') venc.close(); } catch (e) {}
    }
  }

  return { run, supported, bitrateFor, pickVideoConfig, pickAudioConfig, mixAudio };
})();
