'use strict';
/* تحليل المقطع المرجعي (public/js/reftools.js): كشف القصّات والإيقاع وتوزيع الوسائط — الجزء الذي لا يحتاج متصفحاً */

const test = require('node:test');
const assert = require('node:assert/strict');

const RefTools = require('../public/js/reftools.js');

const STEP = 1 / 12, N = 32 * 32;
/** إطار من ألوانه: fn(رقم البكسل) ← [r, g, b] */
function frame(fn) {
  const px = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { const c = fn(i); px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; }
  return RefTools.signature(px);
}
const COLORS = [[230, 40, 40], [40, 200, 60], [40, 60, 230], [240, 220, 40], [200, 40, 220], [40, 220, 220]];
const half = c => c.map(v => v >> 1);
/** لقطة: خطوط بلون البذرة ونسخته الداكنة. الانزياح يمثّل حركة الكاميرا: البكسلات تتغيّر وتوزيع الألوان ثابت */
const pixel = (seed, shift = 0) => i => ((i + shift) % 8 < 4 ? COLORS[seed] : half(COLORS[seed]));
const picture = (seed, shift = 0) => frame(pixel(seed, shift));
/** فيديو من مقاطع: كل مقطع { seconds, at(k, n) } حيث k رقم الإطار داخل المقطع و n عدد إطاراته */
function video(parts) {
  const frames = [];
  for (const p of parts) for (let k = 0, n = Math.round(p.seconds / STEP); k < n; k++) frames.push(p.at(k, n));
  return { frames, times: frames.map((_, i) => i * STEP), duration: frames.length * STEP };
}
const still = (seed, seconds) => ({ seconds, at: () => picture(seed) });
const moving = (seed, seconds) => ({ seconds, at: k => picture(seed, k) });
const detect = (v, o = {}) => RefTools.detect(v.frames, v.times, { duration: v.duration, ...o });
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('signature: صورة رمادية وتوزيع ألوان مجموعه 1', () => {
  const s = picture(0);
  assert.equal(s.g.length, N);
  near(s.h.reduce((x, y) => x + y, 0), 1, 1e-4);
  assert.equal(RefTools.hdist(s, picture(0, 3)), 0); // الحركة لا تغيّر توزيع الألوان
  assert.ok(RefTools.dist(s, picture(0, 3)) > 5);     // لكنها تغيّر البكسلات
  near(RefTools.hdist(s, picture(1)), 1, 1e-4);
});

test('القص الحاد يُكشف عند موضعه، وحركة الكاميرا لا تُحسب قصاً', () => {
  const { cuts, flashes } = detect(video([moving(1, 2), moving(2, 1), still(3, 1.5)]));
  assert.deepEqual(cuts.map(c => c.kind), ['cut', 'cut']);
  near(cuts[0].t, 2, 1e-9);
  near(cuts[1].t, 3, 1e-9);
  assert.equal(flashes.length, 0);
});

test('فيديو من لقطة واحدة متحركة: بلا قصّات', () => {
  assert.equal(detect(video([moving(4, 5)])).cuts.length, 0);
});

test('التلاشي المتقاطع بين صورتين ثابتتين يُكشف مرة واحدة في منتصفه', () => {
  // تلاشٍ منقّط: نسبة k من البكسلات صارت من الصورة الثانية، فيتغيّر توزيع الألوان تدريجياً كما في الصور الحقيقية
  const dissolve = { seconds: 0.5, at: (k, n) => frame(i => ((i * 7919) % N < N * (k + 1) / (n + 1) ? pixel(5)(i) : pixel(1)(i))) };
  const { cuts } = detect(video([still(1, 2), dissolve, still(5, 2)]));
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].kind, 'fade');
  near(cuts[0].t, 2.25, 0.3);
});

test('المرور بالأسود انتقال واحد، لا لقطة سوداء قصيرة', () => {
  const { cuts } = detect(video([still(1, 2), { seconds: 0.4, at: () => frame(() => [2, 2, 2]) }, still(2, 2)]));
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].kind, 'black');
  near(cuts[0].t, 2.2, 0.15);
});

test('الوميض الأبيض على القص يُعلَّم ولا يُحسب قصّتين', () => {
  const { cuts } = detect(video([still(1, 2), { seconds: STEP, at: () => frame(() => [250, 250, 250]) }, still(2, 2)]));
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].flash, true);
});

