'use strict';
/* ملف المشروع (.montaji) — منطق بلا واجهة، يُختبر في Node.
   الملف أرشيف ZIP عادي بلا ضغط: project.json (الخط الزمني) ومعه مجلد media/ فيه ملفات الوسائط،
   فيفتحه أي برنامج ZIP وتُستخرج منه الملفات إن لزم. */

const ProjectTools = (() => {
  const VERSION = 1, EXT = 'montaji', MIN_LEN = 0.2;
  const MAX32 = 0xFFFFFFFF;
  const invalid = () => new Error('الملف ليس ملف مشروع مونتاجي صالحاً');

  /* ================= CRC-32 على دفعات ================= */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crcUpdate(c, bytes) {
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return c;
  }
  const crc32 = bytes => (crcUpdate(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0;

  /** CRC لملف كبير دون تحميله كله في الذاكرة: يُقرأ دفعات */
  async function crcOfBlob(blob, onProgress, step = 8 << 20) {
    let c = 0xFFFFFFFF;
    for (let o = 0; o < blob.size; o += step) {
      c = crcUpdate(c, new Uint8Array(await blob.slice(o, o + step).arrayBuffer()));
      if (onProgress) onProgress(Math.min(blob.size, o + step));
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ================= كتابة ZIP ================= */
  /**
   * entries: [{ name, size, crc, data }] و data جزء Blob (ملف أو بايتات).
   * يعيد أجزاء تُجمع بـ new Blob(parts): الملفات تبقى مراجع فلا تُنسخ في الذاكرة.
   * ZIP64 يُستعمل حين يتجاوز ملف أو الأرشيف 4 غيغابايت (مشاريع الفيديو تبلغها بسهولة).
   */
  function zipParts(entries, opts = {}) {
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
    const date = (d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
    const u64 = (view, at, n) => view.setBigUint64(at, BigInt(n), true);
    let offset = 0, cdSize = 0;
    for (const f of entries) {
      const name = enc.encode(f.name);
      const big = !!opts.zip64 || f.size >= MAX32, far = big || offset >= MAX32;

      const lx = new DataView(new ArrayBuffer(big ? 20 : 0));
      if (big) { lx.setUint16(0, 1, true); lx.setUint16(2, 16, true); u64(lx, 4, f.size); u64(lx, 12, f.size); }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, big ? 45 : 20, true);
      lh.setUint16(6, 0x0800, true); // الأسماء UTF-8 (أسماء عربية)
      lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, f.crc, true); lh.setUint32(18, big ? MAX32 : f.size, true); lh.setUint32(22, big ? MAX32 : f.size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, lx.byteLength, true);
      parts.push(new Uint8Array(lh.buffer), name, new Uint8Array(lx.buffer), f.data);

      const cx = new DataView(new ArrayBuffer(far ? 28 : 0));
      if (far) { cx.setUint16(0, 1, true); cx.setUint16(2, 24, true); u64(cx, 4, f.size); u64(cx, 12, f.size); u64(cx, 20, offset); }
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, far ? 45 : 20, true); ch.setUint16(6, far ? 45 : 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, f.crc, true); ch.setUint32(20, far ? MAX32 : f.size, true); ch.setUint32(24, far ? MAX32 : f.size, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, cx.byteLength, true);
      ch.setUint32(42, far ? MAX32 : offset, true);
      central.push(new Uint8Array(ch.buffer), name, new Uint8Array(cx.buffer));
      cdSize += 46 + name.length + cx.byteLength;
      offset += 30 + name.length + lx.byteLength + f.size;
    }

    const tail = [];
    const wide = !!opts.zip64 || entries.length >= 0xFFFF || cdSize >= MAX32 || offset >= MAX32;
    if (wide) {
      const r = new DataView(new ArrayBuffer(56));
      r.setUint32(0, 0x06064b50, true); u64(r, 4, 44); r.setUint16(12, 45, true); r.setUint16(14, 45, true);
      u64(r, 24, entries.length); u64(r, 32, entries.length); u64(r, 40, cdSize); u64(r, 48, offset);
      const l = new DataView(new ArrayBuffer(20));
      l.setUint32(0, 0x07064b50, true); u64(l, 8, offset + cdSize); l.setUint32(16, 1, true);
      tail.push(new Uint8Array(r.buffer), new Uint8Array(l.buffer));
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, wide ? 0xFFFF : entries.length, true); end.setUint16(10, wide ? 0xFFFF : entries.length, true);
    end.setUint32(12, wide ? MAX32 : cdSize, true); end.setUint32(16, wide ? MAX32 : offset, true);
    tail.push(new Uint8Array(end.buffer));

    return { parts: [...parts, ...central, ...tail], size: offset + cdSize + (wide ? 76 : 0) + 22 };
  }

  /* ================= قراءة ZIP ================= */
  /** يقرأ فهرس الأرشيف من آخره فقط: [{ name, method, crc, size, csize, offset }] */
  async function readZip(blob) {
    const view = async (a, b) => new DataView(await blob.slice(a, b).arrayBuffer());
    const tailAt = Math.max(0, blob.size - 66000);
    const tail = await view(tailAt, blob.size);
    let p = tail.byteLength - 22;
    while (p >= 0 && tail.getUint32(p, true) !== 0x06054b50) p--;
    if (p < 0) throw invalid();
    let count = tail.getUint16(p + 10, true), cdSize = tail.getUint32(p + 12, true), cdAt = tail.getUint32(p + 16, true);
    if (count === 0xFFFF || cdSize === MAX32 || cdAt === MAX32) {
      const l = p - 20;
      if (l < 0 || tail.getUint32(l, true) !== 0x07064b50) throw invalid();
      const at = Number(tail.getBigUint64(l + 8, true));
      const r = await view(at, at + 56);
      if (r.byteLength < 56 || r.getUint32(0, true) !== 0x06064b50) throw invalid();
      count = Number(r.getBigUint64(32, true)); cdSize = Number(r.getBigUint64(40, true)); cdAt = Number(r.getBigUint64(48, true));
    }
    if (count > 100000 || cdSize > 64e6 || cdAt + cdSize > blob.size) throw invalid();

    const cd = await view(cdAt, cdAt + cdSize), dec = new TextDecoder(), out = [];
    for (let i = 0, q = 0; i < count; i++) {
      if (q + 46 > cd.byteLength || cd.getUint32(q, true) !== 0x02014b50) throw invalid();
      const method = cd.getUint16(q + 10, true), crc = cd.getUint32(q + 16, true);
      let csize = cd.getUint32(q + 20, true), size = cd.getUint32(q + 24, true), offset = cd.getUint32(q + 42, true);
      const n = cd.getUint16(q + 28, true), x = cd.getUint16(q + 30, true), c = cd.getUint16(q + 32, true);
      if (q + 46 + n + x > cd.byteLength) throw invalid();
      const name = dec.decode(new Uint8Array(cd.buffer, q + 46, n));
      // حقل ZIP64: يحمل فقط القيم التي امتلأ حقلها ذو 32 بت، بهذا الترتيب
      for (let e = q + 46 + n, stop = e + x; e + 4 <= stop;) {
        const id = cd.getUint16(e, true), len = cd.getUint16(e + 2, true);
        if (id === 1) {
          let k = e + 4;
          const next = () => { if (k + 8 > stop) throw invalid(); const v = Number(cd.getBigUint64(k, true)); k += 8; return v; };
          if (size === MAX32) size = next();
          if (csize === MAX32) csize = next();
          if (offset === MAX32) offset = next();
        }
        e += 4 + len;
      }
      out.push({ name, method, crc, size, csize, offset });
      q += 46 + n + x + c;
    }
    return out;
  }

  /** بيانات ملف من الأرشيف كـ Blob. المخزَّن بلا ضغط شريحة من الملف الأصلي، فلا نسخ في الذاكرة */
  async function zipData(blob, e) {
    const h = new DataView(await blob.slice(e.offset, e.offset + 30).arrayBuffer());
    if (h.byteLength < 30 || h.getUint32(0, true) !== 0x04034b50) throw invalid();
    const at = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    if (at + e.csize > blob.size) throw invalid();
    const raw = blob.slice(at, at + e.csize);
    if (e.method === 0) return raw;
    // أرشيف أعاد المستخدم ضغطه ببرنامج ZIP
    if (e.method === 8 && typeof DecompressionStream !== 'undefined') {
      return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    }
    throw new Error('طريقة ضغط غير مدعومة في ملف المشروع');
  }

  /* ================= من المشروع إلى JSON ================= */
  // ما يُشتق من ملف الوسائط عند الفتح، أو كائنات المتصفح، لا يُحفظ
  const SKIP = new Set(['url', 'file', 'el', 'buf', 'thumb', 'wave', 'beats', 'w', 'h', 'srcDur']);
  function plain(o) {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (k[0] === '_' || SKIP.has(k)) continue;
      if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) out[k] = v;
    }
    return out;
  }

  /** اسم ملف آمن داخل الأرشيف: بلا مسارات ولا رموز يرفضها ويندوز */
  const cleanName = name => String(name || '').replace(/[\\/]/g, '-').replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(-90);
  const entryName = name => cleanName(name) || 'file';

  /**
   * يحوّل الحالة إلى بيانات المشروع وقائمة مصادر الوسائط.
   * المقاطع المقسومة أو المكررة تشترك في الملف نفسه، فيُحفظ مرة واحدة.
   * ← { data, sources: [{ id, path, source, edited }] } حيث source ملف، أو لوحة Canvas لصورة عُدّلت في استوديو الصور
   */
  function serialize(st) {
    const sources = [], seen = new Map();
    const ref = (item, kind) => {
      const edited = kind === 'image' && !!item.el && typeof item.el.getContext === 'function';
      const source = edited ? item.el : item.file;
      if (!source) return null;
      let m = seen.get(source);
      if (!m) {
        const name = edited ? String(item.name || 'image').replace(/\.[^.\\/]+$/, '') + '.png' : item.name || source.name || kind;
        m = { id: 'm' + (sources.length + 1), kind, name, path: `media/${sources.length + 1}-${entryName(name)}`, source, edited };
        seen.set(source, m);
        sources.push(m);
      }
      return m.id;
    };
    const withMedia = (list, kindOf) => list.map(o => ({ ...plain(o), media: ref(o, kindOf(o)) })).filter(o => o.media);
    const data = {
      app: 'montaji', version: VERSION, name: st.name || '', ratio: st.ratio,
      clips: withMedia(st.clips, c => (c.type === 'video' ? 'video' : 'image')),
      audios: withMedia(st.audios, () => 'audio'),
      texts: st.texts.map(plain),
      effects: st.effects.map(plain),
      media: sources.map(({ id, kind, name, path }) => ({ id, kind, name, path })),
    };
    return { data, sources };
  }

  /* ================= من JSON إلى مشروع موثوق ================= */
  // الملف قد يأتي من أي مكان: كل قيمة تُفحص، وما لا يُعرف يُهمل. نصوص مثل اللون والمعرّف
  // تدخل في HTML الواجهة، فلا تُقبل إلا بصيغتها الدقيقة.
  const ENUMS = {
    ratio: ['16:9', '9:16', '1:1', '4:5'],
    transition: ['none', 'fade', 'slide', 'zoom', 'wipe', 'black'],
    motion: ['none', 'zoomIn', 'zoomOut', 'panRight', 'panLeft', 'panUp', 'panDown', 'handheld'],
    fit: ['blur', 'contain', 'cover'],
    anim: ['none', 'fade', 'rise', 'pop'],
    filters: ['none', 'vivid', 'warm', 'cool', 'bw', 'vintage', 'soft'],
    fonts: ['segoe', 'tahoma', 'arial', 'times', 'courier', 'elegant'],
    effects: ['zoomBlur', 'whip', 'flash', 'shake', 'rgb', 'bw', 'sharp', 'vignette', 'darken', 'zoomTo', 'spotlight', 'shine', 'glow', 'sparkle', 'areaFlash', 'backlight'],
  };
  const TEXT_DEFAULTS = {
    text: '', start: 0, dur: 3, x: 0.5, y: 0.82, size: 0.08, color: '#ffffff', font: 'segoe', bold: true,
    stroke: true, strokeColor: '#000000', bg: false, bgColor: '#000000', shadow: true, anim: 'fade',
  };
  const EFFECT_DEFAULTS = { start: 0, dur: 1, amount: 1, at: null, atMode: 'cut', x: 0.5, y: 0.5, r: 0.3, w: 0.4, h: 0.2 };

  const num = (min, max) => v => (typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
  const bool = v => (typeof v === 'boolean' ? v : undefined);
  const str = max => v => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const id = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : undefined);
  const color = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
  const oneOf = list => v => (list.includes(v) ? v : undefined);
  const T = 1e6; // حد أعلى للأزمنة بالثواني

  function specs(en) {
    return {
      clip: {
        id, type: oneOf(['image', 'video']), name: str(200), media: id,
        in: num(0, T), out: num(0, T), speed: num(0.25, 4), volume: num(0, 1), muted: bool, pulse: bool,
        filter: oneOf(en.filters), bright: num(50, 150), contrast: num(50, 150), sat: num(0, 200),
        fit: oneOf(en.fit), motion: oneOf(en.motion), transition: oneOf(en.transition), trLen: num(0.1, 1.5),
      },
      audio: { id, name: str(200), media: id, start: num(0, T), in: num(0, T), out: num(0, T), volume: num(0, 1), fadeIn: num(0, 5), fadeOut: num(0, 5) },
      text: {
        id, text: str(2000), start: num(0, T), dur: num(MIN_LEN, T), x: num(0, 1), y: num(0, 1), size: num(0.03, 0.22),
        color, font: oneOf(en.fonts), bold: bool, stroke: bool, strokeColor: color, bg: bool, bgColor: color, shadow: bool, anim: oneOf(en.anim),
      },
      effect: {
        id, type: oneOf(en.effects), start: num(0, T), dur: num(0.1, 600), amount: num(0, 1), at: id, atMode: oneOf(['cut', 'clip']),
        x: num(0, 1), y: num(0, 1), r: num(0.05, 1), w: num(0.02, 1), h: num(0.02, 1),
      },
      media: { id, kind: oneOf(['image', 'video', 'audio']), name: str(200), path: str(300) },
    };
  }

  function clean(o, spec, defaults) {
    const out = { ...defaults };
    if (!o || typeof o !== 'object') return out;
    for (const k in spec) {
      const v = spec[k](o[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  /**
   * يفحص بيانات project.json ويعيد مشروعاً آمناً للتحميل، أو يرمي خطأً برسالة للمستخدم.
   * enums: القيم المتاحة في هذا الإصدار { filters, fonts, effects } (من Render)
   */
  function normalize(data, enums = {}) {
    if (!data || typeof data !== 'object' || data.app !== 'montaji') throw invalid();
    if (!(data.version >= 1)) throw invalid();
    if (data.version > VERSION) throw new Error('هذا المشروع محفوظ بإصدار أحدث من مونتاجي. حدّث البرنامج لفتحه.');
    const sp = specs({ ...ENUMS, ...enums });
    const list = v => (Array.isArray(v) ? v.slice(0, 5000) : []);
    const used = new Set();
    const unique = o => {
      while (!o.id || used.has(o.id)) o.id = Math.random().toString(36).slice(2, 10);
      used.add(o.id);
      return o;
    };

    const media = list(data.media).map(m => clean(m, sp.media)).filter(m => m.id && m.kind && m.path);
    const kinds = new Map(media.map(m => [m.id, m.kind]));
    const clips = list(data.clips).map(c => clean(c, sp.clip)).filter(c => c.type && kinds.get(c.media) === c.type).map(unique);
    const audios = list(data.audios).map(a => clean(a, sp.audio, { start: 0 })).filter(a => kinds.get(a.media) === 'audio').map(unique);
    const texts = list(data.texts).map(x => clean(x, sp.text, TEXT_DEFAULTS)).map(unique);
    const clipIds = new Set(clips.map(c => c.id));
    const effects = list(data.effects).map(e => clean(e, sp.effect, EFFECT_DEFAULTS)).filter(e => e.type).map(unique);
    for (const e of effects) if (e.at && !clipIds.has(e.at)) e.at = null;

    const usedMedia = new Set([...clips, ...audios].map(o => o.media));
    return {
      name: str(120)(data.name) || '', ratio: oneOf(ENUMS.ratio)(data.ratio) || '16:9',
      clips, audios, texts, effects, media: media.filter(m => usedMedia.has(m.id)),
    };
  }

  /** اسم ملف المشروع من اسمه: بلا مسارات ولا رموز محجوزة، وبالامتداد */
  function fileName(name) {
    const n = cleanName(String(name || '').replace(new RegExp('\\.' + EXT + '$', 'i'), '')).replace(/[. ]+$/, '');
    return (n || 'مشروع') + '.' + EXT;
  }

  return { VERSION, EXT, crc32, crcUpdate, crcOfBlob, zipParts, readZip, zipData, serialize, normalize, entryName, fileName, ENUMS };
})();

if (typeof module !== 'undefined') module.exports = ProjectTools;
