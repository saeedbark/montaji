'use strict';
/* قراءة ملف .env واختيار المزوّد */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv, provider, choices, PROVIDERS } = require('../server/config');

const envOf = vals => k => vals[k] || '';

test('parseEnv: مفاتيح، تعليقات، اقتباس، و BOM', () => {
  const vals = parseEnv([
    '﻿# تعليق',
    'GEMINI_API_KEY=abc123',
    '  AI_MODEL = my-model   # تعليق في آخر السطر',
    'QUOTED="has # hash"',
    "SINGLE='x y'",
    'EMPTY=',
    'ليس سطراً صالحاً',
  ].join('\r\n'));
  assert.deepEqual(vals, { GEMINI_API_KEY: 'abc123', AI_MODEL: 'my-model', QUOTED: 'has # hash', SINGLE: 'x y', EMPTY: '' });
});

test('provider: بلا مفاتيح يعيد خطأً واضحاً', () => {
  assert.ok(provider(envOf({})).error);
});

test('provider: يكتشف المزوّد من المفتاح الموجود', () => {
  const p = provider(envOf({ OPENAI_API_KEY: 'k' }));
  assert.equal(p.id, 'openai');
  assert.equal(p.key, 'k');
  assert.equal(p.model, PROVIDERS.openai.model);
  assert.equal(p.vision, true);
});

test('provider: AI_PROVIDER و AI_MODEL و AI_VISION تتجاوز الافتراضي', () => {
  const p = provider(envOf({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'anthropic', AI_MODEL: 'm', AI_VISION: 'off' }));
  assert.equal(p.id, 'anthropic');
  assert.equal(p.key, 'a');
  assert.equal(p.model, 'm');
  assert.equal(p.vision, false);
});

test('provider: حد طول الرد — افتراضي OpenRouter، و AI_MAX_TOKENS يتجاوزه', () => {
  assert.equal(provider(envOf({ OPENROUTER_API_KEY: 'o' })).maxTokens, 8192);
  assert.equal(provider(envOf({ GEMINI_API_KEY: 'g' })).maxTokens, 0, 'لا حد يُرسل لمزوّد بلا حد افتراضي');
  assert.equal(provider(envOf({ GEMINI_API_KEY: 'g', AI_MAX_TOKENS: '4000' })).maxTokens, 4000);
  assert.equal(provider(envOf({ OPENROUTER_API_KEY: 'o', AI_MAX_TOKENS: 'abc' })).maxTokens, 8192);
});

test('provider: مزوّد غير معروف أو ناقص الإعداد', () => {
  assert.match(provider(envOf({ AI_PROVIDER: 'nope' })).error, /nope/);
  assert.ok(provider(envOf({ AI_PROVIDER: 'openai' })).error, 'مفتاح فارغ');
  assert.ok(provider(envOf({ AI_PROVIDER: 'ollama' })).error, 'Ollama يحتاج AI_MODEL');
  assert.equal(provider(envOf({ AI_PROVIDER: 'ollama', AI_MODEL: 'llama' })).id, 'ollama');
});

test('provider: AI_BASE_URL وحده يكفي للمزوّد المخصّص', () => {
  const p = provider(envOf({ AI_BASE_URL: 'http://localhost:1234/v1/', AI_MODEL: 'local' }));
  assert.equal(p.id, 'custom');
  assert.equal(p.base, 'http://localhost:1234/v1');
});

test('choices: كل مزوّد له مفتاح يظهر في القائمة، والافتراضي أولاً', () => {
  const env = envOf({ GEMINI_API_KEY: 'g', OPENROUTER_API_KEY: 'o', AI_PROVIDER: 'openrouter' });
  const c = choices(env);
  assert.deepEqual(c.map(o => o.provider), ['openrouter', 'gemini']);
  assert.equal(c[0].default, true);
  assert.equal(c[1].model, PROVIDERS.gemini.model);
  assert.ok(c.every(o => !('key' in o)), 'لا مفاتيح في القائمة');
});

test('choices: GEMINI_MODEL و AI_MODEL قوائم مفصولة بفواصل', () => {
  const env = envOf({ GEMINI_API_KEY: 'g', OPENROUTER_API_KEY: 'o', AI_MODEL: 'gemini-a', GEMINI_MODEL: 'gemini-b, gemini-a', OPENROUTER_MODEL: 'x/one,y/two' });
  assert.deepEqual(choices(env).map(o => `${o.provider}:${o.model}`), ['gemini:gemini-a', 'gemini:gemini-b', 'openrouter:x/one', 'openrouter:y/two']);
  assert.equal(provider(env).model, 'gemini-a');
});

test('choices: لا قائمة بلا مفاتيح، ولا Ollama ما لم يُسمَّ له نموذج', () => {
  assert.deepEqual(choices(envOf({})), []);
  assert.deepEqual(choices(envOf({ GEMINI_API_KEY: 'g' })).map(o => o.provider), ['gemini']);
  assert.deepEqual(choices(envOf({ GEMINI_API_KEY: 'g', OLLAMA_MODEL: 'llama' })).map(o => o.provider), ['gemini', 'ollama']);
});

test('provider: يقبل الاختيار من القائمة فقط', () => {
  const env = envOf({ GEMINI_API_KEY: 'g', OPENROUTER_API_KEY: 'o', AI_BASE_URL: 'http://proxy/v1' });
  const p = provider(env, { provider: 'openrouter', model: PROVIDERS.openrouter.model });
  assert.equal(p.id, 'openrouter');
  assert.equal(p.key, 'o');
  assert.equal(p.base, PROVIDERS.openrouter.base, 'AI_BASE_URL يخص المزوّد الافتراضي وحده');
  // مزوّد بلا مفتاح أو نموذج غير مسمّى: يعود إلى الافتراضي
  assert.equal(provider(env, { provider: 'openai', model: 'gpt' }).id, 'gemini');
  assert.equal(provider(env, { provider: 'openrouter', model: 'any/model' }).id, 'gemini');
  assert.equal(provider(env).base, 'http://proxy/v1');
});
