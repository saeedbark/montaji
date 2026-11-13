'use strict';
/* قراءة ملف .env واختيار المزوّد */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv, provider, PROVIDERS } = require('../server/config');

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
