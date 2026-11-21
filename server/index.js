'use strict';
/* خادم مونتاجي المحلي — بلا أي مكتبات خارجية (Node 18 أو أحدث)

   config.js   الإعدادات وملف .env ومزوّدو الذكاء الاصطناعي
   http.js     أدوات HTTP وتقديم ملفات الواجهة من public/
   chat.js     /api/chat  يوصل الشات بالمزوّد؛ المفتاح يبقى في .env ولا يصل إلى المتصفح
   bridge.js   /api/bridge  قناة بين الخادم وتبويب المحرر
   mcp.js      /mcp  خادم MCP: أي عميل خارجي يتحكم بالمحرر المفتوح في المتصفح */

const http = require('http'), fs = require('fs'), { spawn } = require('child_process');
const { PORT, ENV_FILE, ENV_TEMPLATE, provider, publicConfig } = require('./config');
const { langOf, json, readBody, trusted, serveStatic } = require('./http');
const { chat } = require('./chat');
const { openBridge, resolveResult, serveMedia } = require('./bridge');
const { mcp } = require('./mcp');
const { saveExport, saveProject, saveCaptions } = require('./exports');
const { transcribe } = require('./stt');
const { saveKey, saveModel, listModels } = require('./settings');

// --open: يفتح المحرر في المتصفح بعد أن يصبح الخادم جاهزاً (start.bat و start.command يمرّرانه)
const OPEN = process.argv.includes('--open');
const URL_ = `http://localhost:${PORT}`;

/** يفتح الرابط في المتصفح الافتراضي. الفشل لا يوقف الخادم: الرابط مطبوع في النافذة */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    c.on('error', () => {});
    c.unref();
  } catch (e) { /* لا متصفح */ }
}

/* ================= التوجيه ================= */
const server = http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  const api = p.startsWith('/api/') || p === '/mcp';
  res.lang = langOf(req); // لغة رسائل الخطأ (json يختار error_en بالإنجليزية)
  if (!api) return serveStatic(req, res, p);
  if (!trusted(req)) return json(res, 403, { error: 'forbidden' });
  try {
    if (p === '/mcp') return await mcp(req, res);
    if (p === '/api/config' && req.method === 'GET') return json(res, 200, publicConfig());
    if (p === '/api/bridge' && req.method === 'GET') return openBridge(req, res);
    if (p === '/api/models' && req.method === 'GET') return await listModels(req, res, new URL(req.url, 'http://x').searchParams);
    if (p.startsWith('/api/media/') && req.method === 'GET') return serveMedia(res, p.slice(11));
    if (p === '/api/export/save' && req.method === 'POST') return await saveExport(req, res, new URL(req.url, 'http://x').searchParams);
    if (p === '/api/captions/save' && req.method === 'POST') return await saveCaptions(req, res, new URL(req.url, 'http://x').searchParams);
    if (p === '/api/transcribe' && req.method === 'POST') return await transcribe(req, res, new URL(req.url, 'http://x').searchParams);
    if (p === '/api/project/save' && req.method === 'POST') return await saveProject(req, res, new URL(req.url, 'http://x').searchParams);
    if (req.method === 'POST' && /json/.test(req.headers['content-type'] || '')) {
      if (p === '/api/chat') return await chat(req, res);
      if (p === '/api/settings/key') return await saveKey(req, res);
      if (p === '/api/settings/model') return await saveModel(req, res);
      if (p === '/api/bridge/result') {
        const b = JSON.parse(await readBody(req, 48e6));
        resolveResult(b.id, b.result);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message || String(e), error_en: e.en });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // غالباً المحرر يعمل في نافذة أخرى: مع --open نفتحه وننهي هذه النسخة بهدوء
    console.error(`\n  Port ${PORT} is already in use - Montaji is probably already running.\n  Open ${URL_}\n`);
    if (OPEN) { openBrowser(URL_); return setTimeout(() => process.exit(0), 500); }
  } else console.error(e);
  process.exit(1);
});

// الاستماع على 127.0.0.1 فقط: المحرر لا يُفتح لأجهزة الشبكة
server.listen(PORT, '127.0.0.1', () => {
  // أول تشغيل: أنشئ ملف المفاتيح من القالب ليملأه المستخدم
  if (!fs.existsSync(ENV_FILE)) {
    try { fs.copyFileSync(ENV_TEMPLATE, ENV_FILE); } catch (e) { /* القالب مفقود */ }
  }
  const p = provider();
  console.log(`\n  Montaji        ${URL_}`);
  console.log(`  MCP server     ${URL_}/mcp`);
  console.log(p.error
    ? '  AI chat        off - open the assistant in the editor and paste your API key'
    : `  AI chat        ${p.id} / ${p.model}`);
  console.log('\n  Keep this window open while you use Montaji.');
  console.log('  Close it (or press Ctrl+C) to stop the editor.\n');
  if (OPEN) openBrowser(URL_);
});
