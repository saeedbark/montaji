'use strict';
/* أدوات HTTP المشتركة: أنواع الملفات، ردود JSON، قراءة جسم الطلب، فحص المصدر، وتقديم ملفات الواجهة */

const fs = require('fs'), path = require('path');
const { PUBLIC_DIR, PORT } = require('./config');

const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
};
const MEDIA_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|mp4|m4v|mov|webm|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)$/i;

const contentType = file => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

/** لغة الطلب: كوكي montaji_lang التي تضبطها الواجهة. العربية افتراضياً (وللطرفية وعملاء MCP) */
const langOf = req => (/(?:^|;\s*)montaji_lang=en(?:;|$)/.test(req.headers.cookie || '') ? 'en' : 'ar');

/**
 * رسائل الخادم ثنائية اللغة: الحقل X_en بجانب X يحل محله في الواجهة الإنجليزية، ويُحذف في الحالتين.
 * تكفي ثلاثة مستويات (الرد، وأجزاؤه مثل stt و choices في /api/config، وعناصرها)، فلا تُمسح الردود الكبيرة كلها
 */
function pickLang(data, en, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 2) return data;
  if (Array.isArray(data)) return depth > 1 ? data : data.map(v => pickLang(v, en, depth + 1));
  if (!Object.keys(data).some(k => k.endsWith('_en')) && depth) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.endsWith('_en') && k.slice(0, -3) in data) continue;
    const e = data[k + '_en'];
    out[k] = en && e != null ? e : pickLang(v, en, depth + 1);
  }
  return out;
}

function json(res, status, data) {
  if (res.headersSent) return;
  data = pickLang(data, res.lang === 'en');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('الطلب أكبر من المسموح'), { en: 'The request is too large' })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// الواجهات تقبل الطلبات من الصفحة المحلية نفسها فقط، كي لا يستعمل موقع آخر مفتاحك أو محرّرك
function trusted(req) {
  if (!HOSTS.includes(req.headers.host)) return false;
  const o = req.headers.origin;
  return !o || HOSTS.some(h => o === 'http://' + h);
}

function serveStatic(req, res, p) {
  if (p === '/') p = '/index.html';
  const f = path.join(PUBLIC_DIR, p);
  // لا يُقدَّم شيء خارج public/ ولا أي ملف مخفي.
  // الفحص على المسار الناتج لا على نص الرابط: في ويندوز «\» فاصل أيضاً، فالرابط /js\..\.env كان يتجاوز الفحص
  const rel = path.relative(PUBLIC_DIR, f);
  const hidden = !rel || path.isAbsolute(rel) || rel.split(path.sep).some(s => s.startsWith('.'));
  if (hidden || /[\\:\0]/.test(p)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    // no-cache: المتصفح يسأل في كل مرة، فيصل أي تحديث للملفات فوراً، وإن لم يتغيّر الملف فالرد 304 بلا جسم
    // (ويحتفظ المتصفح بنسخته المترجمة من السكربتات بدل تحليلها من جديد عند كل فتح)
    const etag = `W/"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
    const head = { 'Content-Type': contentType(f), 'Cache-Control': 'no-cache', ETag: etag, 'Accept-Ranges': 'bytes' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
    // Range: مشغّل الفيديو (فيديو الدليل) يطلب الجزء الذي يحتاجه فقط، فيبدأ فوراً ويقفز بلا تحميل الملف كله
    let start = 0, end = st.size - 1, status = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2]) && st.size) {
      if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(end, +m[2]); }
      else start = Math.max(0, st.size - +m[2]);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      status = 206;
      head['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    head['Content-Length'] = end - start + 1;
    res.writeHead(status, head);
    if (req.method === 'HEAD' || !st.size) return res.end();
    // بثّ من القرص: الملف الكبير لا يُحمَّل كله في ذاكرة الخادم
    fs.createReadStream(f, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

module.exports = { TYPES, MEDIA_EXT, contentType, langOf, pickLang, json, readBody, trusted, serveStatic };
