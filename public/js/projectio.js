'use strict';
/* حفظ المشروع في ملف ‎.montaji‎ وفتحه (استيراد). صيغة الملف وخطة الحفظ وفحصهما في projecttools.js؛
   هنا قراءة الملفات وكتابتها والنوافذ.

   الحفظ: أول مرة يُحفظ المشروع في مجلد projects داخل مونتاجي (يُنشأ إن لم يوجد) عبر الخادم المحلي،
   وكل حفظ بعدها يكتب في الملف نفسه بلا سؤال. «حفظ باسم» وحده يسأل عن اسم آخر أو مكان آخر.
   الفتح: نافذة فيها مشاريع مجلد projects (الأحدث أولاً)، وزر لملف من مكان آخر. */

const ProjectIO = (() => {
  const S = window.studio, PT = ProjectTools;
  const $ = s => document.querySelector(s);
  const ui = {
    modal: $('#projModal'), title: $('#projTitle'), bar: $('#projBar'), status: $('#projStatus'), pct: $('#projPct'),
    file: $('#fileProject'),
  };
  let busy = false;      // حفظ أو فتح جارٍ
  let dialog = null;     // نافذة «حفظ باسم» أو «فتح مشروع» المفتوحة
  // ملف المشروع الحالي: { kind: 'server', name } اسم نسبي في مجلد projects، أو { kind: 'handle', handle }
  // ملف اختاره المستخدم بنافذة المتصفح. الحفظ التالي يكتب فيه مباشرة (انظر PT.planSave)
  let target = null;
  let projectsDir = '';  // المسار الكامل لمجلد projects كما يعيده الخادم (للعرض)

  const isBusy = () => busy;
  const isDialogOpen = () => !!dialog;
  const isProjectFile = f => new RegExp('\\.' + PT.EXT + '$', 'i').test((f && f.name) || '');
  const baseName = n => PT.projectName(n);
  const tick = () => new Promise(r => setTimeout(r)); // يترك للمتصفح فرصة رسم النافذة قبل العمل الطويل
  const sep = () => (/^[a-z]:\\|\\/i.test(projectsDir) ? '\\' : '/');
  const fullPath = rel => (projectsDir ? projectsDir + sep() + String(rel).split('/').join(sep()) : 'projects/' + rel);

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
    progress(0, tt('جارٍ التحضير…', 'Preparing…'));
    ui.modal.hidden = false;
  }
  function end() { busy = false; ui.modal.hidden = true; }

  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return tt('مشروع', 'project') + `-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  const explain = e => (e && e.name === 'NotReadableError'
    ? tt('تعذّرت قراءة أحد ملفات الوسائط. ربما نُقل أو حُذف من مكانه على جهازك.', 'One of the media files could not be read. It may have been moved or deleted on your device.')
    : e instanceof SyntaxError ? tt('الملف ليس ملف مشروع مونتاجي صالحاً', 'This is not a valid Montaji project file')
    : e instanceof TypeError && /fetch/i.test(e.message) ? tt('تعذّر الوصول إلى خادم مونتاجي. هل ما زالت نافذته مفتوحة؟', 'Could not reach the Montaji server. Is its window still open?')
    : String((e && e.message) || e));

  /* ================= الخادم المحلي ================= */
  async function apiJson(url, init) {
    const res = await fetch(url, init);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }
  /** مشاريع مجلد projects: [{ name, size, modified }] الأحدث أولاً */
  async function listProjects() {
    const j = await apiJson('/api/projects', { cache: 'no-store' });
    if (j.dir) projectsDir = j.dir;
    return Array.isArray(j.projects) ? j.projects : [];
  }
  const reveal = name => fetch('/api/project/reveal' + (name ? '?name=' + encodeURIComponent(name) : ''), { method: 'POST' }).catch(() => {});

  /** ملف من الخادم كـ Blob مع التقدّم، دفعات صغيرة فلا يجتمع الملف كله في ذاكرة JavaScript */
  async function fetchBlob(url, onProgress = () => {}) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
    const total = +res.headers.get('Content-Length') || 0;
    if (!res.body || !res.body.getReader) return res.blob();
    const reader = res.body.getReader(), parts = [];
    let chunk = [], size = 0, got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunk.push(value); size += value.length; got += value.length;
      if (size >= 16 << 20) { parts.push(new Blob(chunk)); chunk = []; size = 0; }
      if (total) onProgress(got / total);
    }
    if (chunk.length) parts.push(new Blob(chunk));
    if (total && got !== total) throw new Error(tt('انقطعت قراءة ملف المشروع. حاول مرة أخرى.', 'Reading the project file was interrupted. Try again.'));
    return new Blob(parts, { type: 'application/zip' });
  }

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

  /** إذن الكتابة في ملف اختاره المستخدم من قبل (قد يطلبه المتصفح من جديد بعد إعادة التحميل) */
  async function canWrite(handle) {
    try {
      const opts = { mode: 'readwrite' };
      if (!handle.queryPermission) return true;
      if (await handle.queryPermission(opts) === 'granted') return true;
      return !!handle.requestPermission && await handle.requestPermission(opts) === 'granted';
    } catch (e) { console.warn(e); return false; }
  }

  async function writeHandle(handle, blob) {
    const w = await handle.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (e) {
      // لا يبقى ملف مؤقت ‎.crswap‎ بجانب الملف، ويبقى الملف القديم كما هو
      try { await w.abort(); } catch (x) { /* أُغلق أصلاً */ }
      throw e;
    }
  }

  /**
   * يحفظ المشروع (انظر PT.planSave):
   *   حفظ (Ctrl+S): في ملف المشروع نفسه إن حُفظ أو فُتح من قبل، وإلا في مجلد projects باسم المشروع.
   *   o.pick (حفظ باسم، Ctrl+Shift+S): نافذة لاسم آخر في مجلد projects أو مكان آخر على الجهاز.
   *   o.saveAs (المساعد وعملاء MCP): مجلد projects بهذا الاسم.
   */
  async function save(o = {}) {
    if (busy || dialog) return { ok: false, error: tt('هناك عملية حفظ أو فتح جارية', 'A save or open is already in progress') };
    if (S.isEmpty()) { S.toast(tt('المشروع فارغ، لا شيء يُحفظ', 'The project is empty, nothing to save'), 'err'); return { ok: false, error: tt('المشروع فارغ', 'The project is empty') }; }
    const name = state.name || stamp();
    let plan = PT.planSave(target, o, name);

    // نوافذ المتصفح وأذوناته تشترط نقرة من المستخدم، فتُطلب قبل أي عمل طويل
    if (plan.kind === 'handle' && !(await canWrite(plan.handle))) plan = { kind: 'server', name: PT.fileName(name), overwrite: false };
    if (plan.kind === 'dialog') {
      plan = await saveAsDialog(name);
      if (!plan) return { ok: false, error: tt('ألغى المستخدم الحفظ', 'The user cancelled the save') };
    }

    begin(tt('حفظ المشروع', 'Saving the project'));
    try {
      await tick();
      const writes = plan.kind !== 'download';
      const r = await build((p, n) => progress(p * (writes ? 0.7 : 1), tt(`قراءة ${n}`, `Reading ${n}`)));
      const out = { ok: true, file: PT.fileName(name), size_mb: +(r.blob.size / 1048576).toFixed(1), media_files: r.files };
      let msg;
      if (plan.kind === 'handle') {
        progress(0.7, tt('جارٍ كتابة الملف…', 'Writing the file…'));
        await writeHandle(plan.handle, r.blob);
        out.file = plan.handle.name;
        target = { kind: 'handle', handle: plan.handle };
        msg = tt(`حُفظ المشروع في ${out.file}`, `Project saved to ${out.file}`);
      } else if (plan.kind === 'server') {
        progress(0.7, tt('جارٍ الحفظ في مجلد المشاريع…', 'Saving to the projects folder…'));
        const q = `name=${encodeURIComponent(plan.name)}${plan.overwrite ? '&overwrite=1' : ''}`;
        const j = await apiJson('/api/project/save?' + q, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: r.blob });
        if (j.dir) projectsDir = j.dir;
        out.saved_to = j.path;
        out.file = j.name || j.path.split(/[\\/]/).pop();
        target = { kind: 'server', name: out.file };
        msg = tt(`حُفظ المشروع: ${j.path}`, `Project saved: ${j.path}`);
      } else {
        ImageTools.download(r.blob, PT.fileName(name));
        out.file = PT.fileName(name);
        out.downloaded = true;
        target = null; // ملف في مجلد التنزيلات: لا نعرف مكانه فلا نكتب فيه لاحقاً
        msg = tt(`نُزّل ملف المشروع إلى مجلد التنزيلات: ${out.file}`, `Project file downloaded to your Downloads folder: ${out.file}`);
      }
      progress(1);
      state.name = baseName(out.file);
      S.refresh();
      S.toast(msg, 'ok');
      document.dispatchEvent(new CustomEvent('project:saved', { detail: out }));
      return out;
    } catch (e) {
      console.error(e);
      S.toast(tt('تعذّر حفظ المشروع: ', 'Could not save the project: ') + explain(e), 'err');
      return { ok: false, error: explain(e) };
    } finally { end(); }
  }

  /* ================= النوافذ ================= */
  /** نافذة بسيطة تُبنى عند الطلب. close(v) يغلقها وينهي الوعد بالقيمة v */
  function modal(build) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'modal';
      const box = document.createElement('div');
      box.className = 'dialog proj-dialog';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      back.append(box);
      const close = v => {
        if (dialog !== back) return;
        dialog = null;
        back.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      };
      back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
      document.addEventListener('keydown', onKey, true);
      dialog = back;
      document.body.append(back);
      build(box, close);
    });
  }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const button = (text, cls, onClick) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = onClick; return b; };
  const sizeText = n => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const dateText = ms => { try { return new Date(ms).toLocaleString(I18N.lang === 'en' ? 'en-GB' : 'ar', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; } };

  /** سطر «المجلد: …» مع زر يفتحه في مستكشف الملفات */
  function folderLine() {
    const p = el('p', 'ex-note proj-folder');
    p.append(el('span', '', tt('مجلد المشاريع: ', 'Projects folder: ')), Object.assign(el('bdi', '', projectsDir || 'projects'), { dir: 'ltr' }));
    const b = button(tt('إظهار المجلد', 'Show folder'), 'proj-link', () => reveal(''));
    p.append(b);
    return p;
  }

  /**
   * نافذة «حفظ باسم»: اسم جديد في مجلد projects، أو مكان آخر على الجهاز بنافذة المتصفح.
   * ← خطة حفظ (مثل PT.planSave) أو null إن أُلغيت
   */
  async function saveAsDialog(name) {
    let list = [];
    try { list = await listProjects(); } catch (e) { console.warn(e); }
    return modal((box, close) => {
      box.append(el('h2', '', tt('حفظ باسم', 'Save as')));
      const row = el('label', 'row proj-name');
      const input = el('input');
      input.type = 'text';
      input.value = name;
      input.maxLength = 120;
      input.setAttribute('aria-label', tt('اسم المشروع', 'Project name'));
      row.append(el('span', '', tt('الاسم', 'Name')), input);
      const warn = el('p', 'ex-note proj-warn');
      warn.hidden = true;
      box.append(row, folderLine(), warn);

      const file = () => PT.fileName(input.value.trim() || name);
      const existing = () => list.find(p => !p.name.includes('/') && p.name.toLowerCase() === file().toLowerCase());
      let confirmed = '';
      const update = () => {
        const ex = existing(), mine = ex && target && target.kind === 'server' && target.name.toLowerCase() === ex.name.toLowerCase();
        warn.hidden = !ex || mine;
        warn.textContent = ex && !mine ? tt(`يوجد مشروع باسم «${ex.name}». الحفظ يستبدله.`, `A project named “${ex.name}” exists. Saving replaces it.`) : '';
      };
      input.oninput = () => { confirmed = ''; ok.textContent = tt('حفظ', 'Save'); update(); };
      update();

      const saveHere = () => {
        const ex = existing(), mine = ex && target && target.kind === 'server' && target.name.toLowerCase() === ex.name.toLowerCase();
        // استبدال مشروع آخر يحتاج نقرة ثانية بعد قراءة التحذير
        if (ex && !mine && confirmed !== ex.name) {
          confirmed = ex.name;
          ok.textContent = tt('استبدال', 'Replace');
          return;
        }
        close({ kind: 'server', name: ex ? ex.name : file(), overwrite: !!ex });
      };
      const elsewhere = async () => {
        if (!window.showSaveFilePicker) return close({ kind: 'download' });
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: file(),
            types: [{ description: tt('مشروع مونتاجي', 'Montaji project'), accept: { 'application/zip': ['.' + PT.EXT] } }],
          });
          close({ kind: 'handle', handle });
        } catch (e) {
          if (e.name !== 'AbortError') { console.warn(e); close({ kind: 'download' }); }
        }
      };
      const ok = button(tt('حفظ', 'Save'), 'primary', saveHere);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveHere(); } });
      const actions = el('div', 'dialog-actions');
      actions.append(button(tt('إلغاء', 'Cancel'), '', () => close(null)),
        button(window.showSaveFilePicker ? tt('مكان آخر…', 'Another place…') : tt('تنزيل', 'Download'), '', elsewhere), ok);
      box.append(actions);
      input.focus();
      input.select();
    });
  }

  /** نافذة «فتح مشروع»: مشاريع مجلد projects، وزر لملف من مكان آخر */
  async function openDialog() {
    let list = null;
    try { list = await listProjects(); } catch (e) { console.warn(e); }
    if (!list) return browse(); // الخادم لا يجيب: نافذة الملفات مباشرة
    const choice = await modal((box, close) => {
      box.append(el('h2', '', tt('فتح مشروع', 'Open a project')), folderLine());
      if (!list.length) box.append(el('p', 'ex-note proj-empty', tt('لا توجد مشاريع محفوظة في هذا المجلد بعد. الحفظ يضعها هنا.', 'No saved projects in this folder yet. Saving puts them here.')));
      else {
        const ul = el('div', 'proj-list');
        ul.setAttribute('role', 'list');
        for (const p of list) {
          const b = el('button', 'proj-item');
          b.type = 'button';
          b.setAttribute('role', 'listitem');
          const current = target && target.kind === 'server' && target.name === p.name;
          b.append(Object.assign(el('b', '', p.name.replace(/\.montaji$/i, '')), { dir: 'auto' }),
            el('small', '', `${dateText(p.modified)} · ${sizeText(p.size)}${current ? ' · ' + tt('المفتوح الآن', 'open now') : ''}`));
          b.onclick = () => close({ name: p.name });
          ul.append(b);
        }
        box.append(ul);
      }
      const actions = el('div', 'dialog-actions');
      actions.append(button(tt('إلغاء', 'Cancel'), '', () => close(null)), button(tt('ملف من مكان آخر…', 'File from another place…'), '', () => close({ browse: true })));
      box.append(actions);
      const first = box.querySelector('.proj-item') || actions.lastChild;
      first.focus();
    });
    if (!choice) return;
    if (choice.browse) return browse();
    return openProject(choice.name);
  }

  /* ================= الفتح (الاستيراد) ================= */
  /** يفتح مشروعاً من مجلد projects باسمه النسبي. الحفظ التالي يكتب فيه */
  function openProject(rel) {
    const name = String(rel).split('/').pop();
    return open(async onProgress => new File([await fetchBlob('/api/project/file?name=' + encodeURIComponent(rel), onProgress)], name, { type: 'application/zip' }),
      { inMemory: true, target: { kind: 'server', name: rel } });
  }

  /**
   * يفتح ملف مشروع مكان المشروع الحالي.
   * file: ملف، أو دالة تجلبه (من الخادم) فيظهر تقدّم قراءته في نافذة الفتح نفسها.
   * ملفات الوسائط تُنسخ من ملف المشروع (o.inMemory: الملف في الذاكرة أصلاً فلا حاجة للنسخ)، لأن الشريحة
   * من ملف على القرص تصبح غير مقروءة حين يُحفظ المشروع فوقه: كانت كل الحفظات بعد الأولى تفشل
   * ويبقى في الملف أول ما حُفظ.
   * o.target: ملف المشروع الذي يحفظ فيه Ctrl+S لاحقاً؛ o.handle: الملف المفتوح من نافذة المتصفح.
   */
  async function open(file, o = {}) {
    if (busy) return { ok: false, error: tt('هناك عملية حفظ أو فتح جارية', 'A save or open is already in progress') };
    const replaced = !S.isEmpty();
    begin(tt('فتح المشروع', 'Opening the project'));
    try {
      await tick();
      const fetching = typeof file === 'function';
      const base = fetching ? 0.4 : 0; // نصيب جلب الملف من شريط التقدّم
      if (fetching) file = await file(p => progress(base * p, tt('قراءة ملف المشروع…', 'Reading the project file…')));
      const byName = new Map((await PT.readZip(file)).map(e => [e.name, e]));
      const pj = byName.get('project.json');
      if (!pj || pj.size > 20e6) throw new Error(tt('الملف ليس ملف مشروع مونتاجي صالحاً', 'This is not a valid Montaji project file'));
      const raw = JSON.parse(await (await PT.zipData(file, pj)).text());
      const data = PT.normalize(raw, { filters: Object.keys(Render.FILTERS), fonts: Object.keys(Render.FONTS), effects: Object.keys(Render.EFFECTS) });
      data.name = baseName(file.name) || data.name; // الاسم الظاهر هو اسم الملف، ولو أعاد المستخدم تسميته

      const found = data.media.map(m => ({ m, e: byName.get(m.path) })).filter(x => x.e);
      if (data.media.length && !found.length) throw new Error(tt('ملف المشروع لا يحوي ملفات الوسائط', 'The project file has no media files'));
      const copy = !o.inMemory, share = copy ? (1 - base) * 0.5 : 0; // نصيب نسخ الوسائط من شريط التقدّم
      const total = found.reduce((s, x) => s + x.e.size, 0) || 1;
      const files = new Map();
      let read = 0;
      for (const { m, e } of found) {
        let blob = await PT.zipData(file, e);
        if (copy) {
          const before = read;
          blob = await PT.copyBlob(blob, n => progress(base + share * (before + n) / total, tt(`نسخ ${m.name}`, `Copying ${m.name}`)));
          read += e.size;
        }
        files.set(m.id, new File([blob], m.name || 'file', { type: mimeOf(m.name) }));
      }

      // ملف بلا مكان معروف (سحب أو نافذة الملفات العادية): إن كان من مجلد projects نحفظ فيه، لا في نسخة جديدة
      let next = o.target || (o.handle ? { kind: 'handle', handle: o.handle } : null);
      if (!next && !o.inMemory) {
        try { const rel = PT.matchProject(await listProjects(), file); if (rel) next = { kind: 'server', name: rel }; } catch (e) { /* الخادم لا يجيب */ }
      }

      const from = base + share;
      const skipped = await S.loadProject(data, files, (d, t) => progress(from + (1 - from) * d / t, tt(`تحميل الوسائط ${d} من ${t}`, `Loading media ${d} of ${t}`)));
      // مشروع آخر: لا يُكتب فوق ملف المشروع السابق
      target = next;
      const n = state.clips.length, parts = [`${n} ${n === 1 ? tt('مقطع', 'clip') : tt('مقاطع', 'clips')}`];
      if (state.texts.length) parts.push(`${state.texts.length} ${tt('نص', 'text')}`);
      if (state.effects.length) parts.push(`${state.effects.length} ${tt('تأثير', 'effect')}`);
      if (state.audios.length) parts.push(`${state.audios.length} ${tt('موسيقى', 'music')}`);
      S.toast(tt(`فُتح المشروع «${data.name}»: ${parts.join(' · ')} · المدة ${fmtTime(view.total)}`, `Opened “${data.name}”: ${parts.join(' · ')} · duration ${fmtTime(view.total)}`), 'ok');
      if (skipped.length) S.toast(tt(`تعذّر تحميل ${skipped.length} عنصر: ${skipped.slice(0, 3).join('، ')}${skipped.length > 3 ? '…' : ''}`, `Could not load ${skipped.length} items: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`), 'err');
      else if (replaced) S.toast(tt('استُبدل المشروع السابق. Ctrl+Z يعيده.', 'The previous project was replaced. Ctrl+Z brings it back.'));
      document.dispatchEvent(new CustomEvent('project:opened', { detail: { name: data.name } }));
      return { ok: true, name: data.name, skipped };
    } catch (e) {
      console.error(e);
      S.toast(tt('تعذّر فتح المشروع: ', 'Could not open the project: ') + explain(e), 'err');
      return { ok: false, error: explain(e) };
    } finally { end(); }
  }

  /** نافذة ملفات المتصفح لمشروع من أي مكان. في Chrome و Edge تعطي مقبضاً للملف فيُحفظ فيه لاحقاً بلا سؤال */
  async function browse() {
    if (busy) return;
    if (window.showOpenFilePicker) {
      let handle = null;
      try {
        [handle] = await window.showOpenFilePicker({
          types: [{ description: tt('مشروع مونتاجي', 'Montaji project'), accept: { 'application/zip': ['.' + PT.EXT] } }],
        });
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn(e); // المتصفح منع النافذة: نافذة الملفات العادية
      }
      if (handle) {
        let file = null;
        try { file = await handle.getFile(); } catch (e) { console.warn(e); }
        if (file) return void open(file, { handle });
      }
    }
    ui.file.click();
  }

  /** فتح مشروع: نافذة مشاريع مجلد projects */
  function pick() {
    if (busy || dialog) return;
    return openDialog();
  }

  ui.file.onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) open(f); };
  $('#btnProjOpen').onclick = pick;
  $('#btnEmptyOpen').onclick = pick;
  $('#btnProjSave').onclick = () => save();
  $('#btnSave').onclick = () => save(); // زر ظاهر دائماً في الشريط العلوي
  $('#btnProjSaveAs').onclick = () => save({ pick: true });

  return {
    save, open, openProject, pick, browse, build, isBusy, isDialogOpen, isProjectFile, listProjects,
    // للحفظ التلقائي: ملف المشروع يُحفظ مع النسخة فيبقى Ctrl+S يكتب فيه بعد الاستعادة
    getTarget: () => target, setTarget: t => { target = t && (t.kind === 'server' ? typeof t.name === 'string' : t.kind === 'handle' && t.handle) ? t : null; },
  };
})();
