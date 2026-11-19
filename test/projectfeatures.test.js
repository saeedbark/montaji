'use strict';
/* ملف المشروع مع الطبقات والترجمة والإطارات المفتاحية (public/js/projecttools.js): الحفظ ثم الفتح، ورفض القيم غير الآمنة */

const test = require('node:test');
const assert = require('node:assert/strict');

const PT = require('../public/js/projecttools.js');

const fileA = { name: 'a.mp4' }, fileB = { name: 'logo.png' }, fileM = { name: 'm.mp3' };
const project = () => ({
  name: 'تجربة', ratio: '9:16',
  clips: [{
    id: 'c1', type: 'video', name: 'a.mp4', file: fileA, el: {}, url: 'blob:x', in: 0, out: 5, speed: 1, volume: 1, muted: false,
    filter: 'none', bright: 100, contrast: 100, sat: 100, fit: 'blur', motion: 'none', transition: 'none', zoom: 1.5, panX: -0.2, opacity: 0.9,
    kf: { zoom: [{ t: 0, v: 1, e: 'smooth' }, { t: 3, v: 2, e: 'linear' }] },
  }],
  overlays: [
    { id: 'o1', type: 'image', name: 'logo.png', file: fileB, el: {}, start: 1, in: 0, out: 3, speed: 1, track: 2, x: 0.8, y: 0.2, scale: 0.15, rot: 12, opacity: 0.7,
      mask: 'circle', radius: 0.1, border: 0.01, borderColor: '#FFCC00', shadow: true, blend: 'screen', filter: 'warm', anim: 'pop', volume: 1, muted: true,
      _g: { cx: 1 }, kf: { x: [{ t: 0, v: 0.1, e: 'hold' }, { t: 2, v: 0.8, e: 'smooth' }] } },
    // الملف نفسه الذي في المسار الرئيسي: يُحفظ مرة واحدة
    { id: 'o2', type: 'video', name: 'a.mp4', file: fileA, el: {}, start: 0, in: 1, out: 4, speed: 2, track: 0, x: 0.5, y: 0.5, scale: 0.4, rot: 0, opacity: 1,
      mask: 'none', radius: 0.08, border: 0, borderColor: '#ffffff', shadow: false, blend: 'normal', filter: 'none', anim: 'none', volume: 0.5, muted: false },
  ],
  audios: [{ id: 'a1', name: 'm.mp3', file: fileM, el: {}, buf: {}, start: 0, in: 0, out: 30, volume: 0.8, fadeIn: 0, fadeOut: 1, kf: { volume: [{ t: 0, v: 0.8, e: 'smooth' }, { t: 2, v: 0.2, e: 'smooth' }] } }],
  texts: [{ id: 't1', text: 'عنوان', start: 0, dur: 3, x: 0.5, y: 0.5, size: 0.08, color: '#ffffff', font: 'segoe', bold: true, stroke: true, strokeColor: '#000000', bg: false, bgColor: '#000000', shadow: true, anim: 'fade', opacity: 0.5, rot: -10 }],
  effects: [{ id: 'e1', type: 'flash', start: 1, dur: 0.3, amount: 1, at: null, atMode: 'cut', x: 0.5, y: 0.5, r: 0.3, w: 0.4, h: 0.2, kf: { amount: [{ t: 0, v: 0, e: 'linear' }, { t: 0.2, v: 1, e: 'linear' }] } }],
  captions: {
    lang: 'ar', _box: { x0: 0 }, _cur: 'k1',
    style: { font: 'tahoma', size: 0.05, y: 0.7, color: '#ffffff', hl: '#00ff88', bg: false, bgColor: '#101010', outline: true, mode: 'pop' },
    items: [{ id: 'k1', start: 1, end: 2.5, text: 'مرحبا بكم', words: [{ w: 'مرحبا', t0: 1, t1: 1.6 }, { w: 'بكم', t0: 1.7, t1: 2.3 }] }],
  },
});

const roundTrip = st => PT.normalize(JSON.parse(JSON.stringify(PT.serialize(st).data)));

