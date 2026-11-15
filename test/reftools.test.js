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
  const lit = { seconds: STEP * 2, at: k => frame(i => pixel(1, k)(i).map(c => Math.min(255, c + 90))) };
  const r = detect(video([moving(1, 2), lit, moving(1, 2), lit, moving(1, 1)]));
  assert.equal(r.cuts.length, 0);
  assert.equal(r.flashes.length, 2);
  near(r.flashes[0], 2, 1e-9);
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
