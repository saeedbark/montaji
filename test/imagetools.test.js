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
