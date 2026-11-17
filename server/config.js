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
// ملفات المشاريع التي يطلب المساعد حفظها (save_project مع save_as). MONTAJI_PROJECT_DIR للاختبارات
const PROJECT_DIR = process.env.MONTAJI_PROJECT_DIR || path.join(ROOT, 'projects');
// أماكن اختيارية يقرأ منها الريمكس حين لا يُعطى مسار: المقطع المرجعي (مجلد «مرجع»، أو فيديو موضوع في مجلد التطبيق نفسه)،
// ووسائط المستخدم الخام (مجلد «خام»). الاسم العربي أو الإنجليزي؛ MONTAJI_REF_DIR و MONTAJI_RAW_DIR للاختبارات أو لمجلد في مكان آخر
const REF_DIRS = process.env.MONTAJI_REF_DIR ? [process.env.MONTAJI_REF_DIR] : [path.join(ROOT, 'مرجع'), path.join(ROOT, 'reference'), ROOT];
const RAW_DIRS = process.env.MONTAJI_RAW_DIR ? [process.env.MONTAJI_RAW_DIR] : [path.join(ROOT, 'خام'), path.join(ROOT, 'raw')];
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
  custom:     { label: 'مزوّد مخصّص', label_en: 'Custom provider', keys: ['AI_API_KEY'], base: '', model: '' },
};

const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const keyOf = (env, p) => p.keys.map(env).find(Boolean) || '';

/** المزوّد الافتراضي: AI_PROVIDER، وإلا أول مزوّد له مفتاح. '' إن لم يوجد، أو { error } لاسم غير معروف */
function defaultId(env) {
  const id = env('AI_PROVIDER').toLowerCase();
  if (id && !PROVIDERS[id]) return { error: `المزوّد «${id}» غير معروف. القيم المتاحة: ${Object.keys(PROVIDERS).join(' ، ')}`, error_en: `Unknown provider “${id}”. Available values: ${Object.keys(PROVIDERS).join(', ')}` };
  return id || Object.keys(PROVIDERS).find(k => keyOf(env, PROVIDERS[k])) || (env('AI_BASE_URL') ? 'custom' : '');
}

/** نماذج مزوّد: GEMINI_MODEL (قائمة مفصولة بفواصل)، ومعها AI_MODEL للمزوّد الافتراضي، وإلا نموذجه الافتراضي */
function modelsOf(env, id, isDefault) {
  const own = list(env(id.toUpperCase() + '_MODEL'));
  const all = [...new Set([...(isDefault ? list(env('AI_MODEL')) : []), ...own])];
  return all.length ? all : PROVIDERS[id].model ? [PROVIDERS[id].model] : [];
}

/** إعداد مزوّد بعينه. AI_BASE_URL و AI_API_KEY يخصّان المزوّد الافتراضي (أو المخصّص) فقط */
function resolve(env, id, model, isDefault) {
  const p = PROVIDERS[id];
  const shared = isDefault || id === 'custom';
  const key = keyOf(env, p) || (shared ? env('AI_API_KEY') : '');
  const base = ((shared && env('AI_BASE_URL')) || p.base).replace(/\/+$/, '');
  model = model || modelsOf(env, id, isDefault)[0] || '';
  if (!key && id !== 'ollama' && id !== 'custom') return { error: `المفتاح ${p.keys[0]} فارغ في ملف .env`, error_en: `The key ${p.keys[0]} is empty in the .env file` };
  if (!base) return { error: 'حدّد AI_BASE_URL في ملف .env', error_en: 'Set AI_BASE_URL in the .env file' };
  if (!model) return { error: 'حدّد اسم النموذج AI_MODEL في ملف .env', error_en: 'Set the model name AI_MODEL in the .env file' };
  return { id, label: p.label, label_en: p.label_en || p.label, key, base, model, vision: !/^(off|false|0|no)$/i.test(env('AI_VISION')) };
}

/**
 * كل ما يمكن اختياره من قائمة النموذج في لوحة المساعد: كل مزوّد له مفتاح في .env، بكل نماذجه.
 * [{ provider, label, model, default }] — الافتراضي أولاً، بلا مفاتيح
 */
function choices(env = readEnv()) {
  const def = defaultId(env);
  if (!def || def.error) return [];
  const out = [];
  for (const id of [def, ...Object.keys(PROVIDERS).filter(k => k !== def)]) {
    const isDefault = id === def;
    // Ollama والمخصّص لا مفتاح لهما: يظهران حين يكونان الافتراضي، أو Ollama حين يُسمّى له نموذج
    const usable = isDefault || (id === 'ollama' ? !!env('OLLAMA_MODEL') : id !== 'custom' && !!keyOf(env, PROVIDERS[id]));
    if (!usable || resolve(env, id, null, isDefault).error) continue;
    modelsOf(env, id, isDefault).forEach((model, i) => out.push({ provider: id, label: PROVIDERS[id].label, label_en: PROVIDERS[id].label_en || PROVIDERS[id].label, model, default: isDefault && i === 0 }));
  }
  return out;
}

