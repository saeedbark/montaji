'use strict';
/* لغة الواجهة (public/js/i18n.js): tt يختار نص اللغة الحالية، والجداول الثابتة تتبع اللغة بعد التبديل */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const I18N = require('../public/js/i18n.js');

test('العربية هي الافتراضية، والتبديل يغيّر نص tt', () => {
  assert.equal(I18N.lang, 'ar');
  assert.equal(I18N.t('حذف', 'Delete'), 'حذف');
  I18N.set('en');
  assert.equal(I18N.t('حذف', 'Delete'), 'Delete');
  I18N.set('xx'); // قيمة مجهولة لا تغيّر شيئاً
  assert.equal(I18N.lang, 'en');
  I18N.set('ar');
  assert.equal(I18N.t('حذف', 'Delete'), 'حذف');
});

test('localize يجعل التسميات حيّة ويبقيها ظاهرة في Object.entries', () => {
  const t = I18N.localize({ a: ['أ', 'A'], b: { label: ['ب', 'B'], css: 'x' }, c: { label: 'ثابت' } });
  assert.deepEqual(Object.entries(t).map(([k, v]) => [k, typeof v === 'string' ? v : v.label]), [['a', 'أ'], ['b', 'ب'], ['c', 'ثابت']]);
  I18N.set('en');
  assert.equal(t.a, 'A');
  assert.equal(t.b.label, 'B');
  assert.equal(t.b.css, 'x');
  assert.equal(t.c.label, 'ثابت');
  I18N.set('ar');
});

test('onChange يُستدعى عند التبديل', () => {
  const seen = [];
  I18N.onChange(l => seen.push(l));
  I18N.set('en');
  I18N.set('ar');
  assert.deepEqual(seen.slice(-2), ['en', 'ar']);
});

test('كل ملفات الواجهة التي تستعمل tt تُحمَّل بعد i18n.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const first = scripts.indexOf('js/i18n.js');
  assert.ok(first >= 0, 'i18n.js غير محمَّل');
  for (const s of scripts.slice(0, first)) {
    const src = fs.readFileSync(path.join(__dirname, '../public', s), 'utf8');
    assert.ok(!/\btt\(/.test(src), `${s} يستعمل tt قبل تحميل i18n.js`);
  }
});
