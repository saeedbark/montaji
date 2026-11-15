'use strict';
/* /api/export/save و /api/project/save — يحفظان ما يرفعه المحرر في مجلد exports/ (فيديو مصدَّر)
   أو projects/ (ملف مشروع). يستعملهما export_video و save_project عبر MCP:
   العميل الخارجي لا يستطيع الضغط على زر التنزيل في المتصفح */

const fs = require('fs'), path = require('path');
const { EXPORT_DIR, PROJECT_DIR } = require('./config');
const { json } = require('./http');

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
    req.on('data', c => { size += c.length; if (size > max) { fail(new Error('file too large')); req.destroy(); } });
    req.pipe(out);
  });
}

async function saveUpload(req, res, { dir, name, type, max }) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith(type)) return json(res, 415, { error: 'expected ' + type });
  const len = +req.headers['content-length'] || 0;
  if (len > max) return json(res, 413, { error: 'file too large' });
  fs.mkdirSync(dir, { recursive: true });
  const file = reservePath(dir, name);
  const tmp = file + '.part';
  try {
    await receive(req, tmp, max);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(file, { force: true });
    throw e;
  }
  json(res, 200, { ok: true, path: file, size: fs.statSync(file).size });
}

const saveExport = (req, res, query) => saveUpload(req, res, { dir: EXPORT_DIR, name: safeName(query.get('name')), type: 'video/mp4', max: 4 * GB });

// ملف المشروع يحمل ملفات الوسائط الأصلية كلها، فحدّه أعلى من حد الفيديو المصدَّر
const saveProject = (req, res, query) => saveUpload(req, res, { dir: PROJECT_DIR, name: safeName(query.get('name'), '.montaji', 'project'), type: 'application/zip', max: 32 * GB });

// ملف ترجمة SRT أو VTT (export_captions مع save_as) بجانب الفيديوهات المصدَّرة
const saveCaptions = (req, res, query) => {
  const ext = query.get('format') === 'vtt' ? '.vtt' : '.srt';
  return saveUpload(req, res, { dir: EXPORT_DIR, name: safeName(query.get('name'), ext, 'captions'), type: 'text/plain', max: 8 * 1024 * 1024 });
};

module.exports = { saveExport, saveProject, saveCaptions, safeName };
