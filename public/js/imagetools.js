'use strict';
/* معالجة الصور: إزالة الخلفية، القص والتدوير، التحويل بين الصيغ، وحزم ZIP — منطق بلا واجهة.
   دوال البكسلات تقبل أي كائن { data, width, height } فتُختبر في Node (يُحمَّل الملف هناك أيضاً). */

const ImageTools = (() => {
  const FORMATS = {
    jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
    png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false, alpha: true },
    webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
  };
  const MAX_PIXELS = 40e6; // فوق هذا تُصغَّر الصورة عند الفتح كي لا تتجاوز حدود Canvas

  const lim = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ================= إزالة الخلفية ================= */

  /** الألوان الغالبة على إطار الصورة: هي المرشّحة لأن تكون الخلفية */
  function borderColors(img) {
    const { data, width: w, height: h } = img;
    const step = Math.max(1, Math.floor((w + h) / 800));
    const buckets = new Map();
    let total = 0;
    const add = (x, y) => {
      const p = (y * w + x) * 4;
      if (data[p + 3] < 8) return;
      const k = (data[p] >> 4) << 8 | (data[p + 1] >> 4) << 4 | data[p + 2] >> 4;
      let b = buckets.get(k);
      if (!b) buckets.set(k, b = [0, 0, 0, 0]);
      b[0] += data[p]; b[1] += data[p + 1]; b[2] += data[p + 2]; b[3]++;
      total++;
    };
    for (let x = 0; x < w; x += step) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y += step) { add(0, y); add(w - 1, y); }
    // اللون الأكثر تكراراً دائماً، ومعه كل لون يغطي جزءاً معتبراً من الإطار (خلفية بلونين مثلاً).
    // الحد الأدنى يمنع عنصراً يلامس الحافة (كتف، قاعدة منتج) من أن يُحسب خلفية
    return [...buckets.values()].sort((a, b) => b[3] - a[3])
      .filter((b, i) => i === 0 || b[3] >= total * 0.12).slice(0, 4)
      .map(b => [b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
  }

  /** متوسط لون مربع 3×3 حول نقطة */
  function colorAt(img, x, y) {
    const { data, width: w, height: h } = img;
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1); j++) {
      for (let i = Math.max(0, x - 1); i <= Math.min(w - 1, x + 1); i++) {
        const p = (j * w + i) * 4;
        r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
      }
    }
    return [r / n, g / n, b / n];
  }

  function boxBlur(src, w, h, r) {
    const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length), win = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + lim(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    // المرور العمودي يسير صفاً صفاً بمجموع جارٍ لكل عمود: القفز عمودياً في الذاكرة أبطأ بمرات في الصور الكبيرة
    const col = new Uint32Array(w);
    for (let k = -r; k <= r; k++) {
      const row = lim(k, 0, h - 1) * w;
      for (let x = 0; x < w; x++) col[x] += tmp[row + x];
    }
    for (let y = 0; y < h; y++) {
      const row = y * w, add = Math.min(h - 1, y + r + 1) * w, del = Math.max(0, y - r) * w;
      for (let x = 0; x < w; x++) {
        out[row + x] = col[x] / win;
        col[x] += tmp[add + x] - tmp[del + x];
      }
    }
    return out;
  }

  /**
   * يجعل الخلفية شفافة (يعدّل img.data في مكانه) ويعيد { removed, share }.
   * الطريقة لونية لا ذكاء اصطناعي: تنجح مع الخلفيات الموحّدة أو المتدرّجة بهدوء.
   *   tolerance   0..100 مقدار اختلاف اللون المسموح عن لون الخلفية
   *   feather     0..8 بكسل: تنعيم الحافة (يأكل قليلاً من حافة العنصر فيزيل هالة الخلفية)
   *   seed        { x, y } نقطة نقرها المستخدم؛ بدونها تبدأ الإزالة من حواف الصورة
   *   contiguous  true: المناطق المتصلة بنقطة البدء فقط. false: اللون أينما وُجد
   */
  function removeBackground(img, o = {}) {
    const { data, width: w, height: h } = img, n = w * h;
    const tol = lim(o.tolerance == null ? 22 : +o.tolerance, 0, 100) * 2.2; // 100 ← نصف أقصى مسافة لونية تقريباً
    const near2 = tol * tol;
    const far2 = near2 * 3.24, step2 = near2 * 0.0625; // تتبّع التدرّج: حتى 1.8× ما دام الفرق عن الجار أقل من ربع الحساسية
    const seed = o.seed ? { x: lim(Math.round(o.seed.x), 0, w - 1), y: lim(Math.round(o.seed.y), 0, h - 1) } : null;
    const refs = seed ? [colorAt(img, seed.x, seed.y)] : borderColors(img);

    // كل بكسل يُصنَّف مرة واحدة في مرور خطّي سريع، ثم تقرأ التعبئة التصنيف فقط:
    // FAR ليس خلفية أبداً · NEAR خلفية إن وصلته التعبئة · MID خلفية إن كان امتداداً ناعماً لجاره (تدرّج) · BG خلفية مؤكدة
    const FAR = 0, NEAR = 1, MID = 2, BG = 3;
    const cls = new Uint8Array(n);
    const nr = refs.length, rr = refs.map(c => c[0]), rg = refs.map(c => c[1]), rb = refs.map(c => c[2]);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (data[p + 3] < 8) { cls[i] = NEAR; continue; } // الشفاف أصلاً خلفية، والتعبئة تمرّ عبره
      const r = data[p], g = data[p + 1], b = data[p + 2];
      let best = Infinity;
      for (let k = 0; k < nr; k++) {
        const dr = r - rr[k], dg = g - rg[k], db = b - rb[k], d = dr * dr + dg * dg + db * db;
        if (d < best) best = d;
      }
      cls[i] = best <= near2 ? NEAR : best <= far2 ? MID : FAR;
    }

    let removed = 0;
    if (o.contiguous === false) {
      for (let i = 0; i < n; i++) if (cls[i] === NEAR) { cls[i] = BG; removed++; }
    } else {
      const stack = new Int32Array(n); // كل بكسل يدخل مرة واحدة على الأكثر
      let top = 0;
      const take = i => { cls[i] = BG; removed++; stack[top++] = i; };
      const start = i => { if (cls[i] === NEAR) take(i); };
      /** j جار للبكسل i المؤكد أنه خلفية */
      const grow = (j, i) => {
        const c = cls[j];
        if (c === NEAR) take(j);
        else if (c === MID) {
          const p = j * 4, q = i * 4;
          const dr = data[p] - data[q], dg = data[p + 1] - data[q + 1], db = data[p + 2] - data[q + 2];
          if (dr * dr + dg * dg + db * db <= step2) take(j);
        }
      };
      if (seed) take(seed.y * w + seed.x);
      else {
        for (let x = 0; x < w; x++) { start(x); start((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { start(y * w); start(y * w + w - 1); }
      }
      while (top) {
        const i = stack[--top], x = i % w;
        if (x > 0) grow(i - 1, i);
        if (x < w - 1) grow(i + 1, i);
        if (i >= w) grow(i - w, i);
        if (i < n - w) grow(i + w, i);
      }
    }

    const r = Math.round(lim(o.feather == null ? 1 : +o.feather, 0, 8));
    if (r > 0 && removed) {
      let keep = new Uint8Array(n);
      for (let i = 0; i < n; i++) keep[i] = cls[i] === BG ? 0 : 255;
      keep = boxBlur(boxBlur(keep, w, h, r), w, h, r);
      // نأخذ النصف العلوي فقط من التدرّج، فتقع الحافة الناعمة داخل العنصر لا في الخلفية
      for (let i = 0; i < n; i++) {
        if (keep[i] === 255) continue;
        const a = cls[i] === BG ? 0 : lim((keep[i] - 127) * 2, 0, 255);
        if (a < 255) data[i * 4 + 3] = data[i * 4 + 3] * a / 255;
      }
    } else {
      for (let i = 0; i < n; i++) if (cls[i] === BG) data[i * 4 + 3] = 0;
    }
    return { removed, share: n ? removed / n : 0 };
  }

  /* ================= ZIP (تخزين بلا ضغط — الصور مضغوطة أصلاً) ================= */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** files: [{ name, bytes: Uint8Array }] ← Uint8Array لملف zip */
  function zip(files) {
    const enc = new TextEncoder(), local = [], central = [];
    const d = new Date();
    const time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
    const date = (d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.bytes), size = f.bytes.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true); // الأسماء UTF-8 (أسماء عربية)
      lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      local.push(new Uint8Array(lh.buffer), name, f.bytes);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);

    const parts = [...local, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(offset + cdSize + 22);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /* ================= Canvas (المتصفح فقط) ================= */
  function canvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h));
    return cv;
  }

  /** نسخة Canvas من صورة أو فيديو أو Canvas آخر، بحجم اختياري */
  function fromSource(el, w, h) {
    const sw = el.naturalWidth || el.videoWidth || el.width, sh = el.naturalHeight || el.videoHeight || el.height;
    const cv = canvas(w || sw, h || sh), g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(el, 0, 0, cv.width, cv.height);
    return cv;
  }

  /** يفتح ملف صورة (أو Blob) على Canvas */
  async function load(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('تعذّر قراءة الصورة'));
        img.src = url;
      });
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('الصورة فارغة');
      const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
      return fromSource(img, w * k, h * k);
    } finally { URL.revokeObjectURL(url); }
  }

  function rotate(cv, deg) {
    deg = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
    if (!deg) return cv;
    const swap = deg !== 180;
    const out = canvas(swap ? cv.height : cv.width, swap ? cv.width : cv.height), g = out.getContext('2d');
    g.translate(out.width / 2, out.height / 2);
    g.rotate(deg * Math.PI / 180);
    g.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return out;
  }

  function flip(cv, horizontal) {
    const out = canvas(cv.width, cv.height), g = out.getContext('2d');
    if (horizontal) { g.translate(cv.width, 0); g.scale(-1, 1); } else { g.translate(0, cv.height); g.scale(1, -1); }
    g.drawImage(cv, 0, 0);
    return out;
  }

  /** x, y, w, h بالبكسل */
  function crop(cv, x, y, w, h) {
    x = lim(Math.round(x), 0, cv.width - 1); y = lim(Math.round(y), 0, cv.height - 1);
    w = lim(Math.round(w), 1, cv.width - x); h = lim(Math.round(h), 1, cv.height - y);
    const out = canvas(w, h);
    out.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
    return out;
  }

  function resize(cv, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let src = cv;
    // التصغير الكبير على مراحل (النصف كل مرة) يعطي حوافاً أنعم من قفزة واحدة
    while (src.width / 2 >= w && src.height / 2 >= h) src = fromSource(src, src.width / 2, src.height / 2);
    return src.width === w && src.height === h && src !== cv ? src : fromSource(src, w, h);
  }

  function removeBg(cv, opts) {
    const out = fromSource(cv), g = out.getContext('2d');
    const img = g.getImageData(0, 0, out.width, out.height);
    const r = removeBackground(img, opts);
    g.putImageData(img, 0, 0);
    return { canvas: out, ...r };
  }

  /** صورة مصغّرة للخط الزمني وشريط الملفات */
  function thumb(cv, height = 96) {
    const t = fromSource(cv, Math.max(16, height * cv.width / cv.height), height);
    return t.toDataURL('image/png');
  }

  /** لوحة جاهزة للترميز: الصيغ التي بلا شفافية تُملأ خلفيتها بلون matte */
  function flatten(cv, format, matte) {
    if ((FORMATS[format] || FORMATS.png).alpha) return cv;
    const out = canvas(cv.width, cv.height), g = out.getContext('2d');
    g.fillStyle = matte || '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(cv, 0, 0);
    return out;
  }

  /**
   * ترميز متزامن إلى { bytes, blob, mime, ext }.
   * toDataURL يعمل حتى لو كانت الصفحة في الخلفية (بعكس toBlob)، وهذا يلزم عند النداء عبر MCP
   */
  function encode(cv, format, quality = 0.9, matte) {
    const f = FORMATS[format] || FORMATS.png;
    const url = flatten(cv, format, matte).toDataURL(f.mime, quality);
    const mime = url.slice(5, url.indexOf(';'));
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // متصفح لا يدعم الصيغة يعيد PNG بصمت
    return { bytes, mime, ext: mime === f.mime ? f.ext : 'png', blob: new Blob([bytes], { type: mime }) };
  }

  /** حجم الملف الناتج دون تجميد الواجهة (للعرض فقط) */
  function sizeOf(cv, format, quality = 0.9, matte) {
    const f = FORMATS[format] || FORMATS.png;
    return new Promise(res => flatten(cv, format, matte).toBlob(b => res(b ? b.size : 0), f.mime, quality));
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  return {
    FORMATS, removeBackground, borderColors, crc32, zip,
    canvas, fromSource, load, rotate, flip, crop, resize, removeBg, thumb, encode, sizeOf, download,
  };
})();

if (typeof module !== 'undefined') module.exports = ImageTools;
