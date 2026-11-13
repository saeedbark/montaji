'use strict';
/* /api/chat — وسيط بين لوحة المساعد ومزوّد الذكاء الاصطناعي.
   المفتاح يُضاف هنا من ملف .env، فلا يصل إلى المتصفح إطلاقاً */

const { provider } = require('./config');
const { json, readBody } = require('./http');

async function chat(req, res) {
  const body = JSON.parse(await readBody(req, 48e6));
  const p = provider();
  if (p.error) return json(res, 400, { error: p.error, setup: true });
  if (typeof fetch !== 'function') return json(res, 500, { error: 'الشات يحتاج Node.js بإصدار 18 أو أحدث' });

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  const payload = { model: p.model, messages: body.messages };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;
  const headers = { 'Content-Type': 'application/json' };
  if (p.key) headers.Authorization = 'Bearer ' + p.key;

  let r, text;
  try {
    // ازدحام المزوّد (5xx) عابر غالباً: نعيد المحاولة مرتين قبل إبلاغ المستخدم
    for (let attempt = 0; ; attempt++) {
      r = await fetch(p.base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      text = await r.text();
      if (r.status < 500 || attempt >= 2) break;
      await new Promise(done => setTimeout(done, 1500 * (attempt + 1)));
      if (ctrl.signal.aborted) return;
    }
  } catch (e) {
    if (ctrl.signal.aborted) return;
    return json(res, 502, { error: `تعذّر الاتصال بـ ${p.label} — تحقق من الإنترنت${p.id === 'ollama' ? ' ومن أن Ollama يعمل' : ''}.` });
  }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* رد غير متوقع */ }
  if (!r.ok) {
    const e = Array.isArray(data) ? data[0] && data[0].error : data && data.error;
    const detail = (typeof e === 'string' ? e : e && e.message) || text.slice(0, 300);
    const hint = r.status === 401 || r.status === 403 ? 'المفتاح مرفوض — تأكد من صحته في ملف .env'
      : r.status === 404 ? `النموذج «${p.model}» غير متاح — غيّر AI_MODEL في ملف .env`
      : r.status === 429 ? 'تجاوزت حد الاستخدام أو انتهى الرصيد لدى المزوّد'
      : r.status >= 500 ? `${p.label} مزدحم الآن — أعد إرسال رسالتك بعد لحظات`
      : `خطأ من ${p.label} (${r.status})`;
    return json(res, 502, { error: hint, detail });
  }
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return json(res, 502, { error: `رد غير مفهوم من ${p.label}`, detail: text.slice(0, 300) });
  json(res, 200, { message, usage: data.usage || null, model: p.model });
}

module.exports = { chat };
