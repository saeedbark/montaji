'use strict';
/* /api/settings/key — يحفظ مفتاح الذكاء الاصطناعي في ملف .env من داخل المحرر،
   فلا يحتاج المستخدم إلى فتح الملف بنفسه (وهو مخفي في ماك لأن اسمه يبدأ بنقطة).
   المفتاح يُكتب في .env فقط ولا يُعاد إلى المتصفح أبداً، حتى في رسائل الخطأ */

const fs = require('fs'), path = require('path');
const { ENV_FILE, ENV_TEMPLATE, parseEnv } = require('./config');
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
  try { body = JSON.parse(await readBody(req, 10e3)); } catch (e) { return json(res, 400, { error: 'طلب غير صالح' }); }
  const target = KEY_TARGETS[body && body.provider];
  if (!target) return json(res, 400, { error: 'اختر مزوّداً من القائمة' });
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!KEY_RE.test(key)) return json(res, 400, { error: 'المفتاح غير صالح: انسخه كاملاً بلا مسافات' });

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
    return json(res, 500, { error: 'تعذّر حفظ ملف .env — تأكد من أن مجلد البرنامج قابل للكتابة' });
  }
  json(res, 200, { ok: true, provider: body.provider });
}

module.exports = { KEY_TARGETS, setEnvValues, saveKey };
