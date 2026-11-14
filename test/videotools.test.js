'use strict';
/* تقسيم الفيديو (public/js/videotools.js): مواضع القطع، قراءة MP4، والنسخ المباشر إلى ملفات جديدة.
   ملفات الاختبار تُبنى بمكتبة mp4-muxer نفسها من عيّنات مصطنعة، فلا حاجة إلى فك أو ترميز حقيقي */

const test = require('node:test');
const assert = require('node:assert/strict');

const Mp4Muxer = require('../public/vendor/mp4-muxer.js');
const VideoTools = require('../public/js/videotools.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const source = bytes => ({ size: bytes.length, read: async (o, l) => bytes.subarray(o, o + l) });

const FPS = 30, GOP = 30, SECONDS = 10, AAC = 1024 / 48000;
const AVCC = Uint8Array.from([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 0]);
const ASC = Uint8Array.from([0x11, 0x90]); // AAC-LC، 48 كيلوهرتز، ستيريو

/** بايتات عيّنة تحمل نوعها ورقمها، لنتحقق أن كل جزء نسخ العيّنات الصحيحة */
const payload = (tag, i, n = 40) => { const d = new Uint8Array(n).fill(tag); new DataView(d.buffer).setUint32(1, i); return d; };
const idOf = d => new DataView(d.buffer, d.byteOffset).getUint32(1);

/** ترتيب الفك داخل كل GOP مع إطارات B: I0 P3 B1 B2 P6 B4 B5 … (أرقام العرض) */
function decodeOrder() {
  const out = [];
  for (let g = 0; g < SECONDS * FPS / GOP; g++) {
    const base = g * GOP, seq = [0];
    let j = 1;
    for (; j + 2 < GOP; j += 3) seq.push(j + 2, j, j + 1);
    for (; j < GOP; j++) seq.push(j);
    out.push(...seq.map(k => base + k));
  }
  return out;
}

/** فيديو H.264 مصطنع بإطارات B (تأخير فك إطارين) وصوت AAC */
function makeMp4({ audio = true, rotation = 0 } = {}) {
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: 640, height: 360, frameRate: FPS, rotation },
    audio: audio ? { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  const order = decodeOrder(), frame = 1e6 / FPS;
  const vmeta = { decoderConfig: { codec: 'avc1.640028', codedWidth: 640, codedHeight: 360, description: AVCC } };
  order.forEach((disp, k) => {
    const pts = disp * frame, dts = (k - 2) * frame;
    muxer.addVideoChunkRaw(payload(0xee, disp), disp % GOP === 0 ? 'key' : 'delta', pts, frame, k ? undefined : vmeta, pts - dts);
  });
  if (audio) {
    const ameta = { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, description: ASC } };
    for (let i = 0; i * AAC < SECONDS; i++) muxer.addAudioChunkRaw(payload(0xaa, i, 12), 'key', i * AAC * 1e6, AAC * 1e6, i ? undefined : ameta);
  }
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}

/* ---------------- مواضع القطع ---------------- */

test('planCuts: كل مدة، ولا يترك جزءاً أخيراً أقصر من نصف ثانية', () => {
  assert.deepEqual(VideoTools.planCuts({ start: 0, end: 70, mode: 'every', every: 30 }), [30, 60]);
  assert.deepEqual(VideoTools.planCuts({ start: 0, end: 60.2, mode: 'every', every: 30 }), [30]);
  assert.deepEqual(VideoTools.planCuts({ start: 10, end: 40, mode: 'every', every: 10 }), [20, 30]);
});

test('planCuts: أجزاء متساوية، وأوقات محددة مرتبة بلا تكرار وداخل المدى', () => {
  assert.deepEqual(VideoTools.planCuts({ start: 0, end: 9, mode: 'count', count: 3 }), [3, 6]);
  assert.deepEqual(VideoTools.planCuts({ start: 0, end: 9, mode: 'count', count: 1 }), []);
  assert.deepEqual(VideoTools.planCuts({ start: 0, end: 20, mode: 'times', times: [15, 5, 5.2, 0.1, 25, 'x'] }), [5, 15]);
});

test('exactParts يقسم المدى عند المواضع نفسها', () => {
  assert.deepEqual(VideoTools.exactParts(2, 10, [5]), [{ start: 2, end: 5 }, { start: 5, end: 10 }]);
});

