'use strict';
/* الترجمة (Captions) — منطق بلا واجهة، يُختبر في Node.
   الكلمة: { w, t0, t1 } بالثواني. الكتلة: { id, start, end, text, words } على زمن المشروع. */

const CaptionTools = (() => {
  const MIN = 0.2;
  const BREAK = /[.!?…؟!،,;؛:]$/; // علامة ترقيم في آخر الكلمة: موضع جيد للقطع
  const HARD = /[.!?…؟]$/;
  const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;
  const newId = () => Math.random().toString(36).slice(2, 10);

  /** يزيل التشكيل: مخرجات محرّكات التفريغ فيه غير ثابتة */
  const stripDiacritics = s => String(s).replace(TASHKEEL, '');
  const tokens = text => String(text).split(/\s+/).filter(Boolean);
  const textOf = words => words.map(w => w.w).join(' ');

  /** يوزّع كلمات نص على مدى زمني بنسبة أطوالها (حين لا يعطي المحرّك توقيت الكلمات) */
  function spread(text, start, end) {
    const ws = tokens(text);
    const total = ws.reduce((n, w) => n + w.length + 1, 0);
    let t = start;
    return ws.map(w => {
      const d = (end - start) * (w.length + 1) / total, o = { w, t0: t, t1: t + d };
      t += d;
      return o;
    });
  }

  /** كلمات من جمل بلا توقيت كلمات */
  const wordsFromSegments = segments => segments.flatMap(s => spread(s.text, s.start, s.end));

  /**
   * يدمج نتائج أجزاء متداخلة من صوت طويل: chunks = [{ offset, start, end, words }]
   * حيث start و end مدى الجزء في الصوت الكامل، و words بزمن الجزء. في التداخل يؤخذ كل جزء حتى منتصفه.
   */
  function mergeChunks(chunks) {
    const out = [];
    chunks.forEach((c, i) => {
      const from = i ? (chunks[i - 1].end + c.start) / 2 : -Infinity;
      const to = i < chunks.length - 1 ? (c.end + chunks[i + 1].start) / 2 : Infinity;
      for (const w of c.words) {
        const t0 = w.t0 + c.start, mid = t0 + (w.t1 - w.t0) / 2;
        if (mid >= from && mid < to) out.push({ w: w.w, t0, t1: w.t1 + c.start });
      }
    });
    return out;
  }

  /**
   * يحوّل الكلمات إلى كتل قصيرة: يقطع عند علامات الترقيم والسكتات، وعند تجاوز حد الأحرف أو المدة.
   *   maxChars  أقصى عدد أحرف في الكتلة (الريلز العمودية تحتاج أقل)
   *   maxDur    أقصى مدة للكتلة بالثواني
   *   gap       سكتة تفصل كتلتين
   */
  function toItems(words, o = {}) {
    const maxChars = o.maxChars || 28, maxDur = o.maxDur || 4, gap = o.gap || 0.6;
    const list = words.filter(w => w && String(w.w).trim()).map(w => ({ w: o.keepDiacritics ? String(w.w).trim() : stripDiacritics(w.w).trim(), t0: +w.t0, t1: Math.max(+w.t1, +w.t0) }))
      .filter(w => w.w && isFinite(w.t0) && isFinite(w.t1)).sort((a, b) => a.t0 - b.t0);
    const items = [];
    let cur = [], chars = 0;
    const flush = () => { if (cur.length) items.push(cur); cur = []; chars = 0; };
    for (const w of list) {
      const last = cur[cur.length - 1];
      if (last) {
        const tooLong = chars + 1 + w.w.length > maxChars || w.t1 - cur[0].t0 > maxDur;
        const pause = w.t0 - last.t1 > gap;
        const soft = BREAK.test(last.w) && chars >= maxChars * 0.5;
        if (tooLong || pause || HARD.test(last.w) || soft) flush();
      }
      cur.push(w);
      chars += (cur.length > 1 ? 1 : 0) + w.w.length;
    }
    flush();
    const out = items.map(ws => ({ id: newId(), start: ws[0].t0, end: Math.max(ws[ws.length - 1].t1, ws[0].t0 + MIN), text: textOf(ws), words: ws }));
    // الكتلة تبقى ظاهرة قليلاً بعد آخر كلمة كي تُقرأ، دون أن تتداخل مع التالية
    out.forEach((it, i) => {
      const next = out[i + 1];
      it.end = next ? Math.min(Math.max(it.end + 0.15, it.start + MIN), Math.max(it.end, next.start)) : it.end + 0.15;
    });
    return out;
  }

  /** يغيّر مدى الكتلة: التحريك يزيح الكلمات، وسحب الحافة يمدّدها أو يضغطها خطّياً */
  function retime(it, start, end) {
    end = Math.max(end, start + MIN);
    const k = (end - start) / Math.max(1e-6, it.end - it.start);
    const words = it.words.map(w => ({ w: w.w, t0: start + (w.t0 - it.start) * k, t1: start + (w.t1 - it.start) * k }));
    return { ...it, start, end, words };
  }

  /** يغيّر نص الكتلة: إن بقي عدد الكلمات كما هو يُحفظ توقيتها، وإلا يُوزَّع على المدة */
  function setText(it, text) {
    text = String(text).replace(/\s+/g, ' ').trim();
    const ws = tokens(text);
    const words = ws.length === it.words.length ? it.words.map((w, i) => ({ ...w, w: ws[i] })) : spread(text, it.start, it.end);
    return { ...it, text, words };
  }

  /** يدمج كتلتين متتاليتين في واحدة */
  function merge(a, b) {
    const [x, y] = a.start <= b.start ? [a, b] : [b, a];
    return { id: x.id, start: x.start, end: Math.max(x.end, y.end), text: (x.text + ' ' + y.text).trim(), words: [...x.words, ...y.words] };
  }

  /** يقسم كتلة عند الزمن t (أو عند منتصف كلماتها): [الأولى، الثانية] أو null إن كانت كلمة واحدة */
  function splitAt(it, t) {
    const ws = it.words;
    if (ws.length < 2) return null;
    let n = ws.findIndex(w => w.t0 + (w.t1 - w.t0) / 2 >= t);
    if (!(t > it.start && t < it.end) || n <= 0) n = n === 0 ? 1 : Math.ceil(ws.length / 2);
    const A = ws.slice(0, n), B = ws.slice(n);
    const cut = Math.max(A[A.length - 1].t1, Math.min(B[0].t0, it.end - MIN));
    return [
      { id: it.id, start: it.start, end: Math.max(it.start + MIN, Math.min(cut, B[0].t0)), text: textOf(A), words: A },
      { id: newId(), start: B[0].t0, end: Math.max(it.end, B[0].t0 + MIN), text: textOf(B), words: B },
    ];
  }

  /** الكتلة الظاهرة عند الزمن t */
  const itemAt = (items, t) => items.find(it => t >= it.start && t < it.end) || null;

  /** رقم الكلمة المنطوقة عند الزمن t في الكتلة: آخر كلمة بدأت. -1 قبل أول كلمة */
  function wordAt(it, t) {
    let n = -1;
    for (let i = 0; i < it.words.length; i++) if (t >= it.words[i].t0) n = i; else break;
    return n;
  }

  /** يزيح كل الكتل زمنياً (تفريغ مقطع يبدأ في منتصف المشروع) ويحوّل سرعته */
  const place = (words, offset, rate = 1) => words.map(w => ({ w: w.w, t0: offset + w.t0 / rate, t1: offset + w.t1 / rate }));

  /* ================= SRT و VTT ================= */
  const pad = (n, k = 2) => String(n).padStart(k, '0');
  function stamp(t, sep) {
    const ms = Math.max(0, Math.round(t * 1000));
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
  }
  const sorted = items => [...items].filter(it => String(it.text).trim()).sort((a, b) => a.start - b.start);
  const line = it => String(it.text).replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();

  /** SubRip: الفاصلة قبل أجزاء الثانية، وترقيم يبدأ من 1 */
  const srt = items => sorted(items).map((it, i) => `${i + 1}\n${stamp(it.start, ',')} --> ${stamp(it.end, ',')}\n${line(it)}\n`).join('\n');
  /** WebVTT: ترويسة، ونقطة قبل أجزاء الثانية. «-->» داخل النص يفسد الملف فيُستبدل */
  const vtt = items => 'WEBVTT\n\n' + sorted(items).map(it => `${stamp(it.start, '.')} --> ${stamp(it.end, '.')}\n${line(it).replace(/-->/g, '→')}\n`).join('\n');

  return { MIN, stripDiacritics, spread, wordsFromSegments, mergeChunks, toItems, retime, setText, merge, splitAt, itemAt, wordAt, place, srt, vtt };
})();

if (typeof module !== 'undefined') module.exports = CaptionTools;
