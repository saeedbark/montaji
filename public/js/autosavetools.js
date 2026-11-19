'use strict';
/* الحفظ التلقائي — منطق بلا واجهة، يُختبر في Node.
   المشروع المفتوح يعيش في ذاكرة الصفحة فقط، فإعادة تحميلها تُضيّعه. لذلك تُحفظ منه نسخة في
   IndexedDB بعد كل تعديل (js/autosave.js)، ويُعرض على المستخدم استعادتها عند فتح الصفحة.
   الوسائط قد تكون كبيرة: يُكتب كل ملف مرة واحدة بمفتاح ثابت، ولا يُعاد إلا ما تغيّر. */

const AutosaveTools = (() => {
  const tt = typeof I18N !== 'undefined' ? I18N.t : ar => ar;

  /**
   * ما يُكتب وما يُحذف من ملفات الوسائط المخزّنة.
   * prev: مفاتيح المخزّن الآن. next: [{ key, always }] ما يحتاجه المشروع؛ always لصورة عُدّلت
   * (لوحتها تتغير دون أن يتغير مفتاحها) فتُكتب في كل مرة.
   * ← { write: [مفاتيح]، remove: [مفاتيح] }
   */
  function planMedia(prev, next) {
    const had = new Set(prev || []), need = new Set();
    const write = [];
    for (const m of next || []) {
      if (!m || !m.key || need.has(m.key)) continue;
      need.add(m.key);
      if (m.always || !had.has(m.key)) write.push(m.key);
    }
    const remove = [...had].filter(k => !need.has(k));
    return { write, remove };
  }

  /** هل في بيانات المشروع ما يستحق الاستعادة؟ */
  function hasContent(data) {
    if (!data || typeof data !== 'object') return false;
    const n = k => (Array.isArray(data[k]) ? data[k].length : 0);
    const caps = data.captions && Array.isArray(data.captions.items) ? data.captions.items.length : 0;
    return n('clips') + n('overlays') + n('audios') + n('texts') + n('effects') + caps > 0;
  }

  /** «قبل 5 دقائق» من فرق الزمن */
  function ago(savedAt, now = Date.now()) {
    const s = Math.max(0, Math.round((now - savedAt) / 1000));
    if (!Number.isFinite(s) || s < 45) return tt('قبل لحظات', 'moments ago');
    const m = Math.round(s / 60);
    if (m < 60) return m === 1 ? tt('قبل دقيقة', 'a minute ago') : tt(`قبل ${m} دقيقة`, `${m} minutes ago`);
    const h = Math.round(m / 60);
    if (h < 24) return h === 1 ? tt('قبل ساعة', 'an hour ago') : tt(`قبل ${h} ساعة`, `${h} hours ago`);
    const d = Math.round(h / 24);
    return d === 1 ? tt('أمس', 'yesterday') : tt(`قبل ${d} يوم`, `${d} days ago`);
  }

  /** سطر يصف النسخة المحفوظة في نافذة الاستعادة */
  function describe(data, savedAt, now = Date.now()) {
    const n = k => (data && Array.isArray(data[k]) ? data[k].length : 0);
    const parts = [];
    if (n('clips')) parts.push(`${n('clips')} ${tt('مقطع', n('clips') === 1 ? 'clip' : 'clips')}`);
    if (n('overlays')) parts.push(`${n('overlays')} ${tt('طبقة', n('overlays') === 1 ? 'layer' : 'layers')}`);
    if (n('audios')) parts.push(`${n('audios')} ${tt('صوت', n('audios') === 1 ? 'audio' : 'audios')}`);
    if (n('texts')) parts.push(`${n('texts')} ${tt('نص', n('texts') === 1 ? 'text' : 'texts')}`);
    if (n('effects')) parts.push(`${n('effects')} ${tt('تأثير', n('effects') === 1 ? 'effect' : 'effects')}`);
    const name = data && data.name ? `«${data.name}» · ` : '';
    return `${name}${parts.join(' · ')} · ${tt('آخر تعديل', 'last edit')} ${ago(savedAt, now)}`;
  }

  return { planMedia, hasContent, ago, describe };
})();

if (typeof module !== 'undefined') module.exports = AutosaveTools;
