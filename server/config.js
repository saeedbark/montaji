'use strict';
/* الإعدادات: المسارات، المنفذ، قراءة ملف .env، واختيار مزوّد الذكاء الاصطناعي */

const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
// كل ما يُقدَّم للمتصفح يعيش في public/ فقط؛ الخادم وملف .env خارجه فلا يمكن طلبهما برابط
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = +process.env.PORT || 4747;
// MONTAJI_ENV_FILE يُستعمل في الاختبارات كي لا تُقرأ مفاتيح المطوّر الحقيقية
const ENV_FILE = process.env.MONTAJI_ENV_FILE || path.join(ROOT, '.env');
const ENV_TEMPLATE = path.join(ROOT, '.env.example');
// الفيديوهات التي يطلب المساعد حفظها (export_video مع save_as). MONTAJI_EXPORT_DIR للاختبارات
const EXPORT_DIR = process.env.MONTAJI_EXPORT_DIR || path.join(ROOT, 'exports');
const VERSION = require('../package.json').version;

/** يحوّل نص ملف .env إلى كائن { KEY: value } */
function parseEnv(txt) {
  const vals = {};
  for (const line of String(txt).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    vals[m[1]] = v;
  }
  return vals;
}

// يُقرأ الملف عند كل طلب، فتعديل المفتاح لا يحتاج إعادة تشغيل
function readEnv() {
  let txt = '';
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch (e) { /* لا ملف بعد */ }
  const vals = parseEnv(txt);
  return k => vals[k] || process.env[k] || '';
}

// كل المزوّدين يُخاطَبون بصيغة OpenAI Chat Completions (Gemini و Claude يوفّران نقطة متوافقة معها)
// لإضافة مزوّد جديد يكفي سطر هنا: المفاتيح التي يُبحث عنها، عنوان الواجهة، والنموذج الافتراضي
const PROVIDERS = {
  gemini:     { label: 'Google Gemini', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash' },
  openai:     { label: 'OpenAI', keys: ['OPENAI_API_KEY'], base: 'https://api.openai.com/v1', model: 'gpt-5.4-mini' },
  anthropic:  { label: 'Anthropic Claude', keys: ['ANTHROPIC_API_KEY'], base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  openrouter: { label: 'OpenRouter', keys: ['OPENROUTER_API_KEY'], base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  ollama:     { label: 'Ollama', keys: [], base: 'http://localhost:11434/v1', model: '' },
  custom:     { label: 'مزوّد مخصّص', keys: ['AI_API_KEY'], base: '', model: '' },
};

/** المزوّد الفعّال بحسب .env، أو { error } برسالة تُعرض للمستخدم */
function provider(env = readEnv()) {
  const keyOf = p => p.keys.map(env).find(Boolean) || '';
  let id = env('AI_PROVIDER').toLowerCase();
  if (id && !PROVIDERS[id]) return { error: `المزوّد «${id}» غير معروف. القيم المتاحة: ${Object.keys(PROVIDERS).join(' ، ')}` };
  if (!id) id = Object.keys(PROVIDERS).find(k => keyOf(PROVIDERS[k])) || (env('AI_BASE_URL') ? 'custom' : '');
  if (!id) return { error: 'لم يُضبط أي مفتاح بعد' };
  const p = PROVIDERS[id];
  const key = keyOf(p) || env('AI_API_KEY');
  const base = (env('AI_BASE_URL') || p.base).replace(/\/+$/, '');
  const model = env('AI_MODEL') || p.model;
  if (!key && id !== 'ollama' && id !== 'custom') return { error: `المفتاح ${p.keys[0]} فارغ في ملف .env` };
  if (!base) return { error: 'حدّد AI_BASE_URL في ملف .env' };
  if (!model) return { error: 'حدّد اسم النموذج AI_MODEL في ملف .env' };
  return { id, label: p.label, key, base, model, vision: !/^(off|false|0|no)$/i.test(env('AI_VISION')) };
}

/** ما يُسمح للمتصفح بمعرفته عن الإعدادات — بلا المفتاح أبداً */
function publicConfig() {
  const p = provider();
  const base = { envFile: '.env', mcp: `http://localhost:${PORT}/mcp` };
  return p.error ? { ...base, ready: false, error: p.error } : { ...base, ready: true, provider: p.id, label: p.label, model: p.model, vision: p.vision };
}

module.exports = { ROOT, PUBLIC_DIR, PORT, ENV_FILE, ENV_TEMPLATE, EXPORT_DIR, VERSION, PROVIDERS, parseEnv, readEnv, provider, publicConfig };
