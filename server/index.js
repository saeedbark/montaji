'use strict';
/* خادم مونتاجي المحلي — بلا أي مكتبات خارجية (Node 18 أو أحدث)

   config.js   الإعدادات وملف .env ومزوّدو الذكاء الاصطناعي
   http.js     أدوات HTTP وتقديم ملفات الواجهة من public/
   chat.js     /api/chat  يوصل الشات بالمزوّد؛ المفتاح يبقى في .env ولا يصل إلى المتصفح
   bridge.js   /api/bridge  قناة بين الخادم وتبويب المحرر
   mcp.js      /mcp  خادم MCP: أي عميل خارجي يتحكم بالمحرر المفتوح في المتصفح */

const http = require('http'), fs = require('fs');
const { PORT, ENV_FILE, ENV_TEMPLATE, provider, publicConfig } = require('./config');
const { json, readBody, trusted, serveStatic } = require('./http');
const { chat } = require('./chat');
const { openBridge, resolveResult, serveMedia } = require('./bridge');
const { mcp } = require('./mcp');

/* ================= التوجيه ================= */
const server = http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  const api = p.startsWith('/api/') || p === '/mcp';
  if (!api) return serveStatic(req, res, p);
  if (!trusted(req)) return json(res, 403, { error: 'forbidden' });
  try {
    if (p === '/mcp') return await mcp(req, res);
    if (p === '/api/config' && req.method === 'GET') return json(res, 200, publicConfig());
    if (p === '/api/bridge' && req.method === 'GET') return openBridge(req, res);
    if (p.startsWith('/api/media/') && req.method === 'GET') return serveMedia(res, p.slice(11));
    if (req.method === 'POST' && /json/.test(req.headers['content-type'] || '')) {
      if (p === '/api/chat') return await chat(req, res);
      if (p === '/api/bridge/result') {
        const b = JSON.parse(await readBody(req, 48e6));
        resolveResult(b.id, b.result);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message || String(e) });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`المنفذ ${PORT} مستخدم — ربما المحرر يعمل مسبقاً. افتح http://localhost:${PORT}`);
  else console.error(e);
  process.exit(1);
});

// الاستماع على 127.0.0.1 فقط: المحرر لا يُفتح لأجهزة الشبكة
server.listen(PORT, '127.0.0.1', () => {
  // أول تشغيل: أنشئ ملف المفاتيح من القالب ليملأه المستخدم
  if (!fs.existsSync(ENV_FILE)) {
    try { fs.copyFileSync(ENV_TEMPLATE, ENV_FILE); } catch (e) { /* القالب مفقود */ }
  }
  const p = provider();
  console.log(`\n  Montaji        http://localhost:${PORT}`);
  console.log(`  MCP server     http://localhost:${PORT}/mcp`);
  console.log(p.error
    ? `  AI chat        off - put your API key in ${ENV_FILE}\n`
    : `  AI chat        ${p.id} / ${p.model}\n`);
});
