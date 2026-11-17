'use strict';
/* /api/transcribe — يحوّل ملف WAV (16 كيلوهرتز أحادي) إلى نص بتوقيت الكلمات.
   المفتاح يُضاف هنا من .env كما في /api/chat، فلا يصل إلى المتصفح.

   نوعان من المزوّدين:
   - whisper: واجهة OpenAI ‏/audio/transcriptions (OpenAI، Groq، أو خادم محلي مثل whisper.cpp و faster-whisper
     عبر STT_BASE_URL). تعيد توقيت كل كلمة.
   - chat: نموذج محادثة يسمع الصوت (Gemini). يعيد جملاً بتوقيت تقريبي، وتوقيت الكلمات يُوزَّع داخل الجملة. */

const { sttProvider } = require('./config');
const { json } = require('./http');

const MAX_BYTES = 26e6; // حد OpenAI 25 ميغابايت للملف؛ المحرر يقطّع الصوت الطويل قبل الإرسال

function readBytes(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('الملف الصوتي أكبر من المسموح'), { en: 'The audio file is too large' })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const cleanLang = v => (/^[a-z]{2,3}$/i.test(v || '') ? v.toLowerCase() : '');
const sec = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);

/** رد /audio/transcriptions بصيغة verbose_json ← { segments, words } بأرقام مفحوصة */
function fromWhisper(data) {
  const segments = [], words = [];
  for (const s of Array.isArray(data.segments) ? data.segments : []) {
    const a = sec(s.start), b = sec(s.end), text = String(s.text || '').trim();
    if (a != null && b != null && b > a && text) segments.push({ start: a, end: b, text });
  }
  for (const w of Array.isArray(data.words) ? data.words : []) {
    const a = sec(w.start), b = sec(w.end), text = String(w.word || '').trim();
    if (a != null && b != null && b >= a && text) words.push({ w: text, t0: a, t1: b });
  }
  if (!segments.length && !words.length && String(data.text || '').trim()) {
    segments.push({ start: 0, end: sec(data.duration) || 0, text: String(data.text).trim() });
  }
  return { segments, words, language: cleanLang(data.language) };
}

async function viaWhisper(p, wav, lang, signal) {
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  fd.append('model', p.model);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  if (lang) fd.append('language', lang);
  const headers = {};
  if (p.key) headers.Authorization = 'Bearer ' + p.key;
  const r = await fetch(p.base + '/audio/transcriptions', { method: 'POST', headers, body: fd, signal });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* رد غير متوقع */ }
  if (!r.ok || !data) return { status: r.status, detail: (data && data.error && (data.error.message || data.error)) || text.slice(0, 300) };
  return { result: fromWhisper(data) };
}

const CHAT_PROMPT = lang => 'Transcribe the speech in this audio' + (lang ? ` (language code: ${lang})` : ' in the language that is spoken')
  + '. Reply with ONLY a JSON array, no markdown, of short segments in order: [{"start": seconds, "end": seconds, "text": "..."}]. '
  + 'Each segment is one short phrase of at most 8 words. Times are seconds from the start of the audio with one decimal. '
  + 'Do not translate, do not add words that are not spoken, and return [] if there is no speech.';

/** يستخرج مصفوفة JSON من رد نموذج المحادثة (قد يحيطها بسياج markdown) */
function parseSegments(content) {
  const s = String(content || ''), a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  let list;
  try { list = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    const st = sec(+(x && x.start)), en = sec(+(x && x.end)), text = String((x && x.text) || '').trim();
    if (st != null && en != null && en > st && text) out.push({ start: st, end: en, text });
  }
  return out.sort((x, y) => x.start - y.start);
}

async function viaChat(p, wav, lang, signal) {
  const headers = { 'Content-Type': 'application/json' };
  if (p.key) headers.Authorization = 'Bearer ' + p.key;
  const body = {
    model: p.model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: CHAT_PROMPT(lang) },
      { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } },
    ] }],
  };
  const r = await fetch(p.base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* رد غير متوقع */ }
  if (!r.ok || !data) {
    const e = Array.isArray(data) ? data[0] && data[0].error : data && data.error;
    return { status: r.status, detail: (typeof e === 'string' ? e : e && e.message) || text.slice(0, 300) };
  }
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  const segments = parseSegments(msg && (typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('') : ''));
  if (!segments) return { status: 502, detail: 'the model did not return a JSON list of segments' };
  return { result: { segments, words: [], language: lang, approx: true } };
}

async function transcribe(req, res, query) {
  const p = sttProvider();
  if (p.error) return json(res, 400, { error: p.error, error_en: p.error_en, setup: true });
  if (!/^audio\/(wav|x-wav|wave)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'expected audio/wav' });
  if (+req.headers['content-length'] > MAX_BYTES) return json(res, 413, { error: 'الملف الصوتي أكبر من المسموح', error_en: 'The audio file is too large' });
  const wav = await readBytes(req, MAX_BYTES);
  if (wav.length < 44 || wav.toString('latin1', 0, 4) !== 'RIFF') return json(res, 400, { error: 'ملف WAV غير صالح', error_en: 'Invalid WAV file' });
  const lang = cleanLang(query.get('lang'));

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  let out;
  try {
    out = await (p.kind === 'chat' ? viaChat : viaWhisper)(p, wav, lang, ctrl.signal);
  } catch (e) {
    if (ctrl.signal.aborted) return;
    return json(res, 502, {
      error: `تعذّر الاتصال بخدمة التفريغ (${p.label}) — تحقق من الإنترنت أو من أن الخادم المحلي يعمل.`,
      error_en: `Could not reach the transcription service (${p.label_en}) — check your internet connection or that the local server is running.`,
    });
  }
  if (!out.result) {
    const s = out.status;
    const hint = s === 401 || s === 403 ? ['المفتاح مرفوض — تأكد من صحته في ملف .env', 'The key was rejected — check it in the .env file']
      : s === 404 ? [`النموذج «${p.model}» أو نقطة التفريغ غير متاحة لدى ${p.label} — راجع STT_MODEL و STT_BASE_URL في ملف .env`, `The model “${p.model}” or the transcription endpoint is not available at ${p.label_en} — check STT_MODEL and STT_BASE_URL in the .env file`]
      : s === 429 ? ['تجاوزت حد الاستخدام أو انتهى الرصيد لدى المزوّد', 'Usage limit reached or out of credit with the provider']
      : s >= 500 ? [`${p.label} مزدحم الآن — أعد المحاولة بعد لحظات`, `${p.label_en} is busy right now — try again in a moment`]
      : [`خطأ من ${p.label} (${s})`, `Error from ${p.label_en} (${s})`];
    return json(res, 502, { error: hint[0], error_en: hint[1], detail: String(out.detail || '').slice(0, 300) });
  }
  json(res, 200, { ...out.result, provider: p.id, model: p.model });
}

module.exports = { transcribe, fromWhisper, parseSegments };
