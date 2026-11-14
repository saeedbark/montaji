'use strict';
/* ملف المشروع (public/js/projecttools.js): كتابة ZIP وقراءته، تحويل المشروع إلى JSON، وفحص ما يُقرأ منه */

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const PT = require('../public/js/projecttools.js');

const bytes = s => new TextEncoder().encode(s);
const entry = (name, data) => ({ name, size: data.length, crc: PT.crc32(data), data });
const archive = (entries, opts) => new Blob(PT.zipParts(entries, opts).parts);

test('CRC-32 يطابق zlib، دفعة واحدة أو على دفعات', async () => {
  const data = bytes('مونتاجي — montaji 123456789');
  assert.equal(PT.crc32(data), zlib.crc32 ? zlib.crc32(data) : PT.crc32(data));
  assert.equal(PT.crc32(bytes('123456789')), 0xCBF43926);
  const big = new Uint8Array(100000).map((_, i) => i * 31 + 7);
  let seen = 0;
  assert.equal(await PT.crcOfBlob(new Blob([big]), n => { seen = n; }, 4096), PT.crc32(big));
  assert.equal(seen, big.length);
});

test('الأرشيف يُكتب ثم يُقرأ بأسمائه العربية وبياناته', async () => {
  const files = [entry('project.json', bytes('{"a":1}')), entry('media/1-صورة جميلة.jpg', new Uint8Array([1, 2, 3, 4, 5])), entry('media/2-empty.bin', new Uint8Array(0))];
  const z = PT.zipParts(files);
  const blob = new Blob(z.parts);
  assert.equal(blob.size, z.size);
  const list = await PT.readZip(blob);
  assert.deepEqual(list.map(e => e.name), files.map(f => f.name));
  for (let i = 0; i < files.length; i++) {
    assert.equal(list[i].crc, files[i].crc);
    const got = new Uint8Array(await (await PT.zipData(blob, list[i])).arrayBuffer());
    assert.deepEqual([...got], [...files[i].data]);
  }
});

test('ZIP64 يُكتب ويُقرأ (مشاريع أكبر من 4 غيغابايت)', async () => {
  const files = [entry('project.json', bytes('{}')), entry('media/1-a.mp4', new Uint8Array(3000).fill(9))];
  const z = PT.zipParts(files, { zip64: true });
  const blob = new Blob(z.parts);
  assert.equal(blob.size, z.size);
  const list = await PT.readZip(blob);
  assert.deepEqual(list.map(e => [e.name, e.size]), [['project.json', 2], ['media/1-a.mp4', 3000]]);
  const got = new Uint8Array(await (await PT.zipData(blob, list[1])).arrayBuffer());
  assert.equal(got.length, 3000);
  assert.ok(got.every(b => b === 9));
});

test('يقرأ أرشيفاً أعيد ضغطه ببرنامج ZIP (deflate)', async () => {
  // نضع بيانات deflate مكان الملف، ثم نقرأ المدخل كما يصفه فهرس برنامج ضغط (الطريقة 8)
  const text = bytes('montaji '.repeat(200));
  const packed = new Uint8Array(zlib.deflateRawSync(text));
  const blob = archive([entry('project.json', packed)]);
  const [e] = await PT.readZip(blob);
  assert.equal(e.method, 0);
  const got = new Uint8Array(await (await PT.zipData(blob, { ...e, method: 8 })).arrayBuffer());
  assert.deepEqual([...got], [...text]);
});

test('الملفات التالفة تُرفض برسالة واضحة', async () => {
  await assert.rejects(PT.readZip(new Blob([bytes('this is not a zip file at all')])), /ليس ملف مشروع/);
  await assert.rejects(PT.readZip(new Blob([])), /ليس ملف مشروع/);
  const good = new Uint8Array(await archive([entry('project.json', bytes('{}'))]).arrayBuffer());
  await assert.rejects(PT.readZip(new Blob([good.slice(0, good.length - 30)])), /ليس ملف مشروع/);
});

