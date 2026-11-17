'use strict';
/* لغة ردود الخادم (server/http.js): langOf يقرأ كوكي الواجهة، و pickLang يختار error أو error_en */

const test = require('node:test');
const assert = require('node:assert/strict');

const { langOf, pickLang } = require('../server/http');

test('langOf: الإنجليزية مع montaji_lang=en فقط، والعربية في غير ذلك', () => {
  const req = cookie => ({ headers: cookie == null ? {} : { cookie } });
  assert.equal(langOf(req()), 'ar');
  assert.equal(langOf(req('montaji_lang=en')), 'en');
  assert.equal(langOf(req('a=1; montaji_lang=en; b=2')), 'en');
  assert.equal(langOf(req('montaji_lang=ar')), 'ar');
  assert.equal(langOf(req('montaji_lang=english')), 'ar');
  assert.equal(langOf(req('xmontaji_lang=en')), 'ar');
});

test('pickLang يستبدل الحقول ويحذف _en، في الرد وأجزائه وعناصر قوائمه', () => {
  const data = {
    error: 'ع', error_en: 'E', code: 'no_key',
    stt: { error: 'ص', error_en: 'S' },
    choices: [{ label: 'مخصّص', label_en: 'Custom', model: 'm' }, { label: 'OpenAI', label_en: 'OpenAI' }],
    other_en: 'بلا أصل يبقى كما هو',
  };
  assert.deepEqual(pickLang(data, true), {
    error: 'E', code: 'no_key', stt: { error: 'S' },
    choices: [{ label: 'Custom', model: 'm' }, { label: 'OpenAI' }], other_en: 'بلا أصل يبقى كما هو',
  });
  assert.deepEqual(pickLang(data, false), {
    error: 'ع', code: 'no_key', stt: { error: 'ص' },
    choices: [{ label: 'مخصّص', model: 'm' }, { label: 'OpenAI' }], other_en: 'بلا أصل يبقى كما هو',
  });
  // error_en غير معرَّف (رسالة من خطأ بلا ترجمة): يبقى العربي
  assert.deepEqual(pickLang({ error: 'ع', error_en: undefined }, true), { error: 'ع' });
  assert.equal(pickLang(null, true), null);
  assert.deepEqual(pickLang([1, 2], true), [1, 2]);
});
