'use strict';
/* /api/chat — وسيط بين لوحة المساعد ومزوّد الذكاء الاصطناعي.
   المفتاح يُضاف هنا من ملف .env، فلا يصل إلى المتصفح إطلاقاً.
   إن فشل المزوّد المختار (رصيد منتهٍ، مفتاح مرفوض، ازدحام، مهلة) يُجرَّب التالي ممن لهم مفتاح في .env،
   والمفتاح الذي انتهى رصيده أو رُفض يُحذف من .env ويُبلَّغ المستخدم ليضع غيره */

const { provider, choices } = require('./config');
const { removeKey } = require('./settings');
const { json, readBody } = require('./http');

// مهلة الطلب الواحد: نموذج عالق لا يُبقي المساعد ينتظر إلى الأبد. أقصر حين يوجد بديل يُجرَّب بعده
const TIMEOUT_WITH_FALLBACK = 100e3, TIMEOUT_LAST = 240e3;
const MAX_CANDIDATES = 4;

/**
 * نوع الفشل من رمز الحالة ونص الخطأ:
 *  dead  = المفتاح نفسه لا يصلح (رصيد منتهٍ أو مرفوض): يُحذف ويُتخطّى المزوّد كله
 *  next  = عابر أو يخص هذا النموذج (ازدحام، حد استخدام، نموذج غير متاح، مهلة): يُجرَّب البديل
 *  stop  = خطأ في الطلب نفسه: البديل لن يكون أحسن حالاً
 */
function failKind(status, detail = '') {
  if (status === 402 || status === 401) return 'dead';
  // Gemini يعيد 400 أو 403 لمفتاح غير صالح أو معطّل
  if (status === 403 || (status === 400 && /api[ _-]?key|API_KEY_INVALID|permission denied|billing/i.test(detail))) return 'dead';
  if (status === 404 || status === 408 || status === 429 || status >= 500 || !status) return 'next';
  return 'stop';
}

/** ترتيب المحاولة: المختار أولاً ثم بقية الخيارات (الافتراضي أولاً) بلا تكرار */
function candidates(first, list) {
  const out = first && !first.error ? [first] : [];
  for (const c of list) {
    if (out.length >= MAX_CANDIDATES) break;
    if (out.some(o => o.id === c.provider && o.model === c.model)) continue;
    const p = provider(undefined, { provider: c.provider, model: c.model });
    if (!p.error && p.id === c.provider && p.model === c.model) out.push(p);
  }
  return out;
}

/**
 * Gemini يشترط توقيع التفكير (thought_signature) على نداءات الأدوات السابقة في السجل.
 * إن كتبها مزوّد آخر قبل الانتقال إلى Gemini فلا توقيع لها، فيُوضع التوقيع الذي يقبله Gemini لسجل من نموذج آخر
 */
function forGemini(messages) {
  return messages.map(m => {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) return m;
    if (m.tool_calls.some(c => c.extra_content && c.extra_content.google && c.extra_content.google.thought_signature)) return m;
    const [c0, ...rest] = m.tool_calls;
    return { ...m, tool_calls: [{ ...c0, extra_content: { google: { thought_signature: 'skip_thought_signature_validator' } } }, ...rest] };
  });
}

/** رسالة الخطأ المعروضة للمستخدم لرمز حالة من المزوّد */
function hintOf(p, s) {
  return s === 401 || s === 403 ? [`مفتاح ${p.label} مرفوض`, `The ${p.label_en} key was rejected`]
    : s === 402 ? [`انتهى رصيد مفتاح ${p.label}`, `The ${p.label_en} key is out of credit`]
    : s === 404 ? [`النموذج «${p.model}» غير متاح — اختر نموذجاً آخر أو غيّر اسمه في ملف .env`, `The model “${p.model}” is not available — choose another one or change its name in the .env file`]
    : s === 408 ? [`${p.label} لم يرد في الوقت المحدد — أعد إرسال رسالتك`, `${p.label_en} did not answer in time — send your message again`]
    : s === 429 ? [`تجاوزت حد الاستخدام لدى ${p.label} — انتظر قليلاً أو أضف مفتاحاً آخر`, `Usage limit reached with ${p.label_en} — wait a little or add another key`]
    : s >= 500 ? [`${p.label} مزدحم الآن — أعد إرسال رسالتك بعد لحظات`, `${p.label_en} is busy right now — send your message again in a moment`]
    : [`خطأ من ${p.label} (${s})`, `Error from ${p.label_en} (${s})`];
}