test('serialize يحفظ الملف المشترك مرة واحدة ويترك كائنات المتصفح', () => {
  const video = { name: 'رحلة.mp4', size: 10 }, song = { name: 'لحن.mp3', size: 5 }, photo = { name: 'a.jpg', size: 3 };
  const canvas = { getContext() {}, width: 4, height: 4 };
  const state = {
    name: 'رحلتي', ratio: '9:16', sel: { kind: 'clip', id: 'c1' },
    clips: [
      { id: 'c1', type: 'video', name: 'رحلة.mp4', file: video, el: {}, url: 'blob:x', thumb: 'data:x', w: 1920, h: 1080, srcDur: 30, in: 0, out: 5, speed: 1, volume: 1, muted: false, filter: 'warm', _start: 0 },
      { id: 'c2', type: 'video', name: 'رحلة.mp4', file: video, el: {}, url: 'blob:x', thumb: 'data:x', w: 1920, h: 1080, srcDur: 30, in: 5, out: 9, speed: 2, volume: 1, muted: true, pulse: true, _start: 5 },
      { id: 'c3', type: 'image', name: 'a.jpg', file: photo, el: canvas, srcDur: Infinity, in: 0, out: 4, speed: 1 },
    ],
    audios: [{ id: 'a1', name: 'لحن.mp3', file: song, el: {}, buf: {}, beats: {}, wave: 'data:x', srcDur: 60, start: 1, in: 2, out: 20, volume: 0.8, fadeIn: 0, fadeOut: 1.5, _lane: 0 }],
    texts: [{ id: 't1', text: 'أهلاً', start: 0, dur: 3, x: 0.5, y: 0.5, size: 0.1, color: '#ffffff', _box: {} }],
    effects: [{ id: 'e1', type: 'flash', start: 4.8, dur: 0.25, amount: 1, at: 'c2', atMode: 'cut', _lane: 0 }],
  };
  const { data, sources } = PT.serialize(state);
  assert.equal(sources.length, 3, 'الفيديو المقسوم يُحفظ ملفاً واحداً');
  assert.equal(data.clips[0].media, data.clips[1].media);
  assert.equal(sources[0].source, video);
  assert.equal(sources[1].source, canvas, 'الصورة المعدّلة تُحفظ من لوحتها');
  assert.equal(sources[1].edited, true);
  assert.match(sources[1].path, /^media\/2-a\.png$/);
  assert.equal(sources[2].source, song);
  assert.deepEqual(data.media.map(m => m.kind), ['video', 'image', 'audio']);
  assert.equal(data.app, 'montaji');
  assert.equal(data.name, 'رحلتي');
  const text = JSON.stringify(data);
  assert.doesNotMatch(text, /blob:|data:x|"_start"|"_lane"|"_box"|"srcDur"|"buf"|"sel"/);
  assert.equal(data.clips[1].pulse, true);
  assert.equal(data.effects[0].at, 'c2');

  // وما حُفظ يعود كما هو بعد الفحص
  const back = PT.normalize(JSON.parse(text));
  assert.equal(back.ratio, '9:16');
  assert.deepEqual(back.clips.map(c => [c.id, c.type, c.in, c.out, c.speed]), [['c1', 'video', 0, 5, 1], ['c2', 'video', 5, 9, 2], ['c3', 'image', 0, 4, 1]]);
  assert.equal(back.clips[0].filter, 'warm');
  assert.deepEqual(back.audios.map(a => [a.id, a.start, a.in, a.out, a.volume]), [['a1', 1, 2, 20, 0.8]]);
  assert.equal(back.texts[0].text, 'أهلاً');
  assert.equal(back.effects[0].at, 'c2');
  assert.equal(back.media.length, 3);
});

test('normalize يرفض ما ليس مشروعاً أو ما هو من إصدار أحدث', () => {
  assert.throws(() => PT.normalize(null), /ليس ملف مشروع/);
  assert.throws(() => PT.normalize({ app: 'other', version: 1 }), /ليس ملف مشروع/);
  assert.throws(() => PT.normalize({ app: 'montaji' }), /ليس ملف مشروع/);
  assert.throws(() => PT.normalize({ app: 'montaji', version: PT.VERSION + 1 }), /إصدار أحدث/);
  const empty = PT.normalize({ app: 'montaji', version: 1 });
  assert.deepEqual([empty.ratio, empty.clips.length, empty.media.length], ['16:9', 0, 0]);
});

