'use strict';
/* اللون المميز للواجهة (public/js/theme.js): ثلاثة ألوان يدور بينها الزر، ولكل منها قاعدة في style.css */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const THEME = require('../public/js/theme.js');

test('ثلاثة ألوان، والوردي هو الافتراضي', () => {
  assert.deepEqual(THEME.ACCENTS.map(a => a.id), ['pink', 'amber', 'blue']);
  assert.equal(THEME.current, 'pink');
});

test('الزر يدور على الألوان ويرجع إلى الأول، والقيمة المجهولة تصير الافتراضي', () => {
  assert.equal(THEME.next('pink'), 'amber');
  assert.equal(THEME.next('amber'), 'blue');
  assert.equal(THEME.next('blue'), 'pink');
  assert.equal(THEME.valid('red'), 'pink');
  assert.equal(THEME.next(null), 'amber');
});

test('لكل لون غير الافتراضي قاعدة في style.css وفي سكربت رأس index.html', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const { id } of THEME.ACCENTS.slice(1)) {
    assert.match(css, new RegExp(`:root\\[data-accent="${id}"\\]\\s*\\{[^}]*--accent:`));
    assert.ok(html.includes(`a === '${id}'`), id);
  }
});

test('أيقونة التبويب: تُدار درجة الألوان المشبعة فقط، والداكن والشفاف يبقيان', () => {
  assert.equal(Math.round(THEME.hueOf('#ff5c7a')), 349);
  assert.equal(Math.round(THEME.hueOf('#3b82f6')), 217);
  const px = new Uint8ClampedArray([255, 92, 122, 255, /* داكن */ 20, 20, 24, 255, /* شفاف */ 255, 0, 0, 0]);
  THEME.recolor(px, THEME.hueOf('#3b82f6') - THEME.hueOf('#ff5c7a'));
  assert.ok(Math.abs(THEME.hueOf('#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('')) - 217) < 2, 'الوردي صار أزرق');
  assert.deepEqual([...px.slice(4)], [20, 20, 24, 255, 255, 0, 0, 0]);
});