test('وميض إضاءة داخل اللقطة (تعود الصورة بعده كما كانت) مؤثر لا قص', () => {
  const lit = { seconds: STEP * 2, at: k => frame(i => pixel(1, k)(i).map(c => Math.min(255, c + 120))) };
  const r = detect(video([moving(1, 2), lit, moving(1, 2), lit, moving(1, 1)]));
  assert.equal(r.cuts.length, 0);
  assert.equal(r.flashes.length, 2);
  near(r.flashes[0].t, 2, 1e-9);
  assert.ok(r.flashes[0].width > 0.9 && r.flashes[0].height > 0.9, 'وميض يغطي الإطار كله');
});

test('وميض على المنتج: بقعة تسطع ثم تعود، يُكشف مع موضعها في الإطار', () => {
  // مستطيل 8×6 يبدأ عند (14, 15) من إطار 32×32 يضيء لإطار واحد
  const inBox = i => { const x = i % 32, y = (i / 32) | 0; return x >= 14 && x < 22 && y >= 15 && y < 21; };
  const lit = { seconds: STEP, at: () => frame(i => (inBox(i) ? pixel(1)(i).map(c => Math.min(255, c + 110)) : pixel(1)(i))) };
  const r = detect(video([still(1, 2), lit, still(1, 1), lit, still(1, 1)]));
  assert.equal(r.cuts.length, 0);
  assert.equal(r.flashes.length, 2);
  const f = r.flashes[0];
  near(f.t, 2, 1e-9);
  near(f.x, 18 / 32, 0.02);
  near(f.y, 18 / 32, 0.02);
  near(f.width, 8 / 32, 0.02);
  near(f.height, 6 / 32, 0.02);
});

test('حركة الكاميرا وحدها لا تُحسب وميضاً', () => {
  assert.equal(detect(video([moving(1, 3), moving(2, 3)])).flashes.length, 0);
});

/** صورة رمادية N×N ناعمة (بقع)، مكبّرة s حول المركز */
function blobs(N, s = 1) {
  const out = new Float32Array(N * N), c = (N - 1) / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = c + (x - c) / s, w = c + (y - c) / s;
      out[y * N + x] = 128 + 60 * Math.sin(u * 0.31) * Math.cos(w * 0.23) + 40 * Math.sin((u + w) * 0.17);
    }
  }
  return out;
}

test('zoomBetween يقدّر التكبير بين إطارين، و zoomOf يفرّق الاندفاعة المبكرة عن الزوم المستمر', () => {
  const N = 64, A = blobs(N), M = blobs(N, 1.27), B = blobs(N, 1.3);
  const full = RefTools.zoomBetween(A, B, N);
  near(full.scale, 1.3, 0.04);
  assert.ok(full.cost < full.base * 0.5, 'التطابق مع التكبير أفضل بكثير من دونه');
  near(RefTools.zoomBetween(B, A, N).scale, 1 / 1.3, 0.04);
  near(RefTools.zoomBetween(A, A, N).scale, 1, 1e-9);

  // أغلب التكبير في النصف الأول
  const early = RefTools.zoomOf(full, RefTools.zoomBetween(A, M, N), RefTools.zoomBetween(M, B, N));
  assert.equal(early.when, 'early');
  near(early.scale, 1.3, 0.04);
  // تكبير موزّع على اللقطة
  const mid = blobs(N, 1.14);
  assert.equal(RefTools.zoomOf(full, RefTools.zoomBetween(A, mid, N), RefTools.zoomBetween(mid, B, N)).when, 'steady');
  // بلا زوم: لا شيء
  const same = RefTools.zoomBetween(A, A, N);
  assert.equal(RefTools.zoomOf(same, same, same), null);
});

/** صورة رمادية N×N بتفاصيل؛ blur = عدد مرات التنعيم، وأفقياً فقط إن كان oneWay */
function detail(N, blur = 0, oneWay = false) {
  let a = Float32Array.from({ length: N * N }, (_, i) => 130 + ((((i % N) / 3) | 0) % 2 ? 45 : -45) + (((((i / N) | 0) / 3) | 0) % 2 ? 45 : -45));
  for (let k = 0; k < blur; k++) {
    const b = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let sum = 0, cnt = 0;
        for (let dy = oneWay ? 0 : -1; dy <= (oneWay ? 0 : 1); dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
            sum += a[yy * N + xx]; cnt++;
          }
        }
        b[y * N + x] = sum / cnt;
      }
    }
    a = b;
  }
  return a;
}

