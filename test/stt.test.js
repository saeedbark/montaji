'use strict';
/* تفريغ الكلام: اختيار الخدمة من .env (server/config.js)، قراءة ردود المزوّدين (server/stt.js)،
   وتجهيز الصوت للإرسال (toMono16k و sttChunks في public/js/audiotools.js) */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sttProvider, STT_PROVIDERS } = require('../server/config');
const { fromWhisper, parseSegments } = require('../server/stt');
const AudioTools = require('../public/js/audiotools.js');

const envOf = vals => k => vals[k] || '';
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('sttProvider: بلا مفاتيح يعيد خطأً يذكر ما يُضبط', () => {
  const p = sttProvider(envOf({}));
  assert.match(p.error, /STT_BASE_URL/);
});

test('sttProvider: يكتشف الخدمة من المفتاح الموجود، و Whisper يتقدّم على نموذج المحادثة', () => {
  assert.equal(sttProvider(envOf({ GEMINI_API_KEY: 'g' })).id, 'gemini');
  assert.equal(sttProvider(envOf({ GEMINI_API_KEY: 'g' })).kind, 'chat');
  const both = sttProvider(envOf({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' }));
  assert.equal(both.id, 'groq');
  assert.equal(both.kind, 'whisper');
  assert.equal(both.key, 'q');
  assert.equal(both.model, STT_PROVIDERS.groq.model);
  assert.equal(sttProvider(envOf({ OPENAI_API_KEY: 'o', GROQ_API_KEY: 'q' })).id, 'openai');
});

test('sttProvider: STT_PROVIDER و STT_MODEL يتجاوزان الافتراضي، والقيم الخاطئة تُرفض', () => {
  const p = sttProvider(envOf({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', STT_PROVIDER: 'gemini', STT_MODEL: 'my-model' }));
  assert.equal(p.id, 'gemini'); assert.equal(p.model, 'my-model'); assert.equal(p.key, 'g');
  assert.match(sttProvider(envOf({ STT_PROVIDER: 'nope' })).error, /nope/);
  assert.match(sttProvider(envOf({ STT_PROVIDER: 'groq' })).error, /GROQ_API_KEY/);
  assert.match(sttProvider(envOf({ STT_PROVIDER: 'custom' })).error, /STT_BASE_URL/);
});

test('sttProvider: خادم محلي عبر STT_BASE_URL يتقدّم على المفاتيح ولا يحتاج مفتاحاً', () => {
  const p = sttProvider(envOf({ OPENAI_API_KEY: 'o', STT_BASE_URL: 'http://localhost:8000/v1/' }));
  assert.equal(p.id, 'custom'); assert.equal(p.kind, 'whisper');
  assert.equal(p.base, 'http://localhost:8000/v1');
  assert.equal(p.key, '', 'مفتاح OpenAI لا يُرسل إلى خادم آخر');
  assert.equal(sttProvider(envOf({ STT_BASE_URL: 'http://x/v1', STT_API_KEY: 'k' })).key, 'k');
});

test('fromWhisper: يأخذ الكلمات والجمل الصالحة فقط', () => {
  const r = fromWhisper({
    language: 'ar', text: 'مرحبا بكم',
    segments: [{ start: 0, end: 1.5, text: ' مرحبا بكم ' }, { start: 2, end: 1, text: 'سالب' }, { start: 'x', end: 3, text: 'ليس رقماً' }, { start: 3, end: 4, text: '  ' }],
    words: [{ word: ' مرحبا', start: 0.1, end: 0.6 }, { word: 'بكم', start: 0.7, end: 1.2 }, { word: '', start: 1, end: 2 }, { word: 'x', start: -1, end: 2 }, { word: 'y', start: NaN, end: 2 }],
  });
  assert.deepEqual(r.segments, [{ start: 0, end: 1.5, text: 'مرحبا بكم' }]);
  assert.deepEqual(r.words, [{ w: 'مرحبا', t0: 0.1, t1: 0.6 }, { w: 'بكم', t0: 0.7, t1: 1.2 }]);
  assert.equal(r.language, 'ar');
});

test('fromWhisper: رد نصي بلا توقيت (خادم لا يدعم verbose_json) يصير جملة واحدة', () => {
  const r = fromWhisper({ text: 'نص كامل', duration: 6 });
  assert.deepEqual(r.segments, [{ start: 0, end: 6, text: 'نص كامل' }]);
  assert.deepEqual(r.words, []);
  assert.deepEqual(fromWhisper({}), { segments: [], words: [], language: '' });
});

test('parseSegments: يستخرج JSON من رد نموذج المحادثة ولو أحاطه بسياج markdown', () => {
  const out = parseSegments('```json\n[{"start": 2.5, "end": 4, "text": "ثانياً"}, {"start": "0.0", "end": 2, "text": " أولاً "}, {"start": 5, "end": 5, "text": "صفر المدة"}, {"start": 6, "end": 7}]\n```');
  assert.deepEqual(out, [{ start: 0, end: 2, text: 'أولاً' }, { start: 2.5, end: 4, text: 'ثانياً' }]);
  assert.deepEqual(parseSegments('[]'), []);
  assert.equal(parseSegments('لا أستطيع'), null);
  assert.equal(parseSegments('[not json]'), null);
  assert.equal(parseSegments(''), null);
});

/** كائن يشبه AudioBuffer */
function buffer(channels, seconds, sampleRate, fn) {
  const length = Math.round(seconds * sampleRate);
  const data = [...Array(channels)].map((_, c) => Float32Array.from({ length }, (_, i) => fn(c, i)));
  return { numberOfChannels: channels, sampleRate, length, duration: length / sampleRate, getChannelData: c => data[c] };
}

test('toMono16k: يمزج القناتين ويخفض التردد إلى 16 كيلوهرتز ويقتطع المدى', () => {
  const buf = buffer(2, 2, 48000, (c, i) => (c ? 0.25 : 0.75) * (i < 48000 ? 1 : -1));
  const all = AudioTools.toMono16k(buf);
  assert.equal(all.sampleRate, 16000);
  assert.equal(all.channels.length, 1);
  assert.equal(all.length, 32000);
  near(all.channels[0][10], 0.5); near(all.channels[0][31990], -0.5);
  const part = AudioTools.toMono16k(buf, 0.5, 1.5);
  assert.equal(part.length, 16000);
  near(part.duration, 1);
  near(part.channels[0][7990], 0.5); near(part.channels[0][8010], -0.5);
  // ملف WAV الناتج أحادي 16 بت
  const wav = AudioTools.wav(part), dv = new DataView(wav.buffer);
  assert.equal(dv.getUint16(22, true), 1); assert.equal(dv.getUint32(24, true), 16000);
  assert.equal(wav.length, 44 + 16000 * 2);
});

test('toMono16k: تردد ليس من مضاعفات 16000 (44.1 كيلوهرتز)', () => {
  const m = AudioTools.toMono16k(buffer(1, 1, 44100, () => 0.3));
  assert.ok(Math.abs(m.length - 16000) <= 1);
  for (const v of m.channels[0]) near(v, 0.3, 1e-5);
});

test('sttChunks: الصوت القصير جزء واحد، والطويل أجزاء متداخلة تغطيه كله تحت الحد', () => {
  assert.deepEqual(AudioTools.sttChunks(0), []);
  assert.deepEqual(AudioTools.sttChunks(120), [{ start: 0, end: 120 }]);
  const ch = AudioTools.sttChunks(1500, 600, 2);
  assert.equal(ch.length, 3);
  near(ch[0].start, 0); near(ch[2].end, 1500);
  for (let i = 0; i < ch.length; i++) {
    assert.ok(ch[i].end - ch[i].start <= 600 + 1e-6, 'جزء أطول من الحد');
    if (i) near(ch[i - 1].end - ch[i].start, 2);
  }
});
