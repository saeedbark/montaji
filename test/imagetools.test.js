'use strict';
/* معالجة الصور (public/js/imagetools.js): إزالة الخلفية وحزم ZIP — الجزء الذي لا يحتاج متصفحاً */

const test = require('node:test');
const assert = require('node:assert/strict');

const ImageTools = require('../public/js/imagetools.js');

/** صورة RGBA يحدّد لونَ كل بكسل فيها paint(x, y) ← [r, g, b] أو [r, g, b, a] */
function image(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}
const alpha = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];
const inBox = (x, y) => x >= 12 && x < 28 && y >= 12 && y < 28;

test('تزيل الخلفية الموحّدة وتُبقي العنصر', () => {
  const img = image(40, 40, (x, y) => (inBox(x, y) ? [200, 30, 30] : [255, 255, 255]));
  const r = ImageTools.removeBackground(img, { feather: 0 });
  assert.equal(r.removed, 40 * 40 - 16 * 16);
  assert.equal(alpha(img, 0, 0), 0);
  assert.equal(alpha(img, 39, 20), 0);
  assert.equal(alpha(img, 20, 20), 255);
  assert.equal(alpha(img, 12, 12), 255, 'حافة العنصر تبقى كاملة بلا تنعيم');
});

test('لا تحذف لون الخلفية المحبوس داخل العنصر إلا عند إلغاء «المتصلة فقط»', () => {
  const hole = (x, y) => x >= 18 && x < 22 && y >= 18 && y < 22;
  const paint = (x, y) => (hole(x, y) ? [255, 255, 255] : inBox(x, y) ? [20, 60, 200] : [255, 255, 255]);

  const a = image(40, 40, paint);
  ImageTools.removeBackground(a, { feather: 0 });
  assert.equal(alpha(a, 20, 20), 255, 'الثقب الأبيض داخل العنصر يبقى');

  const b = image(40, 40, paint);
  ImageTools.removeBackground(b, { feather: 0, contiguous: false });
  assert.equal(alpha(b, 20, 20), 0, 'يُحذف اللون أينما وُجد');
  assert.equal(alpha(b, 14, 14), 255);
});

test('تتبع الخلفية المتدرّجة بهدوء دون أن تدخل العنصر', () => {
  // تدرّج رمادي من 255 إلى 177: آخره أبعد عن لون الحافة الغالب من حدّ الحساسية المباشر
  const img = image(40, 40, (x, y) => (inBox(x, y) ? [30, 120, 40] : [255 - x * 2, 255 - x * 2, 255 - x * 2]));
  ImageTools.removeBackground(img, { feather: 0 });
  assert.equal(alpha(img, 2, 20), 0);
  assert.equal(alpha(img, 38, 20), 0, 'الطرف الأغمق من التدرّج');
  assert.equal(alpha(img, 20, 20), 255);
});

test('النقر على لون يحذف منطقته المتصلة فقط', () => {
  // نصف أحمر ونصف أزرق؛ النقر على الأحمر لا يمسّ الأزرق
  const img = image(20, 20, x => (x < 10 ? [220, 20, 20] : [20, 20, 220]));
  const r = ImageTools.removeBackground(img, { seed: { x: 3, y: 3 }, feather: 0 });
  assert.equal(r.removed, 200);
  assert.equal(alpha(img, 3, 15), 0);
  assert.equal(alpha(img, 15, 15), 255);
});

test('الحساسية تتحكم في مقدار الاختلاف المقبول', () => {
  // حول العنصر هالة رمادية أغمق قليلاً من الخلفية: تبقى بحساسية منخفضة وتُحذف بالمرتفعة
  const halo = (x, y) => x >= 9 && x < 31 && y >= 9 && y < 31;
  const paint = (x, y) => (inBox(x, y) ? [200, 30, 30] : halo(x, y) ? [205, 205, 205] : [235, 235, 235]);
  const low = image(40, 40, paint), high = image(40, 40, paint);
  const few = ImageTools.removeBackground(low, { tolerance: 5, feather: 0 }).removed;
  const all = ImageTools.removeBackground(high, { tolerance: 40, feather: 0 }).removed;
  assert.ok(few < all, `${few} < ${all}`);
  assert.equal(all, 40 * 40 - 16 * 16);
  assert.equal(alpha(high, 20, 20), 255);
});

