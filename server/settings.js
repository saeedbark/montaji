'use strict';
/* /api/settings/key — يحفظ مفتاح الذكاء الاصطناعي في ملف .env من داخل المحرر،
   فلا يحتاج المستخدم إلى فتح الملف بنفسه (وهو مخفي في ماك لأن اسمه يبدأ بنقطة).
   المفتاح يُكتب في .env فقط ولا يُعاد إلى المتصفح أبداً، حتى في رسائل الخطأ */

const fs = require('fs'), path = require('path');
const { ENV_FILE, ENV_TEMPLATE, PROVIDERS, parseEnv, modelsOf, choices, provider } = require('./config');
const { json, readBody } = require('./http');

// ما يمكن ضبطه من المحرر: اسم المتغيّر، وهل هو مزوّد للمحادثة (يُختار في AI_PROVIDER) أم للترجمة فقط
const KEY_TARGETS = {
  gemini:     { env: 'GEMINI_API_KEY', chat: true },
  openai:     { env: 'OPENAI_API_KEY', chat: true },
  anthropic:  { env: 'ANTHROPIC_API_KEY', chat: true },
  openrouter: { env: 'OPENROUTER_API_KEY', chat: true },
  groq:       { env: 'GROQ_API_KEY', chat: false },
};

// المفاتيح حروف ظاهرة بلا مسافات. هذا يمنع أيضاً كسر ملف .env بسطر جديد أو تعليق (#) أو علامات اقتباس
const KEY_RE = /^[A-Za-z0-9._\-:/+=]{8,400}$/;

/**
 * يضع القيم في نص ملف .env: يستبدل أول سطر غير معلّق لكل متغيّر، أو يضيفه في آخر الملف.
 * بقية الأسطر (التعليقات والمفاتيح الأخرى) تبقى كما هي، وكذلك نوع نهاية السطر.
 */
function setEnvValues(txt, vals) {
  const eol = /\r\n/.test(txt) ? '\r\n' : '\n';
  const lines = String(txt).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of Object.entries(vals)) {
    const re = new RegExp(`^\\s*${k}\\s*=`);
    const i = lines.findIndex(l => re.test(l));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  return lines.join(eol) + eol;
}

async function saveKey(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req, 10e3)); } catch (e) { return json(res, 400, { error: 'طلب غير صالح', error_en: 'Invalid request' }); }
  const target = KEY_TARGETS[body && body.provider];
  if (!target) return json(res, 400, { error: 'اختر مزوّداً من القائمة', error_en: 'Choose a provider from the list' });
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!KEY_RE.test(key)) return json(res, 400, { error: 'المفتاح غير صالح: انسخه كاملاً بلا مسافات', error_en: 'Invalid key: copy all of it, with no spaces' });

  let txt = '';
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch (e) {
    try { txt = fs.readFileSync(ENV_TEMPLATE, 'utf8'); } catch (e2) { /* لا قالب: ملف جديد */ }
  }
  const vals = { [target.env]: key };
  if (target.chat) {
    // المستخدم اختار هذا المزوّد صراحة، فيُفضَّل على أي مفتاح آخر في الملف.
    // نموذج مزوّد سابق لا يصلح للجديد، فيُفرَّغ AI_MODEL ليُستعمل النموذج الافتراضي
    const old = parseEnv(txt);
    vals.AI_PROVIDER = body.provider;
    if (old.AI_MODEL && (old.AI_PROVIDER || '') !== body.provider) vals.AI_MODEL = '';
  }

  // كتابة ذرّية: ملف مؤقت ثم إعادة تسمية، فلا يبقى .env نصف مكتوب إن انقطع شيء
  const tmp = path.join(path.dirname(ENV_FILE), `.env.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, setEnvValues(txt, vals), { mode: 0o600 });
    fs.renameSync(tmp, ENV_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* لم يُنشأ */ }
    return json(res, 500, { error: 'تعذّر حفظ ملف .env — تأكد من أن مجلد البرنامج قابل للكتابة', error_en: 'Could not save the .env file — make sure the app folder is writable' });
  }
  json(res, 200, { ok: true, provider: body.provider });
}

// أسماء النماذج: حروف ظاهرة بلا مسافات (gemini-3.6-flash، openai/gpt-5، llama3.2:3b…)
const MODEL_RE = /^[A-Za-z0-9._\-:/@]{1,120}$/;

/**
 * /api/settings/model — يضيف نموذجاً إلى قائمة نماذج المزوّد في .env (GEMINI_MODEL…) ليظهر في قائمة الاختيار.
 * النماذج الموجودة تبقى، فلا يختفي النموذج الحالي حين تُكتب القائمة أول مرة
 */
async function saveModel(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req, 10e3)); } catch (e) { return json(res, 400, { error: 'طلب غير صالح', error_en: 'Invalid request' }); }
  const id = body && body.provider, model = typeof (body && body.model) === 'string' ? body.model.trim().replace(/^models\//, '') : '';
  if (!KEY_TARGETS[id] || !KEY_TARGETS[id].chat) return json(res, 400, { error: 'اختر مزوّداً من القائمة', error_en: 'Choose a provider from the list' });
  if (!MODEL_RE.test(model)) return json(res, 400, { error: 'اسم النموذج غير صالح', error_en: 'Invalid model name' });
  let txt = '';
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch (e) { /* لا ملف بعد */ }
  const vals = parseEnv(txt), env = k => vals[k] || process.env[k] || '';
  const list = [...new Set([...modelsOf(env, id, false), model])].join(',');
  const tmp = path.join(path.dirname(ENV_FILE), `.env.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, setEnvValues(txt, { [id.toUpperCase() + '_MODEL']: list }), { mode: 0o600 });
    fs.renameSync(tmp, ENV_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* لم يُنشأ */ }
    return json(res, 500, { error: 'تعذّر حفظ ملف .env — تأكد من أن مجلد البرنامج قابل للكتابة', error_en: 'Could not save the .env file — make sure the app folder is writable' });
  }
  json(res, 200, { ok: true, provider: id, model });
}