test('parseTimes يقرأ الثواني والدقائق والأرقام العربية', () => {
  const r = VideoTools.parseTimes('0:30، 1:15.5, 90  1:00:00 ١:٠٥ abc 1:x');
  assert.deepEqual(r.times, [30, 75.5, 90, 3600, 65]);
  assert.deepEqual(r.bad, ['abc', '1:x']);
});

/* ---------------- قراءة MP4 ---------------- */

test('parseMp4 يقرأ مسارَي الفيديو والصوت وجداول العيّنات', async () => {
  const info = await VideoTools.parseMp4(source(makeMp4({ rotation: 90 })));
  const { video: v, audio: a } = info;
  assert.equal(info.copy, true);
  assert.equal(v.codec, 'avc');
  assert.equal(v.codecString, 'avc1.640028');
  assert.deepEqual([...v.description], [...AVCC]);
  assert.equal(v.width, 640);
  assert.equal(v.height, 360);
  assert.equal(v.rotation, 90);
  assert.equal(v.n, SECONDS * FPS);
  assert.equal(v.key.reduce((s, k) => s + k, 0), SECONDS * FPS / GOP);
  assert.equal(a.codec, 'aac');
  assert.equal(a.sampleRate, 48000);
  assert.equal(a.channels, 2);
  assert.deepEqual([...a.description], [...ASC]);
  near(info.duration, SECONDS + 2 / FPS, 0.01); // الفيديو يبدأ متأخراً بإطارين (تأخير الفك)
});

test('parseMp4 يرفض ملفاً ليس MP4', async () => {
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0, 0, 0]);
  await assert.rejects(VideoTools.parseMp4(source(webm)));
});

/* ---------------- النسخ المباشر ---------------- */

test('copyParts يحاذي القطع إلى الإطار المفتاحي السابق ويدمج القطعين على الإطار نفسه', async () => {
  const info = await VideoTools.parseMp4(source(makeMp4()));
  const k = s => s + 2 / FPS; // زمن الإطار المفتاحي في الثانية s
  const parts = VideoTools.copyParts(info, { start: 0, end: info.duration, cuts: [2.5, 2.9, 5.5] });
  assert.equal(parts.length, 3);
  near(parts[0].start, k(0)); near(parts[0].end, k(2));
  near(parts[1].start, k(2)); near(parts[1].end, k(5));
  near(parts[2].start, k(5)); near(parts[2].end, info.duration);
  assert.deepEqual(parts.map(p => p.v1 - p.v0), [60, 90, 150]);
  assert.equal(parts[0].a0, 0, 'الجزء الأول يأخذ الصوت من أوله');
  assert.equal(parts[2].a1, info.audio.n);
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].a0, parts[i - 1].a1, 'لا فراغ ولا تكرار في الصوت');
});

test('copyParts بخيار every: لا يزيد أي جزء على المدة المطلوبة', async () => {
  const info = await VideoTools.parseMp4(source(makeMp4()));
  for (const every of [1.5, 2.5, 3, 4.2]) {
    const parts = VideoTools.copyParts(info, { start: 0, end: info.duration, every });
    for (const p of parts) assert.ok(p.end - p.start <= every + 1e-3, `every ${every}: جزء طوله ${p.end - p.start}`);
    near(parts[parts.length - 1].end, info.duration);
    for (let i = 1; i < parts.length; i++) assert.equal(parts[i].v0, parts[i - 1].v1);
  }
  // الإطارات المفتاحية كل ثانية: كل 2.5 ثانية ← 2 + 2 + 2 + 2 + 2
  assert.deepEqual(VideoTools.copyParts(info, { start: 0, end: info.duration, every: 2.5 }).map(p => p.v1 - p.v0), [60, 60, 60, 60, 60]);
  // مدة أقصر من المسافة بين إطارين مفتاحيين: أقرب إطار بعدها
  assert.equal(VideoTools.copyParts(info, { start: 0, end: info.duration, every: 0.5 }).length, 10);
});

