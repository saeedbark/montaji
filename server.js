'use strict';
/* خادم مونتاجي المحلي — بلا أي مكتبات خارجية (Node 18 أو أحدث)
   1) يقدّم ملفات المحرر
   2) /api/chat   يوصل الشات بمزوّد الذكاء الاصطناعي؛ المفتاح يبقى في ملف .env ولا يصل إلى المتصفح
   3) /mcp        خادم MCP: أي عميل خارجي (Claude Code, Cursor...) يتحكم بالمحرر المفتوح في المتصفح */

const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const TOOLS = require('./js/tools.js');

const ROOT = __dirname;
const PORT = +process.env.PORT || 5173;
const ENV_FILE = path.join(ROOT, '.env');
const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];

/* ================= الإعدادات (.env) ================= */
// يُقرأ الملف عند كل طلب، فتعديل المفتاح لا يحتاج إعادة تشغيل
function readEnv() {
  const vals = {};
  let txt = '';
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch (e) { /* لا ملف بعد */ }
  for (const line of txt.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    vals[m[1]] = v;
  }
  return k => vals[k] || process.env[k] || '';
}

// كل المزوّدين يُخاطَبون بصيغة OpenAI Chat Completions (Gemini و Claude يوفّران نقطة متوافقة معها)
const PROVIDERS = {
  gemini:     { label: 'Google Gemini', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash' },
  openai:     { label: 'OpenAI', keys: ['OPENAI_API_KEY'], base: 'https://api.openai.com/v1', model: 'gpt-5.4-mini' },
  anthropic:  { label: 'Anthropic Claude', keys: ['ANTHROPIC_API_KEY'], base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  openrouter: { label: 'OpenRouter', keys: ['OPENROUTER_API_KEY'], base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  ollama:     { label: 'Ollama', keys: [], base: 'http://localhost:11434/v1', model: '' },
  custom:     { label: 'مزوّد مخصّص', keys: ['AI_API_KEY'], base: '', model: '' },
};

function provider() {
  const env = readEnv();
  const keyOf = p => p.keys.map(env).find(Boolean) || '';
  let id = env('AI_PROVIDER').toLowerCase();
  if (id && !PROVIDERS[id]) return { error: `المزوّد «${id}» غير معروف. القيم المتاحة: ${Object.keys(PROVIDERS).join(' ، ')}` };
  if (!id) id = Object.keys(PROVIDERS).find(k => keyOf(PROVIDERS[k])) || (env('AI_BASE_URL') ? 'custom' : '');
  if (!id) return { error: 'لم يُضبط أي مفتاح بعد' };
  const p = PROVIDERS[id];
  const key = keyOf(p) || env('AI_API_KEY');
  const base = (env('AI_BASE_URL') || p.base).replace(/\/+$/, '');
  const model = env('AI_MODEL') || p.model;
  if (!key && id !== 'ollama' && id !== 'custom') return { error: `المفتاح ${p.keys[0]} فارغ في ملف .env` };
  if (!base) return { error: 'حدّد AI_BASE_URL في ملف .env' };
  if (!model) return { error: 'حدّد اسم النموذج AI_MODEL في ملف .env' };
  return { id, label: p.label, key, base, model, vision: !/^(off|false|0|no)$/i.test(env('AI_VISION')) };
}

/* ================= أدوات HTTP ================= */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
};
const MEDIA_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|mp4|m4v|mov|webm|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)$/i;

function json(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('الطلب أكبر من المسموح')); req.destroy(); } else chunks.push(c);
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
  const f = path.join(ROOT, p);
  // لا تُقدَّم الملفات المخفية (.env وغيرها) ولا أي شيء خارج مجلد المشروع
  if (!f.startsWith(ROOT + path.sep) || p.split('/').some(s => s.startsWith('.'))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

/* ================= الشات ================= */
function publicConfig() {
  const p = provider();
  const base = { envFile: '.env', mcp: `http://localhost:${PORT}/mcp` };
  return p.error ? { ...base, ready: false, error: p.error } : { ...base, ready: true, provider: p.id, label: p.label, model: p.model, vision: p.vision };
}

async function chat(req, res) {
  const body = JSON.parse(await readBody(req, 48e6));
  const p = provider();
  if (p.error) return json(res, 400, { error: p.error, setup: true });
  if (typeof fetch !== 'function') return json(res, 500, { error: 'الشات يحتاج Node.js بإصدار 18 أو أحدث' });

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  const payload = { model: p.model, messages: body.messages };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;
  const headers = { 'Content-Type': 'application/json' };
  if (p.key) headers.Authorization = 'Bearer ' + p.key;

  let r, text;
  try {
    // ازدحام المزوّد (5xx) عابر غالباً: نعيد المحاولة مرتين قبل إبلاغ المستخدم
    for (let attempt = 0; ; attempt++) {
      r = await fetch(p.base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      text = await r.text();
      if (r.status < 500 || attempt >= 2) break;
      await new Promise(done => setTimeout(done, 1500 * (attempt + 1)));
      if (ctrl.signal.aborted) return;
    }
  } catch (e) {
    if (ctrl.signal.aborted) return;
    return json(res, 502, { error: `تعذّر الاتصال بـ ${p.label} — تحقق من الإنترنت${p.id === 'ollama' ? ' ومن أن Ollama يعمل' : ''}.` });
  }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* رد غير متوقع */ }
  if (!r.ok) {
    const e = Array.isArray(data) ? data[0] && data[0].error : data && data.error;
    const detail = (typeof e === 'string' ? e : e && e.message) || text.slice(0, 300);
    const hint = r.status === 401 || r.status === 403 ? 'المفتاح مرفوض — تأكد من صحته في ملف .env'
      : r.status === 404 ? `النموذج «${p.model}» غير متاح — غيّر AI_MODEL في ملف .env`
      : r.status === 429 ? 'تجاوزت حد الاستخدام أو انتهى الرصيد لدى المزوّد'
      : r.status >= 500 ? `${p.label} مزدحم الآن — أعد إرسال رسالتك بعد لحظات`
      : `خطأ من ${p.label} (${r.status})`;
    return json(res, 502, { error: hint, detail });
  }
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return json(res, 502, { error: `رد غير مفهوم من ${p.label}`, detail: text.slice(0, 300) });
  json(res, 200, { message, usage: data.usage || null, model: p.model });
}

/* ================= الجسر إلى المتصفح ================= */
// المشروع يعيش داخل تبويب المحرر؛ الخادم يرسل له نداءات الأدوات عبر SSE وينتظر النتيجة
const tabs = new Set();
const pending = new Map();
const mediaTokens = new Map();
let activeTab = null;

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

function callBrowser(name, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!activeTab) return reject(new Error(`The Montaji editor is not open. Ask the user to open http://localhost:${PORT} in Chrome or Edge, then retry.`));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The editor did not answer in time.')); }, timeoutMs);
    pending.set(id, r => { clearTimeout(timer); pending.delete(id); resolve(r); });
    activeTab.write(`data: ${JSON.stringify({ id, name, args })}\n\n`);
  });
}