test('blurAt: القص الحاد بلا مؤثر، والضباب في كل الاتجاهات zoomBlur، وفي اتجاه واحد whip', () => {
  const N = 64, sharp = RefTools.sharpness(detail(N), N);
  const around = make => [-0.08, -0.04, 0, 0.04, 0.08].map(dt => ({ dt, ...RefTools.sharpness(make(dt), N) }));
  assert.ok(sharp.s > 20 && sharp.luma > 40);
  assert.equal(RefTools.blurAt(around(() => detail(N)), sharp, sharp), null);
  // الإطارات بعد القص ضبابية ثم تصفو
  assert.equal(RefTools.blurAt(around(dt => detail(N, dt >= 0 ? 2 : 0)), sharp, sharp), 'zoomBlur');
  assert.equal(RefTools.blurAt(around(dt => detail(N, dt >= 0 ? 3 : 0, true)), sharp, sharp), 'whip');
  // الضباب قبل القص يُكشف أيضاً
  assert.equal(RefTools.blurAt(around(dt => detail(N, dt < 0 ? 2 : 0)), sharp, sharp), 'zoomBlur');
  // إطار أسود عند القص ليس ضباباً، ولقطة بلا تفاصيل لا يُحكم عليها
  assert.equal(RefTools.blurAt(around(dt => (dt === 0 ? new Float32Array(N * N) : detail(N))), sharp, sharp), null);
  const flat = RefTools.sharpness(new Float32Array(N * N).fill(90), N);
  assert.equal(RefTools.blurAt(around(() => new Float32Array(N * N).fill(90)), flat, flat), null);
});

test('markLooks: لقطة رمادية كلها تُعلَّم أبيض وأسود، لا الملوّنة ولا الشاشة المظلمة', () => {
  const grayShot = { seconds: 1, at: () => frame(i => (i % 8 < 4 ? [200, 200, 200] : [90, 90, 90])) };
  const darkCard = { seconds: 1, at: () => frame(() => [20, 20, 20]) };
  const v = video([still(1, 1), grayShot, darkCard]);
  const r = detect(v);
  const shots = RefTools.markLooks(RefTools.buildShots(r.cuts, v.duration, r.d, v.times), v.frames, v.times, r.luma);
  assert.deepEqual(shots.map(x => x.look), [undefined, 'bw', undefined]);
});

test('edgeFades: ظهور تدريجي من الأسود واختفاء إليه، والقص من الأسود ليس ظهوراً تدريجياً', () => {
  const lit = k => frame(i => pixel(1)(i).map(c => c * k));
  const fadeIn = { seconds: 0.5, at: (k, n) => lit(k / n) }, fadeOut = { seconds: 0.75, at: (k, n) => lit(1 - (k + 1) / n) };
  let v = video([fadeIn, still(1, 3), fadeOut]);
  let f = RefTools.edgeFades(detect(v).luma, v.times);
  near(f.in, 0.5, 0.17);
  near(f.out, 0.75, 0.17);
  // بلا تدرّج
  v = video([still(1, 3)]);
  assert.deepEqual(RefTools.edgeFades(detect(v).luma, v.times), { in: 0, out: 0 });
  // شاشة سوداء ثم قص مباشر إلى الصورة
  v = video([{ seconds: 0.5, at: () => frame(() => [2, 2, 2]) }, still(1, 3)]);
  assert.equal(RefTools.edgeFades(detect(v).luma, v.times).in, 0);
});

test('mergeLayout يختار الترتيب الأقرب لشكل الإطار، و groups تقسّم الوسائط على اللقطات', () => {
  // ملصقات 4:5 في إطار عمودي 9:16
  assert.deepEqual(RefTools.mergeLayout(2, 0.8, 9 / 16), { layout: 'column', columns: 1 });
  assert.deepEqual(RefTools.mergeLayout(4, 0.8, 9 / 16), { layout: 'grid', columns: 2 });
  // والإطار الأفقي يأخذها صفاً
  assert.deepEqual(RefTools.mergeLayout(2, 0.8, 16 / 9), { layout: 'row', columns: 2 });
  assert.deepEqual(RefTools.mergeLayout(3, 1, 16 / 9), { layout: 'row', columns: 3 });

  assert.deepEqual(RefTools.groups(6, [1, 3]), [[0], [1, 2, 3], [4], [5]]);
  assert.deepEqual(RefTools.groups(4, [3, 3]), [[0, 1, 2], [3]]);
  assert.deepEqual(RefTools.groups(3), [[0], [1], [2]]);
  assert.deepEqual(RefTools.groups(0, [2]), []);
});

test('إطار دخيل واحد (خلل أو لمعة) لا يُحسب قصاً', () => {
  const r = detect(video([moving(1, 2), { seconds: STEP, at: () => picture(4) }, moving(1, 2)]));
  assert.equal(r.cuts.length, 0);
});

