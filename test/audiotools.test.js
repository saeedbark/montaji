'use strict';
/* معالجة الصوت (public/js/audiotools.js): القص والتوحيد والتلاشي وملف WAV — الجزء الذي لا يحتاج متصفحاً */

const test = require('node:test');
const assert = require('node:assert/strict');

const AudioTools = require('../public/js/audiotools.js');

/** كائن يشبه AudioBuffer: fn(channel, sampleIndex) ← قيمة العيّنة */
function buffer(channels, seconds, sampleRate, fn) {
  const length = Math.round(seconds * sampleRate);
  const data = [...Array(channels)].map((_, c) => Float32Array.from({ length }, (_, i) => fn(c, i)));
  return { numberOfChannels: channels, sampleRate, length, duration: length / sampleRate, getChannelData: c => data[c] };
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('process يقتطع المدى المطلوب بالضبط ولا يمسّ الأصل', () => {
  const buf = buffer(2, 2, 1000, (c, i) => (c ? -i : i) / 10000);
  const r = AudioTools.process(buf, { start: 0.5, end: 1.25 });
  assert.equal(r.length, 750);
  assert.equal(r.channels.length, 2);
  near(r.duration, 0.75);
  near(r.channels[0][0], 500 / 10000);
  near(r.channels[1][749], -1249 / 10000);
  r.channels[0][0] = 9;
  near(buf.getChannelData(0)[500], 500 / 10000, 1e-6);
});

test('process يحصر المدى داخل الملف', () => {
  const buf = buffer(1, 1, 1000, () => 0.5);
  assert.equal(AudioTools.process(buf, { start: -3, end: 99 }).length, 1000);
  assert.equal(AudioTools.process(buf, { start: 0.8, end: 0.2 }).length, 0);
});

test('توحيد المستوى يرفع أعلى قمة إلى -1 dBFS', () => {
  const buf = buffer(2, 1, 1000, (c, i) => (c ? 0.1 : 0.25) * Math.sin(i / 7));
  const r = AudioTools.process(buf, { normalize: true });
  let peak = 0;
  for (const ch of r.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  near(peak, 0.891, 1e-3);
  near(r.peak, 0.891, 1e-3);
  // النسبة بين القناتين محفوظة
  near(r.channels[1][30] / r.channels[0][30], 0.4, 1e-4);
});

test('الصمت لا يُضخَّم', () => {
  const r = AudioTools.process(buffer(1, 0.5, 1000, () => 0), { normalize: true });
  assert.ok(r.channels[0].every(v => v === 0));
  assert.equal(r.peak, 0);
});

test('التلاشي يبدأ وينتهي بصفر ويترك الوسط', () => {
  const buf = buffer(1, 2, 1000, () => 0.5);
  const r = AudioTools.process(buf, { fadeIn: 0.5, fadeOut: 0.25 });
  const c = r.channels[0];
  assert.equal(c[0], 0);
  near(c[250], 0.25);           // منتصف الظهور
  near(c[1000], 0.5);           // الوسط كما هو
  assert.equal(c[1999], 0);     // آخر عيّنة
  assert.ok(c[1800] > c[1900]);
});

test('أكثر من قناتين يُخفض إلى ستيريو', () => {
  // 5.1: الوسط فقط فيه صوت ← يظهر في القناتين
  const buf = buffer(6, 0.1, 1000, c => (c === 2 ? 0.5 : 0));
  const r = AudioTools.process(buf);
  assert.equal(r.channels.length, 2);
  near(r.channels[0][10], 0.5 * Math.SQRT1_2, 1e-6);
  near(r.channels[1][10], 0.5 * Math.SQRT1_2, 1e-6);
});

test('peaks يعيد عموداً لكل جزء بأعلى قيمة فيه', () => {
  const buf = buffer(1, 1, 1000, (c, i) => (i >= 500 && i < 510 ? -0.8 : 0.1));
  const p = AudioTools.peaks(buf, 10);
  assert.equal(p.length, 10);
  near(p[0], 0.1, 1e-6);
  near(p[5], 0.8, 1e-6);
});

test('wav ينتج ترويسة صحيحة وعيّنات 16 بت متداخلة', () => {
  const clip = AudioTools.process(buffer(2, 0.01, 8000, (c, i) => (c ? -1 : i === 0 ? 1 : 0.5)));
  const bytes = AudioTools.wav(clip);
  const dv = new DataView(bytes.buffer);
  const tag = o => String.fromCharCode(...bytes.subarray(o, o + 4));
  assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE'); assert.equal(tag(12), 'fmt '); assert.equal(tag(36), 'data');
  assert.equal(dv.getUint32(4, true), bytes.length - 8);
  assert.equal(dv.getUint16(20, true), 1);      // PCM
  assert.equal(dv.getUint16(22, true), 2);      // قناتان
  assert.equal(dv.getUint32(24, true), 8000);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.getUint32(40, true), clip.length * 4);
  assert.equal(dv.getInt16(44, true), 32767);   // يسار: 1
  assert.equal(dv.getInt16(46, true), -32768);  // يمين: -1
  assert.equal(dv.getInt16(48, true), 16384);   // يسار: 0.5
});

test('estimate يعطي حجماً معقولاً لكل صيغة', () => {
  assert.equal(AudioTools.estimate(10, 'wav', 0, 2, 48000), 44 + 10 * 48000 * 4);
  const m = AudioTools.estimate(60, 'm4a', 192000);
  assert.ok(m > 1.4e6 && m < 1.5e6, String(m));
});
