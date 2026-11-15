'use strict';
/* الترجمة التلقائية — نافذة التفريغ، وتحويل صوت المشروع إلى كتل ترجمة عبر /api/transcribe، وتصدير SRT/VTT.
   المنطق الحسابي في captiontools.js، والرسم في render.js (drawCaptions). */

const Captions = (() => {
  const S = window.studio;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const modal = $('#capModal'), body = $('#capBody');
  const LANGS = [['', 'تلقائي (يكتشفها المحرّك)'], ['ar', 'العربية'], ['en', 'الإنجليزية'], ['fr', 'الفرنسية'], ['es', 'الإسبانية'], ['tr', 'التركية'],
    ['de', 'الألمانية'], ['ur', 'الأردية'], ['fa', 'الفارسية'], ['id', 'الإندونيسية']];
  let abort = null, lastLang = 'ar';

  const isOpen = () => !modal.hidden;
  const fail = (msg, extra) => { throw Object.assign(new Error(msg), extra || {}); };

  /** إعدادات خدمة التفريغ كما يعرضها الخادم (بلا المفتاح) */
  async function config() {
    try { return (await (await fetch('/api/config')).json()).stt || { ready: false, error: 'تعذّر قراءة الإعدادات' }; }
    catch (e) { return { ready: false, error: 'تعذّر الاتصال بالخادم المحلي' }; }
  }

  /** العنصر الذي يصلح مصدراً للتفريغ (فيديو في المسار الرئيسي أو طبقة، أو صوت)، أو null */
  function speechItem(id) {
    for (const kind of ['clip', 'overlay', 'audio']) {
      const obj = S.listOf(kind).find(o => o.id === id);
      if (obj && (kind === 'audio' || obj.type === 'video')) return { kind, obj };
    }
    return null;
  }

  /**
   * صوت المصدر: { buf, start, end, at, rate } — [start, end] بثواني buf، وزمن المشروع = at + (ثانية المصدر - start) / rate.
   * بلا id: صوت المشروع كله كما يُسمع (المزج نفسه الذي يستعمله التصدير).
   */
  async function source(id) {
    layout();
    if (id) {
      const hit = speechItem(id) || fail('هذا العنصر ليس فيديو ولا صوتاً');
      const { kind, obj } = hit;
      if (kind === 'audio') return { buf: obj.buf, start: obj.in, end: obj.out, at: obj.start, rate: 1 };
      let buf;
      try { buf = await decodeAudioFile(obj.file); } catch (e) { fail('هذا الفيديو بلا صوت'); }
      return { buf, start: obj.in, end: Math.min(obj.out, buf.duration), at: kind === 'clip' ? obj._start : obj.start, rate: obj.speed || 1 };
    }
    if (view.total <= 0) fail('المشروع فارغ');
    const buf = await Exporter.mixAudio(view.total);
    if (!buf) fail('لا صوت في المشروع: أضف فيديو فيه كلام أو تسجيلاً صوتياً');
    return { buf, start: 0, end: buf.duration, at: 0, rate: 1 };
  }

  /**
   * يفرّغ الكلام ويضع كتل الترجمة في المشروع (مكان أي ترجمة سابقة في المدى نفسه).
   *   id     مقطع فيديو أو طبقة فيديو أو صوت؛ وبدونه صوت المشروع كله
   *   lang   رمز اللغة (ar, en…) أو فارغ للاكتشاف التلقائي
   * ← { count, approx, language, start, end }. لا يسجّل في سجل التراجع: ذلك على المستدعي.
   */
  async function transcribe({ id, lang = '', maxChars, signal, onProgress } = {}) {
    const say = (p, msg) => onProgress && onProgress(p, msg);
    say(0, 'جارٍ تجهيز الصوت…');
    const src = await source(id);
    const dur = src.end - src.start;
    if (!(dur >= 0.3)) fail('المقطع أقصر من أن يُفرَّغ');
    const chunks = AudioTools.sttChunks(dur), parts = [];
    let approx = false, language = '';
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      say(0.05 + 0.9 * i / chunks.length, chunks.length > 1 ? `جارٍ التفريغ… الجزء ${i + 1} من ${chunks.length}` : 'جارٍ التفريغ… قد يستغرق دقيقة');
      const wav = AudioTools.wav(AudioTools.toMono16k(src.buf, src.start + ch.start, src.start + ch.end));
      let r, j;
      try {
        r = await fetch('/api/transcribe' + (lang ? '?lang=' + encodeURIComponent(lang) : ''), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal });
        j = await r.json().catch(() => ({}));
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        fail('تعذّر الاتصال بالخادم المحلي');
      }
      if (!r.ok) fail(j.error || `HTTP ${r.status}`, { detail: j.detail, setup: !!j.setup });
      const timed = Array.isArray(j.words) && j.words.length > 0;
      parts.push({ start: ch.start, end: ch.end, words: timed ? j.words : CaptionTools.wordsFromSegments(j.segments || []) });
      approx = approx || !timed || !!j.approx;
      language = language || j.language || '';
    }
    const words = CaptionTools.place(CaptionTools.mergeChunks(parts), src.at, src.rate);
    if (!words.length) fail('لم يُعثر على كلام في هذا الصوت');
    // الإطار العمودي يتسع لأحرف أقل في السطر
    const narrow = state.ratio === '9:16' || state.ratio === '4:5';
    const items = CaptionTools.toItems(words, { maxChars: maxChars || (narrow ? 22 : 32) });
    const a = src.at, b = src.at + dur / src.rate;
    const keep = state.captions.items.filter(it => it.end <= a + 0.01 || it.start >= b - 0.01);
    const all = [...keep, ...items].sort((x, y) => x.start - y.start);
    all.forEach((it, i) => { // كتلة واحدة على الشاشة في كل لحظة
      const next = all[i + 1];
      if (next && it.end > next.start) Object.assign(it, CaptionTools.retime(it, it.start, Math.max(it.start + CaptionTools.MIN, next.start)));
    });
    state.captions.items = all;
    state.captions.lang = lang || language || state.captions.lang || '';
    say(1, 'تم');
    return { count: items.length, first: items[0].id, approx, language: state.captions.lang, start: a, end: b };
  }

  /* ================= التصدير ================= */
  /** نص ملف الترجمة ومعلوماته، أو خطأ إن لم توجد ترجمة */
  function fileOf(format) {
    const fmt = format === 'vtt' ? 'vtt' : 'srt';
    if (!state.captions.items.length) fail('لا توجد ترجمة بعد');
    const text = fmt === 'vtt' ? CaptionTools.vtt(state.captions.items) : CaptionTools.srt(state.captions.items);
    const base = (state.name || 'montaji').replace(/\.montaji$/i, '').replace(/[\\/:*?"<>|]/g, '-') || 'montaji';
    // علامة BOM في SRT: مشغّلات ويندوز تقرأ بها العربية UTF-8 صحيحاً
    return { text, name: `${base}.${fmt}`, blob: new Blob([fmt === 'srt' ? '﻿' : '', text], { type: 'text/plain;charset=utf-8' }), format: fmt };
  }

  /** ينزّل ملف الترجمة (زر الواجهة) */
  function exportFile(format) {
    let f;
    try { f = fileOf(format); } catch (e) { return S.toast(e.message, 'err'); }
    ImageTools.download(f.blob, f.name);
    S.toast(`نُزّل ملف الترجمة ${f.name}`, 'ok');
  }

  /* ================= النافذة ================= */
  function close() {
    if (abort) return; // التفريغ جارٍ
    modal.hidden = true;
  }

  async function open() {
    if (view.exporting) return S.toast('انتظر انتهاء التصدير أولاً', 'err');
    layout();
    S.pause();
    modal.hidden = false;
    body.innerHTML = '<p class="cap-note">جارٍ قراءة الإعدادات…</p>';
    const cfg = await config();
    if (!cfg.ready) {
      body.innerHTML = `<p class="cap-error">${esc(cfg.error)}</p>
        <p class="cap-note">افتح ملف <b dir="ltr">.env</b> في مجلد مونتاجي وضع أحد هذه المفاتيح ثم أعد المحاولة (لا حاجة لإعادة التشغيل):<br>
        <b dir="ltr">GROQ_API_KEY</b> (مجاني وجيد في العربية) · <b dir="ltr">OPENAI_API_KEY</b> · <b dir="ltr">GEMINI_API_KEY</b><br>
        أو شغّل Whisper على جهازك وضع عنوانه في <b dir="ltr">STT_BASE_URL</b> فلا يغادر الصوت الجهاز.</p>
        <div class="dialog-actions"><button class="btn" data-act="close">إغلاق</button></div>`;
      return;
    }
    const sel = state.sel && speechItem(state.sel.id);
    const name = sel ? sel.obj.name : '';
    const has = state.captions.items.length;
    body.innerHTML = `
      <label class="row"><span>المصدر</span><select id="capSrc">
        <option value="">صوت المشروع كله</option>
        ${sel ? `<option value="${sel.obj.id}" selected>${sel.kind === 'audio' ? 'الصوت المحدد' : 'الفيديو المحدد'}: ${esc(name.slice(0, 40))}</option>` : ''}
      </select></label>
      <label class="row"><span>لغة الكلام</span><select id="capLang">${LANGS.map(([v, l]) => `<option value="${v}"${v === lastLang ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="cap-note">المحرّك: <b>${esc(cfg.label)}</b> <span dir="ltr">(${esc(cfg.model)})</span>.
        ${cfg.local ? 'يعمل على جهازك: الصوت لا يغادره.' : 'سيُرسل صوت المشروع إلى هذا المزوّد لتفريغه.'}
        ${cfg.words ? '' : '<br>هذا المحرّك يعطي توقيت الجمل لا الكلمات، فتمييز الكلمة المنطوقة تقريبي. للتوقيت الدقيق استعمل Groq أو OpenAI.'}
        ${has ? '<br>الترجمة الموجودة في المدى نفسه ستُستبدل (التراجع يعيدها).' : ''}</p>
      <div id="capProg" hidden>
        <div class="bar"><div class="bar-fill" id="capBar"></div></div>
        <div class="ex-status"><span id="capStatus"></span></div>
      </div>
      <p class="cap-error" id="capErr" hidden></p>
      <div class="dialog-actions">
        <button class="btn" data-act="close">إلغاء</button>
        <button class="btn primary" data-act="start">ابدأ التفريغ</button>
      </div>`;
  }

  async function start() {
    const id = $('#capSrc').value || null, lang = $('#capLang').value;
    lastLang = lang;
    const prog = $('#capProg'), err = $('#capErr'), btn = body.querySelector('[data-act="start"]');
    prog.hidden = false; err.hidden = true; btn.disabled = true;
    abort = new AbortController();
    try {
      const r = await transcribe({
        id, lang, signal: abort.signal,
        onProgress: (p, msg) => { $('#capBar').style.width = (p * 100).toFixed(0) + '%'; $('#capStatus').textContent = msg; },
      });
      abort = null;
      modal.hidden = true;
      S.touch();
      S.setTime(r.start);
      S.select({ kind: 'caption', id: r.first });
      S.toast(`أُضيفت الترجمة: ${r.count} كتلة${r.approx ? ' (توقيت الكلمات تقريبي)' : ''}`, 'ok');
    } catch (e) {
      const stopped = e.name === 'AbortError';
      abort = null;
      if (stopped) { modal.hidden = true; return; }
      console.error(e);
      prog.hidden = true; btn.disabled = false;
      err.hidden = false;
      err.textContent = e.message + (e.detail ? ` — ${e.detail}` : '');
    }
  }

  body.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'start') start();
    else if (abort) abort.abort(); // «إلغاء» أثناء التفريغ يوقفه
    else close();
  });
  modal.addEventListener('pointerdown', e => { if (e.target === modal) close(); });

  return { open, close, isOpen, transcribe, exportFile, fileOf, speechItem, config };
})();