test('الحساسية المنخفضة تتجاهل قصاً بين لقطتين متشابهتين تكشفه العادية والعالية', () => {
  // اللقطة الثانية تختلف عن الأولى في ربع ألوانها فقط
  const similar = frame(i => (i % 4 === 0 ? COLORS[2] : pixel(1)(i)));
  const v = video([still(1, 2), { seconds: 2, at: () => similar }]);
  assert.equal(detect(v, { sensitivity: 'low' }).cuts.length, 0);
  assert.equal(detect(v).cuts.length, 1);
  assert.equal(detect(v, { sensitivity: 'high' }).cuts.length, 1);
});

test('buildShots: اللقطات تغطي الفيديو كله، مع نوع الدخول وثبات الصورة', () => {
  const v = video([still(1, 2), moving(2, 1), still(3, 1.5)]);
  const r = detect(v);
  const shots = RefTools.buildShots(r.cuts, v.duration, r.d, v.times);
  assert.equal(shots.length, 3);
  assert.equal(shots[0].start, 0);
  near(shots[2].end, v.duration, 1e-9);
  near(shots.reduce((s, x) => s + x.duration, 0), v.duration, 1e-9);
  assert.deepEqual(shots.map(s => s.transition), ['none', 'cut', 'cut']);
  assert.deepEqual(shots.map(s => s.motion), ['still', 'moving', 'still']);
});

test('rhythm: عدد الضربات لكل لقطة ونسبة القصّات الواقعة على ضربة', () => {
  const shots = [0, 2, 3, 3.5].map((start, i, a) => ({ start, duration: (a[i + 1] || 5.5) - start }));
  const beats = Array.from({ length: 12 }, (_, i) => i * 0.5);
  const r = RefTools.rhythm(shots, beats, 0.5);
  assert.deepEqual(r.pattern, [4, 2, 1, 4]);
  assert.equal(r.on_beat, 1);
  // قصّات بعيدة عن الضربات
  const off = RefTools.rhythm(shots.map(s => ({ ...s, start: s.start + 0.25 })), beats, 0.5);
  assert.equal(off.on_beat, 0);
  assert.equal(RefTools.rhythm(shots, [], 0), null);
});

test('nearestRatio يختار أقرب مقاس مدعوم', () => {
  assert.equal(RefTools.nearestRatio(1920, 1080), '16:9');
  assert.equal(RefTools.nearestRatio(1080, 1920), '9:16');
  assert.equal(RefTools.nearestRatio(720, 1280), '9:16');
  assert.equal(RefTools.nearestRatio(1080, 1080), '1:1');
  assert.equal(RefTools.nearestRatio(1080, 1350), '4:5');
  assert.equal(RefTools.nearestRatio(2560, 1080), '16:9');
});

test('assign: الوسائط الأقل تُعاد من أولها، أو يقصر الفيديو مع trim، والزائدة تُترك', () => {
  assert.deepEqual(RefTools.assign(5, 2), [0, 1, 0, 1, 0]);
  assert.deepEqual(RefTools.assign(5, 2, 'trim'), [0, 1]);
  assert.deepEqual(RefTools.assign(2, 5), [0, 1]);
  assert.deepEqual(RefTools.assign(0, 3), []);
  assert.deepEqual(RefTools.assign(3, 0), []);
});

test('fitVideo: الأطول يُقصّ من وسطه والأقصر يُبطَّأ ليملأ اللقطة', () => {
  assert.deepEqual(RefTools.fitVideo(10, 2), { in: 4, out: 6, speed: 1 });
  const slow = RefTools.fitVideo(1, 2);
  assert.deepEqual(slow, { in: 0, out: 1, speed: 0.5 });
  near((slow.out - slow.in) / slow.speed, 2, 1e-9);
  assert.equal(RefTools.fitVideo(0.2, 4).speed, 0.25); // لا أبطأ من ربع السرعة
});

test('sheetLayout: خلايا بنسبة الفيديو، وأعمدة أكثر للعمودي', () => {
  const wide = RefTools.sheetLayout(10, 1920, 1080);
  assert.deepEqual([wide.cw, wide.ch, wide.cols, wide.rows], [200, 113, 4, 3]);
  const tall = RefTools.sheetLayout(10, 1080, 1920);
  assert.deepEqual([tall.cw, tall.ch, tall.cols, tall.rows], [113, 200, 6, 2]);
  assert.equal(RefTools.sheetLayout(2, 1080, 1920).cols, 2);
});
