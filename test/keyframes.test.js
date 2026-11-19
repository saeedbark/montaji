'use strict';
/* الإطارات المفتاحية وحساب المدة (public/js/core.js): prop() وأخواتها، والتقسيم، و layout() مع الطبقات */

const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../public/js/core.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('edgeScroll: التمرير التلقائي أثناء السحب يتجه نحو الحافة القريبة ويسرع كلما اقترب منها', () => {
  // منطقة مرئية من 100 إلى 900، وحدّ الحافة 48 بكسل، والسرعة القصوى 30
  assert.equal(C.edgeScroll(500, 100, 900), 0, 'في الوسط لا تمرير');
  assert.equal(C.edgeScroll(148, 100, 900), 0, 'على حد المنطقة تماماً لا تمرير');
  assert.ok(C.edgeScroll(140, 100, 900) < 0, 'قرب البداية: نحو البداية');
  assert.ok(C.edgeScroll(860, 100, 900) > 0, 'قرب النهاية: نحو النهاية');
  assert.ok(C.edgeScroll(110, 100, 900) < C.edgeScroll(140, 100, 900), 'أسرع كلما اقترب من الحافة');
  assert.equal(C.edgeScroll(100, 100, 900), -30, 'عند الحافة: السرعة القصوى');
  assert.equal(C.edgeScroll(20, 100, 900), -30, 'بعد الحافة (فوق عناوين المسارات): لا تتجاوز القصوى');
  assert.equal(C.edgeScroll(2000, 100, 900), 30);
  assert.equal(C.edgeScroll(147, 100, 900), -1, 'تبدأ بطيئة لا صفراً');
  // منطقة ضيقة: الحد لا يتجاوز ثلثها فيبقى وسط يمكن السحب فيه بلا تمرير
  assert.equal(C.edgeScroll(150, 100, 200), 0);
  assert.equal(C.edgeScroll(50, 100, 100), 0, 'منطقة بلا عرض');
  assert.equal(C.edgeScroll(NaN, 100, 900), 0);
});

test('prop: خاصية بلا إطارات تعيد القيمة الثابتة، أو الافتراضية إن غابت', () => {
  assert.equal(C.prop({ x: 0.3 }, 'x', 5), 0.3);
  assert.equal(C.prop({}, 'opacity', 0), 1);
  assert.equal(C.prop({}, 'zoom', 0), 1);
  assert.equal(C.prop({ x: 0.3, kf: { x: [] } }, 'x', 1), 0.3);
});

test('prop: قبل أول إطار وبعد آخر إطار وبينهما', () => {
  const o = { x: 9 };
  C.setKey(o, 'x', 1, 0.2, 'linear');
  C.setKey(o, 'x', 3, 0.8, 'linear');
  near(C.prop(o, 'x', 0), 0.2);
  near(C.prop(o, 'x', 1), 0.2);
  near(C.prop(o, 'x', 2), 0.5);
  near(C.prop(o, 'x', 2.5), 0.65);
  near(C.prop(o, 'x', 3), 0.8);
  near(C.prop(o, 'x', 99), 0.8);
});

test('prop: كل نوع انسيابية', () => {
  const mk = e => { const o = {}; C.setKey(o, 'v', 0, 0, e); C.setKey(o, 'v', 4, 100, 'linear'); return o; };
  near(C.prop(mk('linear'), 'v', 1), 25);
  near(C.prop(mk('smooth'), 'v', 1), 12.5); // 2k² عند k = 0.25
  near(C.prop(mk('smooth'), 'v', 2), 50);
  near(C.prop(mk('smooth'), 'v', 3), 87.5);
  assert.equal(C.prop(mk('hold'), 'v', 3.99), 0);
  assert.equal(C.prop(mk('hold'), 'v', 4), 100);
});

test('setKey يرتّب الإطارات، يستبدل الإطار عند الزمن نفسه، ولا يغيّر كائن kf القديم', () => {
  const o = {};
  C.setKey(o, 'x', 2, 1);
  const before = o.kf;
  C.setKey(o, 'x', 0.5, 5);
  C.setKey(o, 'x', 2.005, 7); // أقرب من حد الدمج: يستبدل إطار الثانية 2
  assert.deepEqual(o.kf.x.map(k => [k.t, k.v]), [[0.5, 5], [2, 7]]);
  assert.deepEqual(before.x.map(k => [k.t, k.v]), [[2, 1]], 'لقطة سجل التراجع تبقى كما هي');
  assert.equal(o.kf.x[0].e, 'smooth', 'الانسيابية الافتراضية');
});

test('setKey يفرض الحد الأقصى لعدد الإطارات', () => {
  const o = {};
  for (let i = 0; i < C.KF_MAX + 30; i++) C.setKey(o, 'x', i, i);
  assert.equal(o.kf.x.length, C.KF_MAX);
});

test('removeKey و clearKeys: القيمة الثابتة تأخذ قيمة أول إطار وكائن kf يُحذف حين يفرغ', () => {
  const o = { x: 0 };
  C.setKey(o, 'x', 0, 0.2); C.setKey(o, 'x', 2, 0.8); C.setKey(o, 'y', 2, 0.4);
  C.removeKey(o, null, 2); // كل الخصائص عند الثانية 2
  assert.deepEqual(Object.keys(o.kf), ['x']);
  assert.equal(o.y, 0.4, 'آخر إطار للخاصية صار قيمتها الثابتة');
  C.clearKeys(o);
  assert.equal(o.kf, undefined);
  assert.equal(o.x, 0.2);
});