/** نماذج المحادثة من قائمة المزوّد: تُستبعد نماذج الصور والصوت والتضمين، الأحدث أولاً */
function chatModels(id, ids) {
  const skip = /embed|tts|audio|image|imagen|veo|live|realtime|transcribe|moderation|whisper|dall-e|aqa|learnlm|search|computer-use|robotics|banana/i;
  let out = ids.map(x => String(x || '').replace(/^models\//, '')).filter(x => x && !skip.test(x));
  if (id === 'gemini') out = out.filter(x => /^gemini/i.test(x));
  if (id === 'openai') out = out.filter(x => /^(gpt|o\d|chatgpt)/i.test(x));
  return [...new Set(out)].sort((a, b) => b.localeCompare(a, 'en', { numeric: true })).slice(0, 80);
}

/**
 * /api/models?provider=gemini — النماذج المتاحة بمفتاح المزوّد الموجود في .env، لقائمة «جرّب نموذجاً آخر».
 * إن تعذّر جلبها تُعاد قائمة فارغة: الواجهة تقبل كتابة الاسم يدوياً
 */
async function listModels(req, res, params) {
  const id = params.get('provider') || '';
  const c = choices().find(o => o.provider === id);
  const p = c && provider(undefined, c);
  if (!p || p.error || !p.key) return json(res, 200, { models: [] });
  const headers = id === 'anthropic' ? { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' } : { Authorization: 'Bearer ' + p.key };
  try {
    const r = await fetch(p.base + '/models', { headers, signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    const ids = (Array.isArray(d.data) ? d.data : Array.isArray(d.models) ? d.models : []).map(m => m.id || m.name);
    json(res, 200, { models: r.ok ? chatModels(id, ids) : [] });
  } catch (e) { json(res, 200, { models: [] }); }
}

/**
 * يحذف مفتاح مزوّد من ملف .env (حين ينتهي رصيده أو يرفضه المزوّد)، فيعمل المساعد بالمفتاح التالي.
 * إن كان المزوّد الافتراضي يُفرَّغ AI_PROVIDER و AI_MODEL أيضاً. يعيد اسم المتغيّر المحذوف، أو '' إن لم يكن في الملف
 */
function removeKey(id) {
  const p = PROVIDERS[id];
  if (!p || !p.keys.length) return '';
  let txt;
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch (e) { return ''; }
  const old = parseEnv(txt);
  const name = p.keys.find(k => old[k]);
  if (!name) return '';
  const vals = { [name]: '' };
  if ((old.AI_PROVIDER || '').toLowerCase() === id) Object.assign(vals, { AI_PROVIDER: '', ...(old.AI_MODEL ? { AI_MODEL: '' } : {}) });
  const tmp = path.join(path.dirname(ENV_FILE), `.env.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, setEnvValues(txt, vals), { mode: 0o600 });
    fs.renameSync(tmp, ENV_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* لم يُنشأ */ }
    return '';
  }
  return name;
}

module.exports = { setEnvValues, saveKey, saveModel, listModels, chatModels, removeKey };
