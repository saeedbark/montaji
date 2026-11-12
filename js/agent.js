'use strict';
/* منفّذ أدوات المساعد الذكي: يحوّل نداء الأداة (المعرّف في tools.js) إلى تعديل على المشروع.
   يستخدمه الشات داخل الصفحة، وكذلك خادم MCP عبر الجسر. */

const Agent = (() => {
  const S = window.studio;
  let changed = false; // تعديلات لم تُسجَّل بعد في سجل التراجع

  const r2 = n => Math.round(n * 100) / 100;
  const has = v => v !== undefined && v !== null && v !== '';
  const fail = msg => { throw new Error(msg); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const num = (v, name) => { const n = +v; return isFinite(n) ? n : fail(`${name} must be a number`); };
  const bool = v => v === true || v === 'true' || v === 1;
  const oneOf = (v, list, name) => (list.includes(String(v)) ? String(v) : fail(`${name} must be one of: ${list.join(', ')}`));
  const color = (v, name) => {
    let s = String(v).trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + [...s.slice(1)].map(ch => ch + ch).join('');
    return /^#[0-9a-f]{6}$/.test(s) ? s : fail(`${name} must be a color like #ffcc00`);
  };

  const lists = { clip: () => state.clips, audio: () => state.audios, text: () => state.texts };
  function find(id) {
    for (const kind in lists) {
      const obj = lists[kind]().find(o => o.id === id);
      if (obj) return { kind, obj };
    }
    return null;
  }
  function pick(kind, ids) {
    const arr = lists[kind]();
    const list = Array.isArray(ids) ? ids : has(ids) ? [ids] : [];
    if (!list.length) fail('ids is required');
    if (list.includes('all')) return arr.slice();
    return list.map(id => arr.find(o => o.id === id) || fail(`No ${kind} has id "${id}". Call get_project to see the current ids.`));
  }

  /* ---------- وصف المشروع للنموذج ---------- */
  const clipInfo = (c, i) => ({
    id: c.id, index: i, type: c.type, name: c.name, start: r2(c._start), duration: r2(clipLen(c)), width: c.w, height: c.h,
    ...(c.type === 'video' ? { source_duration: r2(c.srcDur), trim_start: r2(c.in), trim_end: r2(c.out), speed: c.speed, volume: Math.round(c.volume * 100), muted: c.muted } : {}),
    transition: c.transition, motion: c.motion, fit: c.fit, filter: c.filter, brightness: c.bright, contrast: c.contrast, saturation: c.sat,
  });
  const audioInfo = a => ({
    id: a.id, name: a.name, start: r2(a.start), duration: r2(audioLen(a)), source_duration: r2(a.srcDur),
    trim_start: r2(a.in), trim_end: r2(a.out), volume: Math.round(a.volume * 100), fade_in: a.fadeIn, fade_out: a.fadeOut,
  });
  const textInfo = x => ({
    id: x.id, text: x.text, start: r2(x.start), duration: r2(x.dur), x: r2(x.x), y: r2(x.y), size: r2(x.size * 100),
    color: x.color, font: x.font, bold: x.bold, stroke: x.stroke, stroke_color: x.strokeColor,
    background: x.bg, background_color: x.bgColor, shadow: x.shadow, animation: x.anim,
  });
  function project() {
    layout();
    return {
      ratio: state.ratio, duration: r2(view.total), playhead: r2(view.t),
      clips: state.clips.map(clipInfo), audios: state.audios.map(audioInfo), texts: state.texts.map(textInfo),
    };
  }
  const brief = () => { layout(); return { duration: r2(view.total) }; };

  /* ---------- تطبيق الحقول ---------- */
  function applyText(x, a) {
    if (has(a.text)) x.text = String(a.text);
    if (has(a.start)) x.start = Math.max(0, num(a.start, 'start'));
    if (has(a.duration)) x.dur = Math.max(MIN_LEN, num(a.duration, 'duration'));
    if (has(a.position)) { x.y = { top: 0.15, middle: 0.5, bottom: 0.82 }[oneOf(a.position, ['top', 'middle', 'bottom'], 'position')]; x.x = 0.5; }
    if (has(a.x)) x.x = clamp(num(a.x, 'x'), 0.02, 0.98);
    if (has(a.y)) x.y = clamp(num(a.y, 'y'), 0.03, 0.97);
    if (has(a.size)) x.size = clamp(num(a.size, 'size'), 3, 22) / 100;
    if (has(a.color)) x.color = color(a.color, 'color');
    if (has(a.font)) x.font = oneOf(a.font, Object.keys(Render.FONTS), 'font');
    if (has(a.bold)) x.bold = bool(a.bold);
    if (has(a.stroke)) x.stroke = bool(a.stroke);
    if (has(a.stroke_color)) x.strokeColor = color(a.stroke_color, 'stroke_color');
    if (has(a.background)) x.bg = bool(a.background);
    if (has(a.background_color)) x.bgColor = color(a.background_color, 'background_color');
    if (has(a.shadow)) x.shadow = bool(a.shadow);
    if (has(a.animation)) x.anim = oneOf(a.animation, ['none', 'fade', 'rise', 'pop'], 'animation');
  }

  function applyClip(c, a) {
    const vid = c.type === 'video';
    if (vid) {
      if (has(a.speed)) c.speed = clamp(num(a.speed, 'speed'), 0.25, 4);
      if (has(a.trim_start)) c.in = clamp(num(a.trim_start, 'trim_start'), 0, c.srcDur - MIN_LEN);
      if (has(a.trim_end)) c.out = num(a.trim_end, 'trim_end');
      if (has(a.duration)) c.out = c.in + num(a.duration, 'duration') * c.speed;
      c.out = clamp(c.out, c.in + MIN_LEN * c.speed, c.srcDur);
      if (has(a.volume)) c.volume = clamp(num(a.volume, 'volume'), 0, 100) / 100;
      if (has(a.muted)) c.muted = bool(a.muted);
    } else if (has(a.duration)) {
      c.out = c.in + clamp(num(a.duration, 'duration'), MIN_LEN, 120);
    }
    if (has(a.transition)) c.transition = oneOf(a.transition, ['none', 'fade', 'slide', 'zoom', 'wipe', 'black'], 'transition');
    if (has(a.motion)) c.motion = oneOf(a.motion, ['none', 'zoomIn', 'zoomOut', 'panRight', 'panLeft'], 'motion');
    if (has(a.fit)) c.fit = oneOf(a.fit, ['blur', 'contain', 'cover'], 'fit');
    if (has(a.filter)) c.filter = oneOf(a.filter, Object.keys(Render.FILTERS), 'filter');
    if (has(a.brightness)) c.bright = Math.round(clamp(num(a.brightness, 'brightness'), 50, 150));
    if (has(a.contrast)) c.contrast = Math.round(clamp(num(a.contrast, 'contrast'), 50, 150));
    if (has(a.saturation)) c.sat = Math.round(clamp(num(a.saturation, 'saturation'), 0, 200));
  }

  function applyAudio(o, a) {
    if (has(a.start)) o.start = Math.max(0, num(a.start, 'start'));
    if (has(a.trim_start)) o.in = clamp(num(a.trim_start, 'trim_start'), 0, o.srcDur - MIN_LEN);
    if (has(a.trim_end)) o.out = num(a.trim_end, 'trim_end');
    o.out = clamp(o.out, o.in + MIN_LEN, o.srcDur);
    if (has(a.volume)) o.volume = clamp(num(a.volume, 'volume'), 0, 100) / 100;
    if (has(a.fade_in)) o.fadeIn = r2(clamp(num(a.fade_in, 'fade_in'), 0, 5));
    if (has(a.fade_out)) o.fadeOut = r2(clamp(num(a.fade_out, 'fade_out'), 0, 5));
  }

  /* ---------- الالتقاط (ليرى النموذج) ---------- */
  const jpeg = cv => cv.toDataURL('image/jpeg', 0.72);
  function canvasFor(w, h, max) {
    const k = Math.min(1, max / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(w * k)); cv.height = Math.max(2, Math.round(h * k));
    return cv;
  }

  // ينتظر انتهاء تنقّل مقاطع الفيديو إلى الزمن المطلوب
  async function settle() {
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      if (!state.clips.some(c => c.type === 'video' && (c.el.seeking || c.el._pend != null || c.el.readyState < 2))) return;
      await sleep(40);
    }
  }

  /** الإطار النهائي المركّب عند زمن معيّن */
  async function frameAt(t) {
    S.setTime(t);
    await settle();
    const [w, h] = outputSize(state.ratio, 720);
    const cv = canvasFor(w, h, 512);
    Render.frame(cv.getContext('2d'), cv.width, cv.height, view.t);
    return jpeg(cv);
  }

  /** صور مصغّرة من الملف الأصلي لمقطع (صورة واحدة، أو لقطتان من الفيديو الطويل) */
  async function previews(c) {
    const cv = canvasFor(c.w, c.h, 448), g = cv.getContext('2d');
    if (c.type === 'image') { g.drawImage(c.el, 0, 0, cv.width, cv.height); return [jpeg(cv)]; }
    const span = c.out - c.in, out = [];
    for (const f of span > 5 ? [0.2, 0.8] : [0.5]) {
      await seekExact(c.el, c.in + span * f);
      g.drawImage(c.el, 0, 0, cv.width, cv.height);
      out.push(jpeg(cv));
    }
    S.refresh(); // يعيد الفيديو إلى موضع المؤشر
    return out;
  }

  /* ---------- الأدوات ---------- */
  const impl = {
    get_project: () => project(),

    set_ratio({ ratio }) {
      S.setRatio(oneOf(ratio, Object.keys(RATIOS), 'ratio'));
      return { ratio: state.ratio };
    },

    update_clips(a) {
      const list = pick('clip', a.ids);
      list.forEach(c => applyClip(c, a));
      layout();
      return { updated: list.map(c => ({ id: c.id, start: r2(c._start), duration: r2(clipLen(c)) })), ...brief() };
    },

    reorder_clips({ order }) {
      const first = pick('clip', order).filter((c, i, arr) => arr.indexOf(c) === i);
      state.clips = [...first, ...state.clips.filter(c => !first.includes(c))];
      layout();
      return { order: state.clips.map(c => ({ id: c.id, name: c.name, start: r2(c._start) })) };
    },

    split(a) {
      layout();
      const t = num(a.time, 'time');
      let hit = has(a.id) ? find(a.id) || fail(`No item has id "${a.id}".`) : null;
      if (!hit) {
        const i = clipIndexAt(t);
        if (i < 0) fail('The main track is empty.');
        hit = { kind: 'clip', obj: state.clips[i] };
      }
      const { kind, obj } = hit;
      const s = kind === 'clip' ? obj._start : obj.start;
      const len = kind === 'clip' ? clipLen(obj) : kind === 'audio' ? audioLen(obj) : obj.dur;
      if (!(t > s + 0.08 && t < s + len - 0.08)) fail(`time must be inside the item (${r2(s)} to ${r2(s + len)}), not at its edge.`);
      const n = S.cloneItem(kind, obj);
      if (kind === 'clip') {
        const cut = obj.in + (t - obj._start) * obj.speed;
        if (obj.type === 'image') { n.in = 0; n.out = obj.out - cut; } else n.in = cut;
        n.transition = 'none'; obj.out = cut;
        state.clips.splice(state.clips.indexOf(obj) + 1, 0, n);
      } else if (kind === 'audio') {
        const cut = obj.in + (t - obj.start);
        n.in = cut; n.start = t; n.fadeIn = 0; obj.out = cut; obj.fadeOut = 0;
        state.audios.push(n);
      } else {
        n.start = t; n.dur = obj.start + obj.dur - t; obj.dur = t - obj.start;
        state.texts.push(n);
      }
      return { kind, first_part_id: obj.id, second_part_id: n.id };
    },

    add_text(a) {
      if (!has(a.text)) fail('text is required');
      const x = {
        id: uid(), text: '', start: 0, dur: 3,
        x: 0.5, y: 0.82, size: 0.08, color: '#ffffff', font: 'segoe', bold: true,
        stroke: true, strokeColor: '#000000', bg: false, bgColor: '#000000', shadow: true, anim: 'fade',
      };
      applyText(x, a);
      state.texts.push(x);
      return { id: x.id, start: r2(x.start), duration: r2(x.dur) };
    },

    update_texts(a) {
      const list = pick('text', a.ids);
      list.forEach(x => applyText(x, a));
      return { updated: list.map(x => x.id) };
    },

    update_audio(a) {
      const list = pick('audio', a.ids);
      list.forEach(o => applyAudio(o, a));
      return { updated: list.map(o => ({ id: o.id, start: r2(o.start), duration: r2(audioLen(o)) })), ...brief() };
    },

    duplicate_item({ id }) {
      const hit = find(id) || fail(`No item has id "${id}".`);
      const { kind, obj } = hit, n = S.cloneItem(kind, obj);
      if (kind === 'clip') state.clips.splice(state.clips.indexOf(obj) + 1, 0, n);
      else if (kind === 'audio') { n.start = obj.start + audioLen(obj); state.audios.push(n); }
      else { n.start = obj.start + obj.dur; state.texts.push(n); }
      return { kind, id: n.id, ...brief() };
    },

    delete_items({ ids }) {
      const list = Array.isArray(ids) ? ids : has(ids) ? [ids] : [];
      if (!list.length) fail('ids is required');
      const hits = list.map(id => find(id) || fail(`No item has id "${id}".`));
      for (const { kind, obj } of hits) {
        if (obj.el && obj.el.pause) obj.el.pause();
        if (kind === 'clip') state.clips = state.clips.filter(o => o !== obj);
        else if (kind === 'audio') state.audios = state.audios.filter(o => o !== obj);
        else state.texts = state.texts.filter(o => o !== obj);
      }
      return { deleted: hits.length, ...brief() };
    },

    async view_frame({ times }) {
      layout();
      const list = (Array.isArray(times) ? times : [times]).filter(has).slice(0, 4).map(t => clamp(num(t, 'times'), 0, view.total));
      if (!list.length) fail('times is required');
      if (view.total <= 0) fail('The project is empty.');
      const back = view.t, images = [];
      S.pause();
      for (const t of list) images.push(await frameAt(t));
      S.setTime(back);
      return { frames: list.map(r2), images };
    },

    seek({ time, play }) {
      S.pause();
      S.setTime(num(time, 'time'));
      if (bool(play)) S.play();
      return { playhead: r2(view.t), playing: view.playing };
    },

    undo({ steps }) {
      flush();
      const n = clamp(Math.round(has(steps) ? num(steps, 'steps') : 1), 1, 20);
      for (let i = 0; i < n; i++) S.undo();
      return project();
    },

    async export_video(a) {
      const r = await S.exportVideo({
        res: has(a.resolution) ? oneOf(a.resolution, ['720', '1080', '1440', '2160'], 'resolution') : '1080',
        fps: has(a.fps) ? oneOf(a.fps, ['24', '30', '60'], 'fps') : '30',
        quality: has(a.quality) ? oneOf(a.quality, ['normal', 'high', 'ultra'], 'quality') : 'high',
      });
      if (!r.ok) fail(r.error);
      return { ...r, note: 'The export finished. A download button is now shown to the user in the editor.' };
    },

    // عبر MCP فقط: الخادم يحوّل المسارات المحلية إلى روابط مؤقتة
    async import_media({ files }) {
      const before = new Set([...state.clips, ...state.audios].map(o => o.id));
      const list = [];
      for (const f of files || []) {
        const r = await fetch(f.url);
        if (!r.ok) fail('Could not read ' + f.name);
        const b = await r.blob();
        list.push(new File([b], f.name, { type: b.type }));
      }
      await S.addFiles(list);
      layout();
      return {
        added_clips: state.clips.map(clipInfo).filter(c => !before.has(c.id)),
        added_audios: state.audios.filter(o => !before.has(o.id)).map(audioInfo),
        ...brief(),
      };
    },
  };

  const READ_ONLY = new Set(['get_project', 'view_frame', 'seek', 'export_video', 'undo', 'import_media']);

  /** يسجّل تعديلات المساعد كخطوة واحدة في سجل التراجع */
  function flush() {
    if (!changed) return false;
    changed = false;
    S.pushHist();
    return true;
  }

  /**
   * ينفّذ أداة. النتيجة: { data, images?, error? }
   * commit: تسجيل التعديل فوراً في سجل التراجع (وإلا فعند flush في نهاية دور المساعد)
   */
  async function run(name, args, { commit = false } = {}) {
    const fn = Object.prototype.hasOwnProperty.call(impl, name) && impl[name];
    if (!fn) return { data: { error: `Unknown tool "${name}".` }, error: true };
    try {
      const out = (await fn(args && typeof args === 'object' ? args : {})) || {};
      if (!READ_ONLY.has(name)) {
        if (state.sel && !find(state.sel.id)) state.sel = null;
        S.refresh();
        S.renderProps();
        changed = true;
        if (commit) flush();
      }
      const { images, ...data } = out;
      return { data: { ok: true, ...data }, images };
    } catch (e) {
      console.error('[agent]', name, e);
      if (!READ_ONLY.has(name)) S.refresh(); // قد يكون جزء من التعديل طُبّق قبل الخطأ
      return { data: { error: String(e.message || e) }, error: true };
    }
  }

  return { run, flush, project, previews };
})();