test('normalize لا يمرّر نصوصاً تدخل في HTML الواجهة ولا قيماً خارج المدى', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const p = PT.normalize({
    app: 'montaji', version: 1, ratio: evil,
    media: [{ id: 'm1', kind: 'video', name: 'v.mp4', path: 'media/1-v.mp4' }, { id: evil, kind: 'image', name: 'x', path: 'p' }, { id: 'm3', kind: 'audio', name: 's.mp3', path: 'media/3-s.mp3' }],
    clips: [
      { id: evil, type: 'video', media: 'm1', name: evil, thumb: evil, url: evil, filter: evil, transition: evil, speed: 99, in: -5, out: 'x', bright: 1e9, extra: evil },
      { id: 'dup', type: 'video', media: 'm1' }, { id: 'dup', type: 'video', media: 'm1' },
      { id: 'c9', type: 'image', media: 'm1' }, { id: 'c8', type: 'video', media: 'missing' }, null, 'x',
    ],
    audios: [{ id: 'a1', media: 'm1' }, { id: 'a2', media: 'm3', volume: 5, fadeOut: -1 }],
    texts: [{ id: 't1', text: evil, color: evil, strokeColor: '#FFAA00', font: evil, anim: evil, size: 50, x: -3 }],
    effects: [{ id: 'e1', type: evil }, { id: 'e2', type: 'flash', at: 'ghost', dur: 0 }, { id: 'e3', type: 'bw', at: 'dup', atMode: 'clip' }],
  });
  assert.equal(p.ratio, '16:9');
  assert.equal(p.media.length, 2, 'وسيط بمعرّف غير صالح أو غير مستعمل يُهمل');
  assert.equal(p.clips.length, 3, 'مقطع بلا وسيط أو بنوع يخالف وسيطه يُهمل');
  const [c] = p.clips;
  assert.match(c.id, /^[A-Za-z0-9_-]+$/);
  assert.equal(c.name, evil, 'الاسم نص حر: تهرّبه الواجهة عند العرض');
  for (const k of ['thumb', 'url', 'filter', 'transition', 'extra', 'out']) assert.equal(c[k], undefined, k);
  assert.deepEqual([c.speed, c.in, c.bright], [4, 0, 150]);
  assert.equal(new Set(p.clips.map(x => x.id)).size, 3, 'المعرّفات المكررة تُستبدل');
  assert.deepEqual(p.audios.map(a => [a.id, a.volume, a.fadeOut, a.start]), [['a2', 1, 0, 0]]);
  const [t] = p.texts;
  assert.deepEqual([t.color, t.strokeColor, t.font, t.anim, t.size, t.x], ['#ffffff', '#ffaa00', 'segoe', 'fade', 0.22, 0]);
  assert.equal(t.text, evil);
  assert.deepEqual(p.effects.map(e => [e.id, e.type, e.at, e.dur]), [['e2', 'flash', null, 0.1], ['e3', 'bw', 'dup', 1]]);
  assert.doesNotMatch(JSON.stringify({ ...p, clips: p.clips.map(({ name, ...r }) => r), texts: p.texts.map(({ text, ...r }) => r) }), /onerror/);
});

test('أسماء الملفات تُنقّى من المسارات والرموز المحجوزة', () => {
  assert.equal(PT.entryName('..\\..\\evil/na:me?.mp4'), '-..-evil-name.mp4');
  assert.equal(PT.entryName(''), 'file');
  assert.equal(PT.fileName('رحلة الصيف'), 'رحلة الصيف.montaji');
  assert.equal(PT.fileName('trip.MONTAJI'), 'trip.montaji');
  assert.equal(PT.fileName('a/b\\c.'), 'a-b-c.montaji');
  assert.equal(PT.fileName(''), 'مشروع.montaji');
});
