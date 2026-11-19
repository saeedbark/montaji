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
    pick: $('#chatPick'), hist: $('#chatHist'), histMenu: $('#chatHistMenu'), dot: $('#chatDot'), resize: $('#chatResize'),
    target: $('#chatTarget'),
  };

  let cfg = null;        // إعدادات الخادم: null = الخادم غير متاح
  let chats = [];        // كل المحادثات: { id, title, mcp, at, msgs, seen, node }
  let cur = null;        // المحادثة المعروضة الآن
  let msgs = [];         // = cur.msgs: المحادثة بصيغة OpenAI (دون رسالة النظام)
  let seen = new Set();  // = cur.seen: روابط الملفات التي عُرّف بها النموذج في هذه المحادثة
  let busy = false;
  let ctl = null;        // لإيقاف الطلب الجاري
  let choice = null;     // النموذج المختار من القائمة { provider, label, model }
  let target = null;     // العنصر الذي ربطه المستخدم بالمحادثة بزر الذكاء الاصطناعي { kind, id, used }

  /* ================= رسالة النظام ================= */
  const SYSTEM = `You are the built-in AI editor of "Montaji" (مونتاجي), a video editor that runs in the user's browser. You edit the user's project directly by calling tools, and the user watches the timeline change live.

How to work
- Act, do not explain. When the user asks for an edit, call the tools and make it happen. Never describe steps for the user to do by hand.
- If the request is open ("make a video", "edit it yourself"), take the creative decisions yourself and build a complete, polished result: a sensible order, good pacing, transitions, camera motion on photos, a title, captions where they help, and music level and fades.
- Ask before you build. When the user asks you to make, restyle or imitate a video (not a small precise edit), first ask up to three short questions whose answers you cannot see for yourself: what the video is for and where it will be posted, which words should appear on screen (a title, a price, a phone number or an account), and whether it should be calm or lively with zooms and flashes on the beat. Offer ready answers and mark your default, so one word is enough. Looking is allowed before asking (the project state below, view_frame, view_media, analyze_reference change nothing) and makes the questions precise. Skip any question the message already answers. For a small precise edit, or when the user says to decide yourself, do not ask: act. Never ask a second round.
- When the project is empty and the request needs media, say so in one line: the user must add files first.
- You may call several tools in one step. When you finish, reply with a short summary (2 to 4 short lines) of what you did, in the user's language (Arabic by default). Never mention tool names or ids to the user.
- You cannot add media files yourself. The user adds them with the paperclip button or by dropping files on the page; they are appended to the timeline automatically and reported to you.

Project model
- Main track: clips (images and videos) play one after another with no gaps. Their order is the playing order, and each clip's start time follows from the clips before it. Total duration is the sum of the main-track clips.
- Images last 4 s by default. Good pacing is 2.5 to 4 s per photo in a slideshow, shorter for energetic videos.
- A transition belongs to the clip that enters and takes up to 0.6 s at its start. The first clip needs none.
- Effects (zoom blur, whip, flash, shake, color split, black and white, sharpen, vignette, darken) sit on their own track over the picture. Put short burst effects on the cuts (add_effect with at_cuts) for energetic edits; they stay on the cuts after sync_to_beat.
- Overlays are free layers above the main track (add_overlay from a clip's media, or to_overlay to move a clip up): a logo in a corner (scale about 15), picture-in-picture (scale about 30, mask round, shadow), a product cut-out over a background. They are drawn under effects, texts and captions. Check their placement with view_frame.
- Captions: transcribe turns the speech into timed caption blocks with the spoken word highlighted (it needs a speech-to-text key in the .env file; if it fails for that reason, tell the user which key to add). Afterwards read the caption texts and fix obvious spelling mistakes with update_captions, keeping the same number of words. On 9:16 use caption size about 4 and y about 0.75.
- Keyframes: set_keyframes animates one property of an item over time; times are seconds from the item's own start. Use it for moves the presets cannot do: a title sliding in from the side, a layer growing, a slow custom zoom on a clip, music ducking under speech (use the caption times to know where the speech is).
- Texts and audio sit on their own tracks and are placed freely by start time. Text position uses x and y from 0 to 1 (0.5 is the center). Keep text away from the frame edges; on 9:16 keep y between 0.12 and 0.85.
- Text is drawn exactly as written and supports Arabic. Keep overlay text short. Size is a percent of frame HEIGHT, so the right value depends on the aspect ratio: follow the size guide at the end of this message.
- Audio longer than the video is cut at the video's end automatically, so give music a fade-out. When video clips carry speech, lower the music to about 20 to 30.
- Music and pictures must feel together. Whenever the project has music, finish by calling sync_to_beat so every cut lands on a beat (call it again after you add, remove or reorder clips). Fast music (beat interval under 0.6 s): 2 beats per clip, short transitions (0.15 to 0.3 s) and pulse on. Slow music: 4 beats per clip and softer, longer transitions. Give a closing contact card more beats (last_clip_beats). Use analyze_audio to time titles on bar starts.
- Imitating a video: when the user wants "the same as this video" with their own photos or clips, call analyze_reference on that video clip, look at the contact sheet and at the user's media (view_media), ask your questions, then apply_reference. It copies the cut times, transitions, zooms, flashes, recognized effects and beat pattern onto the other clips of the project. Move each flash it reports onto the product in the user's picture with update_effects. Afterwards check with view_frame, reorder with apply_reference (clip_ids) so each photo suits its shot, and add texts placed like the ones in the reference, written for the user's own content.
- All times are in seconds.`;

  const VISION_NOTE = '\n- Use view_frame when you need to see what is on screen or to check how your result looks. Do not overuse it.';

  // حجم النص نسبة من ارتفاع الإطار؛ في المقاس العمودي الارتفاع كبير فتلزم قيم أصغر بكثير
  const TEXT_SIZES = {
    '16:9': [9, 12, 5, 7],
    '1:1': [7, 9, 4, 5],
    '4:5': [6, 8, 3.5, 4.5],
    '9:16': [5, 6.5, 3, 4],
  };
  function sizeGuide() {
    const r = TEXT_SIZES[state.ratio] ? state.ratio : '16:9';
    const [t0, t1, c0, c1] = TEXT_SIZES[r];
    return `\n\nText size guide for the current ratio ${r}: titles ${t0} to ${t1}, captions and small lines ${c0} to ${c1}.`
      + ' If you change the ratio, resize existing texts to the guide of the new ratio (you will see the new guide in the next step).';
  }

  function systemMessage() {
    return SYSTEM + (cfg.vision ? VISION_NOTE : '') + sizeGuide()
      + '\n\nCurrent project state (refreshed at every step):\n' + JSON.stringify(Agent.project());
  }

  const toolDefs = () => MONTAJI_TOOLS
    .filter(t => cfg.vision || t.name !== 'view_frame')
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

  /* ================= عرض المحادثة ================= */
  // كل محادثة لها عقدتها الخاصة (div.chat-thread)؛ المعروضة وحدها داخل el.log
  function addTo(chat, node) {
    chat.node.append(node);
    if (chat === cur) el.log.scrollTop = el.log.scrollHeight;
    return node;
  }
  const add = node => addTo(cur, node);
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

  function addUser(text, media, about) {
    const thumbs = media.slice(0, 6).map(m => (m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : `<span>♪ ${esc(m.name)}</span>`)).join('');
    const more = media.length > 6 ? `<span>+${media.length - 6}</span>` : '';
    const tag = about ? `<div class="msg-tgt"><svg class="ic"><use href="#i-spark"/></svg><span>${aboutHtml(about)}</span></div>` : '';
    return add(div('msg user', tag + esc(text) + (media.length ? `<div class="msg-thumbs">${thumbs}${more}</div>` : '')));
  }
  const addBot = text => add(div('msg bot', md(text)));
  const addNote = text => add(div('chat-note', esc(text)));
  const addError = (text, detail) => add(div('chat-err', esc(text) + (detail ? `<small>${esc(String(detail).slice(0, 400))}</small>` : '')));
  const addTyping = () => add(div('typing', '<i></i><i></i><i></i>'));
  function addStep(box, text) {
    const row = div('step run');
    row.textContent = text;
    box.append(row);
    if (cur && cur.node.contains(box)) el.log.scrollTop = el.log.scrollHeight;
    return row;
  }
  function endStep(row, res) {
    row.className = 'step ' + (res.error ? 'err' : 'ok');
    if (res.error) row.title = res.data.error || '';
  }

  const short = (s, n = 26) => { s = String(s || '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; };
  const LABELS = {
    get_project: () => tt('قراءة المشروع', 'Reading the project'),
    set_ratio: a => tt('تغيير المقاس إلى ', 'Changing the size to ') + (a.ratio || ''),
    update_clips: () => tt('تعديل المقاطع', 'Editing clips'),
    reorder_clips: () => tt('إعادة ترتيب المقاطع', 'Reordering clips'),
    split: () => tt('تقسيم', 'Splitting'),
    add_text: a => tt(`إضافة نص: «${short(a.text)}»`, `Adding text: “${short(a.text)}”`),
    update_texts: () => tt('تعديل النصوص', 'Editing texts'),
    add_effect: a => tt('إضافة تأثير: ', 'Adding effect: ') + `${(Render.EFFECTS[a.type] || {}).label || a.type || ''}`,
    update_effects: () => tt('تعديل التأثيرات', 'Editing effects'),
    add_overlay: () => tt('إضافة طبقة فوق الفيديو', 'Adding an overlay'),
    update_overlays: () => tt('تعديل الطبقات', 'Editing overlays'),
    to_overlay: () => tt('تحويل مقطع إلى طبقة', 'Turning a clip into an overlay'),
    to_main: () => tt('تحويل طبقة إلى المسار الرئيسي', 'Moving an overlay to the main track'),
    set_keyframes: () => tt('تحريك بالإطارات المفتاحية', 'Animating with keyframes'),
    clear_keyframes: () => tt('حذف الإطارات المفتاحية', 'Removing keyframes'),
    transcribe: () => tt('تفريغ الكلام إلى ترجمة', 'Transcribing speech to captions'),
    update_captions: () => tt('تعديل الترجمة', 'Editing captions'),
    export_captions: () => tt('حفظ ملف الترجمة', 'Saving the caption file'),
    update_audio: () => tt('ضبط الصوت والموسيقى', 'Adjusting sound and music'),
    analyze_audio: () => tt('تحليل إيقاع الموسيقى', 'Analyzing the music beat'),
    sync_to_beat: () => tt('مزامنة القص مع الإيقاع', 'Syncing cuts to the beat'),
    duplicate_item: () => tt('تكرار عنصر', 'Duplicating an item'),
    delete_items: () => tt('حذف عناصر', 'Deleting items'),
    edit_image: a => (a.remove_background ? tt('إزالة خلفية الصورة', 'Removing the image background') : tt('تعديل الصورة', 'Editing the image')),
    save_image: () => tt('حفظ صورة من الفيديو', 'Saving a frame as an image'),
    merge_images: () => tt('دمج الصور في صورة واحدة', 'Merging images into one'),
    split_video_file: () => tt('تقسيم الفيديو إلى ملفات', 'Splitting the video into files'),
    extract_audio: a => (a.add_to_project === false ? tt('حفظ صوت الفيديو', 'Saving the video sound') : tt('استخراج صوت الفيديو', 'Extracting the video sound')),
    view_frame: () => tt('معاينة النتيجة', 'Checking the result'),
    seek: () => tt('تحريك المؤشر', 'Moving the playhead'),
    undo: () => tt('تراجع', 'Undo'),
    export_video: () => tt('تصدير الفيديو…', 'Exporting the video…'),
    import_media: () => tt('إضافة ملفات', 'Adding files'),
    analyze_reference: () => tt('تحليل المقطع المرجعي…', 'Analyzing the reference video…'),
    view_media: () => tt('النظر إلى وسائطك', 'Looking at your media'),
    apply_reference: () => tt('بناء المونتاج على نمط المرجع', 'Building the edit on the reference pattern'),
  };
  const label = (name, args) => (LABELS[name] ? LABELS[name](args || {}) : name);

  /* ================= شاشة البداية والإعداد ================= */
  const SUGGESTIONS = () => [
    tt('اصنع فيديو جاهزاً من ملفاتي: رتّبها وأضف انتقالات وحركة وعنواناً', 'Make a finished video from my files: order them and add transitions, motion and a title'),
    tt('حوّله إلى فيديو عمودي لتيك توك مع نصوص جذابة', 'Turn it into a vertical TikTok video with catchy text'),
    tt('أضف عنواناً في البداية وكلمة ختامية في النهاية', 'Add a title at the start and a closing line at the end'),
  ];

  // مزوّدو المفاتيح في نموذج الإعداد. groq للترجمة التلقائية فقط، فلا يغيّر مزوّد المحادثة
  const KEY_PROVIDERS = [
    { id: 'gemini', label: ['Google Gemini (مفتاح مجاني)', 'Google Gemini (free key)'], site: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
    { id: 'openai', label: 'OpenAI', site: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
    { id: 'anthropic', label: 'Anthropic Claude', site: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
    { id: 'openrouter', label: 'OpenRouter', site: 'OpenRouter', url: 'https://openrouter.ai/keys' },
    { id: 'groq', label: ['Groq (للترجمة التلقائية فقط، مجاني)', 'Groq (auto captions only, free)'], site: 'Groq', url: 'https://console.groq.com/keys' },
  ];
  I18N.localize(KEY_PROVIDERS);
  let keyOpen = false; // نموذج المفتاح مفتوح بطلب المستخدم (زر الإعدادات) والمساعد جاهز
  let keyError = '';

  const keyLink = id => {
    const k = KEY_PROVIDERS.find(x => x.id === id) || KEY_PROVIDERS[0];
    return `<a href="${k.url}" target="_blank" rel="noopener">${esc(k.site)}</a>`;
  };

  function keyForm(pick) {
    const cur = KEY_PROVIDERS.some(k => k.id === pick) ? pick
      : cfg && cfg.ready && KEY_PROVIDERS.some(k => k.id === cfg.provider) ? cfg.provider : 'gemini';
    return `<form class="key-form" data-keyform>
        <label><span>${tt('المزوّد', 'Provider')}</span><select name="provider">${KEY_PROVIDERS.map(k =>
          `<option value="${k.id}"${k.id === cur ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
        <label><span>${tt('المفتاح', 'Key')}</span><input type="password" name="key" dir="ltr" autocomplete="off" spellcheck="false" placeholder="${tt('الصق المفتاح هنا', 'Paste the key here')}" required></label>
        <p class="key-get">${tt('ليس عندك مفتاح؟ أنشئه من', 'No key? Create one at')} <span data-keylink>${keyLink(cur)}</span> ${tt('ثم انسخه والصقه هنا.', 'then copy it and paste it here.')}</p>
        <p class="why" data-keyerr>${esc(keyError)}</p>
        <div class="key-actions">
          <button class="btn small primary">${tt('حفظ وتفعيل', 'Save and enable')}</button>
          ${keyOpen ? `<button type="button" class="btn small" data-keycancel>${tt('إلغاء', 'Cancel')}</button>` : ''}
        </div>
        <p class="key-note">${tt('يُحفظ المفتاح في ملف <code>.env</code> داخل مجلد البرنامج على جهازك، ولا يُرسل إلا إلى المزوّد الذي اخترته.', 'The key is saved in the <code>.env</code> file in the app folder on your device, and is only sent to the provider you chose.')}</p>
      </form>`;
  }

  async function submitKey(form) {
    const btn = form.querySelector('button.primary');
    const err = form.querySelector('[data-keyerr]');
    btn.disabled = true;
    err.textContent = '';
    try {
      const r = await fetch('/api/settings/key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: form.provider.value, key: form.key.value }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || tt('تعذّر حفظ المفتاح', 'Could not save the key'));
      form.key.value = '';
      keyError = '';
      // نموذج داخل المحادثة (بعد حذف مفتاح منتهٍ): يُستبدل بسطر تأكيد
      const inline = form.closest('.key-notice');
      if (inline) form.replaceWith(div('chat-note', tt('حُفظ المفتاح الجديد.', 'The new key was saved.')));
      else keyOpen = false;
      await loadConfig();
      S.toast && S.toast(form.provider.value === 'groq' ? tt('حُفظ مفتاح الترجمة التلقائية', 'Auto-caption key saved') : tt('تم تفعيل المساعد', 'Assistant enabled'));
    } catch (e) {
      keyError = e.message === 'Failed to fetch' ? tt('الخادم المحلي لا يعمل — شغّل البرنامج من جديد', 'The local server is not running — start the app again') : e.message;
      err.textContent = keyError;
    } finally { btn.disabled = false; }
  }

  function renderIntro() {
    const old = cur.node.querySelector('.chat-intro');
    if (old) old.remove();
    if (!isEmpty(cur) && !keyOpen) return;
    let h;
    if (!cfg) {
      h = tt(`<h3>المساعد يحتاج الخادم المحلي</h3>
        <p>شغّل البرنامج بالنقر المزدوج على <code>start.bat</code> (ويندوز) أو <code>start.command</code> (ماك)، وأبقِ نافذته السوداء مفتوحة، ثم افتح <code>http://localhost:4747</code>.</p>
        <button class="btn small" data-retry>إعادة المحاولة</button>`,
      `<h3>The assistant needs the local server</h3>
        <p>Start the app by double-clicking <code>start.bat</code> (Windows) or <code>start.command</code> (Mac), keep its terminal window open, then open <code>http://localhost:4747</code>.</p>
        <button class="btn small" data-retry>Try again</button>`);
    } else if (keyOpen) {
      h = `<h3>${tt('مفتاح الذكاء الاصطناعي', 'AI key')}</h3>
        <p>${cfg.ready ? tt(`المساعد يعمل الآن بـ <b>${esc((choice || cfg).label)}</b>. `, `The assistant now runs on <b>${esc((choice || cfg).label)}</b>. `) : ''}${tt('الصق مفتاحاً جديداً لتغييره، أو أضف مفتاح Groq للترجمة التلقائية.', 'Paste a new key to change it, or add a Groq key for auto captions.')}</p>
        ${keyForm()}`;
    } else if (!cfg.ready) {
      h = `<h3>${tt('فعّل المساعد بمفتاحك', 'Enable the assistant with your key')}</h3>
        <p>${tt('المساعد ينفّذ المونتاج بدلاً منك حين تكتب له ما تريد. يلزمه مفتاح من أحد مزوّدي الذكاء الاصطناعي، وGoogle Gemini يعطيه مجاناً.', 'The assistant does the editing for you when you write what you want. It needs a key from an AI provider; Google Gemini gives one for free.')}</p>
        ${keyForm()}
        <p class="key-note">${cfg.error && cfg.code !== 'no_key' ? `<span class="why">${esc(cfg.error)}</span><br>` : ''}${tt('أو عدّل ملف', 'Or edit')} <code>${esc(cfg.envFile)}</code> ${tt('بنفسك ثم', 'yourself, then')} <button type="button" class="linkish" data-retry>${tt('تحقّق من جديد', 'check again')}</button>.</p>`;
    } else {
      h = `<h3>${tt('أهلاً، أنا مساعد المونتاج', 'Hi, I am your editing assistant')}</h3>
        <p>${tt('ارفع صورك ومقاطعك (بزر المشبك أو بالسحب والإفلات) واكتب ما تريد، وأنا أنفّذه على الخط الزمني مباشرة.', 'Add your photos and clips (with the paperclip button or by drag and drop) and write what you want; I will do it on the timeline right away.')}</p>
        <div class="sugs">${SUGGESTIONS().map(s => `<button class="sug" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    }
    cur.node.prepend(div('chat-intro', h));
  }

  async function loadConfig() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) throw new Error('no server');
      cfg = await r.json();
    } catch (e) { cfg = null; }
    renderPick();
    renderIntro();
    return cfg;
  }

  /* ================= اختيار النموذج ================= */
  // كل مزوّد له مفتاح في .env يظهر في القائمة؛ الاختيار يُحفظ في المتصفح ويُرسل مع كل طلب
  const PICK_KEY = 'montaji.model';
  function renderPick() {
    const list = (cfg && cfg.ready && cfg.choices) || [];
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PICK_KEY) || 'null'); } catch (e) { /* وضع خاص */ }
    const sel = (saved && list.find(o => o.provider === saved.provider && o.model === saved.model))
      || list.find(o => o.default) || list[0] || null;
    choice = sel;
    const multi = list.length > 1;
    el.pick.hidden = !multi;
    el.model.hidden = multi;
    el.model.textContent = cfg && cfg.ready ? (sel || cfg).model : '';
    el.model.title = cfg && cfg.ready ? `${(sel || cfg).label} — ${(sel || cfg).model}` : '';
    if (!multi) return void (el.pick.innerHTML = '');
    const groups = new Map();
    list.forEach((o, i) => {
      if (!groups.has(o.provider)) groups.set(o.provider, { label: o.label, items: [] });
      groups.get(o.provider).items.push(`<option value="${i}"${o === sel ? ' selected' : ''}>${esc(o.model)}</option>`);
    });
    el.pick.innerHTML = [...groups.values()].map(g => `<optgroup label="${esc(g.label)}">${g.items.join('')}</optgroup>`).join('');
    el.pick.title = `${sel.label} — ${sel.model}`;
  }
  el.pick.addEventListener('change', () => {
    const o = cfg && cfg.choices && cfg.choices[+el.pick.value];
    if (!o) return;
    try { localStorage.setItem(PICK_KEY, JSON.stringify({ provider: o.provider, model: o.model })); } catch (e) { /* وضع خاص */ }
    renderPick();
    S.toast && S.toast(tt(`المساعد يعمل الآن بـ ${o.label} — ${o.model}`, `The assistant now runs on ${o.label} — ${o.model}`));
  });

  /* ================= المحادثات ================= */
  const CHATS_KEY = 'montaji.chats';
  const MAX_CHATS = 30;
  const MCP_IDLE = 10 * 60e3; // نداءات MCP بعد هذا الصمت تبدأ محادثة جديدة

  const isEmpty = c => !c.msgs.length && !c.node.querySelector(':scope > :not(.chat-intro)');

  function newChat(o = {}) {
    const c = { id: uid(), title: o.title || '', mcp: !!o.mcp, at: Date.now(), msgs: [], seen: new Set(), node: div('chat-thread') };
    chats.unshift(c);
    return c;
  }

  /** يعرض محادثة: المحادثة الفارغة التي نغادرها تُحذف كي لا تتراكم */
  function show(c) {
    if (cur === c) return;
    if (cur) {
      cur.scroll = el.log.scrollTop;
      if (isEmpty(cur)) chats = chats.filter(x => x !== cur);
    }
    cur = c;
    msgs = c.msgs;
    seen = c.seen;
    c.unread = false;
    el.log.replaceChildren(c.node);
    renderIntro();
    el.log.scrollTop = c.scroll != null ? c.scroll : el.log.scrollHeight;
    updateFresh();
    updateDot();
  }

  const updateDot = () => { el.dot.hidden = !chats.some(c => c.unread && c !== cur); };

  function when(at) {
    const d = new Date(at), now = new Date();
    const time = d.toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? time : d.toLocaleDateString(I18N.lang, { day: 'numeric', month: 'short' }) + ' · ' + time;
  }

  const listed = () => chats.filter(c => c === cur || !isEmpty(c)).sort((a, b) => b.at - a.at);

  function renderHist() {
    const list = listed();
    el.histMenu.innerHTML = list.length ? list.map(c => `<button type="button" class="menu-item${c === cur ? ' on' : ''}" role="menuitem" data-chat="${c.id}">
        <span class="txt"><b>${esc(c.title || (c.mcp ? tt('عميل MCP', 'MCP client') : tt('محادثة جديدة', 'New chat')))}</b><small>${esc(when(c.at))}</small></span>
        ${c.mcp ? '<i class="tag">MCP</i>' : ''}${c.unread && c !== cur ? '<i class="dot"></i>' : ''}
        <span class="del" data-del="${c.id}" title="${tt('حذف المحادثة', 'Delete chat')}"><svg class="ic"><use href="#i-close"/></svg></span>
      </button>`).join('') : `<div class="empty">${tt('لا محادثات بعد', 'No chats yet')}</div>`;
  }

  function setHist(open) {
    if (open) renderHist();
    el.histMenu.hidden = !open;
    el.hist.setAttribute('aria-expanded', String(open));
  }

  // الصور تُحذف من المحادثات المحفوظة: مساحة المتصفح محدودة، والنموذج لا يحتاج إلا آخرها
  const stripImages = m => (Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')
    ? { ...m, content: m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') + '\n[images omitted]' } : m);

  function htmlOf(c) {
    const n = c.node.cloneNode(true);
    n.querySelectorAll('.chat-intro, .typing, .key-form, img[src^="blob:"]').forEach(x => x.remove());
    return n.innerHTML;
  }

  /** يحفظ المحادثات في المتصفح؛ إن امتلأت المساحة تُترك الأقدم */
  function saveChats() {
    const data = chats.filter(c => !isEmpty(c)).sort((a, b) => b.at - a.at).slice(0, MAX_CHATS)
      .map(c => ({ id: c.id, title: c.title, mcp: c.mcp, at: c.at, msgs: c.msgs.map(stripImages), html: htmlOf(c) }));
    for (let n = data.length; n >= 0; n--) {
      try { return void localStorage.setItem(CHATS_KEY, JSON.stringify(data.slice(0, n))); } catch (e) { /* ممتلئ أو وضع خاص */ }
    }
  }
  let saveTimer = 0;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveChats, 600); };

  function loadChats() {
    let data = [];
    try { data = JSON.parse(localStorage.getItem(CHATS_KEY) || '[]'); } catch (e) { /* تالف أو وضع خاص */ }
    chats = (Array.isArray(data) ? data : []).filter(d => d && d.id).map(d => {
      const node = div('chat-thread', d.html || '');
      node.querySelectorAll('.step.run').forEach(r => { r.className = 'step'; }); // خطوات انقطعت بإغلاق الصفحة
      return { id: String(d.id), title: d.title || '', mcp: !!d.mcp, at: +d.at || 0, msgs: Array.isArray(d.msgs) ? d.msgs : [], seen: new Set(), node };
    });
  }

  function deleteChat(id) {
    const c = chats.find(x => x.id === id);
    if (!c || (busy && c === cur)) return;
    chats = chats.filter(x => x !== c);
    if (c === cur) { cur = null; show(listed()[0] || newChat()); }
    saveChats();
  }

  /** محادثة نداءات MCP: تستمر ما دام العميل يعمل، وتبدأ واحدة جديدة بعد صمت طويل */
  function mcpChat() {
    let c = chats.find(x => x.mcp && x.live);
    if (!c || Date.now() - c.at > MCP_IDLE) {
      c = newChat({ mcp: true, title: tt('عميل MCP · ', 'MCP client · ') + new Date().toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit' }) });
      c.live = true;
    }
    c.at = Date.now();
    return c;
  }

  /* ================= العنصر المحدد ================= */
  // زر الذكاء الاصطناعي على عنصر محدد (الخط الزمني أو لوحة الخصائص) يربط المحادثة به:
  // تظهر بطاقته فوق حقل الكتابة، وكل رسالة تُرسل معها ملاحظة للنموذج بأن الطلب يخصّه، حتى يلغيها المستخدم
  const targetObj = () => (target && S.listOf(target.kind).find(o => o.id === target.id)) || null;

  function kindLabel(kind, o) {
    if (kind === 'clip') return o.type === 'video' ? tt('مقطع فيديو', 'Video clip') : tt('صورة', 'Image');
    if (kind === 'overlay') return o.type === 'video' ? tt('طبقة فيديو', 'Video overlay') : tt('طبقة صورة', 'Image overlay');
    if (kind === 'audio') return tt('موسيقى', 'Music');
    if (kind === 'text') return tt('نص', 'Text');
    if (kind === 'effect') return tt('تأثير', 'Effect');
    return tt('ترجمة', 'Caption');
  }
  const itemName = (kind, o) => (kind === 'effect' ? (Render.EFFECTS[o.type] || {}).label || o.type
    : kind === 'text' || kind === 'caption' ? String(o.text || '').split('\n')[0] : o.name);
  const aboutText = (kind, o) => `${kindLabel(kind, o)}: ${short(itemName(kind, o), 40)}`;
  // اسم الملف داخل <bdi>: وإلا قلبته الواجهة العربية («1.mp4» يظهر «mp4.1»)
  const aboutHtml = s => { const i = s.indexOf(': '); return i < 0 ? `<bdi>${esc(s)}</bdi>` : `${esc(s.slice(0, i + 2))}<bdi>${esc(s.slice(i + 2))}</bdi>`; };

  // اقتراحات جاهزة لكل نوع: نقرة واحدة ترسل الطلب
  const TARGET_SUGS = {
    image: [['حرّكها بتقريب بطيء', 'Add a slow zoom in'], ['أزل خلفية هذه الصورة', 'Remove the background of this photo'], ['اجعل ألوانها أدفأ وأوضح', 'Make its colors warmer and crisper']],
    video: [['اجعله بالحركة البطيئة', 'Make it slow motion'], ['اكتم صوته', 'Mute its sound'], ['أضف انتقالاً ناعماً عند دخوله', 'Add a smooth transition into it']],
    overlay: [['صغّرها وضعها في الزاوية العليا', 'Make it small in the top corner'], ['اجعلها دائرية مع ظل', 'Make it round with a shadow'], ['أدخلها بحركة ظهور', 'Bring it in with a pop animation']],
    text: [['اجعله أكبر وأوضح', 'Make it bigger and clearer'], ['غيّر لونه ليناسب الفيديو', 'Change its color to suit the video'], ['أضف له حركة دخول', 'Give it an entry animation']],
    audio: [['أضف تلاشياً في البداية والنهاية', 'Fade it in and out'], ['اخفض صوتها قليلاً', 'Lower its volume a little'], ['زامن القص مع إيقاعها', 'Sync the cuts to its beat']],
    effect: [['اجعله أقوى', 'Make it stronger'], ['اجعله أقصر', 'Make it shorter'], ['ضعه على كل القطعات', 'Put it on every cut']],
    caption: [['صحّح الأخطاء الإملائية', 'Fix the spelling'], ['كبّر خط الترجمة', 'Make the captions bigger'], ['غيّر لون الكلمة المميزة', 'Change the highlight color']],
  };

  /** ملاحظة للنموذج تحدد العنصر الذي يخصّه الطلب */
  function targetNote(kind, o) {
    layout();
    const r2 = n => Math.round(n * 100) / 100;
    const what = kind === 'clip' ? `${o.type} clip (number ${state.clips.indexOf(o) + 1} of ${state.clips.length} on the main track)`
      : kind === 'overlay' ? `${o.type} overlay` : kind === 'audio' ? 'audio track' : kind === 'text' ? 'text'
        : kind === 'effect' ? `${o.type} effect` : 'caption block';
    const name = kind === 'effect' ? '' : ` "${short(itemName(kind, o), 60)}"`;
    const t0 = itemStart(kind, o), t1 = t0 + itemLen(kind, o);
    return `[Selected item: the user picked this ${what} id=${o.id}${name}, from ${r2(t0)}s to ${r2(t1)}s, with the AI button. `
      + 'Apply the request to this item only, unless the message clearly asks for more.]';
  }

  const BASE_PH = () => tt('اطلب ما تريد… مثل: رتّب المقاطع وأضف عنواناً وانتقالات', 'Ask for anything… e.g. order the clips and add a title and transitions');
  let targetKey = '';
  /** يرسم بطاقة العنصر المربوط؛ يُلغى الربط تلقائياً إن حُذف العنصر */
  function renderTarget() {
    const o = targetObj();
    if (target && !o) target = null;
    const kind = o && target.kind;
    const key = o ? [kind, o.id, aboutText(kind, o), o.thumb || '', target.used ? 1 : 0, I18N.lang].join('|') : '';
    if (key === targetKey) return;
    targetKey = key;
    el.target.hidden = !o;
    el.input.placeholder = o ? tt('اكتب ما تريد تغييره في هذا العنصر…', 'Tell me what to change in this item…') : BASE_PH();
    if (!o) return void (el.target.innerHTML = '');
    const thumb = (kind === 'clip' || kind === 'overlay') && o.thumb;
    const sugs = target.used ? [] : TARGET_SUGS[kind === 'clip' ? o.type : kind] || [];
    el.target.innerHTML = `<div class="tgt-row">
        ${thumb ? `<img src="${esc(thumb)}" alt="">` : '<span class="tgt-ic"><svg class="ic"><use href="#i-spark"/></svg></span>'}
        <span class="tgt-txt" title="${tt('طلبك يخصّ هذا العنصر وحده', 'Your request is about this item only')}: ${esc(itemName(kind, o))}"><small>${tt('عن:', 'About:')}</small> <b>${aboutHtml(aboutText(kind, o))}</b></span>
        <button type="button" class="btn small icon" data-untarget title="${tt('إلغاء الربط بهذا العنصر', 'Stop focusing on this item')}"><svg class="ic"><use href="#i-close"/></svg></button>
      </div>${sugs.length ? `<div class="tgt-sugs">${sugs.map(([ar, en]) => {
        const s = tt(ar, en);
        return `<button type="button" class="tgt-sug" data-sug="${esc(s)}">${esc(s)}</button>`;
      }).join('')}</div>` : ''}`;
  }

  /** يفتح المساعد مربوطاً بعنصر من المشروع { kind, id } */
  function focusOn(t) {
    if (!t || !S.listOf(t.kind).some(o => o.id === t.id)) return;
    target = { kind: t.kind, id: t.id, used: false };
    if (cur.mcp && !busy) show(newChat()); // لا نكتب وسط سجل عميل MCP
    if (el.panel.hidden) setOpen(true);
    renderTarget();
    el.input.focus();
  }

  /* ================= الملفات الجديدة ================= */
  const freshMedia = () => [...state.clips, ...state.audios].filter(m => !seen.has(m.url));

  function updateFresh() {
    const n = busy ? 0 : freshMedia().length;
    el.fresh.hidden = !n;
    if (n) el.fresh.textContent = n === 1 ? tt('ملف جديد سيطّلع عليه المساعد مع رسالتك', 'One new file the assistant will see with your message') : tt(`${n} ملفات جديدة سيطّلع عليها المساعد مع رسالتك`, `${n} new files the assistant will see with your message`);
  }

  /** نص المستخدم + تعريف بالملفات الجديدة (ومعاينات مصغّرة إن كانت الرؤية مفعّلة) */
  async function userContent(text) {
    const media = freshMedia();
    const o = targetObj();
    if (!media.length && !o) return { content: text, media };
    layout();
    let note = media.length ? '\n\n[New media added to the project since your last turn]' : '';
    const parts = [];
    let budget = 14;
    if (o) {
      note = '\n\n' + targetNote(target.kind, o) + note;
      // صورة العنصر المربوط ليرى النموذج ما يقصده المستخدم (إن لم تكن ضمن الملفات الجديدة)
      if (cfg.vision && o.el && (o.type === 'image' || o.type === 'video') && !media.some(m => m.url === o.url)) {
        try {
          const shots = await Agent.previews(o);
          budget -= shots.length;
          parts.push({ type: 'text', text: `Preview of the selected item id=${o.id}:` }, ...shots.map(url => ({ type: 'image_url', image_url: { url } })));
        } catch (e) { console.warn('preview failed', o.name, e); }
      }
    }
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

  /**
   * الخادم حذف مفتاحاً انتهى رصيده أو رُفض، و/أو أجاب مزوّد بديل: يُبلَّغ المستخدم في المحادثة،
   * ويُفتح له نموذج المفتاح هنا ليضع مفتاحاً جديداً
   */
  function addKeyNotice(removed, switched) {
    const lines = (removed || []).map(k => (k.reason === 'credit'
      ? tt(`انتهى رصيد مفتاح ${k.label} فحذفته من الإعدادات.`, `The ${k.label} key ran out of credit, so I removed it.`)
      : tt(`مفتاح ${k.label} مرفوض فحذفته من الإعدادات.`, `The ${k.label} key was rejected, so I removed it.`)));
    if (switched) lines.push(tt(`أكملتُ بـ ${switched.label} (${switched.model}) بدلاً منه.`, `I continued with ${switched.label} (${switched.model}) instead.`));
    if (!removed || !removed.length) {
      // بديل أجاب لأن المختار مزدحم أو لم يرد: سطر واحد يكفي
      return void addNote(tt(`${switched.from} لم يستجب، فأكملتُ بـ ${switched.label} (${switched.model}).`, `${switched.from} did not respond, so I continued with ${switched.label} (${switched.model}).`));
    }
    lines.push(tt('أضف مفتاحاً جديداً هنا:', 'Add a new key here:'));
    add(div('key-notice', `<p>${lines.map(esc).join('<br>')}</p>${keyForm(removed[0].provider)}`));
    loadConfig();
  }

  /* ================= حلقة المحادثة ================= */
  async function api(body) {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const d = await r.json().catch(() => ({ error: tt('رد غير مفهوم من الخادم المحلي', 'Unreadable reply from the local server') }));
    if (!r.ok || d.error) throw Object.assign(new Error(d.error || tt('حدث خطأ', 'Something went wrong')), { detail: d.detail, removed: d.removed });
    return d;
  }
  const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p.text || '').join('') : '').trim();
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

  async function converse() {
    let box = null;
    // إن أجاب مزوّد بديل يبقى هو لبقية هذا الدور، فلا ينتظر كل طلب المزوّد العالق من جديد
    let pick = choice && { provider: choice.provider, model: choice.model };
    for (let turn = 0; turn < 40; turn++) {
      const typing = addTyping();
      let r;
      try { r = await api({ messages: [{ role: 'system', content: systemMessage() }, ...history()], tools: toolDefs(), choice: pick }); }
      finally { typing.remove(); }
      if (r.removed || r.switched) { addKeyNotice(r.removed, r.switched); box = null; }
      if (r.switched) pick = { provider: r.switched.provider, model: r.switched.model };

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
      if (!calls.length) { if (!text) addBot(tt('تم.', 'Done.')); return; }

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
        msgs.push({ role: 'user', content: [{ type: 'text', text: '[Images returned by the tools above, in order: frames from view_frame, contact sheets from analyze_reference and apply_reference]' }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] });
      }
      if (ctl.signal.aborted) throw aborted();
    }
    addNote(tt('توقّف المساعد بعد عدد كبير من الخطوات. اكتب «أكمل» إن أردت المتابعة.', 'The assistant stopped after many steps. Write “continue” to go on.'));
  }

  function setBusy(b) {
    busy = b;
    el.sendIcon.setAttribute('href', b ? '#i-stop' : '#i-send');
    el.send.title = b ? tt('إيقاف المساعد', 'Stop the assistant') : tt('إرسال (Enter)', 'Send (Enter)');
    updateFresh();
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    setBusy(true);
    ctl = new AbortController();
    const chat = cur;
    const mark = msgs.length;
    let u = null, bubble = null;
    try {
      await loadConfig();
      if (!cfg || !cfg.ready) return;
      el.input.value = '';
      autoGrow();
      const tObj = targetObj();
      const about = tObj ? aboutText(target.kind, tObj) : '';
      u = await userContent(text);
      msgs.push({ role: 'user', content: u.content });
      if (!chat.title) chat.title = short(text, 60);
      chat.at = Date.now();
      renderIntro();
      bubble = addUser(text, u.media, about);
      if (tObj) { target.used = true; renderTarget(); }
      await converse();
    } catch (e) {
      if (e.name === 'AbortError') addNote(tt('أُوقف المساعد.', 'Assistant stopped.'));
      else {
        console.error(e);
        addError(e.message || String(e), e.detail);
        if (e.removed && e.removed.length) addKeyNotice(e.removed);
      }
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
      saveChats();
    }
  }

  /* ================= الجسر: نداءات عملاء MCP الخارجيين ================= */
  // وقت تحميل الصفحة: الخادم يرسل النداءات إلى أحدث صفحة حُمّلت، لا إلى تبويب قديم أعاد الاتصال
  const LOADED_AT = Date.now();
  function bridge() {
    const es = new EventSource('/api/bridge?loaded=' + LOADED_AT);
    es.onmessage = async ev => {
      let call;
      try { call = JSON.parse(ev.data); } catch (e) { return; }
      // نداءات MCP تُعرض في محادثتها الخاصة، لا وسط محادثة المستخدم مع المساعد.
      // تُفتح تلقائياً إلا إن كان المساعد يعمل أو نموذج المفتاح مفتوحاً، فتظهر نقطة على زر المحادثات
      const chat = mcpChat();
      if (chat !== cur) {
        if (!busy && !keyOpen) show(chat);
        else { chat.unread = true; updateDot(); }
      }
      let box = chat.node.lastElementChild;
      if (!box || !box.classList.contains('mcp')) {
        const intro = chat.node.querySelector('.chat-intro');
        if (intro) intro.remove();
        box = addTo(chat, div('chat-steps mcp', `<b>${tt('عميل MCP خارجي', 'External MCP client')}</b>`));
      }
      const row = addStep(box, label(call.name, call.args));
      const result = await Agent.run(call.name, call.args, { commit: true });
      endStep(row, result);
      chat.at = Date.now();
      saveSoon();
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
  // محادثة جديدة: السابقة تبقى في قائمة المحادثات
  $('#chatNew').onclick = () => {
    if (busy) return;
    setHist(false);
    if (!isEmpty(cur) || cur.mcp) show(newChat());
    el.input.focus();
  };
  el.hist.onclick = () => setHist(el.histMenu.hidden);
  el.histMenu.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteChat(del.dataset.del); return void renderHist(); }
    const item = e.target.closest('[data-chat]');
    if (!item) return;
    const c = chats.find(x => x.id === item.dataset.chat);
    if (c && c !== cur && busy) return void (S.toast && S.toast(tt('انتظر حتى ينهي المساعد عمله أو أوقفه', 'Wait for the assistant to finish, or stop it')));
    setHist(false);
    if (c) show(c);
  });
  window.addEventListener('pointerdown', e => { if (!el.histMenu.hidden && !e.target.closest('.chat-hist-wrap')) setHist(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.histMenu.hidden) setHist(false); });
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
  $('#chatKey').onclick = () => {
    if (busy) return;
    keyOpen = !keyOpen;
    keyError = '';
    renderIntro();
    if (keyOpen) { el.log.scrollTop = 0; const k = el.log.querySelector('.key-form [name=key]'); if (k) k.focus(); }
  };
  el.log.addEventListener('submit', e => {
    const form = e.target.closest('[data-keyform]');
    if (form) { e.preventDefault(); submitKey(form); }
  });
  el.log.addEventListener('change', e => {
    if (e.target.name !== 'provider') return;
    const link = e.target.form.querySelector('[data-keylink]');
    if (link) link.innerHTML = keyLink(e.target.value);
  });
  el.log.addEventListener('click', e => {
    if (e.target.closest('[data-keycancel]')) { keyOpen = false; keyError = ''; return void renderIntro(); }
    if (e.target.closest('[data-retry]')) return void loadConfig();
    const sug = e.target.closest('[data-sug]');
    if (sug) send(sug.dataset.sug);
  });
  el.target.addEventListener('click', e => {
    if (e.target.closest('[data-untarget]')) { target = null; renderTarget(); return void el.input.focus(); }
    const sug = e.target.closest('[data-sug]');
    if (sug && !busy) send(sug.dataset.sug);
  });
  document.addEventListener('studio:change', () => { updateFresh(); renderTarget(); });

  /* سحب الحافة الداخلية للوحة لتوسيعها أو تضييقها؛ يُحفظ العرض في المتصفح، ونقرتان تُرجعانه */
  function initResize() {
    const handle = el.resize, root = document.documentElement;
    const KEY = 'montaji.chatW', MIN = 300;
    const side = $('#side');
    // اللوحة الطافية (الشاشات المتوسطة) تتسع حتى حافة النافذة؛ وإلا تبقى مساحة للمعاينة ولوحة الخصائص
    const maxW = () => Math.max(MIN, getComputedStyle(el.panel).position === 'absolute'
      ? window.innerWidth - 40 : window.innerWidth - (side ? side.offsetWidth : 0) - 380);
    const apply = w => {
      if (w == null) return void root.style.removeProperty('--chat-w');
      root.style.setProperty('--chat-w', Math.round(Math.min(maxW(), Math.max(MIN, w))) + 'px');
    };
    const save = w => { try { w == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, String(Math.round(w))); } catch (e) { /* وضع خاص */ } };
    let saved = null;
    try { saved = +localStorage.getItem(KEY) || null; } catch (e) { /* وضع خاص */ }
    if (saved) apply(saved);
    // المعاينة والخط الزمني يعيدان حساب مقاسهما عند resize؛ مرة واحدة لكل إطار أثناء السحب
    let raf = 0;
    const relayout = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.dispatchEvent(new Event('resize')); }); };

    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX, startW = el.panel.getBoundingClientRect().width;
      document.body.classList.add('chat-resizing');
      // اللوحة على اليسار في اللغتين، فحافتها تتحرك مع المؤشر
      const move = ev => { saved = startW + (ev.clientX - startX); apply(saved); relayout(); };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('chat-resizing');
        saved = el.panel.getBoundingClientRect().width;
        save(saved);
        relayout();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => { saved = null; apply(null); save(null); relayout(); });
    handle.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      // السهم نحو المعاينة يوسّع اللوحة
      const wider = (e.key === 'ArrowLeft') === rtl();
      saved = el.panel.getBoundingClientRect().width + (wider ? 20 : -20);
      apply(saved); save(saved); relayout();
    });
    window.addEventListener('resize', () => { if (saved) apply(saved); });
  }

  // البدء: المحادثات السابقة في القائمة، ومحادثة جديدة فارغة معروضة
  loadChats();
  show(newChat());
  initResize();
  window.addEventListener('pagehide', saveChats);
  // تبديل اللغة: شاشة البداية وزر الإرسال وقائمة المحادثات تُرسم من جديد (الرسائل السابقة تبقى كما كُتبت)
  // الإعدادات تُقرأ من جديد لأن رسائل الخادم وتسمياته تأتي بلغة الواجهة
  I18N.onChange(() => { renderIntro(); setBusy(busy); targetKey = ''; renderTarget(); if (!el.histMenu.hidden) renderHist(); loadConfig(); });

  // اللوحة مفتوحة على الشاشات الواسعة ما لم يغلقها المستخدم سابقاً
  let pref = null;
  try { pref = localStorage.getItem('montaji.chat'); } catch (e) { /* وضع خاص */ }
  loadConfig().then(c => { if (c) bridge(); });
  // على الهاتف يملأ المساعد الشاشة، فلا يُفتح تلقائياً فوق المحرر
  if (window.innerWidth > 640 && (pref === '1' || (pref === null && window.innerWidth >= 1180))) setOpen(true);
  window.montajiChat = { send, focus: focusOn, get messages() { return msgs; } };
})();
