'use strict';
/* /api/chat: تصنيف أخطاء المزوّد، ترتيب البدائل، توقيع Gemini، وحذف المفتاح المنتهي من .env */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

// ملف .env مؤقت قبل تحميل الإعدادات، فلا تُمس مفاتيح المطوّر الحقيقية
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'montaji-chat-'));
const ENV = path.join(dir, '.env');
process.env.MONTAJI_ENV_FILE = ENV;
for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL', 'GEMINI_MODEL', 'OPENROUTER_MODEL']) delete process.env[k];

const { failKind, candidates, forGemini } = require('../server/chat');
const { removeKey } = require('../server/settings');
const { provider, choices } = require('../server/config');

test('failKind: الرصيد المنتهي والمفتاح المرفوض يحذفان المفتاح، والعابر ينتقل إلى البديل', () => {
  assert.equal(failKind(402), 'dead');
  assert.equal(failKind(401), 'dead');
  assert.equal(failKind(403), 'dead');
  assert.equal(failKind(400, 'API key not valid. Please pass a valid API key.'), 'dead');
  assert.equal(failKind(429), 'next');
  assert.equal(failKind(503), 'next');
  assert.equal(failKind(404), 'next');
  assert.equal(failKind(408), 'next');
  assert.equal(failKind(0), 'next', 'انقطاع الاتصال');
  assert.equal(failKind(400, 'Invalid JSON payload'), 'stop', 'خطأ في الطلب نفسه لا يصلحه البديل');
});

test('forGemini: يضع توقيعاً لنداءات أدوات كتبها مزوّد آخر، ويترك الموقّعة كما هي', () => {
  const call = { id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } };
  const signed = { ...call, extra_content: { google: { thought_signature: 'real' } } };
  const msgs = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: null, tool_calls: [call, { ...call, id: 'b' }] }, { role: 'assistant', content: null, tool_calls: [signed] }];
  const out = forGemini(msgs);
  assert.equal(out[0], msgs[0]);
  assert.equal(out[1].tool_calls[0].extra_content.google.thought_signature, 'skip_thought_signature_validator');
  assert.equal(out[1].tool_calls[1].extra_content, undefined, 'التوقيع على أول نداء في الخطوة فقط');
  assert.equal(out[2], msgs[2]);
  assert.equal(msgs[1].tool_calls[0].extra_content, undefined, 'لا يغيّر الرسائل الأصلية');
});

test('candidates: المختار أولاً ثم المزوّد الثاني الذي له مفتاح', () => {
  fs.writeFileSync(ENV, 'OPENROUTER_API_KEY=or-key\nGEMINI_API_KEY=g-key\nGEMINI_MODEL=gemini-a,gemini-b\nAI_PROVIDER=openrouter\n');
  const first = provider();
  const list = candidates(first, choices());
  assert.deepEqual(list.map(p => `${p.id}/${p.model}`), ['openrouter/openrouter/auto', 'gemini/gemini-a', 'gemini/gemini-b']);
  assert.equal(list[0], first);
});

test('removeKey: يفرّغ مفتاح المزوّد ويُلغي اختياره افتراضياً، فيصبح التالي هو الافتراضي', () => {
  fs.writeFileSync(ENV, '# keys\nOPENROUTER_API_KEY=or-key\nGEMINI_API_KEY=g-key\nAI_PROVIDER=openrouter\nAI_MODEL=some/model\n');
  assert.equal(removeKey('openrouter'), 'OPENROUTER_API_KEY');
  assert.equal(fs.readFileSync(ENV, 'utf8'), '# keys\nOPENROUTER_API_KEY=\nGEMINI_API_KEY=g-key\nAI_PROVIDER=\nAI_MODEL=\n');
  assert.equal(provider().id, 'gemini');
  assert.equal(removeKey('openrouter'), '', 'لا شيء يُحذف مرتين');
  assert.equal(removeKey('ollama'), '', 'Ollama بلا مفتاح');
});

test('removeKey: يحذف GOOGLE_API_KEY إن كان هو مفتاح Gemini، ولا يمس AI_PROVIDER لمزوّد آخر', () => {
  fs.writeFileSync(ENV, 'GOOGLE_API_KEY=g\nOPENAI_API_KEY=o\nAI_PROVIDER=openai\n');
  assert.equal(removeKey('gemini'), 'GOOGLE_API_KEY');
  assert.equal(fs.readFileSync(ENV, 'utf8'), 'GOOGLE_API_KEY=\nOPENAI_API_KEY=o\nAI_PROVIDER=openai\n');
});
