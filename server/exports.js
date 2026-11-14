'use strict';
/* /api/export/save — يحفظ الفيديو المصدَّر في مجلد exports/ داخل المشروع.
   يستعمله export_video عبر MCP: العميل الخارجي لا يستطيع الضغط على زر التنزيل في المتصفح */

const fs = require('fs'), path = require('path');
const { EXPORT_DIR } = require('./config');
const { json } = require('./http');

const MAX_BYTES = 4 * 1024 ** 3;

// أسماء أجهزة محجوزة في ويندوز: con.mp4 لا يُنشئ ملفاً بل يكتب إلى الجهاز
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** اسم ملف آمن: بلا مسارات ولا رموز محجوزة في ويندوز، وبامتداد .mp4 */
function safeName(raw) {
  let n = path.basename(String(raw || '').replace(/\\/g, '/'))
    .replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
  n = n.replace(/\.mp4$/i, '').replace(/[. ]+$/, '').trim();
  if (RESERVED.test(n.split('.')[0].trim())) n = '_' + n;
  return (n || 'montaji') + '.mp4';
}

/**
 * يحجز اسماً غير مستعمل بإنشاء الملف فارغاً (wx يفشل إن وُجد)، فلا يأخذ حفظان متزامنان الاسم نفسه.
 * لا يكتب فوق ملف موجود: يضيف (2)، (3)…
 */
function reservePath(dir, name) {
  const base = name.slice(0, -4);
  for (let i = 1; ; i++) {
    const f = path.join(dir, i === 1 ? name : `${base} (${i}).mp4`);
    try { fs.closeSync(fs.openSync(f, 'wx')); return f; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

/** يكتب جسم الطلب في ملف. ينتهي بعد إغلاق الملف دائماً، حتى إن انقطع الرفع، كي يمكن حذفه في ويندوز */
function receive(req, file) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let size = 0, failed = null;
    const fail = e => { if (failed) return; failed = e; req.unpipe(out); out.destroy(); };
    out.on('close', () => (failed ? reject(failed) : resolve()));
    out.on('error', fail);
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('upload aborted')));
    req.on('data', c => { size += c.length; if (size > MAX_BYTES) { fail(new Error('file too large')); req.destroy(); } });
    req.pipe(out);
  });
}

async function saveExport(req, res, query) {
  if (!/^video\/mp4\b/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'expected video/mp4' });
  const len = +req.headers['content-length'] || 0;
  if (len > MAX_BYTES) return json(res, 413, { error: 'file too large' });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const file = reservePath(EXPORT_DIR, safeName(query.get('name')));
  const tmp = file + '.part';
  try {
    await receive(req, tmp);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(file, { force: true });
    throw e;
  }
  json(res, 200, { ok: true, path: file, size: fs.statSync(file).size });
}

module.exports = { saveExport, safeName };
