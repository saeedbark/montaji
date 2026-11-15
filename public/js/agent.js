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

  const lists = { clip: () => state.clips, overlay: () => state.overlays, audio: () => state.audios, text: () => state.texts, effect: () => state.effects, caption: () => state.captions.items };

  // أسماء الخصائص المتحركة ووحداتها كما يراها النموذج ← الاسم الداخلي والمعامل (القيمة الداخلية = قيمة الأداة ÷ المعامل)
  const KF_API = {
    clip:    { zoom: ['zoom', 100], pan_x: ['panX', 100], pan_y: ['panY', 100], opacity: ['opacity', 100], volume: ['volume', 100] },
    overlay: { x: ['x', 1], y: ['y', 1], scale: ['scale', 100], rotation: ['rot', 1], opacity: ['opacity', 100], volume: ['volume', 100] },
    text:    { x: ['x', 1], y: ['y', 1], size: ['size', 100], opacity: ['opacity', 100], rotation: ['rot', 1] },
    audio:   { volume: ['volume', 100] },
    effect:  { intensity: ['amount', 100] },
  };
  /** إطارات العنصر بوحدات الأدوات، لوصف المشروع */
  function kfInfo(kind, o) {
    if (!o.kf || !KF_API[kind]) return {};
    const out = {};
    for (const [name, [key, k]] of Object.entries(KF_API[kind])) {
      if (o.kf[key] && o.kf[key].length) out[name] = o.kf[key].map(x => ({ t: r2(x.t), v: r2(x.v * k), e: x.e }));
    }
    return Object.keys(out).length ? { keyframes: out } : {};
  }
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
    transition: c.transition, ...(c.transition !== 'none' ? { transition_duration: r2(trDur(c)) } : {}), pulse: !!c.pulse,
    motion: c.motion, fit: c.fit, filter: c.filter, brightness: c.bright, contrast: c.contrast, saturation: c.sat,
    ...(c.zoom != null && c.zoom !== 1 ? { zoom: Math.round(c.zoom * 100) } : {}), ...(c.panX ? { pan_x: Math.round(c.panX * 100) } : {}), ...(c.panY ? { pan_y: Math.round(c.panY * 100) } : {}),
    ...(c.opacity != null && c.opacity !== 1 ? { opacity: Math.round(c.opacity * 100) } : {}),
    ...kfInfo('clip', c),
  });
  const overlayInfo = o => ({
    id: o.id, type: o.type, name: o.name, start: r2(o.start), duration: r2(overlayLen(o)), track: o.track || 0, width: o.w, height: o.h,
    x: r2(o.x), y: r2(o.y), scale: Math.round(o.scale * 100), rotation: r2(o.rot || 0), opacity: Math.round((o.opacity != null ? o.opacity : 1) * 100),
    mask: o.mask, ...(o.mask === 'round' ? { radius: Math.round(o.radius * 100) } : {}), border: Math.round((o.border || 0) * 1000), border_color: o.borderColor,
    shadow: !!o.shadow, blend: o.blend, filter: o.filter, animation: o.anim,
    ...(o.type === 'video' ? { source_duration: r2(o.srcDur), trim_start: r2(o.in), trim_end: r2(o.out), speed: o.speed, volume: Math.round(o.volume * 100), muted: o.muted } : {}),
    ...kfInfo('overlay', o),
  });
  const captionsInfo = () => {
    const c = state.captions, s = c.style;
    if (!c.items.length) return {};
    return { captions: {
      ...(c.lang ? { language: c.lang } : {}),
      style: { font: s.font, size: r2(s.size * 100), y: r2(s.y), color: s.color, highlight_color: s.hl, background: s.bg, background_color: s.bgColor, outline: s.outline, highlight: s.mode },
      items: c.items.map(it => ({ id: it.id, start: r2(it.start), end: r2(it.end), text: it.text })),
    } };
  };
  const audioInfo = a => {
    const b = Beats.ensure(a);
    return {
      id: a.id, name: a.name, start: r2(a.start), duration: r2(audioLen(a)), source_duration: r2(a.srcDur),
      trim_start: r2(a.in), trim_end: r2(a.out), volume: Math.round(a.volume * 100), fade_in: a.fadeIn, fade_out: a.fadeOut,
      ...(b && b.bpm ? { bpm: b.bpm, beat_interval: r2(b.period) } : {}),
      ...kfInfo('audio', a),
    };
  };
  const textInfo = x => ({
    id: x.id, text: x.text, start: r2(x.start), duration: r2(x.dur), x: r2(x.x), y: r2(x.y), size: r2(x.size * 100),
    color: x.color, font: x.font, bold: x.bold, stroke: x.stroke, stroke_color: x.strokeColor,
    background: x.bg, background_color: x.bgColor, shadow: x.shadow, animation: x.anim,
    ...(x.opacity != null && x.opacity !== 1 ? { opacity: Math.round(x.opacity * 100) } : {}), ...(x.rot ? { rotation: r2(x.rot) } : {}),
    ...kfInfo('text', x),
  });
  const effectInfo = e => ({
    id: e.id, type: e.type, start: r2(e.start), duration: r2(e.dur), intensity: Math.round((e.amount != null ? e.amount : 1) * 100),
    ...((Render.EFFECTS[e.type] || {}).region ? { x: r2(e.x), y: r2(e.y),
      ...(Render.EFFECTS[e.type].rect ? { width: Math.round(e.w * 100), height: Math.round(e.h * 100) } : { size: Math.round(e.r * 100) }) } : {}),
    ...(e.at ? { anchored_to_clip: e.at, anchor: e.atMode === 'clip' ? 'whole_clip' : 'cut' } : {}),
    ...kfInfo('effect', e),
  });
  function project() {
    layout();
    return {
      ...(state.name ? { name: state.name } : {}),
      ratio: state.ratio, duration: r2(view.total), playhead: r2(view.t),
      clips: state.clips.map(clipInfo), ...(state.overlays.length ? { overlays: state.overlays.map(overlayInfo) } : {}),
      audios: state.audios.map(audioInfo), texts: state.texts.map(textInfo),
      effects: state.effects.map(effectInfo), ...captionsInfo(),
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
    if (has(a.opacity)) x.opacity = clamp(num(a.opacity, 'opacity'), 0, 100) / 100;
    if (has(a.rotation)) x.rot = clamp(num(a.rotation, 'rotation'), -720, 720);
  }

  function applyOverlay(o, a) {
    const vid = o.type === 'video';
    if (has(a.start)) o.start = Math.max(0, num(a.start, 'start'));
    if (vid) {
      if (has(a.speed)) o.speed = clamp(num(a.speed, 'speed'), 0.25, 4);
      if (has(a.trim_start)) o.in = clamp(num(a.trim_start, 'trim_start'), 0, o.srcDur - MIN_LEN);
      if (has(a.duration)) o.out = o.in + num(a.duration, 'duration') * o.speed;
      o.out = clamp(o.out, o.in + MIN_LEN * o.speed, o.srcDur);
      if (has(a.volume)) o.volume = clamp(num(a.volume, 'volume'), 0, 100) / 100;
      if (has(a.muted)) o.muted = bool(a.muted);
    } else if (has(a.duration)) o.out = clamp(num(a.duration, 'duration'), MIN_LEN, 600);
    if (has(a.x)) o.x = clamp(num(a.x, 'x'), -0.5, 1.5);
    if (has(a.y)) o.y = clamp(num(a.y, 'y'), -0.5, 1.5);
    if (has(a.scale)) o.scale = clamp(num(a.scale, 'scale'), 2, 300) / 100;
    if (has(a.rotation)) o.rot = clamp(num(a.rotation, 'rotation'), -720, 720);
    if (has(a.opacity)) o.opacity = clamp(num(a.opacity, 'opacity'), 0, 100) / 100;
    if (has(a.mask)) o.mask = oneOf(a.mask, Object.keys(Render.MASKS), 'mask');
    if (has(a.radius)) o.radius = clamp(num(a.radius, 'radius'), 0, 50) / 100;
    if (has(a.border)) o.border = clamp(num(a.border, 'border'), 0, 40) / 1000;
    if (has(a.border_color)) o.borderColor = color(a.border_color, 'border_color');
    if (has(a.shadow)) o.shadow = bool(a.shadow);
    if (has(a.blend)) o.blend = oneOf(a.blend, Object.keys(Render.BLENDS), 'blend');
    if (has(a.filter)) o.filter = oneOf(a.filter, Object.keys(Render.FILTERS), 'filter');
    if (has(a.animation)) o.anim = oneOf(a.animation, ['none', 'fade', 'rise', 'pop'], 'animation');
    if (has(a.track)) o.track = Math.round(clamp(num(a.track, 'track'), 0, 20));
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
    if (has(a.transition_duration)) c.trLen = r2(clamp(num(a.transition_duration, 'transition_duration'), 0.1, 1.5));
    if (has(a.pulse)) c.pulse = bool(a.pulse);
    if (has(a.motion)) c.motion = oneOf(a.motion, ['none', 'zoomIn', 'zoomOut', 'panRight', 'panLeft', 'panUp', 'panDown', 'handheld'], 'motion');
    if (has(a.fit)) c.fit = oneOf(a.fit, ['blur', 'contain', 'cover'], 'fit');
    if (has(a.filter)) c.filter = oneOf(a.filter, Object.keys(Render.FILTERS), 'filter');
    if (has(a.brightness)) c.bright = Math.round(clamp(num(a.brightness, 'brightness'), 50, 150));
    if (has(a.contrast)) c.contrast = Math.round(clamp(num(a.contrast, 'contrast'), 50, 150));
    if (has(a.saturation)) c.sat = Math.round(clamp(num(a.saturation, 'saturation'), 0, 200));
    if (has(a.zoom)) c.zoom = clamp(num(a.zoom, 'zoom'), 20, 500) / 100;
    if (has(a.pan_x)) c.panX = clamp(num(a.pan_x, 'pan_x'), -100, 100) / 100;
    if (has(a.pan_y)) c.panY = clamp(num(a.pan_y, 'pan_y'), -100, 100) / 100;
    if (has(a.opacity)) c.opacity = clamp(num(a.opacity, 'opacity'), 0, 100) / 100;
  }

  function applyEffect(e, a) {
    if (has(a.type)) e.type = oneOf(a.type, Object.keys(Render.EFFECTS), 'type');
    if (has(a.duration)) e.dur = r2(clamp(num(a.duration, 'duration'), 0.1, 600));
    if (has(a.start)) { e.start = Math.max(0, num(a.start, 'start')); e.at = null; }
    if (has(a.intensity)) e.amount = clamp(num(a.intensity, 'intensity'), 0, 100) / 100;
    if (has(a.x)) e.x = clamp(num(a.x, 'x'), 0, 1);
    if (has(a.y)) e.y = clamp(num(a.y, 'y'), 0, 1);
    if (has(a.size)) e.r = clamp(num(a.size, 'size'), 5, 100) / 100;
    if (has(a.width)) e.w = clamp(num(a.width, 'width'), 2, 100) / 100;
    if (has(a.height)) e.h = clamp(num(a.height, 'height'), 2, 100) / 100;
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
      if (![...state.clips, ...state.overlays].some(c => c.type === 'video' && (c.el.seeking || c.el._pend != null || c.el.readyState < 2))) return;
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

  /** وصف زوم لقطة للنموذج، مثل "zoom in 36%, early" */
  const zoomText = z => `zoom ${z.scale > 1 ? 'in' : 'out'} ${Math.round(Math.abs(z.scale > 1 ? z.scale - 1 : 1 / z.scale - 1) * 100)}%, ${z.when === 'early' ? 'early (punches in the first half, then holds)' : 'steady through the shot'}`;

  /**
   * ورقة وسائط الريمكس: صورة واحدة فيها كل وسيط برقم اللقطة التي أخذها (وما لم يُستعمل بعلامة ×)،
   * ليرى النموذج صور المستخدم ومقاطعه كلها بنظرة ويحكم أيها يناسب أي لقطة
   */
  async function mediaSheet(used, unused) {
    const cells = [...used.map((c, i) => ({ c, tag: String(i + 1) })), ...unused.map(c => ({ c, tag: '×' }))].slice(0, 48);
    const [fw, fh] = RATIOS[state.ratio] || RATIOS['16:9'];
    const { cw, ch, cols, rows } = RefTools.sheetLayout(cells.length, fw, fh, 180);
    const gap = 6, cv = document.createElement('canvas');
    cv.width = cols * (cw + gap) + gap; cv.height = rows * (ch + gap) + gap;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = 'bold 15px Segoe UI, Arial, sans-serif'; g.textBaseline = 'top';
    for (let k = 0; k < cells.length; k++) {
      const { c, tag } = cells[k];
      const x = gap + (k % cols) * (cw + gap), y = gap + Math.floor(k / cols) * (ch + gap);
      const img = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = c.thumb; });
      if (img) { // الوسيط كاملاً داخل الخلية، بلا قص
        const f = Math.min(cw / img.naturalWidth, ch / img.naturalHeight), w = img.naturalWidth * f, h = img.naturalHeight * f;
        g.drawImage(img, x + (cw - w) / 2, y + (ch - h) / 2, w, h);
      }
      g.fillStyle = tag === '×' ? 'rgba(150,0,0,.85)' : 'rgba(0,0,0,.75)';
      g.fillRect(x, y, g.measureText(tag).width + 10, 22);
      g.fillStyle = '#fff'; g.fillText(tag, x + 5, y + 3);
    }
    return jpeg(cv);
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
      const s = itemStart(kind, obj), len = itemLen(kind, obj);
      if (!(t > s + 0.08 && t < s + len - 0.08)) fail(`time must be inside the item (${r2(s)} to ${r2(s + len)}), not at its edge.`);
      const n = S.splitItem(kind, obj, t) || fail('This caption is a single word and cannot be split.');
      return { kind, first_part_id: obj.id, second_part_id: n.id };
    },

    add_overlay(a) {
      layout();
      const hit = find(a.clip_id);
      if (!hit || (hit.kind !== 'clip' && hit.kind !== 'overlay')) fail(`No clip has id "${a.clip_id}". Import the media first, then pass the id of its clip.`);
      const src = hit.obj;
      const o = S.asOverlay(S.cloneItem('clip', src), 0);
      applyOverlay(o, { start: has(a.start) ? a.start : 0, duration: has(a.duration) ? a.duration : src.type === 'image' ? 4 : undefined, ...a });
      if (!has(a.track)) o.track = S.freeTrack(o.start, overlayLen(o));
      state.overlays.push(o);
      layout();
      return { added: overlayInfo(o), ...brief() };
    },

    update_overlays(a) {
      const list = pick('overlay', a.ids);
      list.forEach(o => applyOverlay(o, a));
      layout();
      return { updated: list.map(overlayInfo), ...brief() };
    },

    to_overlay({ id }) {
      const c = pick('clip', [id])[0];
      if (c.el && c.el.pause) c.el.pause();
      return { overlay: overlayInfo(S.toOverlay(c)), ...brief() };
    },

    to_main({ id }) {
      const o = pick('overlay', [id])[0];
      if (o.el && o.el.pause) o.el.pause();
      const c = S.toMain(o);
      return { clip: clipInfo(c, state.clips.indexOf(c)), ...brief() };
    },

    set_keyframes(a) {
      layout();
      const hit = find(a.id) || fail(`No item has id "${a.id}".`);
      const table = KF_API[hit.kind] || fail(`A ${hit.kind} item cannot be animated with keyframes.`);
      const def = table[a.prop] || fail(`prop for a ${hit.kind} must be one of: ${Object.keys(table).join(', ')}`);
      const [key, k] = def, [min, max] = KF_PROPS[hit.kind][key];
      if (!Array.isArray(a.keys) || !a.keys.length) fail('keys must be a non-empty array of { t, v }. Use clear_keyframes to remove an animation.');
      if (a.keys.length > KF_MAX) fail(`At most ${KF_MAX} keyframes per property.`);
      const len = itemLen(hit.kind, hit.obj);
      const obj = hit.obj, before = obj.kf;
      obj.kf = { ...before, [key]: [] };
      try {
        for (const x of a.keys) {
          const t = clamp(num(x && x.t, 'keys[].t'), 0, Math.max(0, len));
          setKey(obj, key, t, clamp(num(x && x.v, 'keys[].v') / k, min, max), has(x.e) ? oneOf(x.e, KF_EASES, 'keys[].e') : 'smooth');
        }
      } catch (e) { if (before) obj.kf = before; else delete obj.kf; throw e; }
      return { id: obj.id, kind: hit.kind, item_duration: r2(len), ...kfInfo(hit.kind, obj) };
    },

    clear_keyframes(a) {
      const hit = find(a.id) || fail(`No item has id "${a.id}".`);
      const table = KF_API[hit.kind] || {};
      if (has(a.prop) && !table[a.prop]) fail(`prop for a ${hit.kind} must be one of: ${Object.keys(table).join(', ')}`);
      clearKeys(hit.obj, has(a.prop) ? table[a.prop][0] : undefined);
      return { id: hit.obj.id, ...kfInfo(hit.kind, hit.obj) };
    },

    async transcribe(a) {
      if (has(a.source_id) && !Captions.speechItem(a.source_id)) fail(`source_id "${a.source_id}" is not a video clip, video overlay or audio item.`);
      const lang = has(a.language) ? String(a.language).trim().toLowerCase() : '';
      if (lang && !/^[a-z]{2,3}$/.test(lang)) fail('language must be a two-letter code such as ar, en or fr.');
      let r;
      try { r = await Captions.transcribe({ id: has(a.source_id) ? a.source_id : null, lang }); }
      catch (e) { fail(e.message + (e.detail ? ` (${e.detail})` : '') + (e.setup ? ' Tell the user to put a GROQ_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in the .env file of Montaji (or STT_BASE_URL for a local Whisper server).' : '')); }
      const items = state.captions.items.filter(it => it.start >= r.start - 0.01 && it.end <= r.end + 0.5);
      return {
        blocks: r.count, language: r.language || 'auto', from: r2(r.start), to: r2(r.end),
        ...(r.approx ? { note: 'This provider returns sentence timing only, so per-word highlighting is approximate.' } : {}),
        captions: items.slice(0, 300).map(it => ({ id: it.id, start: r2(it.start), end: r2(it.end), text: it.text })),
      };
    },

    update_captions(a) {
      const st = state.captions.style;
      if (has(a.font)) st.font = oneOf(a.font, Object.keys(Render.FONTS), 'font');
      if (has(a.size)) st.size = clamp(num(a.size, 'size'), 2, 20) / 100;
      if (has(a.y)) st.y = clamp(num(a.y, 'y'), 0.05, 0.95);
      if (has(a.color)) st.color = color(a.color, 'color');
      if (has(a.highlight_color)) st.hl = color(a.highlight_color, 'highlight_color');
      if (has(a.background)) st.bg = bool(a.background);
      if (has(a.background_color)) st.bgColor = color(a.background_color, 'background_color');
      if (has(a.outline)) st.outline = bool(a.outline);
      if (has(a.highlight)) st.mode = oneOf(a.highlight, Object.keys(Render.CAPTION_MODES), 'highlight');
      const items = state.captions.items, updated = [];
      for (const x of Array.isArray(a.items) ? a.items : []) {
        const it = items.find(o => o.id === (x && x.id)) || fail(`No caption has id "${x && x.id}". Call get_project to see the caption ids.`);
        if (has(x.text)) Object.assign(it, CaptionTools.setText(it, x.text));
        if (has(x.start) || has(x.end)) {
          const s = has(x.start) ? Math.max(0, num(x.start, 'start')) : it.start, e = has(x.end) ? num(x.end, 'end') : it.end;
          if (!(e > s)) fail('A caption end must be after its start.');
          Object.assign(it, CaptionTools.retime(it, s, e));
        }
        updated.push(it.id);
      }
      if (updated.length) {
        items.sort((p, q) => p.start - q.start);
        items.forEach((it, i) => { // كتلة واحدة على الشاشة في كل لحظة
          const next = items[i + 1];
          if (next && it.end > next.start) Object.assign(it, CaptionTools.retime(it, it.start, Math.max(it.start + CaptionTools.MIN, next.start)));
        });
      }
      return { updated, blocks: items.length };
    },

    async export_captions(a) {
      const f = Captions.fileOf(has(a.format) ? oneOf(a.format, ['srt', 'vtt'], 'format') : 'srt');
      const out = { format: f.format, blocks: state.captions.items.length };
      if (has(a.save_as)) {
        const res = await fetch(`/api/captions/save?format=${f.format}&name=${encodeURIComponent(String(a.save_as))}`, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: f.blob });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) fail('Saving the subtitle file failed: ' + (j.error || `HTTP ${res.status}`));
        return { ...out, saved_to: j.path };
      }
      ImageTools.download(f.blob, f.name);
      return { ...out, file: f.name, note: 'The subtitle file was saved to the user\'s Downloads folder.' };
    },

    add_effect(a) {
      layout();
      const type = oneOf(a.type, Object.keys(Render.EFFECTS), 'type');
      const def = Render.EFFECTS[type];
      const base = { type, start: 0, dur: def.dur, amount: 1, at: null, atMode: 'cut', x: 0.5, y: 0.5, r: 0.3, w: 0.4, h: 0.2 };
      applyEffect(base, { duration: a.duration, intensity: a.intensity, x: a.x, y: a.y, size: a.size, width: a.width, height: a.height });
      const made = [];
      const push = extra => { const e = { ...base, id: uid(), ...extra }; state.effects.push(e); made.push(e); };
      if (bool(a.at_cuts)) {
        const cuts = state.clips.slice(1);
        if (!cuts.length) fail('There are no cuts yet: the main track needs at least 2 clips.');
        const every = has(a.every) ? clamp(Math.round(num(a.every, 'every')), 1, 50) : 1;
        cuts.forEach((c, i) => { if (i % every === 0) push({ at: c.id, atMode: 'cut' }); });
      } else if (has(a.clip_ids)) {
        for (const c of pick('clip', a.clip_ids)) push({ at: c.id, atMode: 'clip' });
      } else {
        if (!has(a.start)) fail('Give start (with duration), or at_cuts, or clip_ids.');
        push({ start: Math.max(0, num(a.start, 'start')) });
      }
      layout();
      return { added: made.map(effectInfo), ...brief() };
    },

    update_effects(a) {
      const list = pick('effect', a.ids);
      list.forEach(e => applyEffect(e, a));
      layout();
      return { updated: list.map(effectInfo) };
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

    analyze_audio({ id }) {
      if (!state.audios.length) fail('The project has no music. Ask the user to add a music file.');
      if (has(id) && !state.audios.some(o => o.id === id)) fail(`No audio has id "${id}".`);
      layout();
      const g = Beats.grid(has(id) ? id : null);
      if (!g.beats.length) fail('No clear beat was found in this audio.');
      const end = state.clips.length ? view.total + 0.01 : Infinity;
      const inside = g.beats.filter(b => b.t <= end).slice(0, 200);
      return {
        bpm: g.bpm, beat_interval: r2(g.period), first_beat: r2(g.beats[0].t),
        beats: inside.map(b => r2(b.t)), bar_starts: inside.filter(b => b.down).map(b => r2(b.t)),
        tip: `Cuts every 2 beats = ${r2(g.period * 2)} s, every 4 beats = ${r2(g.period * 4)} s. sync_to_beat does the re-timing for you.`,
      };
    },

    sync_to_beat(a) {
      layout();
      if (!state.clips.length) fail('The main track is empty.');
      if (!state.audios.length) fail('The project has no music to follow. Ask the user to add a music file.');
      if (has(a.audio_id) && !state.audios.some(o => o.id === a.audio_id)) fail(`No audio has id "${a.audio_id}".`);
      const g = Beats.grid(has(a.audio_id) ? a.audio_id : null);
      const hitsOnly = bool(a.hits_only);
      // وضع «الضربات المسموعة»: نتجاهل ضربات الشبكة الواقعة في الصمت أو المقاطع الهادئة
      const B = hitsOnly ? g.beats.filter(b => b.s >= 0.2) : g.beats, P = g.period;
      if (B.length < 2 || !(P > 0)) fail('No clear beat was found in the music.');

      // الضربات بعد نهاية الموسيقى تُكمَل بنفس الإيقاع
      const lastT = B[B.length - 1].t;
      let lastDown = -1;
      B.forEach((b, k) => { if (b.down) lastDown = k; });
      const beatAt = k => (k < B.length ? B[k].t : lastT + (k - B.length + 1) * P);
      const isDown = k => (k < B.length ? B[k].down : lastDown >= 0 && (k - lastDown) % 4 === 0);
      const beatBefore = t => { // آخر ضربة عند t أو قبلها بقليل، و -1 قبل أول ضربة
        if (t + 0.05 < B[0].t) return -1;
        if (t + 0.05 >= lastT) return B.length - 1 + Math.floor((t + 0.05 - lastT) / P);
        let lo = 0, hi = B.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (B[m].t <= t + 0.05) lo = m; else hi = m - 1; }
        return lo;
      };

      const count = n => clamp(Math.round(num(n, 'beats')), 1, 32);
      let pattern;
      if (Array.isArray(a.pattern) && a.pattern.length) pattern = a.pattern.map(count);
      else if (has(a.beats_per_clip)) pattern = [count(a.beats_per_clip)];
      else if (hitsOnly) pattern = [1];
      else {
        const target = has(a.clip_seconds) ? clamp(num(a.clip_seconds, 'clip_seconds'), 0.3, 10) : 2;
        pattern = [[1, 2, 4, 8].reduce((b, n) => (Math.abs(n * P - target) < Math.abs(b * P - target) ? n : b), 1)];
      }
      const onBars = has(a.on_bars) ? bool(a.on_bars) : pattern.every(n => n % 4 === 0);
      const lastBeats = has(a.last_clip_beats) ? count(a.last_clip_beats) : null;

      const cs = state.clips, offBeat = [];
      let cur = 0;
      cs.forEach((c, i) => {
        const n = i === cs.length - 1 && lastBeats ? lastBeats : pattern[i % pattern.length];
        const s = beatBefore(cur);
        let e = s + n;
        while (beatAt(e) - cur < Math.max(MIN_LEN, 0.5 * n * P)) e++; // لا مقطع أقصر من نصف المطلوب (مقدمة قصيرة مثلاً)
        if (i === 0 && onBars && lastDown >= 0) { let k = e; while (k < e + 4 && !isDown(k)) k++; if (isDown(k)) e = k; }
        let dur = beatAt(e) - cur;
        if (c.type === 'video') {
          const room = (c.srcDur - c.in) / c.speed;
          if (dur > room) {
            while (e > s + 1 && beatAt(e) - cur > room) e--;
            dur = beatAt(e) - cur;
            if (dur > room || dur < MIN_LEN) { dur = room; offBeat.push(c.id); } // الفيديو أقصر من ضربة واحدة
          }
          c.out = Math.min(c.srcDur, c.in + dur * c.speed);
        } else c.out = c.in + dur;
        cur += clipLen(c);
      });

      // النهاية مع نهاية الموسيقى (إن كانت تنتهي بعد قليل من بداية آخر مقطع، لا أغنية كاملة)
      const musicEnd = Math.max(...state.audios.filter(o => !has(a.audio_id) || o.id === a.audio_id).map(o => o.start + audioLen(o)));
      const last = cs[cs.length - 1];
      layout();
      if ((!has(a.end_with_music) || bool(a.end_with_music)) && !lastBeats) {
        const want = musicEnd - last._start;
        if (want >= MIN_LEN && want <= Math.max(8 * P, 6)) {
          if (last.type === 'video') last.out = Math.min(last.srcDur, last.in + want * last.speed);
          else last.out = last.in + want;
        }
      }

      const td = has(a.transition_duration) ? clamp(num(a.transition_duration, 'transition_duration'), 0.1, 1.5) : P < 0.6 ? 0.25 : null;
      if (td != null) cs.forEach(c => { c.trLen = r2(td); });
      if (has(a.pulse)) cs.forEach(c => { c.pulse = bool(a.pulse); });
      layout();
      if (!has(a.snap_texts) || bool(a.snap_texts)) {
        for (const x of state.texts) {
          let best = x.start, bd = Infinity;
          for (let k = Math.max(0, beatBefore(x.start) - 1), t; (t = beatAt(k)) <= x.start + P; k++) {
            if (Math.abs(t - x.start) < bd) { bd = Math.abs(t - x.start); best = t; }
          }
          x.start = r2(Math.max(0, best));
        }
      }
      return {
        bpm: g.bpm, beat_interval: r2(P), ...(hitsOnly ? { hits_only: true, hits: B.map(b => r2(b.t)) } : {}), beats_per_clip: pattern, ...(lastBeats ? { last_clip_beats: lastBeats } : {}),
        transition_duration: td != null ? r2(td) : 'unchanged',
        cuts: cs.map(c => r2(c._start)).slice(1),
        ...(offBeat.length ? { off_beat_clips: offBeat, note: 'These videos are shorter than one beat, so their cut is not on a beat.' } : {}),
        ...(musicEnd < view.total - 0.05 ? { warning: `The music ends at ${r2(musicEnd)} s but the video lasts ${r2(view.total)} s. Loop or extend the music, or use fewer beats per clip.` } : {}),
        ...brief(),
      };
    },

    // المرجع ملف من الجهاز (عبر MCP: الخادم يمنحه رابطاً مؤقتاً) أو مقطع فيديو موجود في المشروع
    async analyze_reference(a) {
      let file, clipId = null;
      if (has(a.url)) {
        const res = await fetch(a.url);
        if (!res.ok) fail('Could not read the reference video file.');
        const b = await res.blob();
        file = new File([b], String(a.name || 'reference.mp4'), { type: b.type });
      } else {
        const videos = [...state.clips, ...state.overlays].filter(c => c.type === 'video');
        let c;
        if (has(a.clip_id)) c = videos.find(x => x.id === a.clip_id) || fail(`No video clip has id "${a.clip_id}".`);
        else if (videos.length === 1) c = videos[0];
        else if (videos.length) fail('The project has several videos: pass clip_id of the one to imitate.');
        else fail('There is no reference video. Ask the user for the video they want to imitate: an MCP client passes its path (or the user drops it in the "مرجع" / "reference" folder of the Montaji app); in the editor the user adds it to the project.');
        file = c.file; clipId = c.id;
      }
      const sensitivity = has(a.sensitivity) ? oneOf(a.sensitivity, Object.keys(RefTools.SENSITIVITY), 'sensitivity') : 'normal';
      S.toast('جارٍ تحليل المقطع المرجعي…');
      const r = await Reference.analyze(file, { sensitivity, clipId });
      const P = r.beats && r.beats.period, avg = r.duration / r.shots.length;
      const shotOf = t => r.shots.findIndex(s => t >= s.start && t < s.end);
      const flashes = r.flashes.map(f => ({ t: r2(f.t), shot: shotOf(f.t) + 1, x: r2(f.x), y: r2(f.y), width: Math.round(f.width * 100), height: Math.round(f.height * 100) }));
      return {
        reference: r.name, width: r.width, height: r.height, ratio: r.ratio, duration: r2(r.duration),
        shot_count: r.shots.length, average_shot: r2(avg), pace: avg < 1 ? 'very fast' : avg < 2 ? 'fast' : avg < 4 ? 'medium' : 'slow',
        music: !r.audio ? { note: 'The video has no sound.' }
          : !P ? { note: 'The video has sound but no clear beat (speech or ambient sound).' }
          : { bpm: r.beats.bpm, beat_interval: r2(P), ...(r.rhythm ? { cuts_on_beat_percent: Math.round(r.rhythm.on_beat * 100) } : {}) },
        shots: r.shots.map((s, i) => ({
          n: i + 1, start: r2(s.start), duration: r2(s.duration), enters: s.transition, ...(s.flash ? { flash: true } : {}),
          picture: s.motion, ...(s.zoom ? { camera: zoomText(s.zoom) } : {}), ...(r.rhythm ? { beats: r.rhythm.pattern[i] } : {}),
          ...(flashes.some(f => f.shot === i + 1) ? { flashes: flashes.filter(f => f.shot === i + 1).length } : {}),
        })),
        ...(flashes.length ? { flashes, flashes_note: 'Light flashes inside shots: x and y are the center in the frame (0 to 1), width and height percent of the frame. A small one is a product or a sign lighting up for an instant; several in one shot at different places usually mean several products lit one after another.' } : {}),
        ...(r.shots.length === 1 ? { note: 'No cut was found: the video looks like one continuous shot. Try sensitivity high.' } : {}),
        next: 'The contact sheets show one numbered frame per shot. Call apply_reference to rebuild this edit with the user\'s media. If shots of the reference show several products side by side, per_shot puts several of the user\'s images in one shot.',
        images: r.sheets,
      };
    },

    // files عبر MCP فقط: الخادم يحوّل المسارات (أو مجلد «خام») إلى روابط مؤقتة.
    // كل شيء يُجهَّز أولاً ثم يُطبَّق دفعة واحدة، فإن فشل شيء في المنتصف بقي المشروع كما كان
    async apply_reference(a) {
      const ref = Reference.current() || fail('No reference has been analyzed yet (or the editor page was reloaded since). Call analyze_reference first.');
      layout();
      const refClip = ref.clipId ? state.clips.find(c => c.id === ref.clipId) : null;
      const yes = k => !has(a[k]) || bool(a[k]);

      let shots = ref.shots;
      if (Array.isArray(a.durations) && a.durations.length) {
        shots = a.durations.map((d, i) => ({ ...(ref.shots[i] || { transition: 'cut', motion: 'moving' }), duration: clamp(num(d, 'durations'), MIN_LEN, 120) }));
      }

      /* الوسائط */
      let material = [];
      const newAudios = [], unreadable = [];
      if (Array.isArray(a.files) && a.files.length) {
        const others = state.clips.filter(c => c !== refClip);
        if (others.length && !bool(a.replace)) fail(`The main track already has ${others.length} clips. Pass replace: true to build the remix in their place, or clip_ids to use the clips of the project as the media.`);
        for (const f of a.files) {
          const res = await fetch(f.url);
          if (!res.ok) fail('Could not read ' + f.name);
          const b = await res.blob();
          let it = null;
          try { it = await S.makeItem(new File([b], f.name, { type: b.type })); } catch (e) { console.warn('[remix]', f.name, e); }
          if (!it) unreadable.push(f.name);
          else (it.buf ? newAudios : material).push(it);
        }
        if (!material.length) fail('None of the files is an image or a video this browser can read.');
      } else material = (has(a.clip_ids) ? pick('clip', a.clip_ids) : state.clips).filter(c => c !== refClip);
      if (!material.length) fail('There is no media to put in the shots. An MCP client passes paths or a folder (default: the "خام" / "raw" folder of the Montaji app); in the editor the user adds photos or clips to the project first.');

      /* عدة وسائط في لقطة واحدة: صور المجموعة تُدمج في صورة واحدة مرتبة لتملأ الإطار */
      let mergedShots = 0;
      if (Array.isArray(a.per_shot) && a.per_shot.some(v => +v > 1)) {
        const [fw, fh] = RATIOS[ref.ratio], units = [];
        for (const g of RefTools.groups(material.length, a.per_shot)) {
          const items = g.map(k => material[k]);
          if (items.length < 2 || items.some(c => c.type !== 'image')) { units.push(...items); continue; } // الفيديو لا يُدمج: يأخذ لقطته
          const aspect = items.reduce((s, c) => s + c.w / c.h, 0) / items.length;
          const cv = ImageTools.merge(items.map(c => c.el), { ...RefTools.mergeLayout(items.length, aspect, fw / fh), fit: 'cover', gap: 2, padding: 0, radius: 0, background: '#000000', rtl: true });
          units.push(await S.makeItem(new File([ImageTools.encode(cv, 'jpeg', 0.92).blob], `دمج-${items.length}-صور.jpg`, { type: 'image/jpeg' })));
          mergedShots++;
        }
        material = units;
      }

      /* موسيقى المرجع: تُضاف إن لم يكن للمشروع موسيقى خاصة به (أو طُلبت صراحة) */
      const oldRefMusic = state.audios.filter(o => o.remix);
      const own = state.audios.some(o => !o.remix) || newAudios.length > 0;
      const wantRef = !!ref.audio && (has(a.music) ? bool(a.music) : !own);
      let refMusic = wantRef ? oldRefMusic[0] || null : null;
      if (wantRef && !refMusic) {
        const pcm = AudioTools.process(ref.audio, { start: 0, end: ref.audio.duration });
        refMusic = await S.makeItem(new File([AudioTools.wav(pcm)], (ref.name.replace(/\.[^.\\/]+$/, '') || 'reference') + '.wav', { type: 'audio/wav' }));
        Object.assign(refMusic, { start: 0, volume: 1, fadeOut: 0.3, remix: true });
      }

      /* لقطة ← مقطع */
      const fill = has(a.fill) ? oneOf(a.fill, ['loop', 'trim'], 'fill') : 'loop';
      const plan = RefTools.assign(shots.length, material.length, fill);
      const used = new Set(), seq = [], slowed = [];
      plan.forEach((m, i) => {
        const src = material[m], sh = shots[i];
        const c = used.has(src) ? S.cloneItem('clip', src) : src;
        used.add(src);
        if (c.type === 'video') {
          Object.assign(c, RefTools.fitVideo(c.srcDur, sh.duration));
          if (c.speed < 1) slowed.push(c.name);
        } else Object.assign(c, { in: 0, out: sh.duration, speed: 1 });
        c.transition = !i ? 'none' : sh.transition === 'fade' ? 'fade' : sh.transition === 'black' ? 'black' : 'none';
        if (c.transition !== 'none') c.trLen = r2(clamp(sh.fade || 0.4, 0.15, Math.max(0.15, Math.min(1, sh.duration / 2))));
        if (wantRef && c.type === 'video') c.muted = true; // صوت المرجع هو المسموع
        seq.push(c);
      });

      /* التطبيق */
      for (const c of state.clips) if (!seq.includes(c) && c.el && c.el.pause) c.el.pause();
      state.clips = seq;
      state.effects = state.effects.filter(e => !e.remix);
      state.audios = state.audios.filter(o => !o.remix || o === refMusic);
      let at = 0;
      for (const o of newAudios) { o.start = at; at += audioLen(o); state.audios.push(o); }
      if (refMusic && !state.audios.includes(refMusic)) state.audios.push(refMusic);
      S.setRatio(ref.ratio);
      layout();

      const flash = extra => {
        const e = { id: uid(), type: 'flash', start: 0, dur: Render.EFFECTS.flash.dur, amount: 1, at: null, atMode: 'cut', x: 0.5, y: 0.5, r: 0.3, w: 0.4, h: 0.2, remix: true, ...extra };
        state.effects.push(e);
        return e;
      };

      /* موسيقى غير موسيقى المرجع: يُنقل الإيقاع (عدد الضربات لكل لقطة) إلى ضرباتها */
      let music = { source: 'none' };
      if (wantRef) music = { source: 'reference', audio_id: refMusic.id, note: 'The cuts keep the reference times, so they land on the same beats. The music belongs to the reference video: tell the user in one line to make sure they may reuse it before publishing.' };
      else if (own) {
        music = { source: 'own music' };
        if (yes('sync')) {
          const g = Beats.grid(null), P = (ref.beats && ref.beats.period) || g.period;
          try {
            if (!(P > 0)) fail('no beat');
            const pattern = shots.slice(0, seq.length).map(s => clamp(Math.round(s.duration / P), 1, 32));
            const r = impl.sync_to_beat({ pattern, end_with_music: false, snap_texts: false });
            Object.assign(music, { retimed: true, bpm: r.bpm, beats_per_clip: pattern, ...(r.warning ? { warning: r.warning } : {}) });
          } catch (e) { music.note = 'No clear beat was found in this music, so the clips keep the shot lengths of the reference.'; }
        }
      }
      // حركة الكاميرا للصور (بعد ضبط المدد النهائية): زوم اللقطة كما قيس في المرجع بإطارين مفتاحيين،
      // أو كاميرا محمولة حيث يتحرك المرجع بلا زوم واضح. الزوم محدود بـ30% وينتهي دائماً عند الصورة كاملة:
      // التقريب يبدأ أصغر ويكبر إليها، والإبعاد يبدأ أقرب وينكشف إليها، فلا يُقصّ نص الملصق وقت قراءته
      if (yes('motion')) {
        seq.forEach((c, i) => {
          if (c.type !== 'image') return;
          const sh = shots[i], len = clipLen(c);
          if (c.kf && c.kf.zoom) { const { zoom, ...rest } = c.kf; if (Object.keys(rest).length) c.kf = rest; else delete c.kf; }
          if (!sh.zoom) { c.motion = sh.motion === 'still' ? 'none' : 'handheld'; return; }
          const k = clamp(sh.zoom.scale, 1 / 1.3, 1.3), early = sh.zoom.when === 'early';
          c.motion = 'none';
          c.kf = { ...c.kf, zoom: [{ t: 0, v: 1 / k, e: early ? 'smooth' : 'linear' }, { t: r2(early ? len / 2 : len), v: 1, e: 'linear' }] };
        });
      }
      // الوميض: على القصّات التي ومضت في المرجع (يتبع مقطعه)، وداخل اللقطات في اللحظة والموضع نفسيهما
      const placed = [];
      if (yes('effects')) {
        seq.forEach((c, i) => { if (i && shots[i].flash) flash({ at: c.id }); });
        layout();
        for (const f of ref.flashes) {
          const i = ref.shots.findIndex(s => f.t >= s.start && f.t < s.end), c = seq[i];
          if (!c) continue;
          const whole = f.width * f.height >= 0.45, type = whole ? 'flash' : 'areaFlash', def = Render.EFFECTS[type];
          const t = c._start + (f.t - ref.shots[i].start) / ref.shots[i].duration * clipLen(c);
          const e = flash({
            type, dur: def.dur, start: r2(Math.max(0, def.shape === 'burst' ? t - def.dur / 2 : t)),
            ...(whole ? {} : { x: f.x, y: f.y, w: clamp(f.width * 1.15, 0.05, 1), h: clamp(f.height * 1.15, 0.05, 1) }),
          });
          placed.push({ id: e.id, type, shot: i + 1, start: e.start, ...(whole ? {} : { x: r2(e.x), y: r2(e.y), width: Math.round(e.w * 100), height: Math.round(e.h * 100) }) });
        }
      }
      layout();
      const unused = material.filter(c => !used.has(c));
      return {
        images: [await mediaSheet(seq, unused)],
        ratio: state.ratio, shots_filled: seq.length, reference_shots: ref.shots.length,
        clips: seq.map((c, i) => ({ id: c.id, name: c.name, type: c.type, shot: i + 1, start: r2(c._start), duration: r2(clipLen(c)), ...(c.type === 'image' && shots[i].zoom && yes('motion') ? { camera: zoomText(shots[i].zoom) } : {}) })),
        ...(mergedShots ? { merged_shots: mergedShots } : {}),
        ...(placed.length ? { flashes: placed, flashes_note: 'Each one sits where the reference had it. Look at the frame (view_frame at its start) and move it onto the product of the user\'s picture with update_effects (x, y, width, height); type can become backlight, glow, shine or sparkle.' } : {}),
        ...(material.length < seq.length ? { reused: `${material.length} media for ${seq.length} shots, so they repeat in a loop.` } : {}),
        ...(unused.length ? { unused: unused.map(c => c.name) } : {}),
        ...(slowed.length ? { slowed_videos: slowed, slowed_note: 'These videos are shorter than their shot and were slowed down to fill it.' } : {}),
        ...(unreadable.length ? { unreadable_files: unreadable } : {}),
        music, ...brief(),
        next: 'The image shows every media tagged with the number of the shot it took (× = not used): compare it with the contact sheet of the reference. To change which media takes which shot, call apply_reference again with clip_ids in the new order (per_shot shows several images together in a shot). Texts of the reference are not copied: add the user\'s own with add_text at similar places and times.',
      };
    },

    duplicate_item({ id }) {
      const hit = find(id) || fail(`No item has id "${id}".`);
      const { kind, obj } = hit, n = S.dupItem(kind, obj) || fail('There is no room for a copy right after this caption.');
      return { kind, id: n.id, ...brief() };
    },

    delete_items({ ids }) {
      const list = Array.isArray(ids) ? ids : has(ids) ? [ids] : [];
      if (!list.length) fail('ids is required');
      const hits = list.map(id => find(id) || fail(`No item has id "${id}".`));
      for (const { kind, obj } of hits) {
        if (obj.el && obj.el.pause) obj.el.pause();
        S.setList(kind, lists[kind]().filter(o => o !== obj));
      }
      return { deleted: hits.length, ...brief() };
    },

    edit_image(a) {
      const c = pick('clip', [a.id])[0];
      if (c.type !== 'image') fail('edit_image only works on image clips, and this clip is a video.');
      const frac = (v, name) => clamp(num(v, name), 0, 1);
      let cv = ImageTools.fromSource(c.el, c.w, c.h);
      const out = {};
      if (has(a.crop_x) || has(a.crop_y) || has(a.crop_width) || has(a.crop_height)) {
        const x = has(a.crop_x) ? frac(a.crop_x, 'crop_x') : 0, y = has(a.crop_y) ? frac(a.crop_y, 'crop_y') : 0;
        const w = has(a.crop_width) ? frac(a.crop_width, 'crop_width') : 1 - x, h = has(a.crop_height) ? frac(a.crop_height, 'crop_height') : 1 - y;
        if (w * cv.width < 2 || h * cv.height < 2) fail('The crop area is empty. crop_x + crop_width and crop_y + crop_height must stay within 0 to 1.');
        cv = ImageTools.crop(cv, x * cv.width, y * cv.height, w * cv.width, h * cv.height);
      }
      if (has(a.rotate)) cv = ImageTools.rotate(cv, +oneOf(a.rotate, ['90', '180', '270'], 'rotate'));
      if (has(a.flip)) cv = ImageTools.flip(cv, oneOf(a.flip, ['horizontal', 'vertical'], 'flip') === 'horizontal');
      if (bool(a.remove_background)) {
        const r = ImageTools.removeBg(cv, { tolerance: has(a.tolerance) ? clamp(num(a.tolerance, 'tolerance'), 1, 100) : 22 });
        cv = r.canvas;
        out.background_removed_percent = Math.round(r.share * 100);
        if (r.share < 0.02) out.note = 'Almost nothing was removed: the background is not a plain color. Try a higher tolerance, or tell the user this photo needs manual work in the image studio.';
        else if (r.share > 0.97) out.note = 'Nearly the whole image was removed. Undo and retry with a lower tolerance.';
      }
      if (has(a.background_color)) {
        const filled = ImageTools.canvas(cv.width, cv.height), g = filled.getContext('2d');
        g.fillStyle = color(a.background_color, 'background_color');
        g.fillRect(0, 0, filled.width, filled.height);
        g.drawImage(cv, 0, 0);
        cv = filled;
      }
      ImageStudio.setClipImage(c, cv);
      return { id: c.id, width: c.w, height: c.h, ...out };
    },

    async merge_images(a) {
      const list = pick('clip', a.ids).filter((c, i, arr) => arr.indexOf(c) === i);
      if (list.length < 2) fail('ids needs at least 2 different image clips.');
      const vid = list.find(c => c.type !== 'image');
      if (vid) fail(`Clip "${vid.id}" is a video; merge_images only takes image clips.`);
      const pct = (k, max, def) => (has(a[k]) ? clamp(num(a[k], k), 0, max) : def);
      const cv = ImageTools.merge(list.map(c => c.el), {
        layout: has(a.layout) ? oneOf(a.layout, ImageTools.LAYOUTS, 'layout') : 'row',
        columns: has(a.columns) ? Math.round(clamp(num(a.columns, 'columns'), 1, list.length)) : undefined,
        fit: has(a.fit) ? oneOf(a.fit, ['cover', 'contain'], 'fit') : 'cover',
        gap: pct('gap', 20, 2), padding: pct('padding', 20, 0), radius: pct('radius', 25, 0),
        background: has(a.background_color) ? color(a.background_color, 'background_color') : '#ffffff',
        rtl: !has(a.right_to_left) || bool(a.right_to_left),
      });
      const first = list[0];
      const before = new Set(state.clips.map(c => c.id));
      // PNG بلا فقدان؛ addFiles يبني المقطع بالطريقة المعتادة ثم ننقله مكان أول صورة
      await S.addFiles([new File([ImageTools.encode(cv, 'png').blob], `دمج-${list.length}-صور.png`, { type: 'image/png' })]);
      const clip = state.clips.find(c => !before.has(c.id)) || fail('Could not add the merged image.');
      state.clips = state.clips.filter(c => c !== clip);
      state.clips.splice(state.clips.indexOf(first), 0, clip);
      Object.assign(clip, { out: first.out, transition: first.transition, trLen: first.trLen, motion: first.motion });
      const replace = !has(a.replace) || bool(a.replace);
      if (replace) state.clips = state.clips.filter(c => !list.includes(c));
      layout();
      return { id: clip.id, width: clip.w, height: clip.h, start: r2(clip._start), replaced: replace ? list.map(c => c.id) : [], ...brief() };
    },

    async extract_audio(a) {
      const c = pick('clip', [a.id])[0];
      if (c.type !== 'video') fail('extract_audio only works on video clips.');
      let buf;
      try { buf = await AudioExtract.decode(c.file); } catch (e) { fail('This video has no sound track.'); }
      const start = has(a.start) ? clamp(num(a.start, 'start'), 0, buf.duration) : c.in;
      const end = has(a.end) ? clamp(num(a.end, 'end'), 0, buf.duration) : Math.min(c.out, buf.duration);
      if (end - start < 0.1) fail(`end must be after start, within 0 to ${r2(buf.duration)} s of the source video.`);
      const pcm = AudioTools.process(buf, {
        start, end, normalize: bool(a.normalize),
        fadeIn: has(a.fade_in) ? clamp(num(a.fade_in, 'fade_in'), 0, 5) : 0,
        fadeOut: has(a.fade_out) ? clamp(num(a.fade_out, 'fade_out'), 0, 5) : 0,
      });
      if (pcm.peak < 1e-3) fail('The sound of this part of the video is silent.');
      const base = c.name.replace(/\.[^.\\/]+$/, '') || 'audio';
      const out = { source_start: r2(start), source_end: r2(end), audio_duration: r2(pcm.duration) };
      if (bool(a.download)) {
        const r = await AudioTools.encode(pcm, has(a.format) ? oneOf(a.format, ['m4a', 'wav'], 'format') : 'm4a');
        ImageTools.download(r.blob, `${base}.${r.ext}`);
        Object.assign(out, { file: `${base}.${r.ext}`, size_kb: Math.round(r.bytes.length / 1024) });
      }
      if (!has(a.add_to_project) || bool(a.add_to_project)) {
        const mute = !has(a.mute_clip) || bool(a.mute_clip);
        const item = await AudioExtract.addToProject(pcm, `${base}.wav`, { clip: c, start }, mute);
        Object.assign(out, { audio_id: item.id, audio_start: r2(item.start), clip_muted: c.muted });
        if (c.speed !== 1) out.note = 'The clip plays at a different speed, so its extracted sound was placed at the clip start but will not stay in sync. Set the clip speed to 1 for exact sync.';
      }
      return { ...out, ...brief() };
    },

    async split_video_file(a) {
      const c = pick('clip', [a.id])[0];
      if (c.type !== 'video') fail('split_video_file only works on video clips.');
      const given = ['every', 'parts', 'times'].filter(k => has(a[k]));
      if (given.length !== 1) fail('Give exactly one of every, parts or times.');
      const o = { start: has(a.start) ? num(a.start, 'start') : c.in, end: has(a.end) ? num(a.end, 'end') : c.out, audio: !has(a.keep_audio) || bool(a.keep_audio), exact: bool(a.exact_cuts) };
      if (o.end - o.start < VideoTools.MIN_PART) fail('end must be after start.');
      if (has(a.every)) Object.assign(o, { mode: 'every', every: num(a.every, 'every') });
      else if (has(a.parts)) Object.assign(o, { mode: 'count', count: clamp(Math.round(num(a.parts, 'parts')), 2, 100) });
      else {
        if (!Array.isArray(a.times) || !a.times.length) fail('times must be a non-empty array of seconds.');
        Object.assign(o, { mode: 'times', times: a.times.map(t => num(t, 'times')) });
      }
      const r = await VideoSplit.splitToFiles(c.file, o);
      if (r.method === 'copy') r.note = 'Copied without re-encoding: each part starts on the keyframe at or before the requested cut, so part lengths can differ slightly from what was asked.';
      return r;
    },

    async save_image(a) {
      layout();
      if (view.total <= 0) fail('The project is empty.');
      const format = has(a.format) ? oneOf(a.format, ['jpeg', 'png', 'webp'], 'format') : 'jpeg';
      const res = has(a.resolution) ? +oneOf(a.resolution, ['720', '1080', '1440', '2160'], 'resolution') : 1080;
      const quality = (has(a.quality) ? clamp(num(a.quality, 'quality'), 10, 100) : 92) / 100;
      const back = view.t;
      S.pause();
      if (has(a.time)) S.setTime(num(a.time, 'time'));
      await settle();
      const [W, H] = outputSize(state.ratio, res), t = view.t;
      const cv = ImageTools.canvas(W, H);
      Render.frame(cv.getContext('2d'), W, H, t);
      S.setTime(back);
      const r = ImageTools.encode(cv, format, quality);
      const file = `montaji-${t.toFixed(1)}s.${r.ext}`;
      ImageTools.download(r.blob, file);
      return { file, time: r2(t), width: W, height: H, size_kb: Math.round(r.bytes.length / 1024), note: 'The image was saved to the user\'s Downloads folder.' };
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
        saveAs: has(a.save_as) ? String(a.save_as) : null,
      });
      if (!r.ok) fail(r.error);
      return {
        ...r,
        note: r.saved_to ? 'The export finished and was saved on disk at saved_to.'
          : r.save_error ? 'The export finished but saving it on disk failed (save_error). A download button is shown to the user in the editor.'
          : 'The export finished. A download button is now shown to the user in the editor.',
      };
    },

    async save_project(a) {
      if (S.isEmpty()) fail('The project is empty, there is nothing to save.');
      const r = await ProjectIO.save({ saveAs: has(a.save_as) ? String(a.save_as) : null });
      if (!r.ok) fail(r.error);
      return { ...r, note: r.saved_to ? 'The project file was saved on disk at saved_to. Reopen it later with open_project.' : 'The project file was downloaded to the user\'s Downloads folder.' };
    },

    // عبر MCP فقط: الخادم يمنح ملف المشروع رابطاً مؤقتاً لأن المتصفح لا يقرأ ملفات الجهاز بمسارها
    async open_project({ url, name }) {
      flush(); // تعديلات المساعد المعلّقة تُسجَّل قبل الاستبدال، فيعيدها التراجع كما هي
      const res = await fetch(url);
      if (!res.ok) fail('Could not read the project file.');
      const r = await ProjectIO.open(new File([await res.blob()], String(name || 'project.montaji')));
      if (!r.ok) fail(r.error);
      return { opened: r.name, ...(r.skipped.length ? { skipped: r.skipped, note: 'The media of the skipped items could not be loaded, so they were left out.' } : {}), ...project() };
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

  // أدوات لا تعدّل المشروع، أو تسجّل خطوتها في سجل التراجع بنفسها (فتح مشروع، إضافة ملفات)
  const READ_ONLY = new Set(['get_project', 'analyze_audio', 'view_frame', 'save_image', 'seek', 'export_video', 'undo', 'import_media', 'save_project', 'open_project', 'export_captions', 'analyze_reference']);

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