/**
 * المزوّد الفعّال بحسب .env، أو { error } برسالة تُعرض للمستخدم.
 * choice = { provider, model } من قائمة لوحة المساعد؛ يُقبل فقط إن كان بين choices()، وإلا يُستعمل الافتراضي
 */
function provider(env = readEnv(), choice = null) {
  const id = defaultId(env);
  if (id && id.error) return id;
  if (!id) return { error: 'لم يُضبط أي مفتاح بعد', error_en: 'No key has been set yet', code: 'no_key' };
  if (choice && choice.provider) {
    const c = choices(env).find(o => o.provider === choice.provider && o.model === choice.model);
    if (c) return resolve(env, c.provider, c.model, c.provider === id);
  }
  return resolve(env, id, null, true);
}

// خدمات تفريغ الكلام للترجمة التلقائية. whisper = واجهة ‎/audio/transcriptions‎ (توقيت لكل كلمة)،
// chat = نموذج محادثة يسمع الصوت (توقيت تقريبي للجمل). الترتيب هو ترتيب الاختيار التلقائي.
const STT_PROVIDERS = {
  openai: { label: 'OpenAI Whisper', kind: 'whisper', keys: ['OPENAI_API_KEY'], base: 'https://api.openai.com/v1', model: 'whisper-1' },
  groq:   { label: 'Groq Whisper', kind: 'whisper', keys: ['GROQ_API_KEY'], base: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' },
  gemini: { label: 'Google Gemini', kind: 'chat', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash' },
  custom: { label: 'خادم تفريغ مخصّص', label_en: 'Custom transcription server', kind: 'whisper', keys: ['STT_API_KEY'], base: '', model: 'whisper-1' },
};

/** خدمة التفريغ الفعّالة بحسب .env، أو { error } برسالة تُعرض للمستخدم */
function sttProvider(env = readEnv()) {
  const keyOf = p => p.keys.map(env).find(Boolean) || '';
  let id = env('STT_PROVIDER').toLowerCase();
  if (id && !STT_PROVIDERS[id]) return { error: `خدمة التفريغ «${id}» غير معروفة. القيم المتاحة: ${Object.keys(STT_PROVIDERS).join(' ، ')}`, error_en: `Unknown transcription service “${id}”. Available values: ${Object.keys(STT_PROVIDERS).join(', ')}` };
  // عنوان مخصّص (whisper.cpp أو faster-whisper على جهازك) يتقدّم على المفاتيح: الصوت لا يغادر الجهاز
  if (!id) id = env('STT_BASE_URL') ? 'custom' : Object.keys(STT_PROVIDERS).find(k => keyOf(STT_PROVIDERS[k])) || '';
  if (!id) return { error: 'الترجمة التلقائية تحتاج مفتاح OpenAI أو Groq أو Gemini في ملف .env، أو خادم Whisper محلياً عبر STT_BASE_URL', error_en: 'Auto captions need an OpenAI, Groq or Gemini key in the .env file, or a local Whisper server set in STT_BASE_URL', code: 'no_key' };
  const p = STT_PROVIDERS[id];
  const key = keyOf(p) || env('STT_API_KEY');
  const base = (env('STT_BASE_URL') || p.base).replace(/\/+$/, '');
  if (!key && id !== 'custom') return { error: `المفتاح ${p.keys[0]} فارغ في ملف .env`, error_en: `The key ${p.keys[0]} is empty in the .env file` };
  if (!base) return { error: 'حدّد STT_BASE_URL في ملف .env', error_en: 'Set STT_BASE_URL in the .env file' };
  return { id, label: p.label, label_en: p.label_en || p.label, kind: p.kind, key, base, model: env('STT_MODEL') || p.model };
}

/** ما يُسمح للمتصفح بمعرفته عن الإعدادات — بلا المفتاح أبداً */
function publicConfig() {
  const p = provider(), s = sttProvider();
  const stt = s.error ? { ready: false, error: s.error, error_en: s.error_en, code: s.code } : { ready: true, provider: s.id, label: s.label, label_en: s.label_en, model: s.model, words: s.kind === 'whisper', local: /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(s.base + '/') };
  const base = { envFile: '.env', mcp: `http://localhost:${PORT}/mcp`, stt };
  return p.error ? { ...base, ready: false, error: p.error, error_en: p.error_en, code: p.code }
    : { ...base, ready: true, provider: p.id, label: p.label, label_en: p.label_en, model: p.model, vision: p.vision, choices: choices() };
}

module.exports = { ROOT, PUBLIC_DIR, PORT, ENV_FILE, ENV_TEMPLATE, EXPORT_DIR, PROJECT_DIR, REF_DIRS, RAW_DIRS, VERSION, PROVIDERS, STT_PROVIDERS, parseEnv, provider, choices, sttProvider, publicConfig };