test('التنعيم يدرّج الحافة داخل العنصر ولا يُظهر الخلفية', () => {
  const img = image(40, 40, (x, y) => (inBox(x, y) ? [200, 30, 30] : [255, 255, 255]));
  ImageTools.removeBackground(img, { feather: 2 });
  assert.equal(alpha(img, 10, 20), 0, 'الخلفية تبقى شفافة تماماً');
  assert.ok(alpha(img, 12, 20) < 255, 'حافة العنصر شبه شفافة');
  assert.equal(alpha(img, 20, 20), 255, 'وسط العنصر معتم');
});

test('الصورة بلا خلفية واضحة لا تُمسّ', () => {
  // ضجيج ثابت: لا لون يغلب على الحواف
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) % 256;
  const img = image(30, 30, () => [rnd(), rnd(), rnd()]);
  const r = ImageTools.removeBackground(img, { tolerance: 3, feather: 0 });
  assert.ok(r.share < 0.05, `share = ${r.share}`);
});

/* ---------- دمج الصور ---------- */
const covers = (L, i) => { const c = L.cells[i]; return [c.x, c.y, c.w, c.h]; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('الدمج الأفقي يوحّد الارتفاع ويحفظ نسب الصور', () => {
  const L = ImageTools.mergeLayout([{ w: 400, h: 200 }, { w: 300, h: 600 }], { layout: 'row' });
  // الارتفاع الموحّد = متوسط الارتفاعين
  assert.equal(L.height, 400);
  assert.deepEqual(covers(L, 0), [0, 0, 800, 400]);
  assert.deepEqual(covers(L, 1), [800, 0, 200, 400]);
  assert.equal(L.width, 1000);
  assert.deepEqual([L.cells[1].sw, L.cells[1].sh], [300, 600], 'الصورة كاملة بلا قص');
});

test('الترتيب من اليمين يعكس المواضع فقط', () => {
  const sizes = [{ w: 400, h: 200 }, { w: 300, h: 600 }];
  const L = ImageTools.mergeLayout(sizes, { layout: 'row', rtl: true });
  assert.deepEqual(covers(L, 0), [200, 0, 800, 400], 'الأولى في اليمين');
  assert.deepEqual(covers(L, 1), [0, 0, 200, 400]);
});

test('الدمج العمودي مع مسافة وإطار بنسبة من العرض الموحّد', () => {
  const L = ImageTools.mergeLayout([{ w: 100, h: 50 }, { w: 100, h: 100 }], { layout: 'column', gap: 10, padding: 5 });
  // العرض 100 ← مسافة 10 وإطار 5
  assert.deepEqual(covers(L, 0), [5, 5, 100, 50]);
  assert.deepEqual(covers(L, 1), [5, 65, 100, 100]);
  assert.deepEqual([L.width, L.height], [110, 170]);
});

test('الشبكة: خانات متساوية، الملء يقص من الوسط، والصف الأخير الناقص يتوسّط', () => {
  const sizes = [{ w: 200, h: 100 }, { w: 200, h: 100 }, { w: 100, h: 100 }];
  const L = ImageTools.mergeLayout(sizes, { layout: 'grid', columns: 2 });
  assert.equal(L.cells.length, 3);
  const [a, b, c] = L.cells;
  assert.equal(a.w, b.w); assert.equal(a.w, c.w); assert.equal(a.h, c.h);
  assert.ok(Math.abs(a.w / a.h - 2) < 0.02, 'الخانة بنسبة الصورة الوسيطة');
  assert.equal(b.x, a.x + a.w, 'متلاصقتان بلا مسافة');
  assert.ok(Math.abs(c.x - (L.width - c.w) / 2) <= 0.5, 'الصف الأخير في المنتصف');
  // الصورة المربعة في خانة عريضة: يُقص أعلاها وأسفلها بالتساوي
  assert.equal(c.sw, 100); assert.equal(c.sx, 0);
  assert.ok(Math.abs(c.sh - 50) < 1, String(c.sh));
  near(c.sy, (100 - c.sh) / 2);
});

test('الشبكة مع fillRow: خانات الصف الأخير الناقص تتسع لتملأ عرضه بلا فراغ', () => {
  const tall = { w: 600, h: 1000 };
  // 3 صور في عمودين: الصورة الثالثة تأخذ عرض الصف كله
  const L = ImageTools.mergeLayout([tall, tall, tall], { layout: 'grid', columns: 2, gap: 2, fillRow: true });
  const [a, b, c] = L.cells;
  assert.equal(a.w, b.w, 'الصف الكامل لا يتغيّر');
  assert.equal(c.x, 0); assert.equal(c.x + c.w, L.width, 'الخانة الأخيرة تمتد من الحافة إلى الحافة');
  assert.equal(c.h, a.h);
  // الصورة الطويلة في خانة عريضة: يُقص أعلاها وأسفلها من الوسط، والعرض كله ظاهر
  assert.equal(c.sw, 600); assert.ok(c.sh < 1000);
  near(c.sy, (1000 - c.sh) / 2);
  // 5 صور في 3 أعمدة: صورتان تتقاسمان الصف الأخير، والتقاؤهما بالحافة دقيق بعد التقريب
  const M = ImageTools.mergeLayout(Array(5).fill(tall), { layout: 'grid', columns: 3, gap: 3, fillRow: true, rtl: true });
  const [d, e] = M.cells.slice(3);
  assert.equal(Math.min(d.x, e.x), 0); assert.equal(Math.max(d.x + d.w, e.x + e.w), M.width);
  assert.ok(Math.abs(d.w - e.w) <= 1);
  assert.ok(d.x > e.x, 'من اليمين إلى اليسار: الأولى في اليمين');
  // بلا fillRow يبقى السلوك القديم: الصف الناقص يتوسّط
  const O = ImageTools.mergeLayout([tall, tall, tall], { layout: 'grid', columns: 2 });
  assert.equal(O.cells[2].w, O.cells[0].w);
});

test('الشبكة مع «الصور كاملة» لا تقص وتضع الصورة في وسط خانتها', () => {
  const L = ImageTools.mergeLayout([{ w: 200, h: 100 }, { w: 100, h: 100 }], { layout: 'grid', columns: 2, fit: 'contain' });
  const [a, b] = L.cells;
  assert.deepEqual([b.sx, b.sy, b.sw, b.sh], [0, 0, 100, 100]);
  assert.equal(b.w, b.h, 'نسبة الصورة محفوظة');
  assert.equal(b.y, (a.h - b.h) / 2 + a.y);
});

test('الناتج الكبير يُصغَّر كله بالنسبة نفسها حتى 8192 بكسل', () => {
  const L = ImageTools.mergeLayout(Array(6).fill({ w: 4000, h: 3000 }), { layout: 'row', gap: 5 });
  assert.ok(L.width <= 8192 && L.height <= 8192, `${L.width}×${L.height}`);
  assert.ok(L.scale < 1);
  const p = ImageTools.mergeLayout([{ w: 4000, h: 3000 }, { w: 4000, h: 3000 }], { layout: 'row', maxSide: 1000 });
  assert.equal(p.width, 1000);
  assert.equal(p.cells[1].x + p.cells[1].w, 1000, 'لا فجوة عند الحافة بعد التقريب');
});

test('بلا صور أو بتخطيط غير معروف', () => {
  assert.deepEqual(ImageTools.mergeLayout([]), { width: 0, height: 0, cells: [] });
  assert.equal(ImageTools.mergeLayout([{ w: 10, h: 10 }, { w: 10, h: 10 }], { layout: 'diagonal' }).width, 20, 'يعود إلى الأفقي');
});

test('crc32 يطابق القيمة المرجعية', () => {
  assert.equal(ImageTools.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.equal(ImageTools.crc32(new Uint8Array(0)), 0);
});

test('zip ينتج أرشيفاً سليم البنية بأسماء عربية', () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'صورة-1.jpg', bytes: enc.encode('first file') },
    { name: 'b.png', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
  ];
  const z = ImageTools.zip(files);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const end = z.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50, 'توقيع نهاية الدليل');
  assert.equal(dv.getUint16(end + 10, true), files.length);
  const cdSize = dv.getUint32(end + 12, true), cdAt = dv.getUint32(end + 16, true);
  assert.equal(cdAt + cdSize, end);

  let p = cdAt;
  for (const f of files) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, 'توقيع مدخل الدليل');
    assert.equal(dv.getUint16(p + 8, true) & 0x0800, 0x0800, 'علامة UTF-8');
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), at = dv.getUint32(p + 42, true);
    assert.equal(new TextDecoder().decode(z.subarray(p + 46, p + 46 + nameLen)), f.name);
    assert.equal(size, f.bytes.length);
    assert.equal(crc, ImageTools.crc32(f.bytes));

    // الترويسة المحلية تشير إلى البيانات نفسها
    assert.equal(dv.getUint32(at, true), 0x04034b50, 'توقيع الترويسة المحلية');
    assert.equal(dv.getUint16(at + 8, true), 0, 'تخزين بلا ضغط');
    const data = z.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    assert.deepEqual([...data], [...f.bytes]);
    p += 46 + nameLen;
  }
  assert.equal(p, end);
});