function serveMedia(res, token) {
  const file = mediaTokens.get(token);
  if (!file) { res.writeHead(404); return res.end(); }
  mediaTokens.delete(token);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/* ================= خادم MCP (Streamable HTTP، بلا جلسات) ================= */
const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MCP_TOOLS = [
  ...TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
  {
    name: 'import_media',
    description: 'Add image, video or audio files from this computer to the project by absolute path. Images and videos are appended to the main track in the given order; audio goes to the music track. Returns the new item ids.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths.' } }, required: ['paths'] },
  },
];
const MCP_INSTRUCTIONS = 'Montaji is a video editor running in the user\'s browser. These tools edit the project that is open there, live. '
  + 'Start with get_project. The main track is a gapless sequence of clips (images and videos); texts and audio are placed freely by start time. '
  + 'Add files with import_media, arrange and style them, then call export_video only if the user asks for the final file.';

async function mcpCall(params) {
  const name = params && params.name;
  let args = (params && params.arguments) || {};
  if (!MCP_TOOLS.some(t => t.name === name)) throw Object.assign(new Error('Unknown tool: ' + name), { code: -32602 });
  try {
    if (name === 'import_media') {
      const files = [];
      for (const p of args.paths || []) {
        const abs = path.resolve(String(p));
        if (!MEDIA_EXT.test(abs)) throw new Error('Unsupported file type: ' + abs);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('File not found: ' + abs);
        const token = crypto.randomBytes(16).toString('hex');
        mediaTokens.set(token, abs);
        files.push({ url: '/api/media/' + token, name: path.basename(abs) });
      }
      if (!files.length) throw new Error('paths is empty');
      args = { files };
    }
    const r = await callBrowser(name, args, name === 'export_video' ? 30 * 60e3 : 5 * 60e3);
    const content = [{ type: 'text', text: JSON.stringify(r.data) }];
    for (const u of r.images || []) {
      const m = /^data:(.+?);base64,(.*)$/.exec(u);
      if (m) content.push({ type: 'image', mimeType: m[1], data: m[2] });
    }
    return { content, isError: !!r.error };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

async function mcpMessage(m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  if (m.id === undefined || m.id === null) return null; // إشعار بلا رد
  const ok = result => ({ jsonrpc: '2.0', id: m.id, result });
  try {
    switch (m.method) {
      case 'initialize': {
        const want = m.params && m.params.protocolVersion;
        return ok({
          protocolVersion: MCP_VERSIONS.includes(want) ? want : MCP_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'montaji', title: 'Montaji video editor', version: '1.0.0' },
          instructions: MCP_INSTRUCTIONS,
        });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: MCP_TOOLS });
      case 'tools/call': return ok(await mcpCall(m.params));
      default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found: ' + m.method } };
    }
  } catch (e) {
    return { jsonrpc: '2.0', id: m.id, error: { code: e.code || -32603, message: e.message } };
  }
}

async function mcp(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  let msg;
  try { msg = JSON.parse(await readBody(req, 4e6)); }
  catch (e) { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const out = Array.isArray(msg) ? (await Promise.all(msg.map(mcpMessage))).filter(Boolean) : await mcpMessage(msg);
  if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202); return res.end(); }
  json(res, 200, out);
}

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
        const done = pending.get(b.id);
        if (done) done(b.result || { data: { error: 'empty result' }, error: true });
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

server.listen(PORT, '127.0.0.1', () => {
  // أول تشغيل: أنشئ ملف المفاتيح من القالب ليملأه المستخدم
  if (!fs.existsSync(ENV_FILE)) {
    try { fs.copyFileSync(path.join(ROOT, '.env.example'), ENV_FILE); } catch (e) { /* القالب مفقود */ }
  }
  const p = provider();
  console.log(`\n  Montaji        http://localhost:${PORT}`);
  console.log(`  MCP server     http://localhost:${PORT}/mcp`);
  console.log(p.error
    ? `  AI chat        off - put your API key in ${ENV_FILE}\n`
    : `  AI chat        ${p.id} / ${p.model}\n`);
});
