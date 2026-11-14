'use strict';
/* حفظ المشروع في ملف ‎.montaji‎ وفتحه (استيراد). صيغة الملف وفحصه في projecttools.js؛
   هنا قراءة الملفات وكتابتها ونافذة التقدّم. */

const ProjectIO = (() => {
  const S = window.studio, PT = ProjectTools;
  const $ = s => document.querySelector(s);
  const ui = {
    modal: $('#projModal'), title: $('#projTitle'), bar: $('#projBar'), status: $('#projStatus'), pct: $('#projPct'),
    file: $('#fileProject'),
  };
  let busy = false;

  const isBusy = () => busy;
  const isProjectFile = f => new RegExp('\\.' + PT.EXT + '$', 'i').test((f && f.name) || '');
  const baseName = n => String(n || '').replace(/\.[^.\\/]+$/, '');
  const tick = () => new Promise(r => setTimeout(r)); // يترك للمتصفح فرصة رسم النافذة قبل العمل الطويل

  // نوع الملف من امتداده: الملفات المستخرجة من الأرشيف بلا نوع، وبعض الأدوات تميّز به الصورة من الفيديو
  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  };
  const mimeOf = name => MIME[(String(name).split('.').pop() || '').toLowerCase()] || '';

  function progress(p, msg) {
    const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
    ui.bar.style.width = pct + '%';
    ui.pct.textContent = pct + '%';
    if (msg != null) ui.status.textContent = msg;
  }
  function begin(title) {
    busy = true;
    S.pause();
    ui.title.textContent = title;
    progress(0, 'جارٍ التحضير…');
    ui.modal.hidden = false;
  }
  function end() { busy = false; ui.modal.hidden = true; }

  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `مشروع-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  const explain = e => (e && e.name === 'NotReadableError'
    ? 'تعذّرت قراءة أحد ملفات الوسائط. ربما نُقل أو حُذف من مكانه على جهازك.'
    : e instanceof SyntaxError ? 'الملف ليس ملف مشروع مونتاجي صالحاً' : String((e && e.message) || e));

  /* ================= الحفظ ================= */
  /**
   * يبني ملف المشروع. الناتج Blob يشير إلى ملفات الوسائط كما هي على القرص، فلا تُنسخ في الذاكرة؛
   * كل ملف يُقرأ مرة واحدة دفعات لحساب CRC الذي تشترطه صيغة ZIP.
   */
  async function build(onProgress = () => {}) {
    layout();
    const { data, sources } = PT.serialize(state);
    const total = sources.reduce((s, m) => s + (m.edited ? 0 : m.source.size), 0) || 1;
    const entries = [];
    let read = 0;
    for (const m of sources) {
      if (m.edited) {
        // صورة عُدّلت في استوديو الصور: تُحفظ لوحتها PNG (بلا فقدان ومع الشفافية)
        const r = ImageTools.encode(m.source, 'png');
        entries.push({ name: m.path, size: r.bytes.length, crc: PT.crc32(r.bytes), data: r.bytes });
      } else {
        const before = read;
        const crc = await PT.crcOfBlob(m.source, n => onProgress((before + n) / total, m.name));
        read += m.source.size;
        entries.push({ name: m.path, size: m.source.size, crc, data: m.source });
      }
    }
    const json = new TextEncoder().encode(JSON.stringify(data, null, 1));
    entries.unshift({ name: 'project.json', size: json.length, crc: PT.crc32(json), data: json });
    return { blob: new Blob(PT.zipParts(entries).parts, { type: 'application/zip' }), data, files: sources.length };
  }

  /**
   * يحفظ المشروع. بنقرة من المستخدم تُفتح نافذة «حفظ باسم» ليختار المكان؛
   * saveAs (من المساعد وعملاء MCP) يحفظه في مجلد projects/ عبر الخادم المحلي؛ وإلا يُنزَّل الملف.
   */
  async function save(o = {}) {
    if (busy) return { ok: false, error: 'هناك عملية حفظ أو فتح جارية' };
    if (S.isEmpty()) { S.toast('المشروع فارغ، لا شيء يُحفظ', 'err'); return { ok: false, error: 'المشروع فارغ' }; }
    const suggested = PT.fileName(state.name || stamp());

    // نافذة الحفظ تشترط نقرة من المستخدم، فتُطلب قبل أي عمل طويل
    let handle = null;
    if (!o.saveAs && window.showSaveFilePicker && navigator.userActivation && navigator.userActivation.isActive) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: 'مشروع مونتاجي', accept: { 'application/zip': ['.' + PT.EXT] } }],
        });
      } catch (e) {
        if (e.name === 'AbortError') return { ok: false, error: 'ألغى المستخدم الحفظ' };
        console.warn(e); // المتصفح منع النافذة: ننزّل الملف كالمعتاد
      }
    }

    begin('حفظ المشروع');
    try {
      await tick();
      const writes = !!(handle || o.saveAs);
      const r = await build((p, name) => progress(p * (writes ? 0.7 : 1), `قراءة ${name}`));
      const out = { ok: true, file: suggested, size_mb: +(r.blob.size / 1048576).toFixed(1), media_files: r.files };
      if (handle) {
        progress(0.7, 'جارٍ كتابة الملف…');
        const w = await handle.createWritable();
        await w.write(r.blob);
        await w.close();
        out.file = handle.name;
      } else if (o.saveAs) {
        progress(0.7, 'جارٍ الحفظ في مجلد projects…');
        const res = await fetch('/api/project/save?name=' + encodeURIComponent(o.saveAs), { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: r.blob });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
        out.saved_to = j.path;
        out.file = j.path.split(/[\\/]/).pop();
      } else ImageTools.download(r.blob, suggested);
      progress(1);
      state.name = baseName(out.file);
      S.refresh();
      S.toast(out.saved_to ? 'حُفظ المشروع في مجلد projects' : handle ? `حُفظ المشروع: ${out.file}` : `نُزّل ملف المشروع: ${out.file}`, 'ok');
      return out;
    } catch (e) {
      console.error(e);
      S.toast('تعذّر حفظ المشروع: ' + explain(e), 'err');
      return { ok: false, error: explain(e) };
    } finally { end(); }
  }

  /* ================= الفتح (الاستيراد) ================= */
  /** يفتح ملف مشروع مكان المشروع الحالي. ملفات الوسائط شرائح من الملف نفسه، فلا تُنسخ في الذاكرة */
  async function open(file) {
    if (busy) return { ok: false, error: 'هناك عملية حفظ أو فتح جارية' };
    const replaced = !S.isEmpty();
    begin('فتح المشروع');
    try {
      await tick();
      const byName = new Map((await PT.readZip(file)).map(e => [e.name, e]));
      const pj = byName.get('project.json');
      if (!pj || pj.size > 20e6) throw new Error('الملف ليس ملف مشروع مونتاجي صالحاً');
      const raw = JSON.parse(await (await PT.zipData(file, pj)).text());
      const data = PT.normalize(raw, { filters: Object.keys(Render.FILTERS), fonts: Object.keys(Render.FONTS), effects: Object.keys(Render.EFFECTS) });
      data.name = baseName(file.name) || data.name; // الاسم الظاهر هو اسم الملف، ولو أعاد المستخدم تسميته

      const files = new Map();
      for (const m of data.media) {
        const e = byName.get(m.path);
        if (e) files.set(m.id, new File([await PT.zipData(file, e)], m.name || 'file', { type: mimeOf(m.name) }));
      }
      if (data.media.length && !files.size) throw new Error('ملف المشروع لا يحوي ملفات الوسائط');

      const skipped = await S.loadProject(data, files, (d, t) => progress(d / t, `تحميل الوسائط ${d} من ${t}`));
      const n = state.clips.length, parts = [`${n} ${n === 1 ? 'مقطع' : 'مقاطع'}`];
      if (state.texts.length) parts.push(`${state.texts.length} نص`);
      if (state.effects.length) parts.push(`${state.effects.length} تأثير`);
      if (state.audios.length) parts.push(`${state.audios.length} موسيقى`);
      S.toast(`فُتح المشروع «${data.name}»: ${parts.join(' · ')} · المدة ${fmtTime(view.total)}`, 'ok');
      if (skipped.length) S.toast(`تعذّر تحميل ${skipped.length} عنصر: ${skipped.slice(0, 3).join('، ')}${skipped.length > 3 ? '…' : ''}`, 'err');
      else if (replaced) S.toast('استُبدل المشروع السابق. Ctrl+Z يعيده.');
      return { ok: true, name: data.name, skipped };
    } catch (e) {
      console.error(e);
      S.toast('تعذّر فتح المشروع: ' + explain(e), 'err');
      return { ok: false, error: explain(e) };
    } finally { end(); }
  }

  const pick = () => { if (!busy) ui.file.click(); };

  ui.file.onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) open(f); };
  $('#btnProjOpen').onclick = pick;
  $('#btnEmptyOpen').onclick = pick;
  $('#btnProjSave').onclick = () => save();

  return { save, open, pick, build, isBusy, isProjectFile };
})();
