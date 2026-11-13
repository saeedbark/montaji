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
    transition: c.transition, ...(c.transition !== 'none' ? { transition_duration: r2(trDur(c)) } : {}), pulse: !!c.pulse,
    motion: c.motion, fit: c.fit, filter: c.filter, brightness: c.bright, contrast: c.contrast, saturation: c.sat,
  });
  const audioInfo = a => {
    const b = Beats.ensure(a);
    return {
      id: a.id, name: a.name, start: r2(a.start), duration: r2(audioLen(a)), source_duration: r2(a.srcDur),
      trim_start: r2(a.in), trim_end: r2(a.out), volume: Math.round(a.volume * 100), fade_in: a.fadeIn, fade_out: a.fadeOut,
      ...(b && b.bpm ? { bpm: b.bpm, beat_interval: r2(b.period) } : {}),
    };
  };
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
    if (has(a.transition_duration)) c.trLen = r2(clamp(num(a.transition_duration, 'transition_duration'), 0.1, 1.5));
    if (has(a.pulse)) c.pulse = bool(a.pulse);
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

  const READ_ONLY = new Set(['get_project', 'analyze_audio', 'view_frame', 'save_image', 'seek', 'export_video', 'undo', 'import_media']);

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
