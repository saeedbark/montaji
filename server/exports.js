'use strict';
/* /api/export/save و /api/project/save — يحفظان ما يرفعه المحرر في مجلد exports/ (فيديو مصدَّر)
   أو projects/ (ملف مشروع). يستعملهما export_video و save_project عبر MCP:
   العميل الخارجي لا يستطيع الضغط على زر التنزيل في المتصفح */

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { EXPORT_DIR, PROJECT_DIR } = require('./config');
const { json } = require('./http');
const { projectPath, relName } = require('./projects');

const GB = 1024 ** 3;

// أسماء أجهزة محجوزة في ويندوز: con.mp4 لا يُنشئ ملفاً بل يكتب إلى الجهاز
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** اسم ملف آمن: بلا مسارات ولا رموز محجوزة في ويندوز، وبالامتداد المطلوب */
function safeName(raw, ext = '.mp4', fallback = 'montaji') {
  let n = path.basename(String(raw || '').replace(/\\/g, '/'))
    .replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
  if (n.toLowerCase().endsWith(ext)) n = n.slice(0, -ext.length);
  n = n.replace(/[. ]+$/, '').trim();
  if (RESERVED.test(n.split('.')[0].trim())) n = '_' + n;
  return (n || fallback) + ext;
}

/**
 * يحجز اسماً غير مستعمل بإنشاء الملف فارغاً (wx يفشل إن وُجد)، فلا يأخذ حفظان متزامنان الاسم نفسه.
 * لا يكتب فوق ملف موجود: يضيف (2)، (3)…
 */
function reservePath(dir, name) {
  const ext = path.extname(name), base = name.slice(0, -ext.length);
  for (let i = 1; ; i++) {
    const f = path.join(dir, i === 1 ? name : `${base} (${i})${ext}`);
    try { fs.closeSync(fs.openSync(f, 'wx')); return f; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

/** يكتب جسم الطلب في ملف. ينتهي بعد إغلاق الملف دائماً، حتى إن انقطع الرفع، كي يمكن حذفه في ويندوز */
function receive(req, file, max) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let size = 0, failed = null;
    const fail = e => { if (failed) return; failed = e; req.unpipe(out); out.destroy(); };
    out.on('close', () => (failed ? reject(failed) : resolve()));
    out.on('error', fail);
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('upload aborted')));
    // في Node الحديث لا يصل 'aborted' دائماً حين يقطع المتصفح الرفع: كان الملف المؤقت ‎.part‎ يبقى مفتوحاً على القرص
    req.on('close', () => { if (!req.complete) fail(new Error('upload aborted')); });
    req.on('data', c => { size += c.length; if (size > max) { fail(new Error('file too large')); req.destroy(); } });
    req.pipe(out);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * يستبدل ملفاً بآخر دفعة واحدة (rename فوق الموجود)، فلا يبقى الملف نصف مكتوب لو انقطع الحفظ.
 * في ويندوز قد يمسك برنامج آخر الملف لحظات (مضاد الفيروسات، الفهرسة، معاينة المستكشف): نعيد المحاولة
 */
async function replaceFile(tmp, file, tries = 20) {
  for (let i = 1; ; i++) {
    try { return fs.renameSync(tmp, file); } catch (e) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
          throw Object.assign(new Error('ملف المشروع مفتوح في برنامج آخر. أغلقه ثم احفظ من جديد.'), { en: 'The project file is open in another program. Close it and save again.' });
        }
        throw e;
      }
      await sleep(150);
    }
  }
}

/**
 * يحفظ جسم الطلب في ملف. replace: المسار الكامل لملف يُكتب فوقه (حفظ المشروع في ملفه نفسه)،
 * وإلا يُحجز اسم جديد في dir بلا كتابة فوق أي ملف. reply: يضيف حقولاً إلى الرد
 */
async function saveUpload(req, res, { dir, name, type, max, replace, reply = r => r }) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith(type)) return json(res, 415, { error: 'expected ' + type });
  const len = +req.headers['content-length'] || 0;
  if (len > max) return json(res, 413, { error: 'file too large' });
  let file, tmp;
  if (replace) {
    fs.mkdirSync(path.dirname(replace), { recursive: true });
    file = replace;
    tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.part`; // اسم مؤقت لكل حفظ: حفظان متزامنان لا يتصادمان
  } else {
    fs.mkdirSync(dir, { recursive: true });
    file = reservePath(dir, name);
    tmp = file + '.part';
  }
  try {
    await receive(req, tmp, max);
    if (replace) await replaceFile(tmp, file); else fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (!replace) fs.rmSync(file, { force: true }); // الاسم المحجوز فارغ؛ أما الملف الموجود فلا يُمسّ
    throw e;
  }
  json(res, 200, reply({ ok: true, path: file, size: fs.statSync(file).size }));
}

const saveExport = (req, res, query) => saveUpload(req, res, { dir: EXPORT_DIR, name: safeName(query.get('name')), type: 'video/mp4', max: 4 * GB });

/**
 * ملف المشروع يحمل ملفات الوسائط الأصلية كلها، فحدّه أعلى من حد الفيديو المصدَّر.
 * overwrite=1 مع اسم نسبي داخل projects/ ("اسم.montaji" أو "مجلد/اسم.montaji"): حفظ المشروع في ملفه نفسه.
 * بدونه: اسم جديد لا يكتب فوق أي ملف (يُضاف (2)، (3)…). الرد يحمل name: الاسم النسبي للحفظ التالي
 */
async function saveProject(req, res, query) {
  let replace = null;
  if (query.get('overwrite') === '1') {
    replace = projectPath(query.get('name'));
    if (!replace) return json(res, 400, { error: 'اسم ملف المشروع غير صالح', error_en: 'Invalid project file name' });
  }
  return saveUpload(req, res, { dir: PROJECT_DIR, name: safeName(query.get('name'), '.montaji', 'project'), type: 'application/zip', max: 32 * GB, replace,
    reply: r => ({ ...r, name: relName(r.path), dir: path.resolve(PROJECT_DIR) }) });
}

// ملف ترجمة SRT أو VTT (export_captions مع save_as) بجانب الفيديوهات المصدَّرة
const saveCaptions = (req, res, query) => {
  const ext = query.get('format') === 'vtt' ? '.vtt' : '.srt';
  return saveUpload(req, res, { dir: EXPORT_DIR, name: safeName(query.get('name'), ext, 'captions'), type: 'text/plain', max: 8 * 1024 * 1024 });
};

module.exports = { saveExport, saveProject, saveCaptions, safeName };
