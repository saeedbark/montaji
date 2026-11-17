'use strict';
/* safeName (server/exports.js): اسم الملف الذي يرسله المحرر يُكتب على القرص، فلا مسارات ولا أسماء محجوزة */

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeName } = require('../server/exports');

test('safeName يحذف المسارات فلا يخرج الحفظ من مجلده', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd.mp4');
  assert.equal(safeName(String.raw`..\..\Windows\evil.mp4`), 'evil.mp4');
  assert.equal(safeName('/abs/path/clip'), 'clip.mp4');
});

test('safeName يحذف الرموز الممنوعة في ويندوز والنقاط والمسافات في الطرفين', () => {
  assert.equal(safeName('a<b>:c"d|e?f*'), 'abcdef.mp4');
  assert.equal(safeName('...hidden'), 'hidden.mp4');
  assert.equal(safeName('name. . '), 'name.mp4');
  assert.equal(safeName('x'.repeat(200)).length, 120 + 4);
});

test('safeName يحمي أسماء الأجهزة المحجوزة في ويندوز', () => {
  assert.equal(safeName('con'), '_con.mp4');
  assert.equal(safeName('COM1.txt'), '_COM1.txt.mp4');
  assert.equal(safeName('nul', '.srt', 'captions'), '_nul.srt');
});

test('safeName يضع الامتداد المطلوب مرة واحدة، والاسم الاحتياطي حين يفرغ الاسم', () => {
  assert.equal(safeName('تجربة.MP4'), 'تجربة.mp4');
  assert.equal(safeName('مشروعي.montaji', '.montaji', 'project'), 'مشروعي.montaji');
  assert.equal(safeName('', '.montaji', 'project'), 'project.montaji');
  assert.equal(safeName(null), 'montaji.mp4');
  assert.equal(safeName('...'), 'montaji.mp4');
});
