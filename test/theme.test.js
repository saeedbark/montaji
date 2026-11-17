'use strict';
/* اللون المميز للواجهة (public/js/theme.js): ثلاثة ألوان يدور بينها الزر، ولكل منها قاعدة في style.css */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const THEME = require('../public/js/theme.js');

test('ثلاثة ألوان، والوردي هو الافتراضي', () => {
  assert.deepEqual(THEME.ACCENTS.map(a => a.id), ['pink', 'violet', 'green']);
  assert.equal(THEME.current, 'pink');
});

test('الزر يدور على الألوان ويرجع إلى الأول، والقيمة المجهولة تصير الافتراضي', () => {
  assert.equal(THEME.next('pink'), 'violet');
  assert.equal(THEME.next('violet'), 'green');
  assert.equal(THEME.next('green'), 'pink');
  assert.equal(THEME.valid('red'), 'pink');
  assert.equal(THEME.next(null), 'violet');
});

test('لكل لون غير الافتراضي قاعدة في style.css وفي سكربت رأس index.html', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const { id } of THEME.ACCENTS.slice(1)) {
    assert.match(css, new RegExp(`:root\\[data-accent="${id}"\\]\\s*\\{[^}]*--accent:`));
    assert.ok(html.includes(`a === '${id}'`), id);
  }
});