test('copyParts مع مدى جزئي: يبدأ عند إطار مفتاحي وينتهي عند النهاية المطلوبة', async () => {
  const src = source(makeMp4());
  const info = await VideoTools.parseMp4(src);
  const parts = VideoTools.copyParts(info, { start: 3.5, end: 7.5, cuts: [5.2] });
  assert.equal(parts.length, 2);
  assert.equal(parts[0].v0, 90);
  near(parts[1].end, 7.5);
  // آخر إطار معروض قبل 7.5 هو رقم 222 (يتأخر العرض إطارين)، وكل ما يُفك قبله بترتيب الفك داخل
  const bytes = source(await VideoTools.copyPart(src, info, parts[1], Mp4Muxer));
  const out = await VideoTools.parseMp4(bytes);
  const shown = [];
  for (let i = 0; i < out.video.n; i++) shown.push(idOf(await bytes.read(out.video.offset[i], out.video.size[i])));
  for (let d = 150; d <= 222; d++) assert.ok(shown.includes(d), `الإطار ${d} مفقود`);
  assert.ok(Math.max(...shown) <= 224);
  near(VideoTools.pts(out.audio, out.audio.n - 1) - VideoTools.pts(out.audio, 0), 7.5 - parts[1].origin, AAC * 1.5);
});

test('copyPart ينسخ عيّنات الجزء نفسها بتوقيت يبدأ من صفر ويبقي الصوت متزامناً', async () => {
  const bytes = makeMp4({ rotation: 90 });
  const src = source(bytes);
  const info = await VideoTools.parseMp4(src);
  const parts = VideoTools.copyParts(info, { start: 0, end: info.duration, cuts: [4.2] });
  let progress = 0;
  const out = await VideoTools.copyPart(src, info, parts[1], Mp4Muxer, { onProgress: p => { progress = p; } });
  assert.equal(progress, 1);

  const o = await VideoTools.parseMp4(source(out));
  const { video: v, audio: a } = o;
  assert.equal(v.n, parts[1].v1 - parts[1].v0);
  assert.equal(a.n, parts[1].a1 - parts[1].a0);
  assert.equal(v.rotation, 90);
  assert.equal(v.key[0], 1, 'الجزء يبدأ بإطار مفتاحي');
  assert.equal(v.key.reduce((s, x) => s + x, 0), 6);
  assert.deepEqual([...v.description], [...AVCC]);
  assert.deepEqual([...a.description], [...ASC]);

  // البايتات: أول عيّنة فيديو هي الإطار المفتاحي 120، وأول عيّنة صوت هي التي كانت عنده
  const first = await source(out).read(v.offset[0], v.size[0]);
  assert.equal(idOf(first), 4 * FPS);
  const aFirst = await source(out).read(a.offset[0], a.size[0]);
  assert.equal(idOf(aFirst), parts[1].a0);

  // التزامن: الفرق بين الإطار المفتاحي وأول صوت في الجزء هو نفسه في الأصل (بدقة إطار صوت واحد)
  const kv = VideoTools.pts(v, 0), ka = VideoTools.pts(a, 0);
  const before = VideoTools.pts(info.video, parts[1].v0) - VideoTools.pts(info.audio, parts[1].a0);
  near(kv - ka, before, AAC);
  near(o.duration - kv, parts[1].end - parts[1].start, 0.01);
});

test('copyPart بلا صوت عند الطلب، وللملف الذي لا صوت له', async () => {
  const src = source(makeMp4());
  const info = await VideoTools.parseMp4(src);
  const [p] = VideoTools.copyParts(info, { start: 0, end: 3.5, cuts: [] });
  const out = await VideoTools.copyPart(src, info, p, Mp4Muxer, { audio: false });
  const o = await VideoTools.parseMp4(source(out));
  assert.equal(o.audio, null);
  assert.equal(o.video.n, 103); // ينتهي عند 3.5 لا عند الإطار المفتاحي

  const silent = source(makeMp4({ audio: false }));
  const si = await VideoTools.parseMp4(silent);
  assert.equal(si.audio, null);
  const parts = VideoTools.copyParts(si, { start: 0, end: si.duration, cuts: [5.5] });
  const o2 = await VideoTools.parseMp4(source(await VideoTools.copyPart(silent, si, parts[0], Mp4Muxer)));
  assert.equal(o2.video.n, 150);
});

test('copyPart يتوقف عند الإلغاء', async () => {
  const src = source(makeMp4());
  const info = await VideoTools.parseMp4(src);
  const [p] = VideoTools.copyParts(info, { start: 0, end: info.duration, cuts: [] });
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(VideoTools.copyPart(src, info, p, Mp4Muxer, { signal: ctl.signal }), { name: 'AbortError' });
});
