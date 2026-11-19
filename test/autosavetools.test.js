'use strict';
/* الحفظ التلقائي (public/js/autosavetools.js): ما يُكتب من الوسائط، ومتى تُعرض الاستعادة، ووصفها */

const test = require('node:test');
const assert = require('node:assert/strict');

const AT = require('../public/js/autosavetools.js');

test('الوسائط: يُكتب الجديد فقط ويُحذف ما لم يعد مستعملاً', () => {
  assert.deepEqual(AT.planMedia([], [{ key: 'a' }, { key: 'b' }]), { write: ['a', 'b'], remove: [] });
  assert.deepEqual(AT.planMedia(['a', 'b'], [{ key: 'a' }, { key: 'b' }]), { write: [], remove: [] });
  assert.deepEqual(AT.planMedia(['a', 'b'], [{ key: 'b' }, { key: 'c' }]), { write: ['c'], remove: ['a'] });
  assert.deepEqual(AT.planMedia(['a'], []), { write: [], remove: ['a'] });
});

test('الوسائط: الصورة المعدّلة تُكتب كل مرة، والمكرر يُكتب مرة واحدة', () => {
  assert.deepEqual(AT.planMedia(['e1'], [{ key: 'e1', always: true }]), { write: ['e1'], remove: [] });
  assert.deepEqual(AT.planMedia([], [{ key: 'a' }, { key: 'a' }, null, {}]), { write: ['a'], remove: [] });
  assert.deepEqual(AT.planMedia(undefined, undefined), { write: [], remove: [] });
});

test('الاستعادة تُعرض فقط لمشروع فيه محتوى', () => {
  assert.equal(AT.hasContent(null), false);
  assert.equal(AT.hasContent({}), false);
  assert.equal(AT.hasContent({ clips: [], audios: [], texts: [], effects: [], captions: { items: [] } }), false);
  assert.equal(AT.hasContent({ clips: [{}] }), true);
  assert.equal(AT.hasContent({ texts: [{}] }), true);
  assert.equal(AT.hasContent({ captions: { items: [{}] } }), true);
});

test('الزمن منذ آخر تعديل', () => {
  const now = 1_000_000_000;
  assert.equal(AT.ago(now - 10_000, now), 'قبل لحظات');
  assert.equal(AT.ago(now - 60_000, now), 'قبل دقيقة');
  assert.equal(AT.ago(now - 5 * 60_000, now), 'قبل 5 دقيقة');
  assert.equal(AT.ago(now - 60 * 60_000, now), 'قبل ساعة');
  assert.equal(AT.ago(now - 30 * 3600_000, now), 'أمس');
  assert.equal(AT.ago(NaN, now), 'قبل لحظات');
});

test('وصف النسخة المحفوظة', () => {
  const now = 1_000_000_000;
  const d = { name: 'شرح', clips: [{}], audios: [{}, {}], texts: [{}], effects: [] };
  assert.equal(AT.describe(d, now - 120_000, now), '«شرح» · 1 مقطع · 2 صوت · 1 نص · آخر تعديل قبل 2 دقيقة');
  assert.equal(AT.describe({ clips: [{}] }, now, now), '1 مقطع · آخر تعديل قبل لحظات');
});
