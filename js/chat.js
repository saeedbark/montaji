'use strict';
/* لوحة المساعد الذكي: المحادثة، حلقة استدعاء الأدوات، والجسر مع خادم MCP.
   المفتاح لا يوجد هنا إطلاقاً — الطلبات تمر عبر الخادم المحلي (/api/chat) الذي يقرأه من .env */

(() => {
  const $ = s => document.querySelector(s);
  const S = window.studio;
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const el = {
    panel: $('#chat'), log: $('#chatLog'), form: $('#chatForm'), input: $('#chatInput'), send: $('#chatSend'),
    sendIcon: $('#chatSendIcon'), model: $('#chatModel'), fresh: $('#chatFresh'), toggle: $('#btnChat'), file: $('#fileChat'),
  };

  let cfg = null;        // إعدادات الخادم: null = الخادم غير متاح
  let msgs = [];         // المحادثة بصيغة OpenAI (دون رسالة النظام)
  let busy = false;
  let ctl = null;        // لإيقاف الطلب الجاري
  const seen = new Set(); // روابط الملفات التي عُرّف بها النموذج

  /* ================= رسالة النظام ================= */
  const SYSTEM = `You are the built-in AI editor of "Montaji" (مونتاجي), a video editor that runs in the user's browser. You edit the user's project directly by calling tools, and the user watches the timeline change live.

How to work
- Act, do not explain. When the user asks for an edit, call the tools and make it happen. Never describe steps for the user to do by hand.
- If the request is open ("make a video", "edit it yourself"), take the creative decisions yourself and build a complete, polished result: a sensible order, good pacing, transitions, camera motion on photos, a title, captions where they help, and music level and fades.
- Ask one short question only when you truly cannot proceed, for example when the project is empty and the user must add files first.
- You may call several tools in one step. When you finish, reply with a short summary (2 to 4 short lines) of what you did, in the user's language (Arabic by default). Never mention tool names or ids to the user.
- You cannot add media files yourself. The user adds them with the paperclip button or by dropping files on the page; they are appended to the timeline automatically and reported to you.

Project model
- Main track: clips (images and videos) play one after another with no gaps. Their order is the playing order, and each clip's start time follows from the clips before it. Total duration is the sum of the main-track clips.
- Images last 4 s by default. Good pacing is 2.5 to 4 s per photo in a slideshow, shorter for energetic videos.
- A transition belongs to the clip that enters and takes up to 0.6 s at its start. The first clip needs none.
- Texts and audio sit on their own tracks and are placed freely by start time. Text position uses x and y from 0 to 1 (0.5 is the center). Keep text away from the frame edges; on 9:16 keep y between 0.12 and 0.85.
- Text is drawn exactly as written and supports Arabic. Keep overlay text short. Size is a percent of frame height: titles 9 to 12, captions 5 to 7.
- Audio longer than the video is cut at the video's end automatically, so give music a fade-out. When video clips carry speech, lower the music to about 20 to 30.
- All times are in seconds.`;

  const VISION_NOTE = '\n- Use view_frame when you need to see what is on screen or to check how your result looks. Do not overuse it.';

  function systemMessage() {
    return SYSTEM + (cfg.vision ? VISION_NOTE : '')
      + '\n\nCurrent project state (refreshed at every step):\n' + JSON.stringify(Agent.project());
  }

  const toolDefs = () => MONTAJI_TOOLS
    .filter(t => cfg.vision || t.name !== 'view_frame')
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

  /* ================= عرض المحادثة ================= */
  function add(node) {
    el.log.append(node);
    el.log.scrollTop = el.log.scrollHeight;
    return node;
  }
  function div(cls, html) {
    const d = document.createElement('div');
    d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  const md = s => esc(s.trim())
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^#{1,4}\s+(.*)$/gm, '<b>$1</b>')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ');

  function addUser(text, media) {
    const thumbs = media.slice(0, 6).map(m => (m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : `<span>♪ ${esc(m.name)}</span>`)).join('');
    const more = media.length > 6 ? `<span>+${media.length - 6}</span>` : '';
    return add(div('msg user', esc(text) + (media.length ? `<div class="msg-thumbs">${thumbs}${more}</div>` : '')));
  }
  const addBot = text => add(div('msg bot', md(text)));
  const addNote = text => add(div('chat-note', esc(text)));
  const addError = (text, detail) => add(div('chat-err', esc(text) + (detail ? `<small>${esc(String(detail).slice(0, 400))}</small>` : '')));
  const addTyping = () => add(div('typing', '<i></i><i></i><i></i>'));
  function addStep(box, text) {
    const row = div('step run');
    row.textContent = text;
    box.append(row);
    el.log.scrollTop = el.log.scrollHeight;
    return row;
  }
  function endStep(row, res) {
    row.className = 'step ' + (res.error ? 'err' : 'ok');
    if (res.error) row.title = res.data.error || '';
  }

  const short = (s, n = 26) => { s = String(s || '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; };
  const LABELS = {
    get_project: () => 'قراءة المشروع',
    set_ratio: a => `تغيير المقاس إلى ${a.ratio || ''}`,
    update_clips: () => 'تعديل المقاطع',
    reorder_clips: () => 'إعادة ترتيب المقاطع',
    split: () => 'تقسيم',
    add_text: a => `إضافة نص: «${short(a.text)}»`,
    update_texts: () => 'تعديل النصوص',
    update_audio: () => 'ضبط الصوت والموسيقى',
    duplicate_item: () => 'تكرار عنصر',
    delete_items: () => 'حذف عناصر',
    view_frame: () => 'معاينة النتيجة',
    seek: () => 'تحريك المؤشر',
    undo: () => 'تراجع',
    export_video: () => 'تصدير الفيديو…',
    import_media: () => 'إضافة ملفات',
  };
  const label = (name, args) => (LABELS[name] ? LABELS[name](args || {}) : name);

  /* ================= شاشة البداية والإعداد ================= */
  const SUGGESTIONS = [
    'اصنع فيديو جاهزاً من ملفاتي: رتّبها وأضف انتقالات وحركة وعنواناً',
    'حوّله إلى فيديو عمودي لتيك توك مع نصوص جذابة',
    'أضف عنواناً في البداية وكلمة ختامية في النهاية',
  ];

  function renderIntro() {
    const old = el.log.querySelector('.chat-intro');
    if (old) old.remove();
    if (msgs.length) return;
    let h;
    if (!cfg) {
      h = `<h3>المساعد يحتاج الخادم المحلي</h3>
        <p>شغّل البرنامج بالنقر المزدوج على <code>start.bat</code> (أو <code>node server.js</code>) ثم افتح <code>http://localhost:5173</code>.</p>
        <button class="btn small" data-retry>إعادة المحاولة</button>`;
    } else if (!cfg.ready) {
      h = `<h3>فعّل المساعد بمفتاحك</h3>
        <p>المساعد ينفّذ المونتاج بدلاً منك حين تكتب له ما تريد. يلزمه مفتاح من أحد مزوّدي الذكاء الاصطناعي:</p>
        <ol>
          <li>افتح الملف <code>${esc(cfg.envFile)}</code> في مجلد البرنامج بأي محرر نصوص.</li>
          <li>ضع مفتاحك بعد علامة <code>=</code>، مثلاً <code>GEMINI_API_KEY=…</code><br>
            مفتاح مجاني من <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>، أو من
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI</a> أو
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic</a> أو
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">OpenRouter</a>.</li>
          <li>احفظ الملف واضغط الزر أدناه.</li>
        </ol>
        <p class="why">${esc(cfg.error || '')}</p>
        <button class="btn small primary" data-retry>تحقّق من المفتاح</button>`;
    } else {
      h = `<h3>أهلاً، أنا مساعد المونتاج</h3>
        <p>ارفع صورك ومقاطعك (بزر المشبك أو بالسحب والإفلات) واكتب ما تريد، وأنا أنفّذه على الخط الزمني مباشرة.</p>
        <div class="sugs">${SUGGESTIONS.map(s => `<button class="sug" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    }
    el.log.prepend(div('chat-intro', h));
  }

  async function loadConfig() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) throw new Error('no server');
      cfg = await r.json();
    } catch (e) { cfg = null; }
    el.model.textContent = cfg && cfg.ready ? cfg.model : '';
    el.model.title = cfg && cfg.ready ? `${cfg.label} — ${cfg.model}` : '';
    renderIntro();
    return cfg;
  }

  /* ================= الملفات الجديدة ================= */
  const freshMedia = () => [...state.clips, ...state.audios].filter(m => !seen.has(m.url));

  function updateFresh() {
    const n = busy ? 0 : freshMedia().length;
    el.fresh.hidden = !n;
    if (n) el.fresh.textContent = n === 1 ? 'ملف جديد سيطّلع عليه المساعد مع رسالتك' : `${n} ملفات جديدة سيطّلع عليها المساعد مع رسالتك`;
  }

  /** نص المستخدم + تعريف بالملفات الجديدة (ومعاينات مصغّرة إن كانت الرؤية مفعّلة) */
  async function userContent(text) {
    const media = freshMedia();
    if (!media.length) return { content: text, media };
    layout();
    let note = '\n\n[New media added to the project since your last turn]';
    const parts = [];
    let budget = 14;
    for (const m of media) {
      seen.add(m.url);
      if (!m.type) { note += `\n- audio id=${m.id} "${m.name}" ${audioLen(m).toFixed(1)}s`; continue; }
      note += `\n- ${m.type} id=${m.id} "${m.name}" ${m.w}x${m.h}` + (m.type === 'video' ? ` ${clipLen(m).toFixed(1)}s` : '');
      if (!cfg.vision || budget <= 0) continue;
      try {
        const shots = await Agent.previews(m);
        budget -= shots.length;
        parts.push({ type: 'text', text: `Preview of ${m.type} id=${m.id} "${m.name}":` }, ...shots.map(url => ({ type: 'image_url', image_url: { url } })));
      } catch (e) { console.warn('preview failed', m.name, e); }
    }
    return { content: parts.length ? [{ type: 'text', text: text + note }, ...parts] : text + note, media };
  }

  // الصور القديمة تُحذف من السجل المرسل كي لا يتضخم كل طلب
  function history() {
    const KEEP = 6;
    let left = KEEP;
    const out = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'user' && Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')) {
        if (left-- > 0) out.push(m);
        else out.push({ role: 'user', content: m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') + '\n[images omitted]' });
      } else out.push(m);
    }
    return out.reverse();
  }

  /* ================= حلقة المحادثة ================= */
  async function api(body) {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const d = await r.json().catch(() => ({ error: 'رد غير مفهوم من الخادم المحلي' }));
    if (!r.ok || d.error) throw Object.assign(new Error(d.error || 'حدث خطأ'), { detail: d.detail });
    return d;
  }
  const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p.text || '').join('') : '').trim();
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

  async function converse() {
    let box = null;
    for (let turn = 0; turn < 40; turn++) {
      const typing = addTyping();
      let r;
      try { r = await api({ messages: [{ role: 'system', content: systemMessage() }, ...history()], tools: toolDefs() }); }
      finally { typing.remove(); }

      const m = r.message;
      const calls = (m.tool_calls || []).filter(c => c && c.function && c.function.name);
      calls.forEach(c => { if (!c.id) c.id = 'call_' + uid(); c.type = 'function'; });
      // الرسالة تُحفظ كما وردت (بما فيها extra_content الذي يشترطه Gemini عند إعادة إرسال نداء الأداة)
      const saved = { role: 'assistant', content: m.content || null };
      if (calls.length) saved.tool_calls = calls;
      if (m.extra_content) saved.extra_content = m.extra_content;
      msgs.push(saved);

      const text = textOf(m.content);
      if (text) { addBot(text); box = null; }
      if (!calls.length) { if (!text) addBot('تم.'); return; }

      if (!box) box = add(div('chat-steps'));
      const images = [];
      for (const c of calls) {
        let args = {}, res = null;
        try { args = JSON.parse(c.function.arguments || '{}'); }
        catch (e) { res = { data: { error: 'The arguments were not valid JSON.' }, error: true }; }
        const row = addStep(box, label(c.function.name, args));
        if (!res) res = ctl.signal.aborted ? { data: { error: 'Cancelled by the user.' }, error: true } : await Agent.run(c.function.name, args);
        endStep(row, res);
        msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(res.data) });
        if (res.images) images.push(...res.images);
      }
      if (images.length) {
        msgs.push({ role: 'user', content: [{ type: 'text', text: '[Frames returned by view_frame, in the order requested]' }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] });
      }
      if (ctl.signal.aborted) throw aborted();
    }
    addNote('توقّف المساعد بعد عدد كبير من الخطوات. اكتب «أكمل» إن أردت المتابعة.');
  }

  function setBusy(b) {
    busy = b;
    el.sendIcon.setAttribute('href', b ? '#i-stop' : '#i-send');
    el.send.title = b ? 'إيقاف المساعد' : 'إرسال (Enter)';
    updateFresh();
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    setBusy(true);
    ctl = new AbortController();
    const mark = msgs.length;
    let u = null, bubble = null;
    try {
      await loadConfig();
      if (!cfg || !cfg.ready) return;
      el.input.value = '';
      autoGrow();
      u = await userContent(text);
      msgs.push({ role: 'user', content: u.content });
      renderIntro();
      bubble = addUser(text, u.media);
      await converse();
    } catch (e) {
      if (e.name === 'AbortError') addNote('أُوقف المساعد.');
      else { console.error(e); addError(e.message || String(e), e.detail); }
      // لم يصل أي رد: نتراجع عن الرسالة ليعيد المستخدم إرسالها كما هي (مع ملفاتها)
      if (u && msgs.length === mark + 1) {
        msgs.length = mark;
        u.media.forEach(m => seen.delete(m.url));
        if (bubble) bubble.remove();
        if (!el.input.value) { el.input.value = text; autoGrow(); }
      }
    } finally {
      ctl = null;
      if (Agent.flush()) S.fitTimeline(); // كل تعديلات هذا الدور = خطوة تراجع واحدة
      setBusy(false);
    }
  }

  /* ================= الجسر: نداءات عملاء MCP الخارجيين ================= */
  function bridge() {
    const es = new EventSource('/api/bridge');
    es.onmessage = async ev => {
      let call;
      try { call = JSON.parse(ev.data); } catch (e) { return; }
      let box = el.log.lastElementChild;
      if (!box || !box.classList.contains('mcp')) {
        const intro = el.log.querySelector('.chat-intro');
        if (intro) intro.remove();
        box = add(div('chat-steps mcp', '<b>عميل MCP خارجي</b>'));
      }
      const row = addStep(box, label(call.name, call.args));
      const result = await Agent.run(call.name, call.args, { commit: true });
      endStep(row, result);
      fetch('/api/bridge/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: call.id, result }) }).catch(() => {});
    };
  }

  /* ================= الواجهة ================= */
  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(140, el.input.scrollHeight + 2) + 'px';
  }

  function setOpen(open) {
    el.panel.hidden = !open;
    document.body.classList.toggle('chat-on', open);
    el.toggle.setAttribute('aria-pressed', open);
    try { localStorage.setItem('montaji.chat', open ? '1' : '0'); } catch (e) { /* وضع خاص */ }
    window.dispatchEvent(new Event('resize'));
    if (open) { loadConfig(); el.input.focus(); }
  }

  el.toggle.onclick = () => setOpen(el.panel.hidden);
  $('#chatClose').onclick = () => setOpen(false);
  $('#chatNew').onclick = () => {
    if (busy) return;
    msgs = [];
    seen.clear();
    el.log.innerHTML = '';
    renderIntro();
    updateFresh();
  };
  $('#chatAttach').onclick = () => el.file.click();
  el.file.onchange = e => { S.addFiles(e.target.files); e.target.value = ''; };

  el.form.addEventListener('submit', e => {
    e.preventDefault();
    if (busy) { if (ctl) ctl.abort(); return; }
    send(el.input.value);
  });
  el.input.addEventListener('input', autoGrow);
  el.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(el.input.value); }
  });
  el.input.addEventListener('paste', e => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) { e.preventDefault(); S.addFiles(files); }
  });
  el.log.addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) return void loadConfig();
    const sug = e.target.closest('[data-sug]');
    if (sug) send(sug.dataset.sug);
  });
  document.addEventListener('studio:change', updateFresh);

  // البدء: اللوحة مفتوحة على الشاشات الواسعة ما لم يغلقها المستخدم سابقاً
  let pref = null;
  try { pref = localStorage.getItem('montaji.chat'); } catch (e) { /* وضع خاص */ }
  loadConfig().then(c => { if (c) bridge(); });
  if (pref === '1' || (pref === null && window.innerWidth >= 1180)) setOpen(true);
  window.montajiChat = { send, get messages() { return msgs; } };
})();
