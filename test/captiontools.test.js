'use strict';
/* الترجمة (public/js/captiontools.js): تقطيع الكلمات إلى كتل، الدمج والتقسيم وإعادة التوقيت، وصيغتا SRT و VTT */

const test = require('node:test');
const assert = require('node:assert/strict');

const CT = require('../public/js/captiontools.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
/** كلمات متتالية: كل كلمة 0.3 ث وبينها 0.1 ث، تبدأ عند at */
const speak = (text, at = 0, step = 0.4) => text.split(' ').map((w, i) => ({ w, t0: at + i * step, t1: at + i * step + 0.3 }));

test('toItems يقطع عند حد الأحرف ولا يفقد كلمة ولا يغيّر ترتيبها', () => {
  const words = speak('مرحبا بكم في محرر مونتاجي الجديد هذه ترجمة تلقائية متزامنة مع الكلام');
  const items = CT.toItems(words, { maxChars: 20 });
  assert.ok(items.length >= 3);
  for (const it of items) {
    assert.ok(it.text.length <= 20, `«${it.text}» أطول من الحد`);
    assert.equal(it.text, it.words.map(w => w.w).join(' '));
    assert.match(it.id, /^[a-z0-9]{1,40}$/);
  }
  assert.equal(items.map(it => it.text).join(' '), words.map(w => w.w).join(' '));
});

test('toItems يقطع عند نهاية الجملة والسكتة الطويلة، والكتل لا تتداخل', () => {
  const words = [...speak('انتهت الجملة.'), ...speak('وهذه جملة', 0.9), ...speak('بعد سكتة', 5)];
  const items = CT.toItems(words, { maxChars: 60 });
  assert.deepEqual(items.map(it => it.text), ['انتهت الجملة.', 'وهذه جملة', 'بعد سكتة']);
  for (let i = 0; i < items.length; i++) {
    assert.ok(items[i].end > items[i].start);
    if (i) assert.ok(items[i].start >= items[i - 1].end - 1e-9, 'كتلتان متداخلتان');
  }
  near(items[2].start, 5);
});

test('toItems يقطع الكتلة التي تتجاوز المدة القصوى', () => {
  const items = CT.toItems(speak('ا ب ج د ه و ز ح', 0, 1), { maxChars: 100, maxDur: 3, gap: 5 });
  assert.ok(items.length >= 3);
  for (const it of items) assert.ok(it.words[it.words.length - 1].t1 - it.start <= 3 + 1e-9);
});

test('toItems يزيل التشكيل افتراضياً ويبقيه عند الطلب', () => {
  const w = [{ w: 'مَرْحَبًا', t0: 0, t1: 0.5 }];
  assert.equal(CT.toItems(w)[0].text, 'مرحبا');
  assert.equal(CT.toItems(w, { keepDiacritics: true })[0].text, 'مَرْحَبًا');
});

test('wordsFromSegments يوزّع الكلمات داخل الجملة بنسبة أطوالها', () => {
  const ws = CT.wordsFromSegments([{ start: 2, end: 4, text: 'اب جدهو' }]); // 2 و 4 أحرف (+ فراغ لكل كلمة): 3 إلى 5
  assert.equal(ws.length, 2);
  near(ws[0].t0, 2); near(ws[0].t1, 2.75); near(ws[1].t0, 2.75); near(ws[1].t1, 4);
});

test('mergeChunks لا يكرر كلمات التداخل بين جزأين', () => {
  // جزآن يتداخلان بين 9 و 11؛ الكلمة عند 9.5 للأول وعند 10.5 للثاني
  const a = { start: 0, end: 11, words: [{ w: 'أ', t0: 1, t1: 1.2 }, { w: 'ب', t0: 9.4, t1: 9.6 }, { w: 'ج', t0: 10.4, t1: 10.6 }] };
  const b = { start: 9, end: 20, words: [{ w: 'ب', t0: 0.4, t1: 0.6 }, { w: 'ج', t0: 1.4, t1: 1.6 }, { w: 'د', t0: 5, t1: 5.2 }] };
  const out = CT.mergeChunks([a, b]);
  assert.deepEqual(out.map(w => w.w), ['أ', 'ب', 'ج', 'د']);
  near(out[2].t0, 10.4); near(out[3].t0, 14);
});

test('place يزيح الكلمات إلى زمن المشروع ويراعي سرعة المقطع', () => {
  const out = CT.place([{ w: 'س', t0: 2, t1: 3 }], 10, 2);
  near(out[0].t0, 11); near(out[0].t1, 11.5);
});

test('retime: التحريك يزيح الكلمات وسحب الحافة يمدّدها خطّياً', () => {
  const it = CT.toItems(speak('واحد اثنان ثلاثة', 1))[0];
  const moved = CT.retime(it, it.start + 2, it.end + 2);
  near(moved.words[1].t0, it.words[1].t0 + 2);
  const wide = CT.retime(it, it.start, it.start + (it.end - it.start) * 2);
  near(wide.words[1].t0 - wide.start, (it.words[1].t0 - it.start) * 2);
  assert.notEqual(wide.words, it.words, 'الكلمات كائن جديد لا تعديل في المكان');
  near(it.words[1].t0, 1.4);
});

test('setText يحفظ توقيت الكلمات إن بقي عددها، وإلا يوزّعها على المدة', () => {
  const it = CT.toItems(speak('واحد اثنان ثلاثة', 1))[0];
  const fixed = CT.setText(it, 'واحد  إثنان ثلاثة');
  assert.equal(fixed.text, 'واحد إثنان ثلاثة');
  near(fixed.words[1].t0, it.words[1].t0);
  const more = CT.setText(it, 'واحد اثنان ثلاثة أربعة');
  assert.equal(more.words.length, 4);
  near(more.words[0].t0, it.start); near(more.words[3].t1, it.end);
});

test('merge و splitAt عكس بعضهما', () => {
  const [a, b] = CT.toItems([...speak('الجملة الأولى.'), ...speak('الجملة الثانية', 2)], { maxChars: 60 });
  const m = CT.merge(a, b);
  assert.equal(m.text, 'الجملة الأولى. الجملة الثانية');
  assert.equal(m.id, a.id);
  near(m.start, a.start); near(m.end, b.end);
  const [x, y] = CT.splitAt(m, 1.5);
  assert.equal(x.text, 'الجملة الأولى.'); assert.equal(y.text, 'الجملة الثانية');
  assert.equal(x.id, m.id); assert.notEqual(y.id, m.id);
  assert.ok(x.end <= y.start + 1e-9);
  assert.equal(CT.splitAt(CT.toItems(speak('كلمة'))[0], 0.1), null, 'كلمة واحدة لا تُقسم');
});

test('itemAt و wordAt', () => {
  const items = CT.toItems([...speak('الجملة الأولى.'), ...speak('الجملة الثانية', 2)], { maxChars: 60 });
  assert.equal(CT.itemAt(items, 0.1), items[0]);
  assert.equal(CT.itemAt(items, 1.5), null);
  assert.equal(CT.itemAt(items, 2.5), items[1]);
  assert.equal(CT.wordAt(items[1], 1.9), -1);
  assert.equal(CT.wordAt(items[1], 2.1), 0);
  assert.equal(CT.wordAt(items[1], 2.45), 1);
});

test('SRT: ترقيم من 1 وفاصلة قبل أجزاء الثانية، مرتب زمنياً', () => {
  const srt = CT.srt([
    { start: 3661.5, end: 3663.25, text: 'ثانياً' },
    { start: 1.2, end: 2.05, text: 'مرحبا بالعالم' },
    { start: 5, end: 6, text: '   ' },
  ]);
  assert.equal(srt, '1\n00:00:01,200 --> 00:00:02,050\nمرحبا بالعالم\n\n2\n01:01:01,500 --> 01:01:03,250\nثانياً\n');
});

test('VTT: ترويسة WEBVTT ونقطة قبل أجزاء الثانية، و«-->» لا تبقى في النص', () => {
  const vtt = CT.vtt([{ start: 0, end: 1.5, text: 'a --> b' }]);
  assert.equal(vtt, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\na → b\n');
});