/** طلب واحد إلى مزوّد واحد. يعيد { ok, message, usage } أو { status, detail, offline } */
async function ask(p, body, signal, timeout) {
  const payload = { model: p.model, messages: p.id === 'gemini' ? forGemini(body.messages) : body.messages };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;
  // نماذج OpenAI الحديثة ترفض max_tokens وتقبل max_completion_tokens
  if (p.maxTokens) payload[p.id === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = p.maxTokens;
  const headers = { 'Content-Type': 'application/json' };
  if (p.key) headers.Authorization = 'Bearer ' + p.key;

  let r, text;
  // انقطاع الاتصال في منتصف رد طويل عابر غالباً، وكذلك 5xx: نعيد المحاولة مرة واحدة قبل الانتقال إلى البديل
  for (let attempt = 0; ; attempt++) {
    // مهلة + إيقاف المستخدم في إشارة واحدة (AbortSignal.any غير موجود في Node 18)
    const both = new AbortController(), stop = () => both.abort();
    let late = false;
    const timer = setTimeout(() => { late = true; both.abort(); }, timeout);
    signal.addEventListener('abort', stop);
    try {
      r = await fetch(p.base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(payload), signal: both.signal });
      text = await r.text();
      if (r.status < 500 || attempt >= 1) break;
    } catch (e) {
      if (signal.aborted) throw e;
      if (late) {
        console.log(`  chat: ${p.label_en} / ${p.model} did not answer within ${timeout / 1000}s`);
        return { status: 408, detail: `No answer within ${timeout / 1000} s` };
      }
      const why = (e.cause && (e.cause.code || e.cause.message)) || e.message;
      console.log(`  chat: ${p.label_en} connection failed (attempt ${attempt + 1}): ${why}`);
      if (attempt >= 1) return { status: 0, offline: true, detail: why };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    }
    await new Promise(done => setTimeout(done, 1500));
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* رد غير متوقع */ }
  if (!r.ok) {
    const e = Array.isArray(data) ? data[0] && data[0].error : data && data.error;
    return { status: r.status, detail: (typeof e === 'string' ? e : e && e.message) || text.slice(0, 300) };
  }
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return { status: 502, detail: text.slice(0, 300) };
  return { ok: true, message, usage: data.usage || null };
}

async function chat(req, res) {
  const body = JSON.parse(await readBody(req, 48e6));
  // النموذج المختار من قائمة لوحة المساعد (إن وُجد)؛ provider يتجاهله إن لم يكن له مفتاح في .env
  const first = provider(undefined, body.choice);
  if (first.error) return json(res, 400, { error: first.error, error_en: first.error_en, setup: true });
  if (typeof fetch !== 'function') return json(res, 500, { error: 'الشات يحتاج Node.js بإصدار 18 أو أحدث', error_en: 'The chat needs Node.js 18 or later' });

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  const list = body.fallback === false ? [first] : candidates(first, choices());
  const dead = new Set(), removed = [], failed = [];
  let last = null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (dead.has(p.id)) continue;
    const more = list.slice(i + 1).some(o => !dead.has(o.id));
    let out;
    try { out = await ask(p, body, ctrl.signal, more ? TIMEOUT_WITH_FALLBACK : TIMEOUT_LAST); }
    catch (e) { if (ctrl.signal.aborted) return; throw e; }
    if (out.ok) {
      return json(res, 200, {
        message: out.message, usage: out.usage, model: p.model, provider: p.id, label: p.label,
        // ما حدث قبل النجاح: مفاتيح حُذفت، ومزوّد بديل أجاب بدل المختار
        ...(removed.length ? { removed } : {}),
        ...(p !== first ? { switched: { provider: p.id, model: p.model, label: p.label, label_en: p.label_en, from: first.label, from_en: first.label_en } } : {}),
      });
    }
    last = { p, ...out };
    const kind = out.offline ? 'next' : failKind(out.status, out.detail);
    failed.push(`${p.label_en} / ${p.model}: ${out.status || 'offline'}`);
    if (kind === 'dead') {
      dead.add(p.id);
      const env = removeKey(p.id);
      if (env) {
        removed.push({ provider: p.id, label: p.label, label_en: p.label_en, reason: out.status === 402 ? 'credit' : 'rejected' });
        console.log(`  chat: ${p.label_en} key ${out.status === 402 ? 'is out of credit' : 'was rejected'} — removed ${env} from .env`);
      }
    }
    if (kind === 'stop') break;
  }

  const p = last.p;
  if (last.offline && failed.length === 1) {
    return json(res, 502, {
      error: `تعذّر الاتصال بـ ${p.label} — تحقق من الإنترنت${p.id === 'ollama' ? ' ومن أن Ollama يعمل' : ''}.`,
      error_en: `Could not reach ${p.label_en} — check your internet connection${p.id === 'ollama' ? ' and that Ollama is running' : ''}.`,
      detail: last.detail, ...(removed.length ? { removed } : {}),
    });
  }
  const hint = hintOf(p, last.status);
  const tried = failed.length > 1 ? ` (${failed.join(' · ')})` : '';
  json(res, 502, { error: hint[0], error_en: hint[1], detail: (last.detail || '') + tried, ...(removed.length ? { removed } : {}), ...(removed.length && !choices().length ? { setup: true } : {}) });
}

module.exports = { chat, failKind, candidates, forGemini };
