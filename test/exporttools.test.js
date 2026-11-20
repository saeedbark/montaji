'use strict';
/* حساب معدّل البت وحجم الملف عند التصدير (public/js/exporttools.js) */

const test = require('node:test');
const assert = require('node:assert/strict');

const ExportTools = require('../public/js/exporttools.js');

const V1080 = { W: 1080, H: 1920 }, V720 = { W: 720, H: 1280 };
const sizes = [{ res: 720, ...V720 }, { res: 1080, ...V1080 }, { res: 1440, W: 1440, H: 2560 }, { res: 2160, W: 2160, H: 3840 }];

test('quality levels keep the old bitrates and add a smaller one', () => {
  const b = q => ExportTools.bitrateFor(1080, 1920, 30, q);
  assert.equal(b('high'), Math.round(1080 * 1920 * 30 * 0.2));
  assert.ok(b('small') < b('normal') && b('normal') < b('high') && b('high') < b('ultra'));
  assert.equal(ExportTools.bitrateFor(1080, 1920, 30, 'nonsense'), b('high'));
});

test('a set size lands on that size for a 3 minute video', () => {
  const p = ExportTools.plan({ ...V1080, fps: 30, duration: 180, quality: 'size', targetMB: 35 });
  assert.ok(Math.abs(p.mb - 35) < 0.01, `${p.mb} ≈ 35`);
  assert.equal(p.audio, 128000);
  assert.equal(p.clamped, false);
  // 1.47 م.ب/ث على 1080p قليل: الخطة تقول إن الصورة ستلين وتقترح 720p
  assert.equal(p.soft, true);
  assert.equal(ExportTools.sharperRes(sizes, 30, p.video, 1080), 720);
  assert.equal(p.gop, 150);
});

test('a size too small for the length is raised to the minimum', () => {
  const p = ExportTools.plan({ ...V1080, fps: 30, duration: 600, quality: 'size', targetMB: 5 });
  assert.equal(p.clamped, 'min');
  assert.equal(p.video, ExportTools.MIN_VIDEO);
  assert.ok(Math.abs(p.mb - p.minMB) < 1e-9);
  assert.ok(p.mb > 5);
});

test('a huge size is capped at the ultra bitrate', () => {
  const p = ExportTools.plan({ ...V720, fps: 30, duration: 10, quality: 'size', targetMB: 2000 });
  assert.equal(p.clamped, 'max');
  assert.equal(p.video, ExportTools.bitrateFor(720, 1280, 30, 'ultra'));
});

test('without audio the whole size goes to the picture', () => {
  const a = ExportTools.plan({ ...V1080, fps: 30, duration: 60, quality: 'size', targetMB: 20 });
  const b = ExportTools.plan({ ...V1080, fps: 30, duration: 60, quality: 'size', targetMB: 20, hasAudio: false });
  assert.equal(b.audio, 0);
  assert.equal(b.video - a.video, a.audio);
});

test('fixed levels: estimate, audio rate and keyframe spacing', () => {
  const high = ExportTools.plan({ ...V1080, fps: 30, duration: 60, quality: 'high' });
  assert.equal(high.audio, 192000);
  assert.equal(high.gop, 60);
  assert.equal(high.soft, false);
  const small = ExportTools.plan({ ...V1080, fps: 30, duration: 180, quality: 'small' });
  assert.equal(small.audio, 128000);
  assert.ok(small.mb < high.mb, "3 min compact is smaller than 1 min high");
});

test('sharper resolution: none below 720, the highest that stays sharp, else the lowest', () => {
  assert.equal(ExportTools.sharperRes(sizes, 30, 500000, 720), null);
  assert.equal(ExportTools.sharperRes(sizes, 30, 3000000, 2160), 1080);
  assert.equal(ExportTools.sharperRes(sizes, 30, 300000, 1440), 720);
});
