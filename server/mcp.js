'use strict';
/* /mcp — خادم MCP (Streamable HTTP، بلا جلسات).
   أي عميل خارجي (Claude Code, Cursor...) يتحكم بالمحرر المفتوح في المتصفح عبر الجسر */

const fs = require('fs'), path = require('path');
const { PUBLIC_DIR, VERSION } = require('./config');
const { MEDIA_EXT, json, readBody } = require('./http');
const { callBrowser, registerMedia } = require('./bridge');

const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

// تعريف الأدوات ملف واحد يشترك فيه المتصفح والخادم.
// يُقرأ من جديد عند كل طلب، فإضافة أداة لا تحتاج إعادة تشغيل الخادم (يكفي تحديث صفحة المحرر)
const TOOLS_FILE = path.join(PUBLIC_DIR, 'js', 'tools.js');
let lastTools = require(TOOLS_FILE);
function loadTools() {
  try { delete require.cache[require.resolve(TOOLS_FILE)]; lastTools = require(TOOLS_FILE); }
  catch (e) { console.error('tools.js:', e.message); }
  return lastTools;
}

// الأداة الوحيدة التي ينفّذ الخادم جزءاً منها: المتصفح لا يستطيع قراءة ملفات الجهاز بمسارها
const IMPORT_TOOL = {
  name: 'import_media',
  description: 'Add image, video or audio files from this computer to the project by absolute path. Images and videos are appended to the main track in the given order; audio goes to the music track. Returns the new item ids.',
  inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths.' } }, required: ['paths'] },
};
const mcpTools = () => [
  ...loadTools().map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
  IMPORT_TOOL,
];
const MCP_INSTRUCTIONS = 'Montaji is a video editor running in the user\'s browser. These tools edit the project that is open there, live. '
  + 'Start with get_project. The main track is a gapless sequence of clips (images and videos); texts, effects and audio are placed freely by start time. '
  + 'Effects (add_effect) sit on their own track over the picture; burst effects such as zoomBlur go on the cuts (at_cuts) and stay there after re-timing. '
  + 'Add files with import_media, arrange and style them, then call export_video only if the user asks for the final file. '
  + 'When there is music, finish with sync_to_beat so every cut lands on a beat (again after any change to the clip order or count); '
  + 'on fast music use 2 beats per clip, short transitions and pulse.';

async function mcpCall(params) {
  const name = params && params.name;
  let args = (params && params.arguments) || {};
  if (!mcpTools().some(t => t.name === name)) throw Object.assign(new Error('Unknown tool: ' + name), { code: -32602 });
  try {
    if (name === 'import_media') {
      const files = [];
      for (const p of args.paths || []) {
        const abs = path.resolve(String(p));
        if (!MEDIA_EXT.test(abs)) throw new Error('Unsupported file type: ' + abs);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('File not found: ' + abs);
        files.push({ url: registerMedia(abs), name: path.basename(abs) });
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
          serverInfo: { name: 'montaji', title: 'Montaji video editor', version: VERSION },
          instructions: MCP_INSTRUCTIONS,
        });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: mcpTools() });
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

module.exports = { mcp };
