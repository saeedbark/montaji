'use strict';
/* مجلد المشاريع projects/ — المكان الافتراضي لحفظ المشاريع من المحرر.
   GET  /api/projects              قائمة ملفات ‎.montaji‎ فيه (وفي مجلداته الفرعية المباشرة)، الأحدث أولاً
   GET  /api/project/file?name=…   يرسل ملف مشروع منه إلى الصفحة لتفتحه
   POST /api/project/reveal?name=… يفتح المجلد في مستكشف الملفات ويحدد الملف
   الأسماء نسبية داخل المجلد فقط ("اسم.montaji" أو "مجلد/اسم.montaji")، ولا يُقبل ما يخرج منه */

const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { PROJECT_DIR } = require('./config');
const { json } = require('./http');

const EXT = '.montaji';
// أسماء أجهزة محجوزة في ويندوز، ورموز يرفضها في أسماء الملفات
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const BAD = /[<>:"|?*\u0000-\u001f]/;

/**
 * المسار الكامل لاسم نسبي داخل مجلد المشاريع، أو null إن لم يكن اسماً مقبولاً:
 * جزء أو جزءان (مجلد فرعي واحد)، بلا .. ولا رموز محجوزة، وبالامتداد ‎.montaji‎
 */
function projectPath(rel, dir = PROJECT_DIR) {
  const parts = String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  for (const p of parts) {
    if (p === '.' || p === '..' || p.length > 160 || BAD.test(p) || /^\.|[. ]$/.test(p) || RESERVED.test(p.split('.')[0].trim())) return null;
  }
  if (!parts[parts.length - 1].toLowerCase().endsWith(EXT)) return null;
  const root = path.resolve(dir), abs = path.resolve(root, ...parts);
  return abs.startsWith(root + path.sep) ? abs : null;
}

/** الاسم النسبي لملف داخل مجلد المشاريع بشرطة مائلة أمامية (كما تستعمله الواجهة) */
const relName = (abs, dir = PROJECT_DIR) => path.relative(path.resolve(dir), abs).split(path.sep).join('/');

/** ملفات المشاريع في المجلد ومجلداته الفرعية المباشرة: [{ name, size, modified }] الأحدث أولاً */
function scan(dir = PROJECT_DIR) {
  const out = [];
  const add = (abs, name) => {
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) out.push({ name, size: st.size, modified: Math.round(st.mtimeMs) });
    } catch (e) { /* حُذف أثناء القراءة */ }
  };
  let top = [];
  try { top = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const d of top) {
    if (d.isFile() && d.name.toLowerCase().endsWith(EXT)) add(path.join(dir, d.name), d.name);
    else if (d.isDirectory() && !d.name.startsWith('.')) {
      let sub = [];
      try { sub = fs.readdirSync(path.join(dir, d.name), { withFileTypes: true }); } catch (e) { continue; }
      for (const s of sub) if (s.isFile() && s.name.toLowerCase().endsWith(EXT)) add(path.join(dir, d.name, s.name), `${d.name}/${s.name}`);
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

function listProjects(req, res) {
  json(res, 200, { dir: path.resolve(PROJECT_DIR), projects: scan() });
}

function notFound(res) {
  json(res, 404, { error: 'ملف المشروع غير موجود في مجلد projects', error_en: 'The project file is not in the projects folder' });
}

function serveProject(req, res, query) {
  const abs = projectPath(query.get('name'));
  let st = null;
  try { st = abs && fs.statSync(abs); } catch (e) { /* غير موجود */ }
  if (!st || !st.isFile()) return notFound(res);
  res.writeHead(200, {
    'Content-Type': 'application/zip', 'Content-Length': st.size, 'Cache-Control': 'no-store',
    'Last-Modified': new Date(st.mtimeMs).toUTCString(),
  });
  fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
}

/** يفتح مستكشف الملفات على ملف المشروع (أو على المجلد إن لم يُعطَ اسم) */
function revealProject(req, res, query) {
  const name = query.get('name');
  const abs = name ? projectPath(name) : path.resolve(PROJECT_DIR);
  if (!abs || !fs.existsSync(abs)) return notFound(res);
  if (!name) fs.mkdirSync(abs, { recursive: true });
  const [cmd, args] = process.platform === 'win32' ? ['explorer', name ? [`/select,${abs}`] : [abs]]
    : process.platform === 'darwin' ? ['open', name ? ['-R', abs] : [abs]]
    : ['xdg-open', [name ? path.dirname(abs) : abs]];
  if (!process.env.MONTAJI_NO_REVEAL) {
    try {
      const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
      c.on('error', () => {});
      c.unref();
    } catch (e) { /* لا مستكشف ملفات */ }
  }
  json(res, 200, { ok: true, path: abs });
}

module.exports = { projectPath, relName, scan, listProjects, serveProject, revealProject };
