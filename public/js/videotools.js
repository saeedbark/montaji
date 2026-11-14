'use strict';
/* تقسيم الفيديو إلى ملفات — الجزء الذي لا يحتاج واجهة:
   - حساب مواضع القطع (كل مدة، أجزاء متساوية، أو أوقات محددة)
   - قراءة جداول العيّنات من ملف MP4/MOV
   - نسخ عيّنات كل جزء إلى ملف MP4 جديد بلا إعادة ترميز (سريع وبلا فقدان)، عبر mp4-muxer
   النسخ المباشر يبدأ كل جزء عند إطار مفتاحي، لذا يقع القطع عند أقرب إطار مفتاحي قبل الموضع المطلوب.
   يعمل في Node أيضاً (test/videotools.test.js). الواجهة في js/splitvideo.js */

const VideoTools = (() => {
  const MIN_PART = 0.5;        // أقصر جزء مسموح بالثواني
  const READ_WINDOW = 16 << 20; // أكبر قراءة واحدة من الملف

  /* ================= مواضع القطع ================= */

  /**
   * مواضع القطع داخل المدى [start, end] مرتبة، وبين كل اثنين MIN_PART على الأقل.
   * mode: 'every' (كل every ثانية) | 'count' (count أجزاء متساوية) | 'times' (أوقات من الملف نفسه)
   */
  function planCuts({ start = 0, end, mode, every, count, times }) {
    start = Math.max(0, +start || 0);
    const len = end - start;
    let cuts = [];
    if (!(len > 0)) return cuts;
    if (mode === 'every') {
      const step = Math.max(MIN_PART, +every || 0);
      for (let t = start + step; t < end - 1e-6; t += step) cuts.push(t);
    } else if (mode === 'count') {
      const n = Math.min(100, Math.max(1, Math.round(+count || 1)));
      for (let i = 1; i < n; i++) cuts.push(start + len * i / n);
    } else {
      cuts = (times || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    }
    const out = [];
    for (const t of cuts) {
      if (t < start + MIN_PART - 1e-9 || t > end - MIN_PART + 1e-9) continue;
      if (out.length && t - out[out.length - 1] < MIN_PART - 1e-9) continue;
      out.push(t);
    }
    return out;
  }

  /** الأجزاء بالمواضع المطلوبة تماماً (لطريقة إعادة الترميز) */
  function exactParts(start, end, cuts) {
    const b = [start, ...cuts, end];
    return b.slice(0, -1).map((s, i) => ({ start: s, end: b[i + 1] }));
  }

  /** «0:30, 1:15.5, 90» ← ثوانٍ. يقبل ث، د:ث، س:د:ث، والفاصلة العربية */
  function parseTimes(text) {
    const times = [], bad = [];
    for (const tok of String(text || '').split(/[,،;\s]+/).filter(Boolean)) {
      const parts = tok.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.').split(':');
      let t = 0, ok = parts.length <= 3;
      for (const p of parts) {
        if (!/^\d+(\.\d+)?$/.test(p)) { ok = false; break; }
        t = t * 60 + +p;
      }
      if (ok) times.push(t); else bad.push(tok);
    }
    return { times, bad };
  }

  /* ================= قراءة MP4 ================= */

  const dv = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const fourcc = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  const u32 = (b, p) => dv(b).getUint32(p);
  const u64 = (b, p) => Number(dv(b).getBigUint64(p));

  /** الصناديق الأبناء داخل مدى من المخزن */
  function boxes(b, from, to) {
    const v = dv(b), out = [];
    let p = from;
    while (p + 8 <= to) {
      let size = v.getUint32(p), hdr = 8;
      const type = fourcc(b, p + 4);
      if (size === 1) { if (p + 16 > to) break; size = Number(v.getBigUint64(p + 8)); hdr = 16; }
      else if (size === 0) size = to - p;
      if (size < hdr || p + size > to) break;
      out.push({ type, start: p + hdr, end: p + size });
      p += size;
    }
    return out;
  }
  const child = (b, box, type) => box && boxes(b, box.start, box.end).find(x => x.type === type);
  const path = (b, box, types) => types.reduce((x, t) => child(b, x, t), box);

  /** صناديق المستوى الأعلى في الملف دون قراءته كله */
  async function topBoxes(src) {
    const out = [];
    let p = 0;
    while (p + 8 <= src.size) {
      const h = await src.read(p, Math.min(16, src.size - p));
      let size = u32(h, 0), hdr = 8;
      const type = fourcc(h, 4);
      if (size === 1 && h.length >= 16) { size = u64(h, 8); hdr = 16; }
      else if (size === 0) size = src.size - p;
      if (size < hdr || !/^[\x20-\x7e]{4}$/.test(type)) break;
      out.push({ type, pos: p, hdr, size });
      p += size;
    }
    return out;
  }

  /** معاملات فك AAC من صندوق esds: نوع الترميز و AudioSpecificConfig */
  function esdsConfig(b, box) {
    let p = box.start + 4, oti = 0, dsi = null;
    const len = () => { let n = 0; for (let i = 0; i < 4; i++) { const c = b[p++]; n = (n << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return n; };
    while (p < box.end) {
      const tag = b[p++], l = len(), s = p;
      if (tag === 3) { // ES_Descriptor: ننزل إلى ما بداخله
        p += 2;
        const f = b[p++];
        if (f & 0x80) p += 2;
        if (f & 0x40) p += 1 + b[p];
        if (f & 0x20) p += 2;
        continue;
      }
      if (tag === 4) { oti = b[p]; p += 13; continue; } // DecoderConfigDescriptor
      if (tag === 5) { dsi = b.slice(p, p + l); break; } // DecoderSpecificInfo
      p = s + l;
    }
    return { oti, dsi };
  }

  const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const hex2 = n => n.toString(16).padStart(2, '0');

  function sampleEntry(b, stsd, type, ts) {
    const e = boxes(b, stsd.start + 8, stsd.end)[0];
    if (!e) return {};
    const fc = e.type;
    if (type === 'video') {
      const width = dv(b).getUint16(e.start + 24), height = dv(b).getUint16(e.start + 26);
      const kids = { start: e.start + 78, end: e.end };
      const avcC = child(b, kids, 'avcC'), hvcC = child(b, kids, 'hvcC');
      if ((fc === 'avc1' || fc === 'avc3') && avcC) {
        const d = b.slice(avcC.start, avcC.end);
        return { fourcc: fc, codec: 'avc', width, height, description: d, codecString: 'avc1.' + hex2(d[1]) + hex2(d[2]) + hex2(d[3]) };
      }
      if ((fc === 'hvc1' || fc === 'hev1') && hvcC) {
        return { fourcc: fc, codec: 'hevc', width, height, description: b.slice(hvcC.start, hvcC.end), codecString: 'hvc1.1.6.L93.B0' };
      }
      return { fourcc: fc, codec: null, width, height };
    }
    // AudioSampleEntry (ومعها إصدارات QuickTime 1 و 2 التي تضيف حقولاً قبل الصناديق الأبناء)
    const ver = dv(b).getUint16(e.start + 8);
    let channels = dv(b).getUint16(e.start + 16), sampleRate = u32(b, e.start + 24) >>> 16;
    const kids = { start: e.start + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0), end: e.end };
    const esds = child(b, kids, 'esds') || path(b, kids, ['wave', 'esds']);
    if (fc !== 'mp4a' || !esds) return { fourcc: fc, codec: null, channels, sampleRate };
    const { oti, dsi } = esdsConfig(b, esds);
    if (oti !== 0x40 || !dsi || dsi.length < 2) return { fourcc: fc, codec: null, channels, sampleRate };
    const objType = dsi[0] >> 3, fi = ((dsi[0] & 7) << 1) | (dsi[1] >> 7), cc = (dsi[1] >> 3) & 15;
    if (cc >= 1 && cc <= 7) channels = cc === 7 ? 8 : cc;
    if (ts >= 8000) sampleRate = ts; else if (AAC_RATES[fi]) sampleRate = AAC_RATES[fi];
    return { fourcc: fc, codec: 'aac', channels, sampleRate, description: dsi, codecString: 'mp4a.40.' + objType };
  }

  /** جداول العيّنات ← مصفوفات لكل عيّنة: موضعها وحجمها وزمنها وهل هي إطار مفتاحي */
  function sampleTable(b, stbl) {
    const stsz = child(b, stbl, 'stsz'), stz2 = child(b, stbl, 'stz2');
    let n = 0, size;
    if (stsz) {
      const fixed = u32(b, stsz.start + 4);
      n = u32(b, stsz.start + 8);
      size = new Uint32Array(n);
      for (let i = 0; i < n; i++) size[i] = fixed || u32(b, stsz.start + 12 + i * 4);
    } else if (stz2) {
      const bits = b[stz2.start + 7], v = dv(b);
      n = u32(b, stz2.start + 8);
      size = new Uint32Array(n);
      for (let i = 0, p = stz2.start + 12; i < n; i++) {
        if (bits === 16) size[i] = v.getUint16(p + i * 2);
        else if (bits === 8) size[i] = b[p + i];
        else size[i] = i & 1 ? b[p + (i >> 1)] & 15 : b[p + (i >> 1)] >> 4;
      }
    } else return null;

    const stco = child(b, stbl, 'stco'), co64 = child(b, stbl, 'co64'), co = stco || co64;
    if (!co) return null;
    const nch = u32(b, co.start + 4), chunk = new Float64Array(nch);
    for (let i = 0; i < nch; i++) chunk[i] = stco ? u32(b, co.start + 8 + i * 4) : u64(b, co.start + 8 + i * 8);

    const offset = new Float64Array(n);
    const stsc = child(b, stbl, 'stsc');
    if (stsc) {
      const ne = u32(b, stsc.start + 4);
      let si = 0;
      for (let k = 0; k < ne && si < n; k++) {
        const p = stsc.start + 8 + k * 12;
        const first = u32(b, p), per = u32(b, p + 4);
        const last = k + 1 < ne ? u32(b, p + 12) - 1 : nch;
        for (let c = first; c <= last && si < n; c++) {
          let off = chunk[c - 1];
          for (let j = 0; j < per && si < n; j++) { offset[si] = off; off += size[si]; si++; }
        }
      }
    }

    const dts = new Float64Array(n), dur = new Uint32Array(n);
    const stts = child(b, stbl, 'stts');
    if (stts) {
      const ne = u32(b, stts.start + 4);
      let si = 0, t = 0;
      for (let k = 0; k < ne; k++) {
        const cnt = u32(b, stts.start + 8 + k * 8), d = u32(b, stts.start + 12 + k * 8);
        for (let j = 0; j < cnt && si < n; j++) { dts[si] = t; dur[si] = d; t += d; si++; }
      }
    }

    const cts = new Int32Array(n);
    const ctts = child(b, stbl, 'ctts');
    if (ctts) {
      const ne = u32(b, ctts.start + 4), v = dv(b);
      let si = 0;
      for (let k = 0; k < ne; k++) {
        const cnt = u32(b, ctts.start + 8 + k * 8), o = v.getInt32(ctts.start + 12 + k * 8);
        for (let j = 0; j < cnt && si < n; j++) cts[si++] = o;
      }
    }

    const stss = child(b, stbl, 'stss'), key = new Uint8Array(n);
    if (stss) {
      const ne = u32(b, stss.start + 4);
      for (let k = 0; k < ne; k++) { const i = u32(b, stss.start + 8 + k * 4) - 1; if (i >= 0 && i < n) key[i] = 1; }
    } else key.fill(1);

    return { n, offset, size, dts, dur, cts, key };
  }

  /** إزاحة قائمة التعديل (elst): كم ثانية تُضاف إلى زمن العرض في الوسط لنحصل على زمنه في الفيلم */
  function editShift(b, trak, movieTs, ts) {
    const elst = path(b, trak, ['edts', 'elst']);
    if (!elst) return 0;
    const ver = b[elst.start], n = u32(b, elst.start + 4), v = dv(b);
    let p = elst.start + 8, lead = 0;
    for (let k = 0; k < n; k++) {
      const segDur = ver ? u64(b, p) : u32(b, p);
      const mediaTime = ver ? Number(v.getBigInt64(p + 8)) : v.getInt32(p + 4);
      p += ver ? 20 : 12;
      if (mediaTime === -1) { lead += segDur / movieTs; continue; }
      return lead - mediaTime / ts;
    }
    return lead;
  }

  /** زاوية الدوران من مصفوفة tkhd (بالاصطلاح نفسه الذي يكتبه mp4-muxer) */
  function rotation(b, tkhd) {
    if (!tkhd) return 0;
    const v = dv(b), m = tkhd.start + (b[tkhd.start] === 1 ? 36 : 24) + 16;
    const a = v.getInt32(m) / 65536, bb = v.getInt32(m + 4) / 65536;
    const deg = Math.round(Math.atan2(bb, a) * 180 / Math.PI / 90) * 90;
    return ((deg % 360) + 360) % 360;
  }

  function parseTrak(b, trak, movieTs) {
    const mdia = child(b, trak, 'mdia'), hdlr = child(b, mdia, 'hdlr'), mdhd = child(b, mdia, 'mdhd');
    if (!hdlr || !mdhd) return null;
    const handler = fourcc(b, hdlr.start + 8);
    const type = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : null;
    if (!type) return null;
    const ts = u32(b, mdhd.start + (b[mdhd.start] === 1 ? 20 : 12));
    const stbl = path(b, mdia, ['minf', 'stbl']), stsd = child(b, stbl, 'stsd');
    if (!stsd || !ts) return null;
    const table = sampleTable(b, stbl);
    if (!table || !table.n) return null;
    return {
      type, ts, ...sampleEntry(b, stsd, type, ts), ...table,
      shift: editShift(b, trak, movieTs, ts),
      rotation: type === 'video' ? rotation(b, child(b, trak, 'tkhd')) : 0,
    };
  }

  /**
   * يقرأ بنية ملف MP4/MOV. src = { size, read(offset, length) → Promise<Uint8Array> }
   * يعيد { video, audio, duration, copy } حيث copy: هل يمكن النسخ المباشر، و reason إن لم يمكن.
   * يرمي خطأً إن لم يكن الملف MP4 أصلاً (WebM مثلاً).
   */
  async function parseMp4(src) {
    const top = await topBoxes(src);
    const moov = top.find(x => x.type === 'moov');
    if (!moov || !top.some(x => x.type === 'mdat')) throw new Error('not an MP4 file');
    if (moov.size > 256 << 20) throw new Error('moov box too large');
    const b = await src.read(moov.pos + moov.hdr, moov.size - moov.hdr);
    const root = { start: 0, end: b.length };
    const mvhd = child(b, root, 'mvhd');
    const movieTs = mvhd ? u32(b, mvhd.start + (b[mvhd.start] === 1 ? 20 : 12)) || 1000 : 1000;
    const tracks = boxes(b, 0, b.length).filter(x => x.type === 'trak').map(t => parseTrak(b, t, movieTs)).filter(Boolean);
    const video = tracks.find(t => t.type === 'video') || null;
    const audio = tracks.find(t => t.type === 'audio') || null;
    const info = { video, audio, duration: video ? trackEnd(video) : 0, copy: false, reason: '' };
    if (child(b, root, 'mvex') || top.some(x => x.type === 'moof')) info.reason = 'fragmented';
    else if (!video) info.reason = 'no video';
    else if (!video.codec) info.reason = `video codec ${video.fourcc}`;
    else if (audio && !audio.codec) info.reason = `audio codec ${audio.fourcc}`;
    else info.copy = true;
    return info;
  }

  /** زمن عرض العيّنة بالثواني على خط زمني الفيلم */
  const pts = (tr, i) => (tr.dts[i] + tr.cts[i]) / tr.ts + tr.shift;

  function trackEnd(tr) {
    let end = 0;
    for (let i = 0; i < tr.n; i++) end = Math.max(end, pts(tr, i) + tr.dur[i] / tr.ts);
    return end;
  }

  /** أول عيّنة صوت زمنها ≥ t (عيّنات الصوت مرتبة زمنياً) */
  function audioIndex(a, t) {
    let lo = 0, hi = a.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pts(a, m) < t - 1e-4) lo = m + 1; else hi = m; }
    return lo;
  }

  /**
   * أجزاء النسخ المباشر: كل جزء يبدأ عند الإطار المفتاحي الذي يسبق موضع القطع المطلوب (أو يوافقه).
   * قطعان يقعان على الإطار المفتاحي نفسه يصيران قطعاً واحداً، فقد يقل عدد الأجزاء عن المطلوب.
   * every (بدل cuts): «كل N ثانية» بحيث لا يزيد أي جزء على N — كل جزء يُقاس من البداية الفعلية للجزء الذي قبله،
   * فلا يتراكم فرق المحاذاة (مهم لحدود مثل 30 ثانية في حالات واتساب).
   * يعيد [{ start, end, origin, v0, v1, a0, a1 }]: الزمن الفعلي، ومدى عيّنات الفيديو والصوت (بترتيب الفك).
   */
  function copyParts(info, { start = 0, end = Infinity, cuts = [], every = 0 }) {
    const v = info.video, a = info.audio, endT = info.duration;
    const keys = [], kt = [];
    for (let i = 0; i < v.n; i++) if (v.key[i]) { keys.push(i); kt.push(pts(v, i)); }
    if (!keys.length) { keys.push(0); kt.push(pts(v, 0)); }
    const snap = t => {
      let lo = 0, hi = keys.length - 1;
      if (kt[0] > t + 1e-3) return keys[0];
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (kt[m] <= t + 1e-3) lo = m; else hi = m - 1; }
      return keys[lo];
    };
    const bounds = [snap(start)];
    for (const c of cuts) { const k = snap(c); if (k > bounds[bounds.length - 1]) bounds.push(k); }
    if (every > 0) {
      const stop = Math.min(end, endT);
      for (;;) {
        const b = bounds[bounds.length - 1], tb = pts(v, b);
        if (stop - tb <= every + 1e-3) break;
        let k = snap(tb + every);
        if (k <= b) k = keys.find(x => x > b); // لا إطار مفتاحي داخل المدة: أقرب واحد بعدها
        if (k === undefined) break;
        bounds.push(k);
      }
    }
    // نهاية النطاق لا تحتاج إطاراً مفتاحياً: نأخذ بترتيب الفك كل ما يلزم لعرض الإطارات قبلها
    // (قد يزيد إطار أو اثنان من إطارات P التي تُفك قبل إطارات B المعروضة قبلها)
    let last = v.n, exactEnd = false;
    if (end < endT - 0.05) {
      let m = -1;
      for (let i = 0; i < v.n; i++) if (pts(v, i) < end - 1e-6) m = i;
      last = m + 1; exactEnd = true;
    }
    while (bounds.length > 1 && bounds[bounds.length - 1] >= last) bounds.pop();
    if (bounds[0] >= last) { last = keys.find(k => k > bounds[0]) ?? v.n; exactEnd = false; }
    const decodeAt = i => pts(v, i) - v.cts[i] / v.ts;
    const fromTop = start <= kt[0] + 1e-3 && bounds[0] === keys[0];
    return bounds.map((v0, i) => {
      const v1 = i + 1 < bounds.length ? bounds[i + 1] : last;
      const tail = exactEnd && i === bounds.length - 1;
      const s = pts(v, v0), e = tail ? end : v1 < v.n ? pts(v, v1) : endT;
      // origin = الزمن الذي يصير صفراً في الملف الناتج = زمن فك الإطار المفتاحي.
      // كل مسار في MP4 (بلا قائمة تعديل) يبدأ فكّه من صفر، فيبدأ الصوت من origin كي يبقى متزامناً مع الصورة
      const part = { start: s, end: e, origin: decodeAt(v0), v0, v1, a0: 0, a1: 0 };
      if (a && a.codec) {
        part.a0 = audioIndex(a, part.origin);
        part.a1 = tail ? audioIndex(a, end) : v1 < v.n ? audioIndex(a, decodeAt(v1)) : a.n;
        // الجزء الأول من بداية الملف يأخذ الصوت كله من أوله
        if (i === 0 && fromTop) { part.a0 = 0; part.origin = Math.max(0, Math.min(part.origin, pts(a, 0))); }
      }
      return part;
    });
  }

  const abortError = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };

  /**
   * ينسخ عيّنات جزء واحد إلى ملف MP4 جديد. لا فك ولا ترميز: البايتات نفسها بتوقيت يبدأ من صفر.
   * Muxer = مكتبة mp4-muxer. يعيد Uint8Array.
   */
  async function copyPart(src, info, part, Muxer, { audio = true, signal, onProgress } = {}) {
    const v = info.video, a = audio && info.audio && info.audio.codec ? info.audio : null;
    const muxer = new Muxer.Muxer({
      target: new Muxer.ArrayBufferTarget(),
      video: {
        codec: v.codec, width: v.width, height: v.height, rotation: v.rotation,
        frameRate: Number.isInteger(v.ts) && v.ts > 0 && v.ts <= 1e6 ? v.ts : undefined, // نفس مقياس الزمن: توقيت مطابق للأصل
      },
      audio: a ? { codec: 'aac', numberOfChannels: a.channels, sampleRate: a.sampleRate } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    // العيّنات بترتيب زمن الفك (الفيديو أولاً عند التساوي)
    const items = [];
    for (let i = part.v0; i < part.v1; i++) {
      if (pts(v, i) < part.start - 1e-6) continue; // إطارات تعتمد على ما قبل الإطار المفتاحي (GOP مفتوح) ولا تُعرض
      const p = pts(v, i) - part.origin;
      const cto = v.cts[i] / v.ts;
      items.push({ tr: v, i, pts: Math.max(0, p), dts: p - cto, cto, video: true });
    }
    const vItems = items.length;
    if (a) for (let j = part.a0; j < part.a1; j++) {
      const p = Math.max(0, pts(a, j) - part.origin);
      items.push({ tr: a, i: j, pts: p, dts: p, cto: 0, video: false });
    }
    if (!vItems) throw new Error('empty part');
    const order = [];
    for (let i = 0, j = vItems; i < vItems || j < items.length;) {
      if (j >= items.length || (i < vItems && items[i].dts <= items[j].dts)) order.push(items[i++]);
      else order.push(items[j++]);
    }

    let firstV = true, firstA = true;
    for (let k = 0; k < order.length;) {
      if (signal && signal.aborted) throw abortError();
      // نقرأ عيّنات متجاورة في الملف دفعة واحدة
      let lo = Infinity, hi = 0, m = k;
      while (m < order.length) {
        const it = order[m], o = it.tr.offset[it.i], e = o + it.tr.size[it.i];
        const nlo = Math.min(lo, o), nhi = Math.max(hi, e);
        if (m > k && nhi - nlo > READ_WINDOW) break;
        lo = nlo; hi = nhi; m++;
      }
      const buf = await src.read(lo, hi - lo);
      for (let q = k; q < m; q++) {
        const it = order[q], tr = it.tr, o = tr.offset[it.i] - lo;
        const data = buf.subarray(o, o + tr.size[it.i]);
        const dur = tr.dur[it.i] / tr.ts * 1e6;
        if (it.video) {
          const meta = firstV ? { decoderConfig: { codec: v.codecString, codedWidth: v.width, codedHeight: v.height, description: v.description } } : undefined;
          muxer.addVideoChunkRaw(data, tr.key[it.i] ? 'key' : 'delta', it.pts * 1e6, dur, meta, it.cto * 1e6);
          firstV = false;
        } else {
          const meta = firstA ? { decoderConfig: { codec: a.codecString, sampleRate: a.sampleRate, numberOfChannels: a.channels, description: a.description } } : undefined;
          muxer.addAudioChunkRaw(data, 'key', it.pts * 1e6, dur, meta);
          firstA = false;
        }
      }
      k = m;
      if (onProgress) onProgress(k / order.length);
    }
    muxer.finalize();
    return new Uint8Array(muxer.target.buffer);
  }

  /** مصدر قراءة من File أو Blob في المتصفح */
  const blobSource = blob => ({
    size: blob.size,
    read: async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()),
  });

  return { MIN_PART, planCuts, exactParts, parseTimes, parseMp4, copyParts, copyPart, blobSource, pts };
})();

if (typeof module !== 'undefined') module.exports = VideoTools;
