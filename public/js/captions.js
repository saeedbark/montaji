'use strict';
/* الترجمة التلقائية — نافذة التفريغ، وتحويل صوت المشروع إلى كتل ترجمة عبر /api/transcribe، وتصدير SRT/VTT.
   المنطق الحسابي في captiontools.js، والرسم في render.js (drawCaptions). */

const Captions = (() => {
  const S = window.studio;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const modal = $('#capModal'), body = $('#capBody');
  const LANGS = () => [['', tt('تلقائي (يكتشفها المحرّك)', 'Automatic (detected by the engine)')], ['ar', tt('العربية', 'Arabic')], ['en', tt('الإنجليزية', 'English')], ['fr', tt('الفرنسية', 'French')], ['es', tt('الإسبانية', 'Spanish')], ['tr', tt('التركية', 'Turkish')],
    ['de', tt('الألمانية', 'German')], ['ur', tt('الأردية', 'Urdu')], ['fa', tt('الفارسية', 'Persian')], ['id', tt('الإندونيسية', 'Indonesian')]];
  let abort = null, lastLang = 'ar';

  const isOpen = () => !modal.hidden;
  const fail = (msg, extra) => { throw Object.assign(new Error(msg), extra || {}); };

  /** إعدادات خدمة التفريغ كما يعرضها الخادم (بلا المفتاح) */
  async function config() {
    try { return (await (await fetch('/api/config')).json()).stt || { ready: false, error: tt('تعذّر قراءة الإعدادات', 'Could not read the settings') }; }
    catch (e) { return { ready: false, error: tt('تعذّر الاتصال بالخادم المحلي', 'Could not reach the local server') }; }
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
      const hit = speechItem(id) || fail(tt('هذا العنصر ليس فيديو ولا صوتاً', 'This item is neither a video nor audio'));
      const { kind, obj } = hit;
      if (kind === 'audio') return { buf: obj.buf, start: obj.in, end: obj.out, at: obj.start, rate: 1 };
      let buf;
      try { buf = await decodeAudioFile(obj.file); } catch (e) { fail(tt('هذا الفيديو بلا صوت', 'This video has no sound')); }
      return { buf, start: obj.in, end: Math.min(obj.out, buf.duration), at: kind === 'clip' ? obj._start : obj.start, rate: obj.speed || 1 };
    }
    if (view.total <= 0) fail(tt('المشروع فارغ', 'The project is empty'));
    const buf = await Exporter.mixAudio(view.total);
    if (!buf) fail(tt('لا صوت في المشروع: أضف فيديو فيه كلام أو تسجيلاً صوتياً', 'No sound in the project: add a video with speech or a voice recording'));
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
    say(0, tt('جارٍ تجهيز الصوت…', 'Preparing the audio…'));
    const src = await source(id);
    const dur = src.end - src.start;
    if (!(dur >= 0.3)) fail(tt('المقطع أقصر من أن يُفرَّغ', 'The clip is too short to transcribe'));
    const chunks = AudioTools.sttChunks(dur), parts = [];
    let approx = false, language = '';
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      say(0.05 + 0.9 * i / chunks.length, chunks.length > 1 ? tt(`جارٍ التفريغ… الجزء ${i + 1} من ${chunks.length}`, `Transcribing… part ${i + 1} of ${chunks.length}`) : tt('جارٍ التفريغ… قد يستغرق دقيقة', 'Transcribing… this may take a minute'));
      const wav = AudioTools.wav(AudioTools.toMono16k(src.buf, src.start + ch.start, src.start + ch.end));
      let r, j;
      try {
        r = await fetch('/api/transcribe' + (lang ? '?lang=' + encodeURIComponent(lang) : ''), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal });
        j = await r.json().catch(() => ({}));
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        fail(tt('تعذّر الاتصال بالخادم المحلي', 'Could not reach the local server'));
      }
      if (!r.ok) fail(j.error || `HTTP ${r.status}`, { detail: j.detail, setup: !!j.setup });
      const timed = Array.isArray(j.words) && j.words.length > 0;
      parts.push({ start: ch.start, end: ch.end, words: timed ? j.words : CaptionTools.wordsFromSegments(j.segments || []) });
      approx = approx || !timed || !!j.approx;
      language = language || j.language || '';
    }
    const words = CaptionTools.place(CaptionTools.mergeChunks(parts), src.at, src.rate);
    if (!words.length) fail(tt('لم يُعثر على كلام في هذا الصوت', 'No speech found in this audio'));
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
    say(1, tt('تم', 'Done'));
    return { count: items.length, first: items[0].id, approx, language: state.captions.lang, start: a, end: b };
  }

  /* ================= التصدير ================= */
  /** نص ملف الترجمة ومعلوماته، أو خطأ إن لم توجد ترجمة */
  function fileOf(format) {
    const fmt = format === 'vtt' ? 'vtt' : 'srt';
    if (!state.captions.items.length) fail(tt('لا توجد ترجمة بعد', 'There are no captions yet'));
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
    S.toast(tt(`نُزّل ملف الترجمة ${f.name}`, `Caption file downloaded: ${f.name}`), 'ok');
  }

  /* ================= النافذة ================= */
  function close() {
    if (abort) return; // التفريغ جارٍ
    modal.hidden = true;
  }

  async function open() {
    if (view.exporting) return S.toast(tt('انتظر انتهاء التصدير أولاً', 'Wait for the export to finish first'), 'err');
    layout();
    S.pause();
    modal.hidden = false;
    body.innerHTML = `<p class="cap-note">${tt('جارٍ قراءة الإعدادات…', 'Reading the settings…')}</p>`;
    const cfg = await config();
    if (!cfg.ready) {
      body.innerHTML = `<p class="cap-error">${esc(cfg.error)}</p>
        <p class="cap-note">${tt(`افتح ملف <b dir="ltr">.env</b> في مجلد مونتاجي وضع أحد هذه المفاتيح ثم أعد المحاولة (لا حاجة لإعادة التشغيل):<br>
        <b dir="ltr">GROQ_API_KEY</b> (مجاني وجيد في العربية) · <b dir="ltr">OPENAI_API_KEY</b> · <b dir="ltr">GEMINI_API_KEY</b><br>
        أو شغّل Whisper على جهازك وضع عنوانه في <b dir="ltr">STT_BASE_URL</b> فلا يغادر الصوت الجهاز.`,
        `Open the <b dir="ltr">.env</b> file in the Montaji folder, add one of these keys, then try again (no restart needed):<br>
        <b dir="ltr">GROQ_API_KEY</b> (free and good with Arabic) · <b dir="ltr">OPENAI_API_KEY</b> · <b dir="ltr">GEMINI_API_KEY</b><br>
        Or run Whisper on your device and put its address in <b dir="ltr">STT_BASE_URL</b> so the audio never leaves it.`)}</p>
        <div class="dialog-actions"><button class="btn" data-act="close">${tt('إغلاق', 'Close')}</button></div>`;
      return;
    }
    const sel = state.sel && speechItem(state.sel.id);
    const name = sel ? sel.obj.name : '';
    const has = state.captions.items.length;
    body.innerHTML = `
      <label class="row"><span>${tt('المصدر', 'Source')}</span><select id="capSrc">
        <option value="">${tt('صوت المشروع كله', 'The whole project sound')}</option>
        ${sel ? `<option value="${sel.obj.id}" selected>${sel.kind === 'audio' ? tt('الصوت المحدد', 'Selected audio') : tt('الفيديو المحدد', 'Selected video')}: ${esc(name.slice(0, 40))}</option>` : ''}
      </select></label>
      <label class="row"><span>${tt('لغة الكلام', 'Spoken language')}</span><select id="capLang">${LANGS().map(([v, l]) => `<option value="${v}"${v === lastLang ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="cap-note">${tt('المحرّك:', 'Engine:')} <b>${esc(cfg.label)}</b> <span dir="ltr">(${esc(cfg.model)})</span>.
        ${cfg.local ? tt('يعمل على جهازك: الصوت لا يغادره.', 'Runs on your device: the audio never leaves it.') : tt('سيُرسل صوت المشروع إلى هذا المزوّد لتفريغه.', 'The project sound will be sent to this provider to transcribe it.')}
        ${cfg.words ? '' : '<br>' + tt('هذا المحرّك يعطي توقيت الجمل لا الكلمات، فتمييز الكلمة المنطوقة تقريبي. للتوقيت الدقيق استعمل Groq أو OpenAI.', 'This engine times sentences, not words, so the spoken-word highlight is approximate. For exact timing use Groq or OpenAI.')}
        ${has ? '<br>' + tt('الترجمة الموجودة في المدى نفسه ستُستبدل (التراجع يعيدها).', 'Existing captions in the same range will be replaced (undo brings them back).') : ''}</p>
      <div id="capProg" hidden>
        <div class="bar"><div class="bar-fill" id="capBar"></div></div>
        <div class="ex-status"><span id="capStatus"></span></div>
      </div>
      <p class="cap-error" id="capErr" hidden></p>
      <div class="dialog-actions">
        <button class="btn" data-act="close">${tt('إلغاء', 'Cancel')}</button>
        <button class="btn primary" data-act="start">${tt('ابدأ التفريغ', 'Start transcribing')}</button>
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
      S.toast(tt(`أُضيفت الترجمة: ${r.count} كتلة${r.approx ? ' (توقيت الكلمات تقريبي)' : ''}`, `Captions added: ${r.count} blocks${r.approx ? ' (word timing is approximate)' : ''}`), 'ok');
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
