'use strict';
/* تعريفات الأدوات (public/js/tools.js) سليمة، ولكل أداة تنفيذ في public/js/agent.js */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOOLS = require('../public/js/tools.js');
const agentSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'agent.js'), 'utf8');

test('الأسماء فريدة وبصيغة snake_case', () => {
  const names = TOOLS.map(t => t.name);
  assert.equal(new Set(names).size, names.length, 'اسم أداة مكرر');
  for (const n of names) assert.match(n, /^[a-z][a-z0-9_]*$/);
});

test('كل أداة لها وصف ومخطط معاملات صالح', () => {
  for (const t of TOOLS) {
    assert.ok(t.description && t.description.length > 20, `${t.name}: الوصف قصير أو مفقود`);
    assert.equal(t.parameters.type, 'object', `${t.name}: parameters.type`);
    const props = t.parameters.properties || {};
    for (const [key, schema] of Object.entries(props)) {
      assert.ok(schema.type, `${t.name}.${key}: بلا type`);
      assert.ok(schema.description, `${t.name}.${key}: بلا description`);
    }
    for (const r of t.parameters.required || []) assert.ok(r in props, `${t.name}: الحقل المطلوب "${r}" غير معرّف`);
  }
});

test('كل أداة معرّفة لها تنفيذ في agent.js', () => {
  for (const t of TOOLS) {
    // دالة داخل الكائن impl: «name(args) {» أو «async name(args) {» أو «name: (args) =>»
    const impl = new RegExp(`^\\s+(async\\s+)?${t.name}\\s*[(:]`, 'm');
    assert.ok(impl.test(agentSrc), `${t.name}: معرّفة في tools.js بلا تنفيذ في agent.js`);
  }
});