test('الطبقات والترجمة والإطارات تُحفظ وتعود كما هي', () => {
  const { data, sources } = PT.serialize(project());
  assert.equal(sources.length, 3, 'الملف المشترك بين مقطع وطبقة يُحفظ مرة واحدة');
  assert.equal(data.overlays[1].media, data.clips[0].media);
  assert.equal(data.overlays[0]._g, undefined, 'ما يحسبه الرسم لا يُحفظ');
  assert.equal(data.captions._box, undefined);

  const p = roundTrip(project());
  assert.equal(p.media.length, 3);
  const [o1, o2] = p.overlays;
  assert.deepEqual(
    { type: o1.type, start: o1.start, out: o1.out, track: o1.track, x: o1.x, y: o1.y, scale: o1.scale, rot: o1.rot, opacity: o1.opacity, mask: o1.mask, border: o1.border, borderColor: o1.borderColor, shadow: o1.shadow, blend: o1.blend, filter: o1.filter, anim: o1.anim },
    { type: 'image', start: 1, out: 3, track: 2, x: 0.8, y: 0.2, scale: 0.15, rot: 12, opacity: 0.7, mask: 'circle', border: 0.01, borderColor: '#ffcc00', shadow: true, blend: 'screen', filter: 'warm', anim: 'pop' },
  );
  assert.deepEqual(o1.kf, { x: [{ t: 0, v: 0.1, e: 'hold' }, { t: 2, v: 0.8, e: 'smooth' }] });
  assert.equal(o2.speed, 2); assert.equal(o2.volume, 0.5); assert.equal(o2.kf, undefined);

  const c = p.clips[0];
  assert.equal(c.zoom, 1.5); assert.equal(c.panX, -0.2); assert.equal(c.opacity, 0.9);
  assert.deepEqual(c.kf.zoom.map(k => k.v), [1, 2]);
  assert.deepEqual(Object.keys(p.audios[0].kf), ['volume']);
  assert.deepEqual(Object.keys(p.effects[0].kf), ['amount']);
  assert.equal(p.texts[0].opacity, 0.5); assert.equal(p.texts[0].rot, -10);

  assert.equal(p.captions.lang, 'ar');
  assert.deepEqual(p.captions.style, { font: 'tahoma', size: 0.05, y: 0.7, color: '#ffffff', hl: '#00ff88', bg: false, bgColor: '#101010', outline: true, mode: 'pop' });
  assert.deepEqual(p.captions.items, [{ id: 'k1', start: 1, end: 2.5, text: 'مرحبا بكم', words: [{ w: 'مرحبا', t0: 1, t1: 1.6 }, { w: 'بكم', t0: 1.7, t1: 2.3 }] }]);
});

test('مقاس مستطيل areaFlash و backlight يُحفظ ويعود (w و h ليسا أبعاد ملف هنا)', () => {
  const st = project();
  st.effects = [
    { id: 'e1', type: 'areaFlash', start: 2, dur: 0.35, amount: 1, at: null, atMode: 'cut', x: 0.5, y: 0.79, r: 0.3, w: 0.58, h: 0.1 },
    { id: 'e2', type: 'backlight', start: 3, dur: 0.5, amount: 1, at: null, atMode: 'cut', x: 0.5, y: 0.9, r: 0.3, w: 0.6, h: 0.12 },
  ];
  const p = roundTrip(st);
  assert.deepEqual(p.effects.map(e => [e.type, e.w, e.h]), [['areaFlash', 0.58, 0.1], ['backlight', 0.6, 0.12]]);
  // أبعاد ملفات المقاطع ما زالت لا تُحفظ
  st.clips[0].w = 1920; st.clips[0].h = 1080;
  const data = PT.serialize(st).data;
  assert.equal(data.clips[0].w, undefined); assert.equal(data.clips[0].h, undefined);
});

test('مشروع قديم بلا طبقات ولا ترجمة يُفتح بقيم افتراضية', () => {
  const p = PT.normalize({ app: 'montaji', version: 1, ratio: '16:9', clips: [], audios: [], texts: [], effects: [], media: [] });
  assert.deepEqual(p.overlays, []);
  assert.deepEqual(p.captions.items, []);
  assert.equal(p.captions.style.mode, 'word');
  assert.equal(p.captions.style.hl, '#ffd400');
});

