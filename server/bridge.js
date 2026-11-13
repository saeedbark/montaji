'use strict';
/* الجسر إلى المتصفح.
   المشروع يعيش داخل تبويب المحرر؛ الخادم يرسل له نداءات الأدوات عبر SSE (/api/bridge)
   وينتظر النتيجة التي يعيدها التبويب بطلب POST (/api/bridge/result) */

const fs = require('fs'), crypto = require('crypto');
const { PORT } = require('./config');
const { contentType } = require('./http');

const tabs = new Set();          // اتصالات SSE المفتوحة (تبويب لكل اتصال)
const pending = new Map();       // id النداء ← دالة تُكمل الوعد عند وصول النتيجة
const mediaTokens = new Map();   // رمز لمرة واحدة ← مسار ملف على الجهاز
let activeTab = null;            // آخر تبويب فُتح: هو الذي يستقبل النداءات

function openBridge(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  tabs.add(res);
  activeTab = res;
  req.on('close', () => {
    tabs.delete(res);
    if (activeTab === res) activeTab = [...tabs].pop() || null;
  });
}
setInterval(() => { for (const t of tabs) t.write(': ping\n\n'); }, 25000).unref();

/** ينفّذ أداة داخل تبويب المحرر ويعيد نتيجتها { data, images?, error? } */
function callBrowser(name, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!activeTab) return reject(new Error(`The Montaji editor is not open. Ask the user to open http://localhost:${PORT} in Chrome or Edge, then retry.`));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The editor did not answer in time.')); }, timeoutMs);
    pending.set(id, r => { clearTimeout(timer); pending.delete(id); resolve(r); });
    activeTab.write(`data: ${JSON.stringify({ id, name, args })}\n\n`);
  });
}

/** يستقبل نتيجة نداء من التبويب */
function resolveResult(id, result) {
  const done = pending.get(id);
  if (done) done(result || { data: { error: 'empty result' }, error: true });
}

/** يمنح ملفاً محلياً رابطاً مؤقتاً يُقرأ مرة واحدة، كي يحمّله المتصفح دون كشف مسارات الجهاز */
function registerMedia(absPath) {
  const token = crypto.randomBytes(16).toString('hex');
  mediaTokens.set(token, absPath);
  return '/api/media/' + token;
}

function serveMedia(res, token) {
  const file = mediaTokens.get(token);
  if (!file) { res.writeHead(404); return res.end(); }
  mediaTokens.delete(token);
  res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

module.exports = { openBridge, callBrowser, resolveResult, registerMedia, serveMedia };
