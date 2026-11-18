'use strict';
/* /api/chat — وسيط بين لوحة المساعد ومزوّد الذكاء الاصطناعي.
   المفتاح يُضاف هنا من ملف .env، فلا يصل إلى المتصفح إطلاقاً */

const { provider } = require('./config');
const { json, readBody } = require('./http');

async function chat(req, res) {
  const body = JSON.parse(await readBody(req, 48e6));
  // النموذج المختار من قائمة لوحة المساعد (إن وُجد)؛ provider يتجاهله إن لم يكن له مفتاح في .env
  const p = provider(undefined, body.choice);
  if (p.error) return json(res, 400, { error: p.error, error_en: p.error_en, setup: true });
  if (typeof fetch !== 'function') return json(res, 500, { error: 'الشات يحتاج Node.js بإصدار 18 أو أحدث', error_en: 'The chat needs Node.js 18 or later' });

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  const payload = { model: p.model, messages: body.messages };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;
  // نماذج OpenAI الحديثة ترفض max_tokens وتقبل max_completion_tokens
  if (p.maxTokens) payload[p.id === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = p.maxTokens;
  const headers = { 'Content-Type': 'application/json' };
  if (p.key) headers.Authorization = 'Bearer ' + p.key;

  let r, text;
  // ازدحام المزوّد (5xx) وانقطاع الاتصال في منتصف رد طويل عابران غالباً: نعيد المحاولة مرتين قبل إبلاغ المستخدم
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(p.base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      text = await r.text();
      if (r.status < 500 || attempt >= 2) break;
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const why = (e.cause && (e.cause.code || e.cause.message)) || e.message;
      console.log(`  chat: ${p.label_en} connection failed (attempt ${attempt + 1}): ${why}`);
      if (attempt >= 2) {
        return json(res, 502, {
          error: `تعذّر الاتصال بـ ${p.label} — تحقق من الإنترنت${p.id === 'ollama' ? ' ومن أن Ollama يعمل' : ''}.`,
          error_en: `Could not reach ${p.label_en} — check your internet connection${p.id === 'ollama' ? ' and that Ollama is running' : ''}.`,
          detail: why,
        });
      }
    }
    await new Promise(done => setTimeout(done, 1500 * (attempt + 1)));
    if (ctrl.signal.aborted) return;
  }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* رد غير متوقع */ }
  if (!r.ok) {
    const e = Array.isArray(data) ? data[0] && data[0].error : data && data.error;
    const detail = (typeof e === 'string' ? e : e && e.message) || text.slice(0, 300);
    const s = r.status;
    const hint = s === 401 || s === 403 ? ['المفتاح مرفوض — تأكد من صحته في ملف .env', 'The key was rejected — check it in the .env file']
      : s === 402 ? ['الرصيد لدى المزوّد لا يكفي لهذا الطلب — اشحن الرصيد، أو ارفع حد المفتاح، أو اختر نموذجاً مجانياً أو أرخص', 'Not enough credit with the provider for this request — top up, raise the key limit, or choose a free or cheaper model']
      : s === 404 ? [`النموذج «${p.model}» غير متاح — اختر نموذجاً آخر أو غيّر اسمه في ملف .env`, `The model “${p.model}” is not available — choose another one or change its name in the .env file`]
      : s === 429 ? ['تجاوزت حد الاستخدام أو انتهى الرصيد لدى المزوّد', 'Usage limit reached or out of credit with the provider']
      : s >= 500 ? [`${p.label} مزدحم الآن — أعد إرسال رسالتك بعد لحظات`, `${p.label_en} is busy right now — send your message again in a moment`]
      : [`خطأ من ${p.label} (${s})`, `Error from ${p.label_en} (${s})`];
    return json(res, 502, { error: hint[0], error_en: hint[1], detail });
  }
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return json(res, 502, { error: `رد غير مفهوم من ${p.label}`, error_en: `Unreadable reply from ${p.label_en}`, detail: text.slice(0, 300) });
  json(res, 200, { message, usage: data.usage || null, model: p.model });
}

module.exports = { chat };