test('normalize يرفض قيم الطبقات غير الآمنة أو الخارجة عن المدى', () => {
  const data = PT.serialize(project()).data;
  Object.assign(data.overlays[0], { borderColor: '"><img src=x onerror=alert(1)>', mask: 'star', blend: 'evil', track: 999.7, scale: 50, opacity: -3, x: 99, id: '<b>', filter: 'nope' });
  data.overlays.push({ ...data.overlays[1], id: 'o3', type: 'audio' });          // نوع غير مسموح
  data.overlays.push({ ...data.overlays[1], id: 'o4', media: 'm999' });           // وسيط غير موجود
  data.overlays.push({ ...data.overlays[1], id: 'o5', type: 'image' });           // لا يطابق نوع الوسيط
  const p = PT.normalize(data);
  assert.equal(p.overlays.length, 2);
  const o = p.overlays[0];
  assert.equal(o.borderColor, '#ffffff'); assert.equal(o.mask, 'none'); assert.equal(o.blend, 'normal'); assert.equal(o.filter, 'none');
  assert.equal(o.track, 20); assert.equal(o.scale, 3); assert.equal(o.opacity, 0); assert.equal(o.x, 1.5);
  assert.match(o.id, /^[A-Za-z0-9_-]{1,40}$/);
});

test('normalize ينقّي الإطارات المفتاحية: مفاتيح النوع فقط، أرقام ضمن المدى، مرتبة، وبحد أقصى', () => {
  const data = PT.serialize(project()).data;
  data.texts[0].kf = {
    x: [{ t: 3, v: 0.5, e: 'bounce' }, { t: 1, v: 99 }, { t: 'x', v: 0.2 }, { t: 2, v: '0.3' }, null, { t: -5, v: 0.1 }],
    zoom: [{ t: 0, v: 2 }],           // ليست من خصائص النص
    __proto__: [{ t: 0, v: 1 }],
    constructor: [{ t: 0, v: 1 }],
    opacity: 'nope',
    size: Array.from({ length: 500 }, (_, i) => ({ t: i, v: 0.05 })),
  };
  data.audios[0].kf = { volume: [{ t: 0, v: 7 }], x: [{ t: 0, v: 1 }] };
  data.clips[0].kf = 'bad';
  data.effects[0].kf = { amount: [] };
  const p = PT.normalize(data);
  const kf = p.texts[0].kf;
  assert.deepEqual(Object.keys(kf).sort(), ['size', 'x']);
  assert.deepEqual(kf.x, [{ t: 0, v: 0.1, e: 'smooth' }, { t: 1, v: 1.5, e: 'smooth' }, { t: 3, v: 0.5, e: 'smooth' }]);
  assert.equal(kf.size.length, 200);
  assert.deepEqual(p.audios[0].kf, { volume: [{ t: 0, v: 1, e: 'smooth' }] });
  assert.equal(p.clips[0].kf, undefined);
  assert.equal(p.effects[0].kf, undefined);
});

test('normalize ينقّي الترجمة: ألوان بصيغتها، كتل صالحة مرتبة، وكلمات داخل مدى كتلتها', () => {
  const data = PT.serialize(project()).data;
  data.captions = {
    lang: 'ar"><script>',
    style: { color: 'red', hl: 'javascript:alert(1)', bgColor: '#12345', mode: 'explode', font: 'comic', size: 9, y: -4, bg: 'yes' },
    items: [
      { id: 'z9', start: 5, end: 6, text: 'ثانية', words: [{ w: 'ثانية', t0: 1, t1: 99 }, { w: '', t0: 5, t1: 6 }, { w: 'x', t0: 'a', t1: 6 }, 'bad'] },
      { id: 'z1', start: 1, end: 2, text: 'أولى' },
      { id: 'bad1', start: 3, end: 3, text: 'بلا مدة' },
      { id: 'bad2', start: 4, end: 5, text: '   ' },
      { id: 'z1', start: 7, end: 8, text: 'معرّف مكرر' },
      { id: '<img>', start: 9, end: 10, text: 'x'.repeat(900) },
      null,
    ],
  };
  const p = PT.normalize(data);
  assert.equal(p.captions.lang, '');
  assert.deepEqual(p.captions.style, { font: 'segoe', size: 0.2, y: 0.05, color: '#ffffff', hl: '#ffd400', bg: true, bgColor: '#000000', outline: true, mode: 'word' });
  const items = p.captions.items;
  assert.deepEqual(items.map(it => it.text.slice(0, 12)), ['أولى', 'ثانية', 'معرّف مكرر', 'x'.repeat(12)]);
  assert.equal(new Set(items.map(it => it.id)).size, 4);
  for (const it of items) assert.match(it.id, /^[A-Za-z0-9_-]{1,40}$/);
  assert.deepEqual(items[0].words, []);
  assert.deepEqual(items[1].words, [{ w: 'ثانية', t0: 5, t1: 6 }]);
  assert.equal(items[3].text.length, 500);
});
