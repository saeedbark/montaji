'use strict';
/* setEnvValues: كتابة المفتاح في نص ملف .env دون المساس ببقيته، و chatModels: تصفية قائمة نماذج المزوّد */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setEnvValues } = require('../server/settings');

test('يستبدل أول سطر غير معلّق ويترك التعليقات والمفاتيح الأخرى', () => {
  const txt = '# GEMINI_API_KEY=commented\nGEMINI_API_KEY=\nOPENAI_API_KEY=keep\n';
  assert.equal(setEnvValues(txt, { GEMINI_API_KEY: 'new' }), '# GEMINI_API_KEY=commented\nGEMINI_API_KEY=new\nOPENAI_API_KEY=keep\n');
});

test('يضيف المتغيّر المفقود في آخر الملف، ويعمل على ملف فارغ', () => {
  assert.equal(setEnvValues('A=1\n', { AI_PROVIDER: 'gemini' }), 'A=1\nAI_PROVIDER=gemini\n');
  assert.equal(setEnvValues('', { A: 'x' }), 'A=x\n');
});

test('يحافظ على نهايات أسطر ويندوز', () => {
  assert.equal(setEnvValues('A=1\r\nB=2\r\n', { B: '3' }), 'A=1\r\nB=3\r\n');
});

test('يطابق اسم المتغيّر كاملاً لا بدايته', () => {
  assert.equal(setEnvValues('AI_MODEL_X=1\nAI_MODEL=old\n', { AI_MODEL: '' }), 'AI_MODEL_X=1\nAI_MODEL=\n');
});

test('chatModels: نماذج المحادثة فقط، بلا models/ والأحدث أولاً', () => {
  const { chatModels } = require('../server/settings');
  assert.deepEqual(chatModels('gemini', ['models/gemini-2.5-flash', 'models/text-embedding-004', 'models/gemini-3.6-flash', 'models/gemini-3.6-flash-image', 'models/imagen-4', 'models/gemini-3.6-flash-lite']),
    ['gemini-3.6-flash-lite', 'gemini-3.6-flash', 'gemini-2.5-flash']);
  assert.deepEqual(chatModels('openai', ['gpt-5.4-mini', 'whisper-1', 'o4-mini', 'tts-1', 'davinci-002']), ['o4-mini', 'gpt-5.4-mini']);
});
