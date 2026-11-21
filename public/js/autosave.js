'use strict';
/* الحفظ التلقائي في المتصفح (IndexedDB).
   بعد كل تعديل بثانيتين تُحفظ نسخة من المشروع؛ وعند فتح الصفحة، إن وُجدت نسخة فيها محتوى،
   يُسأل المستخدم: استعادتها أم البدء من جديد. لا يُحفظ شيء قبل أن يجيب، كي لا تُمسح النسخة.
   المنطق القابل للاختبار في js/autosavetools.js. */

const Autosave = (() => {
  const S = window.studio, state = S.state, PT = ProjectTools, AT = AutosaveTools;
  const DB = 'montaji-autosave', META = 'meta', BLOBS = 'blobs', CURRENT = 'current', DELAY = 2000;

  let ready = false;        // false حتى يقرر المستخدم بشأن النسخة المحفوظة (أو لا توجد نسخة)
  let timer = null, saving = false, again = false, warned = false;
  let stored = [];          // مفاتيح الوسائط المكتوبة في المخزن الآن
  const keyOf = new WeakMap(); // ملف أو لوحة ← مفتاح ثابت في المخزن
  let seq = 0;

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(META); r.result.createObjectStore(BLOBS); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function store(name, mode) { return (await db()).transaction(name, mode).objectStore(name); }
  async function done(tx) { return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); }); }

  const keyFor = (source, edited) => {
    let k = keyOf.get(source);
    if (!k) { k = `${edited ? 'e' : 'f'}${Date.now().toString(36)}-${++seq}`; keyOf.set(source, k); }
    return k;
  };

  /* ---------- الحفظ ---------- */
  /** ملف المشروع (في مجلد projects أو ملف اختاره المستخدم) يُحفظ مع النسخة. المقبض يُخزَّن في
      IndexedDB في Chrome و Edge؛ وإن رفضه المتصفح يُحفظ بدونه */
  function storableTarget() {
    const t = ProjectIO.getTarget();
    if (!t) return null;
    if (t.kind === 'server') return { kind: 'server', name: t.name };
    try { structuredClone(t.handle); return { kind: 'handle', handle: t.handle }; } catch (e) { return null; }
  }

  async function clear() {
    const d = await db();
    const tx = d.transaction([META, BLOBS], 'readwrite');
    tx.objectStore(META).delete(CURRENT);
    tx.objectStore(BLOBS).clear();
    await done(tx);
    stored = [];
  }

  async function saveNow() {
    if (!ready) return;
    if (saving) { again = true; return; }
    if (ProjectIO.isBusy()) { schedule(); return; } // فتح مشروع أو حفظه جارٍ: نعيد المحاولة بعده
    saving = true;
    try {
      if (S.isEmpty() && !state.name) { await clear(); return; }
      const { data, sources } = PT.serialize(state);
      const media = sources.map(m => ({ id: m.id, key: keyFor(m.source, m.edited), always: !!m.edited, m }));
      const plan = AT.planMedia(stored, media);
      const d = await db();
      // الوسائط أولاً، ثم وصف المشروع، ثم حذف ما لم يعد مستعملاً: النسخة تبقى سليمة لو انقطع الحفظ
      if (plan.write.length) {
        const tx = d.transaction(BLOBS, 'readwrite'), os = tx.objectStore(BLOBS);
        for (const k of plan.write) {
          const { m } = media.find(x => x.key === k);
          const blob = m.edited ? new Blob([ImageTools.encode(m.source, 'png').bytes], { type: 'image/png' }) : m.source;
          os.put(blob, k);
        }
        await done(tx);
      }
      const tx = d.transaction([META, BLOBS], 'readwrite');
      tx.objectStore(META).put({ data, keys: media.map(x => ({ id: x.id, key: x.key })), savedAt: Date.now(), target: storableTarget() }, CURRENT);
      for (const k of plan.remove) tx.objectStore(BLOBS).delete(k);
      await done(tx);
      stored = [...new Set(media.map(x => x.key))];
    } catch (e) {
      console.warn('autosave', e);
      if (!warned) { warned = true; S.toast(tt('تعذّر الحفظ التلقائي في المتصفح. احفظ المشروع يدوياً.', 'Autosave in the browser failed. Save the project manually.'), 'err'); }
    } finally {
      saving = false;
      if (again) { again = false; schedule(); }
    }
  }

  function schedule() {
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(saveNow, DELAY);
  }

  /* ---------- الاستعادة ---------- */
  async function readSnapshot() {
    const meta = await req((await store(META, 'readonly')).get(CURRENT));
    return meta && AT.hasContent(meta.data) ? meta : null;
  }

  async function restore(meta) {
    const os = await store(BLOBS, 'readonly');
    const files = new Map();
    for (const { id, key } of meta.keys || []) {
      const m = (meta.data.media || []).find(x => x.id === id);
      const blob = await req(os.get(key));
      if (!m || !blob) continue;
      const f = blob instanceof File ? blob : new File([blob], m.name || 'file', { type: blob.type });
      keyOf.set(f, key); // الملف المستعاد مكتوب في المخزن أصلاً: لا يُعاد
      files.set(id, f);
    }
    const data = PT.normalize(meta.data, { filters: Object.keys(Render.FILTERS), fonts: Object.keys(Render.FONTS), effects: Object.keys(Render.EFFECTS) });
    const skipped = await S.loadProject(data, files, () => {});
    ProjectIO.setTarget(meta.target); // Ctrl+S يكتب في ملف المشروع نفسه كما قبل إعادة التحميل
    stored = (meta.keys || []).map(x => x.key);
    S.toast(tt('استُعيد المشروع غير المحفوظ', 'The unsaved project was restored'), 'ok');
    if (skipped.length) S.toast(tt(`تعذّر تحميل ${skipped.length} عنصر`, `Could not load ${skipped.length} items`), 'err');
  }

  /** نافذة: استعادة النسخة أو البدء من جديد */
  function ask(meta) {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="asTitle">
        <h2 id="asTitle"></h2><p class="ex-note" id="asText"></p><p class="ex-note" id="asInfo" style="opacity:.8"></p>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="asRestore"></button><button class="btn" id="asDiscard"></button>
        </div></div>`;
      document.body.appendChild(modal);
      const file = meta.target && (meta.target.kind === 'server' ? meta.target.name : meta.target.handle && meta.target.handle.name);
      modal.querySelector('#asTitle').textContent = file ? tt('متابعة المشروع', 'Continue the project') : tt('مشروع لم يُحفظ', 'Unsaved project');
      modal.querySelector('#asText').textContent = file
        ? tt(`أُغلقت الصفحة أو أُعيد تحميلها. هل تريد متابعة المشروع من آخر تعديل؟ ملفه: ${file}`, `The page was closed or reloaded. Continue the project from its last edit? Its file: ${file}`)
        : tt('أُغلقت الصفحة أو أُعيد تحميلها وفيها مشروع لم يُحفظ في ملف. هل تريد استعادته؟', 'The page was closed or reloaded with a project that was not saved to a file. Restore it?');
      modal.querySelector('#asInfo').textContent = AT.describe(meta.data, meta.savedAt);
      const btnR = modal.querySelector('#asRestore'), btnD = modal.querySelector('#asDiscard');
      btnR.textContent = tt('استعادة المشروع', 'Restore the project');
      btnD.textContent = tt('ابدأ من جديد', 'Start fresh');
      const close = v => { modal.remove(); resolve(v); };
      btnR.onclick = () => close(true);
      btnD.onclick = () => close(false);
      btnR.focus();
    });
  }

  async function start() {
    let meta = null;
    try { meta = await readSnapshot(); } catch (e) { console.warn('autosave', e); }
    if (meta) {
      let restoreIt = false;
      try { restoreIt = await ask(meta); } catch (e) { console.warn(e); }
      try {
        if (restoreIt) await restore(meta);
        else await clear();
      } catch (e) {
        console.error(e);
        S.toast(tt('تعذّرت استعادة المشروع', 'Could not restore the project'), 'err');
      }
    }
    ready = true;
    if (!S.isEmpty()) schedule(); // ما أُضيف أثناء انتظار الجواب يُحفظ الآن
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  document.addEventListener('studio:change', schedule);
  // ملف المشروع تغيّر (حفظ أو فتح): يُحدَّث في النسخة
  document.addEventListener('project:saved', schedule);
  document.addEventListener('project:opened', schedule);
  // عند إخفاء الصفحة أو إغلاقها: حفظ فوري لآخر تعديل (أفضل جهد)
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) { clearTimeout(timer); saveNow(); } });
  if (typeof indexedDB !== 'undefined') start(); else ready = false;

  return { saveNow, clear, isReady: () => ready };
})();
