'use strict';
/* اختبارات الخادم من الخارج: تشغيله على منفذ حر ثم مخاطبته عبر HTTP */

const { describe, before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let port, child, tmp;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// http.request مباشرة: fetch يطبّع المسار (يحذف ..) فلا يصلح لاختبار تجاوز المجلدات
function request(reqPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers: { Host: `localhost:${port}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* ليس JSON */ }
        resolve({ status: res.statusCode, type: res.headers['content-type'] || '', headers: res.headers, text, data });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const rpc = (method, params, id = 1) => request('/mcp', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { jsonrpc: '2.0', id, method, params },
});

describe('الخادم', () => {
  before(async () => {
    port = await freePort();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'montaji-test-'));
    const envFile = path.join(tmp, '.env');
    fs.writeFileSync(envFile, 'SECRET_MARKER=do-not-leak\n');
    // نمسح مفاتيح البيئة كي لا تؤثر إعدادات جهاز المطوّر في النتيجة
    const env = { ...process.env, PORT: String(port), MONTAJI_ENV_FILE: envFile, MONTAJI_EXPORT_DIR: path.join(tmp, 'exports'), MONTAJI_PROJECT_DIR: path.join(tmp, 'projects'), MONTAJI_REF_DIR: path.join(tmp, 'ref'), MONTAJI_RAW_DIR: path.join(tmp, 'raw'), MONTAJI_NO_REVEAL: '1' };
    for (const k of Object.keys(env)) if (/^(AI_|GEMINI_|GOOGLE_API|OPENAI_|ANTHROPIC_|OPENROUTER_|GROQ_|STT_)/.test(k)) delete env[k];
    child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('الخادم لم يبدأ: ' + out)), 10000);
      const onData = d => { out += d; if (out.includes('MCP server')) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`الخادم توقف (${code}): ${out}`)); });
    });
  });

  after(() => {
    if (child) child.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('حفظ التصدير يبقى داخل مجلد exports ولا يكتب فوق ملف', async () => {
    const save = (name, headers = {}) => request('/api/export/save?name=' + encodeURIComponent(name), {
      method: 'POST', headers: { 'Content-Type': 'video/mp4', ...headers }, body: 'fake-mp4',
    });
    const a = await save('..\\..\\evil');
    assert.equal(a.status, 200);
    assert.equal(path.dirname(a.data.path), path.join(tmp, 'exports'));
    assert.equal(path.basename(a.data.path), 'evil.mp4');
    const b = await save('../evil.mp4');
    assert.equal(path.basename(b.data.path), 'evil (2).mp4');
    assert.equal(fs.readFileSync(b.data.path, 'utf8'), 'fake-mp4');
    // أسماء أجهزة ويندوز المحجوزة لا تُستعمل كما هي
    assert.equal(path.basename((await save('CON')).data.path), '_CON.mp4');
    assert.equal(path.basename((await save('nul.final')).data.path), '_nul.final.mp4');
    // حفظان متزامنان بالاسم نفسه لا يكتب أحدهما فوق الآخر
    const [c, d] = await Promise.all([save('same'), save('same')]);
    assert.notEqual(c.data.path, d.data.path);
    assert.equal(fs.readdirSync(path.join(tmp, 'exports')).filter(f => f.endsWith('.part')).length, 0);
    assert.equal((await save('x', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await save('x', { Origin: 'https://evil.example' })).status, 403);
  });

  test('حفظ ملف الترجمة يبقى داخل مجلد exports بامتداد srt أو vtt', async () => {
    const save = (query, type = 'text/plain; charset=utf-8') => request('/api/captions/save?' + query, { method: 'POST', headers: { 'Content-Type': type }, body: '1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n' });
    const a = await save('name=' + encodeURIComponent('..\\..\\ترجمة.exe'));
    assert.equal(a.status, 200);
    assert.equal(path.dirname(a.data.path), path.join(tmp, 'exports'));
    assert.equal(path.basename(a.data.path), 'ترجمة.exe.srt');
    assert.match(fs.readFileSync(a.data.path, 'utf8'), /مرحبا/);
    assert.equal(path.basename((await save('format=vtt&name=subs.vtt')).data.path), 'subs.vtt');
    assert.equal(path.basename((await save('format=evil&name=')).data.path), 'captions.srt');
    assert.equal((await save('name=x', 'video/mp4')).status, 415);
    assert.equal((await request('/api/captions/save?name=x', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, body: 'x' })).status, 403);
  });

  test('/api/transcribe: يرفض المواقع الأخرى، وبلا خدمة تفريغ يعيد خطأ إعداد واضحاً', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60)]);
    const post = (headers, body = wav) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/transcribe?lang=ar', method: 'POST', headers: { Host: `localhost:${port}`, 'Content-Type': 'audio/wav', ...headers } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { let data = null; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* ليس JSON */ } resolve({ status: res.statusCode, data }); });
      });
      req.on('error', reject);
      req.end(body);
    });
    assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({ Host: 'evil.example' })).status, 403);
    const r = await post({});
    assert.equal(r.status, 400);
    assert.equal(r.data.setup, true);
    assert.match(r.data.error, /\.env/);
    assert.ok(!JSON.stringify(r.data).includes('do-not-leak'));
    // /api/config يبلّغ الواجهة أن التفريغ غير مضبوط، بلا أي مفتاح
    const cfg = await request('/api/config');
    assert.equal(cfg.data.stt.ready, false);
    assert.equal((await request('/api/transcribe')).status, 404, 'GET غير مدعوم');
  });

  test('حفظ المشروع يبقى داخل مجلد projects بامتداد montaji', async () => {
    const save = (name, headers = {}) => request('/api/project/save?name=' + encodeURIComponent(name), {
      method: 'POST', headers: { 'Content-Type': 'application/zip', ...headers }, body: 'fake-project',
    });
    const a = await save('../../رحلة الصيف');
    assert.equal(a.status, 200);
    assert.equal(path.dirname(a.data.path), path.join(tmp, 'projects'));
    assert.equal(path.basename(a.data.path), 'رحلة الصيف.montaji');
    assert.equal(fs.readFileSync(a.data.path, 'utf8'), 'fake-project');
    assert.equal(path.basename((await save('رحلة الصيف.MONTAJI')).data.path), 'رحلة الصيف (2).montaji');
    assert.equal(path.basename((await save('')).data.path), 'project.montaji');
    assert.equal((await save('x', { 'Content-Type': 'video/mp4' })).status, 415);
    assert.equal((await save('x', { Origin: 'https://evil.example' })).status, 403);
    assert.equal(fs.existsSync(path.join(tmp, 'exports', 'x.mp4')), false);
  });

  test('الحفظ التالي يكتب فوق ملف المشروع نفسه في مجلد projects، ويُنشأ المجلد إن لم يوجد', async () => {
    fs.rmSync(path.join(tmp, 'projects'), { recursive: true, force: true }); // المجلد غير موجود: الحفظ ينشئه
    const save = (query, body) => request('/api/project/save?' + query, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
    // أول حفظ: اسم جديد، والرد يحمل الاسم النسبي الذي يكتب فيه الحفظ التالي
    const first = await save('name=' + encodeURIComponent('إعلان العطور'), 'v1');
    assert.equal(first.status, 200);
    assert.equal(first.data.name, 'إعلان العطور.montaji');
    assert.equal(first.data.dir, path.join(tmp, 'projects'));
    // الحفظ الثاني والثالث في الملف نفسه: لا (2) ولا ملفات مؤقتة
    for (const v of ['v2', 'v3-أطول']) {
      const r = await save(`name=${encodeURIComponent(first.data.name)}&overwrite=1`, v);
      assert.equal(r.status, 200);
      assert.equal(r.data.path, first.data.path);
      assert.equal(fs.readFileSync(first.data.path, 'utf8'), v);
    }
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'projects')), ['إعلان العطور.montaji']);
    // مجلد فرعي داخل projects مسموح، والخروج منه أو الأسماء المحجوزة مرفوضة دون إنشاء أي ملف
    const sub = await save('name=' + encodeURIComponent('عملاء/محل الساعات.montaji') + '&overwrite=1', 'sub');
    assert.equal(sub.status, 200);
    assert.equal(sub.data.name, 'عملاء/محل الساعات.montaji');
    for (const bad of ['../evil.montaji', '..\\evil.montaji', 'a/b/c.montaji', 'CON.montaji', 'x.txt', '', '/abs.montaji/..', 'C:\\x.montaji']) {
      assert.equal((await save('name=' + encodeURIComponent(bad) + '&overwrite=1', 'bad')).status, 400, bad);
    }
    assert.equal(fs.existsSync(path.join(tmp, 'evil.montaji')), false);
    // حفظان متزامنان في الملف نفسه: ينتهيان دون خطأ ويبقى ملف واحد كامل
    const [a, b] = await Promise.all([save(`name=${encodeURIComponent(first.data.name)}&overwrite=1`, 'AAAA'), save(`name=${encodeURIComponent(first.data.name)}&overwrite=1`, 'BBBB')]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.ok(['AAAA', 'BBBB'].includes(fs.readFileSync(first.data.path, 'utf8')));
    assert.equal(fs.readdirSync(path.join(tmp, 'projects')).filter(f => f.endsWith('.part')).length, 0);
  });

  test('حفظ انقطع في منتصفه لا يُفسد ملف المشروع الموجود', async () => {
    const file = path.join(tmp, 'projects', 'سليم.montaji');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'النسخة السليمة');
    await new Promise(resolve => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/project/save?overwrite=1&name=' + encodeURIComponent('سليم.montaji'),
        headers: { Host: `localhost:${port}`, 'Content-Type': 'application/zip', 'Content-Length': 1000000 },
      });
      req.on('error', () => {}); // القطع نفسه يرمي خطأً عند العميل
      req.write('نصف ملف');
      setTimeout(() => { req.destroy(); setTimeout(resolve, 400); }, 150); // مهلة يحذف فيها الخادم ملفه المؤقت
    });
    assert.equal(fs.readFileSync(file, 'utf8'), 'النسخة السليمة');
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(f => f.endsWith('.part')), []);
  });

  test('/api/projects يعرض مشاريع المجلد الأحدث أولاً، و /api/project/file يعيد الملف نفسه', async () => {
    const dir = path.join(tmp, 'projects');
    fs.mkdirSync(path.join(dir, 'قديم'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'جديد.montaji'), 'NEW');
    fs.writeFileSync(path.join(dir, 'قديم', 'أقدم.montaji'), 'OLD');
    fs.writeFileSync(path.join(dir, 'ملاحظات.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'نصف.montaji.1a2b.part'), 'x');
    fs.utimesSync(path.join(dir, 'قديم', 'أقدم.montaji'), new Date(1e12), new Date(1e12));
    fs.utimesSync(path.join(dir, 'جديد.montaji'), new Date(), new Date(Date.now() + 60e3));
    const list = await request('/api/projects');
    assert.equal(list.status, 200);
    assert.equal(list.data.dir, dir);
    const names = list.data.projects.map(p => p.name);
    assert.equal(names[0], 'جديد.montaji');
    assert.equal(names[names.length - 1], 'قديم/أقدم.montaji');
    assert.ok(!names.some(n => /\.txt$|\.part$/.test(n)));
    const newest = list.data.projects[0];
    assert.equal(newest.size, 3);
    assert.ok(Math.abs(newest.modified - fs.statSync(path.join(dir, 'جديد.montaji')).mtimeMs) < 2);

    const got = await request('/api/project/file?name=' + encodeURIComponent('قديم/أقدم.montaji'));
    assert.equal(got.status, 200);
    assert.equal(got.type, 'application/zip');
    assert.equal(got.headers['content-length'], '3');
    assert.equal(got.text, 'OLD');
    // يُقرأ أكثر من مرة (فتح المشروع مرة ثانية وثالثة)
    assert.equal((await request('/api/project/file?name=' + encodeURIComponent('قديم/أقدم.montaji'))).text, 'OLD');
    for (const bad of ['../.env', '..\\.env', 'missing.montaji', 'ملاحظات.txt', '']) {
      assert.equal((await request('/api/project/file?name=' + encodeURIComponent(bad))).status, 404, bad);
    }
    assert.equal((await request('/api/projects', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('/api/project/file?name=x.montaji', { headers: { Host: 'evil.example' } })).status, 403);
    // إظهار الملف في المستكشف: داخل المجلد فقط (لا يُفتح مستكشف فعلاً في الاختبار)
    assert.equal((await request('/api/project/reveal?name=' + encodeURIComponent('جديد.montaji'), { method: 'POST' })).status, 200);
    assert.equal((await request('/api/project/reveal?name=..%2F.env', { method: 'POST' })).status, 404);
    assert.equal((await request('/api/project/reveal', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  });

  test('open_project عبر MCP من مجلد projects يمرّر اسمه النسبي فيحفظ فيه الحفظ التالي', async () => {
    const dir = path.join(tmp, 'projects');
    fs.mkdirSync(path.join(dir, 'عملاء'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'عملاء', 'ساعات.montaji'), 'x');
    const outside = path.join(tmp, 'خارج.montaji');
    fs.writeFileSync(outside, 'x');
    const tab = http.get({ host: '127.0.0.1', port, path: `/api/bridge?loaded=${Date.now()}`, headers: { Host: `localhost:${port}` } }, res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        const m = /^data: (.*)$/m.exec(chunk);
        if (!m) return;
        const c = JSON.parse(m[1]);
        request('/api/bridge/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { id: c.id, result: { data: c.args } } });
      });
    });
    await new Promise(r => tab.on('response', r));
    const call = async args => JSON.parse((await rpc('tools/call', { name: 'open_project', arguments: args })).data.result.content[0].text);
    try {
      const a = await call({ path: path.join(dir, 'عملاء', 'ساعات.montaji') });
      assert.equal(a.project, 'عملاء/ساعات.montaji');
      assert.equal(a.name, 'ساعات.montaji');
      assert.equal((await call({ path: 'جديد' })).project, 'جديد.montaji');
      // ملف خارج المجلد يُفتح، لكن بلا اسم نسبي: الحفظ التالي لا يكتب خارج projects
      const b = await call({ path: outside });
      assert.equal(b.project, undefined);
      assert.equal(b.name, 'خارج.montaji');
    } finally {
      tab.destroy();
      await new Promise(r => setTimeout(r, 100));
    }
  });

  test('open_project عبر MCP: يرفض ملفاً غير موجود ويبحث عن الاسم المجرد في مجلد projects', async () => {
    const missing = await rpc('tools/call', { name: 'open_project', arguments: { path: 'no-such-project' } });
    assert.equal(missing.data.result.isError, true);
    assert.ok(missing.data.result.content[0].text.includes(path.join(tmp, 'projects', 'no-such-project.montaji')));
    // الملف موجود لكن المحرر غير مفتوح في هذا الاختبار: الخطأ يطلب فتحه، لا «الملف غير موجود»
    fs.mkdirSync(path.join(tmp, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'projects', 'saved.montaji'), 'x');
    const found = await rpc('tools/call', { name: 'open_project', arguments: { path: 'saved' } });
    assert.equal(found.data.result.isError, true);
    assert.match(found.data.result.content[0].text, /editor is not open/);
  });

  test('الريمكس عبر MCP: المسارات والمجلدات الافتراضية تصل المحرر روابط مؤقتة، والأخطاء واضحة', async () => {
    // تبويب وهمي يعيد المعاملات التي وصلته كما هي
    const tab = http.get({ host: '127.0.0.1', port, path: `/api/bridge?loaded=${Date.now()}`, headers: { Host: `localhost:${port}` } }, res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        const m = /^data: (.*)$/m.exec(chunk);
        if (!m) return;
        const call = JSON.parse(m[1]);
        request('/api/bridge/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { id: call.id, result: { data: call.args } } });
      });
    });
    await new Promise(r => tab.on('response', r));
    const call = async (name, args) => {
      const r = (await rpc('tools/call', { name, arguments: args })).data.result;
      return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text);
    };
    const ref = path.join(tmp, 'ref'), raw = path.join(tmp, 'raw');
    try {
      // لا مجلدات بعد: الأداتان تمرّان بلا ملفات، فيستعمل المحرر مقاطع المشروع
      assert.deepEqual(await call('analyze_reference', {}), {});
      assert.deepEqual(await call('apply_reference', { fill: 'trim' }), { fill: 'trim' });

      fs.mkdirSync(ref); fs.mkdirSync(raw); fs.mkdirSync(path.join(raw, 'sub'));
      fs.writeFileSync(path.join(ref, 'old.mp4'), 'old');
      fs.writeFileSync(path.join(ref, 'new.mov'), 'new');
      fs.writeFileSync(path.join(ref, 'notes.txt'), 'x');
      fs.utimesSync(path.join(ref, 'old.mp4'), new Date(1e12), new Date(1e12));
      for (const n of ['10.jpg', '2.jpg', '1.png', 'لحن.mp3', '.hidden.jpg', 'readme.txt']) fs.writeFileSync(path.join(raw, n), n);

      // بلا مسار: أحدث فيديو في مجلد المرجع، ورابطه يُقرأ مرة واحدة
      const a = await call('analyze_reference', { sensitivity: 'high' });
      assert.equal(a.name, 'new.mov');
      assert.equal(a.sensitivity, 'high');
      assert.equal(a.path, undefined);
      assert.match(a.url, /^\/api\/media\/[0-9a-f]{32}$/);
      assert.equal((await request(a.url)).text, 'new');
      assert.equal((await request(a.url)).status, 404);
      // اسم مجرد يُبحث عنه في مجلد المرجع، والمسار الكامل يؤخذ كما هو
      assert.equal((await call('analyze_reference', { path: 'old.mp4' })).name, 'old.mp4');
      assert.equal((await call('analyze_reference', { path: path.join(ref, 'old.mp4') })).name, 'old.mp4');
      assert.match((await call('analyze_reference', { path: 'missing.mp4' })).error, /not found/);
      assert.match((await call('analyze_reference', { path: path.join(ref, 'notes.txt') })).error, /must be a video/);
      // مقطع من المشروع: لا يُلمس القرص
      assert.deepEqual(await call('analyze_reference', { clip_id: 'abc' }), { clip_id: 'abc' });

      // بلا مسارات: مجلد الخام مرتباً ترتيباً طبيعياً، بلا الملفات المخفية ولا غير الوسائط ولا المجلدات الفرعية
      const b = await call('apply_reference', {});
      assert.deepEqual(b.files.map(f => f.name), ['1.png', '2.jpg', '10.jpg', 'لحن.mp3']);
      assert.equal((await request(b.files[1].url)).text, '2.jpg');
      // مسارات صريحة بترتيبها، ومجلد آخر
      const c = await call('apply_reference', { paths: [path.join(raw, '10.jpg'), path.join(raw, '1.png')], replace: true });
      assert.deepEqual(c.files.map(f => f.name), ['10.jpg', '1.png']);
      assert.equal(c.replace, true);
      assert.equal(c.paths, undefined);
      assert.deepEqual((await call('apply_reference', { folder: ref })).files.map(f => f.name), ['new.mov', 'old.mp4']);
      assert.match((await call('apply_reference', { folder: path.join(raw, 'sub') })).error, /No image, video or audio/);
      assert.match((await call('apply_reference', { paths: [path.join(raw, 'readme.txt')] })).error, /Unsupported file type/);
      assert.match((await call('apply_reference', { paths: [path.join(raw, 'nope.jpg')] })).error, /File not found/);
      // view_media يقرأ المجلد نفسه بالترتيب نفسه، فأرقامه هي أرقام apply_reference
      assert.deepEqual((await call('view_media', {})).files.map(f => f.name), ['1.png', '2.jpg', '10.jpg', 'لحن.mp3']);
      assert.deepEqual(await call('view_media', { clip_ids: ['x'] }), { clip_ids: ['x'] });
      // مقاطع المشروع مطلوبة صراحة: لا يُقرأ مجلد الخام
      assert.deepEqual(await call('apply_reference', { clip_ids: ['x', 'y'] }), { clip_ids: ['x', 'y'] });
    } finally {
      tab.destroy();
      fs.rmSync(ref, { recursive: true, force: true });
      fs.rmSync(raw, { recursive: true, force: true });
    }
  });

  test('يقدّم الواجهة من public/', async () => {
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.type, /text\/html/);
    assert.match(home.text, /مونتاجي/);
    for (const p of ['/css/style.css', '/js/app.js', '/js/tools.js', '/vendor/mp4-muxer.js', '/guide.html']) {
      assert.equal((await request(p)).status, 200, p);
    }
    assert.equal((await request('/missing.js')).status, 404);
    assert.equal((await request('/js')).status, 404, 'المجلد ليس ملفاً');
  });

  test('الملفات الثابتة: 304 إن لم يتغيّر الملف، وأجزاء Range للوسائط', async () => {
    const full = await request('/js/core.js');
    const size = fs.statSync(path.join(ROOT, 'public/js/core.js')).size;
    assert.equal(full.headers['cache-control'], 'no-cache', 'المتصفح يسأل في كل مرة فلا يبقى على كود قديم');
    assert.ok(full.headers.etag);
    assert.equal(+full.headers['content-length'], size);

    const same = await request('/js/core.js', { headers: { 'If-None-Match': full.headers.etag } });
    assert.equal(same.status, 304);
    assert.equal(same.text, '');
    assert.equal((await request('/js/core.js', { headers: { 'If-None-Match': 'W/"old"' } })).status, 200);

    const part = await request('/js/core.js', { headers: { Range: 'bytes=0-11' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], `bytes 0-11/${size}`);
    assert.equal(part.text, full.text.slice(0, 12)); // أول الملف ASCII
    const tail = await request('/js/core.js', { headers: { Range: 'bytes=-5' } });
    assert.equal(tail.status, 206);
    assert.equal(tail.headers['content-range'], `bytes ${size - 5}-${size - 1}/${size}`);
    assert.equal((await request('/js/core.js', { headers: { Range: `bytes=${size + 10}-` } })).status, 416);
    assert.equal((await request('/js/core.js', { headers: { Range: 'lines=1-2' } })).status, 200, 'وحدة غير معروفة: الملف كاملاً');
  });

  test('كل ملف يحمّله index.html موجود', async () => {
    const html = (await request('/')).text;
    const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
    assert.ok(refs.length >= 9, 'لم تُكتشف وسوم script/link');
    for (const ref of refs) assert.equal((await request('/' + ref)).status, 200, ref);
  });

  test('لا يقدّم شيئاً خارج public/ ولا الملفات المخفية', async () => {
    const attempts = [
      '/.env', '/../.env', '/..%2f.env', '/%2e%2e/.env', '/js/../../.env', '/js%5C..%5C..%5C.env', '/js\\..\\..\\.env',
      '/../package.json', '/..%2fpackage.json', '/%2e%2e%2fserver%2findex.js', '/js/..%5C..%5Cserver%5Cconfig.js',
      '/server/index.js', '/package.json', '/.env.example', '/.git/config', '/C:/Windows/win.ini', '/js/%00.js',
    ];
    for (const p of attempts) {
      const r = await request(p);
      assert.ok(r.status === 403 || r.status === 404 || r.status === 400, `${p} → ${r.status}`);
      assert.doesNotMatch(r.text, /do-not-leak|"scripts"|createServer|API_KEY/, `${p} سرّب محتوى`);
    }
  });

  test('الواجهات ترفض المواقع الأخرى (Origin / Host)', async () => {
    assert.equal((await request('/api/config')).status, 200);
    assert.equal((await request('/api/config', { headers: { Origin: `http://localhost:${port}` } })).status, 200);
    assert.equal((await request('/api/config', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('/api/config', { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await rpc('ping', undefined)).status, 200);
    const foreign = await request('/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    assert.equal(foreign.status, 403);
  });

  test('/api/config لا يكشف المفتاح ويبلّغ أن المساعد غير مضبوط', async () => {
    const r = await request('/api/config');
    assert.equal(r.data.ready, false);
    assert.ok(r.data.error);
    assert.equal(r.data.mcp, `http://localhost:${port}/mcp`);
    assert.doesNotMatch(r.text, /do-not-leak/);
  });

  test('رسائل الخادم بلغة الواجهة: العربية افتراضياً، والإنجليزية مع كوكي montaji_lang=en', async () => {
    const ar = await request('/api/config');
    assert.match(ar.data.error, /[؀-ۿ]/);
    assert.equal(ar.data.code, 'no_key');
    assert.ok(!('error_en' in ar.data) && !('error_en' in ar.data.stt), 'الحقل الإنجليزي لا يُرسل');
    const en = await request('/api/config', { headers: { Cookie: 'x=1; montaji_lang=en' } });
    assert.equal(en.data.error, 'No key has been set yet');
    assert.match(en.data.stt.error, /^Auto captions need/);
    assert.equal(en.data.code, 'no_key');
    const key = await request('/api/settings/key', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'montaji_lang=en' }, body: { provider: 'nope', key: 'x' } });
    assert.equal(key.status, 400);
    assert.equal(key.data.error, 'Choose a provider from the list');
  });

  test('/api/chat بلا مفتاح يعيد خطأ إعداد لا عطلاً', async () => {
    const r = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { messages: [] } });
    assert.equal(r.status, 400);
    assert.equal(r.data.setup, true);
  });

  test('MCP: initialize و tools/list', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.status, 200);
    assert.equal(init.data.result.serverInfo.name, 'montaji');
    assert.equal(init.data.result.serverInfo.version, require('../package.json').version);
    assert.equal(init.data.result.protocolVersion, '2025-06-18');

    const list = await rpc('tools/list');
    const names = list.data.result.tools.map(t => t.name);
    for (const n of ['get_project', 'update_clips', 'sync_to_beat', 'export_video', 'import_media']) assert.ok(names.includes(n), n);
    for (const t of list.data.result.tools) assert.equal(t.inputSchema.type, 'object', t.name);
  });

  test('MCP: أخطاء البروتوكول', async () => {
    assert.equal((await rpc('nope')).data.error.code, -32601);
    assert.equal((await rpc('tools/call', { name: 'nope', arguments: {} })).data.error.code, -32602);
    const bad = await request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(bad.data.error.code, -32700);
    assert.equal((await request('/mcp')).status, 405);
    // إشعار بلا id: لا رد
    const note = await request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    assert.equal(note.status, 202);
  });

  test('MCP: نداء أداة والمحرر مغلق يعيد خطأ مفهوماً للنموذج', async () => {
    const r = await rpc('tools/call', { name: 'get_project', arguments: {} });
    assert.equal(r.data.result.isError, true);
    assert.match(r.data.result.content[0].text, /editor is not open/i);
  });

  test('الجسر يرسل النداء إلى أحدث صفحة حُمّلت لا إلى تبويب قديم أعاد الاتصال', async () => {
    // تبويب يفتح اتصال SSE ويجيب عن أول نداء يصله باسمه
    const tab = (name, loaded) => new Promise(resolve => {
      const req = http.get({ host: '127.0.0.1', port, path: `/api/bridge?loaded=${loaded}`, headers: { Host: `localhost:${port}` } }, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => {
          const m = /^data: (.*)$/m.exec(chunk);
          if (!m) return;
          const call = JSON.parse(m[1]);
          request('/api/bridge/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { id: call.id, result: { data: { tab: name } } } });
        });
        resolve(req);
      });
    });
    const fresh = await tab('fresh', 2000);
    const stale = await tab('stale', 1000); // اتصل بعده لكن صفحته أقدم
    try {
      const r = await rpc('tools/call', { name: 'get_project', arguments: {} });
      assert.equal(JSON.parse(r.data.result.content[0].text).tab, 'fresh');
    } finally { fresh.destroy(); stale.destroy(); }
  });
  test('/api/settings/key يحفظ المفتاح في .env ولا يعيده، ويرفض القيم الخطرة والمواقع الأخرى', async () => {
    const envFile = path.join(tmp, '.env');
    const before = fs.readFileSync(envFile, 'utf8');
    const save = (body, headers = {}) => request('/api/settings/key', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    try {
      assert.equal((await save({ provider: 'gemini', key: 'abcdefgh123' }, { Origin: 'http://evil.example' })).status, 403);
      assert.equal((await save({ provider: 'evil', key: 'abcdefgh123' })).status, 400);
      // سطر جديد في المفتاح كان سيضيف متغيّراً آخر إلى .env
      assert.equal((await save({ provider: 'gemini', key: 'abcdefgh123\nAI_BASE_URL=http://evil' })).status, 400);
      assert.equal((await save({ provider: 'gemini', key: 'short' })).status, 400);
      assert.ok(!fs.readFileSync(envFile, 'utf8').includes('evil'));

      const r = await save({ provider: 'gemini', key: '  test-key-1234567890  ' });
      assert.equal(r.status, 200);
      assert.ok(!r.text.includes('test-key-1234567890'));
      const env = fs.readFileSync(envFile, 'utf8');
      assert.match(env, /^GEMINI_API_KEY=test-key-1234567890$/m);
      assert.match(env, /^AI_PROVIDER=gemini$/m);
      assert.match(env, /^SECRET_MARKER=do-not-leak$/m); // بقية الملف كما هي

      const cfg = await request('/api/config');
      assert.equal(cfg.data.ready, true);
      assert.equal(cfg.data.provider, 'gemini');
      assert.ok(!cfg.text.includes('test-key-1234567890'));

      // مفتاح الترجمة فقط لا يغيّر مزوّد المحادثة
      assert.equal((await save({ provider: 'groq', key: 'gsk_groq_key_123456' })).status, 200);
      const env2 = fs.readFileSync(envFile, 'utf8');
      assert.match(env2, /^GROQ_API_KEY=gsk_groq_key_123456$/m);
      assert.match(env2, /^AI_PROVIDER=gemini$/m);
    } finally { fs.writeFileSync(envFile, before); }
  });
});