test('kfTimes و moveKeys و setKeyEase', () => {
  const o = {};
  C.setKey(o, 'x', 0, 1); C.setKey(o, 'x', 2, 2); C.setKey(o, 'y', 2, 3); C.setKey(o, 'y', 4, 4);
  assert.deepEqual(C.kfTimes(o), [0, 2, 4]);
  C.moveKeys(o, 2, 3);
  assert.deepEqual(C.kfTimes(o), [0, 3, 4]);
  assert.deepEqual(o.kf.y.map(k => k.t), [3, 4]);
  C.setKeyEase(o, 3, 'hold');
  assert.equal(o.kf.x[1].e, 'hold'); assert.equal(o.kf.y[0].e, 'hold'); assert.equal(o.kf.x[0].e, 'smooth');
});

test('setVal يكتب إطاراً إن كانت الخاصية متحركة، وإلا القيمة الثابتة', () => {
  const o = { x: 0.1, y: 0.1 };
  C.setKey(o, 'x', 0, 0.1);
  C.setVal(o, 'x', 0.9, 2); C.setVal(o, 'y', 0.9, 2);
  assert.equal(o.kf.x.length, 2);
  assert.equal(o.x, 0.1);
  assert.equal(o.y, 0.9);
  assert.equal(o.kf.y, undefined);
});

test('splitKf: القيمة عند نقطة القطع محفوظة في الجزأين وأزمنة الثاني مُزاحة', () => {
  const o = { x: 0 };
  C.setKey(o, 'x', 0, 0.2, 'smooth'); C.setKey(o, 'x', 2, 0.8, 'linear'); C.setKey(o, 'x', 5, 0.4, 'linear');
  const at = C.prop(o, 'x', 1.2);
  const [A, B] = C.splitKf(o, 1.2);
  const a = { kf: A }, b = { kf: B };
  near(C.prop(a, 'x', 1.2), at); near(C.prop(a, 'x', 50), at, 1e-9);
  near(C.prop(b, 'x', 0), at);
  near(C.prop(b, 'x', 0.8), 0.8);       // إطار الثانية 2 صار عند 0.8
  near(C.prop(b, 'x', 3.8), 0.4);
  near(C.prop(b, 'x', 2.3), C.prop(o, 'x', 3.5)); // ما بعد القطع بإطارين لم يتغيّر
  assert.equal(o.kf.x.length, 3, 'الأصل لم يُعدَّل');
});

test('splitKf: قطع قبل أول إطار أو بعد آخر إطار، وعنصر بلا إطارات', () => {
  const o = {};
  C.setKey(o, 'x', 2, 0.2, 'linear'); C.setKey(o, 'x', 4, 0.8, 'linear');
  let [A, B] = C.splitKf(o, 1);
  near(C.prop({ kf: A }, 'x', 0.5), 0.2);
  near(C.prop({ kf: B }, 'x', 2), 0.5); // منتصف الحركة الأصلية (الثانية 3)
  [A, B] = C.splitKf(o, 6);
  near(C.prop({ kf: A }, 'x', 3), 0.5);
  near(C.prop({ kf: B }, 'x', 1), 0.8);
  assert.deepEqual(C.splitKf({ x: 1 }, 2), [undefined, undefined]);
});

test('layout: المدة الكلية تمتد إلى نهاية طبقة تتجاوز المسار الرئيسي', () => {
  const s = C.state;
  s.clips = [{ id: 'a', in: 0, out: 4, speed: 1 }, { id: 'b', in: 2, out: 8, speed: 2 }];
  s.overlays = [{ id: 'o', start: 6, in: 0, out: 4, speed: 1 }];
  s.audios = [{ id: 'm', start: 0, in: 0, out: 60 }];
  s.texts = []; s.effects = []; s.captions = C.emptyCaptions();
  assert.equal(C.layout(), 10);
  assert.equal(C.view.main, 7);
  assert.equal(s.clips[1]._start, 4);
  s.overlays[0].speed = 2; // طبقة أقصر: الموسيقى لا تمدّ المشروع ما دام فيه مقاطع
  assert.equal(C.layout(), 8);
  s.overlays = [];
  assert.equal(C.layout(), 7);
  s.clips = []; s.captions.items = [{ id: 'c', start: 1, end: 70, text: 'x', words: [] }];
  assert.equal(C.layout(), 70, 'بلا مقاطع: المدة من بقية العناصر، ومنها الترجمة');
  s.audios = []; s.captions = C.emptyCaptions();
});

test('itemLen لكل نوع', () => {
  assert.equal(C.itemLen('clip', { in: 1, out: 5, speed: 2 }), 2);
  assert.equal(C.itemLen('overlay', { in: 0, out: 3, speed: 1 }), 3);
  assert.equal(C.itemLen('audio', { in: 2, out: 9 }), 7);
  assert.equal(C.itemLen('caption', { start: 2, end: 3.5 }), 1.5);
  assert.equal(C.itemLen('text', { dur: 4 }), 4);
});
