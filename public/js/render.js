'use strict';
/* رسم إطار واحد من المشروع على أي Canvas — يُستخدم للمعاينة وللتصدير معاً */

const Render = (() => {
  const FILTERS = {
    none:    { label: ['بدون', 'None'],        css: '' },
    vivid:   { label: ['زاهٍ', 'Vivid'],         css: 'saturate(1.5) contrast(1.08)' },
    warm:    { label: ['دافئ', 'Warm'],        css: 'sepia(0.28) saturate(1.3) hue-rotate(-8deg)' },
    cool:    { label: ['بارد', 'Cool'],        css: 'saturate(1.1) hue-rotate(14deg) brightness(1.03)' },
    bw:      { label: ['أبيض وأسود', 'Black and white'],  css: 'grayscale(1) contrast(1.12)' },
    vintage: { label: ['قديم', 'Vintage'],        css: 'sepia(0.55) contrast(0.92) brightness(1.05) saturate(0.85)' },
    soft:    { label: ['ناعم', 'Soft'],        css: 'contrast(0.86) brightness(1.08) saturate(0.82)' },
  };

  const FONTS = {
    segoe:   { label: ['الافتراضي', 'Default'], css: '"Segoe UI", Tahoma, Arial, sans-serif' },
    tahoma:  { label: ['تاهوما', 'Tahoma'],    css: 'Tahoma, "Segoe UI", sans-serif' },
    arial:   { label: ['آريال', 'Arial'],     css: 'Arial, "Segoe UI", sans-serif' },
    times:   { label: ['تايمز', 'Times'],     css: '"Times New Roman", "Traditional Arabic", serif' },
    courier: { label: ['كوريير', 'Courier'],    css: '"Courier New", monospace' },
    elegant: { label: ['أنيق مائل', 'Elegant italic'], css: 'Didot, "Bodoni MT", Georgia, "Times New Roman", serif', italic: true },
  };

  /*
   * التأثيرات: طبقة فوق الصورة المركّبة (قبل النصوص)، مثل مسار التأثيرات في CapCut.
   * shape يحدد شدّة التأثير عبر مدته: burst = يبلغ ذروته في المنتصف (مناسب لوضعه على القطع)،
   * hold = ثابت طوال المدة، rise = يشتد في أوله ثم يثبت (للتعتيم في الختام).
   */
  const EFFECTS = {
    zoomBlur: { label: ['تكبير ضبابي', 'Zoom blur'],    shape: 'burst', dur: 0.4 },
    whip:     { label: ['سحب سريع', 'Whip'],       shape: 'burst', dur: 0.35 },
    flash:    { label: ['وميض', 'Flash'],           shape: 'burst', dur: 0.25 },
    shake:    { label: ['اهتزاز', 'Shake'],         shape: 'burst', dur: 0.4 },
    rgb:      { label: ['انقسام الألوان', 'Color split'], shape: 'burst', dur: 0.3 },
    bw:       { label: ['أبيض وأسود', 'Black and white'],     shape: 'hold',  dur: 2 },
    sharp:    { label: ['وضوح عالٍ', 'Sharpen'],      shape: 'hold',  dur: 3 },
    vignette: { label: ['إطار داكن', 'Vignette'],      shape: 'hold',  dur: 3 },
    darken:   { label: ['تعتيم', 'Darken'],          shape: 'rise',  dur: 1.2 },
    // تأثيرات على المنتج نفسه: لها موضع (x, y من 0 إلى 1) وحجم r (نسبة من عرض الإطار) يُسحب في المعاينة
    zoomTo:   { label: ['تقريب على المنتج', 'Zoom to product'], shape: 'focus', dur: 1.2, region: true },
    spotlight:{ label: ['إضاءة المنتج', 'Spotlight'],    shape: 'focus', dur: 1.5, region: true },
    shine:    { label: ['لمعة', 'Shine'],            shape: 'sweep', dur: 0.9, region: true },
    glow:     { label: ['توهج', 'Glow'],            shape: 'focus', dur: 1.5, region: true },
    sparkle:  { label: ['بريق', 'Sparkle'],            shape: 'hold',  dur: 1.5, region: true },
    // على مستطيل من الصورة (w, h نسبة من عرض الإطار وارتفاعه): ومضة تشتعل فجأة ثم تنطفئ، كما في ريلز المحلات
    areaFlash:{ label: ['وميض جزئي', 'Area flash'],       shape: 'blink', dur: 0.22, region: true, rect: true },
    backlight:{ label: ['إضاءة خلفية', 'Backlight'],     shape: 'blink', dur: 0.3,  region: true, rect: true },
  };

  // أوضاع مزج الطبقات ← عملية التركيب في Canvas
  const BLENDS = {
    normal:   { label: ['عادي', 'Normal'],   op: 'source-over' },
    screen:   { label: ['إضاءة', 'Screen'],  op: 'screen' },
    multiply: { label: ['ضرب', 'Multiply'],    op: 'multiply' },
    lighten:  { label: ['تفتيح', 'Lighten'],  op: 'lighten' },
  };
  const MASKS = { none: ['بدون', 'None'], round: ['زوايا مستديرة', 'Rounded corners'], circle: ['دائرة', 'Circle'] };
  const CAPTION_MODES = { none: ['بلا تمييز', 'No highlight'], word: ['كلمة ملوّنة', 'Colored word'], pop: ['كلمة مكبّرة', 'Enlarged word'], reveal: ['كلمة كلمة', 'Word by word'] };
  // التسميات تتبع لغة الواجهة
  for (const tb of [FILTERS, FONTS, EFFECTS, BLENDS, MASKS, CAPTION_MODES]) I18N.localize(tb);
  const RTL = /[֐-ࣿיִ-ﻼ]/;

  let curT = 0; // زمن الإطار الجاري رسمه (لنبضة الإيقاع)
  const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

  function filterCss(c) {
    let s = (FILTERS[c.filter] || FILTERS.none).css;
    if (c.bright !== 100) s += ` brightness(${c.bright / 100})`;
    if (c.contrast !== 100) s += ` contrast(${c.contrast / 100})`;
    if (c.sat !== 100) s += ` saturate(${c.sat / 100})`;
    return s.trim();
  }

  // لوحات مؤقتة للانتقالات (نرسم المقطع كاملاً ثم نركّبه بشفافية/إزاحة)
  const layers = [];
  function layer(i, W, H) {
    let cv = layers[i];
    if (!cv) cv = layers[i] = document.createElement('canvas');
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    return cv;
  }

  /** يرسم مقطعاً واحداً ليملأ الإطار. p = نسبة التقدم داخل المقطع (0..1) */
  function drawClip(ctx, c, W, H, p) {
    const el = c.el, sw = c.w, sh = c.h;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!el || !sw || !sh) { ctx.restore(); return; }
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    const f = filterCss(c);
    const sameAspect = Math.abs(sw / sh - W / H) < 0.01;
    const fit = sameAspect ? 'cover' : c.fit;
    // تكبير وإزاحة وشفافية المقطع (ثابتة أو بإطارات مفتاحية). الإطارات المفتاحية تعطّل حركة الكاميرا الجاهزة
    const klt = p * clipLen(c);
    const custom = hasKf(c, 'zoom') || hasKf(c, 'panX') || hasKf(c, 'panY');
    const motion = custom ? 'none' : c.motion;
    ctx.globalAlpha = clamp(prop(c, 'opacity', klt), 0, 1);

    try {
      if (fit === 'blur') {
        // الخلفية الضبابية تُرسم مصغّرة ثم تُكبَّر: نفس الشكل وبجزء بسيط من التكلفة
        const K = 6, bw = Math.ceil(W / K), bh = Math.ceil(H / K);
        const bg = layer(2, bw, bh), g = bg.getContext('2d');
        const bs = Math.max(bw / sw, bh / sh) * 1.12;
        g.filter = `blur(${Math.max(1, H * 0.035 / K).toFixed(1)}px) brightness(0.55)${f ? ' ' + f : ''}`;
        g.drawImage(el, (bw - sw * bs) / 2, (bh - sh * bs) / 2, sw * bs, sh * bs);
        ctx.filter = 'none';
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bg, 0, 0, W, H);
      }
      ctx.filter = f || 'none';
      const s = fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
      let m = 1, dx = 0, dy = 0, rot = 0;
      const Z = 0.14;
      if (motion === 'zoomIn') m = 1 + Z * p;
      else if (motion === 'zoomOut') m = 1 + Z * (1 - p);
      else if (motion === 'panLeft' || motion === 'panRight') {
        m = 1 + Z;
        const extra = sw * s * Z;
        dx = (motion === 'panLeft' ? 0.5 - p : p - 0.5) * extra;
      } else if (motion === 'panUp' || motion === 'panDown') {
        // تمرير عمودي: في الصورة الطويلة (صور مدموجة فوق بعض مع «ملء الإطار») يمر على الصورة كلها
        m = 1 + Z * 0.5;
        const room = Math.max(sh * s * m - H, sh * s * Z * 0.5);
        dy = (motion === 'panUp' ? 0.5 - ease(p) : ease(p) - 0.5) * room;
      } else if (motion === 'handheld') {
        // كاميرا محمولة: انجراف ناعم ودوران خفيف مع اقتراب بطيء، فتبدو الصورة الثابتة كأنها مصوّرة باليد
        const lt = p * clipLen(c), ph = c._ph || (c._ph = [...String(c.id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 97);
        m = 1.03 + 0.04 * p;
        dx = W * 0.010 * (Math.sin(lt * 1.7 + ph) + 0.45 * Math.sin(lt * 4.1 + ph * 2));
        dy = H * 0.008 * (Math.cos(lt * 1.3 + ph) + 0.45 * Math.sin(lt * 3.3 + ph));
        rot = 0.009 * Math.sin(lt * 1.1 + ph * 3);
      }
      // نبضة مع الإيقاع: تكبير خاطف عند كل ضربة في الموسيقى
      if (c.pulse) m *= 1 + 0.045 * Beats.pulse(curT);
      m *= clamp(prop(c, 'zoom', klt), 0.2, 5);
      dx += prop(c, 'panX', klt) * W;
      dy += prop(c, 'panY', klt) * H;
      const dw = sw * s * m, dh = sh * s * m;
      if (rot) { ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.translate(-W / 2, -H / 2); }
      ctx.drawImage(el, (W - dw) / 2 + dx, (H - dh) / 2 + dy, dw, dh);
    } catch (e) { /* العنصر غير جاهز بعد */ }
    ctx.restore();
  }

  function drawTransition(ctx, cur, prev, W, H, p, q) {
    const A = layer(0, W, H), B = layer(1, W, H);
    const bctx = B.getContext('2d');
    drawClip(bctx, cur, W, H, p);
    const actx = A.getContext('2d');
    if (prev) drawClip(actx, prev, W, H, 1);
    else { actx.fillStyle = '#000'; actx.fillRect(0, 0, W, H); }

    ctx.save();
    switch (cur.transition) {
      case 'slide':
        ctx.drawImage(A, -q * W, 0);
        ctx.drawImage(B, (1 - q) * W, 0);
        break;
      case 'zoom': {
        ctx.drawImage(A, 0, 0);
        const s = 1.3 - 0.3 * q;
        ctx.globalAlpha = q;
        ctx.translate(W / 2, H / 2); ctx.scale(s, s);
        ctx.drawImage(B, -W / 2, -H / 2);
        break;
      }
      case 'wipe':
        ctx.drawImage(A, 0, 0);
        ctx.beginPath(); ctx.rect(W * (1 - q), 0, W * q, H); ctx.clip();
        ctx.drawImage(B, 0, 0);
        break;
      case 'black':
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        if (q < 0.5) { ctx.globalAlpha = 1 - q * 2; ctx.drawImage(A, 0, 0); }
        else { ctx.globalAlpha = q * 2 - 1; ctx.drawImage(B, 0, 0); }
        break;
      default: // fade
        ctx.drawImage(A, 0, 0);
        ctx.globalAlpha = q;
        ctx.drawImage(B, 0, 0);
    }
    ctx.restore();
  }

  function wrapLines(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = line + ' ' + words[i];
        if (ctx.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = words[i]; }
      }
      out.push(line);
    }
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawText(ctx, tx, W, H, t, outline) {
    const lt = t - tx.start;
    if (lt < 0 || lt > tx.dur || !String(tx.text).trim()) { tx._box = null; return; }

    const size = prop(tx, 'size', lt) * H;
    const px = prop(tx, 'x', lt), py = prop(tx, 'y', lt);
    const ff = FONTS[tx.font] || FONTS.segoe;
    ctx.save();
    ctx.font = `${ff.italic ? 'italic ' : ''}${tx.bold ? 700 : 400} ${size}px ${ff.css}`;
    ctx.direction = RTL.test(tx.text) ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = wrapLines(ctx, tx.text, W * 0.9);
    const lineH = size * 1.4;
    const bw = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bh = lines.length * lineH;
    const padX = size * 0.45, padY = size * 0.18;

    // حركة الدخول والخروج
    let alpha = 1, offY = 0, sc = 1;
    if (tx.anim && tx.anim !== 'none') {
      const f = Math.min(0.4, tx.dur / 3);
      const k = clamp(Math.min(lt / f, (tx.dur - lt) / f), 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      alpha = k;
      if (tx.anim === 'rise') offY = (1 - e) * size * 0.7;
      if (tx.anim === 'pop') sc = 0.6 + 0.4 * e;
    }
    alpha *= clamp(prop(tx, 'opacity', lt), 0, 1);

    const cx = px * W, cy = py * H;
    ctx.translate(cx, cy + offY);
    const rot = prop(tx, 'rot', lt);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    ctx.scale(sc, sc);
    ctx.globalAlpha = alpha;

    if (tx.bg) {
      ctx.fillStyle = tx.bgColor;
      ctx.globalAlpha = alpha * 0.78;
      roundRect(ctx, -bw / 2 - padX, -bh / 2 - padY, bw + padX * 2, bh + padY * 2, size * 0.28);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    lines.forEach((line, i) => {
      const y = -bh / 2 + lineH * (i + 0.5);
      if (tx.stroke) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.14;
        ctx.strokeStyle = tx.strokeColor;
        ctx.strokeText(line, 0, y);
      }
      if (tx.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,.65)';
        ctx.shadowBlur = size * 0.18;
        ctx.shadowOffsetY = size * 0.05;
      }
      ctx.fillStyle = tx.color;
      ctx.fillText(line, 0, y);
      ctx.shadowColor = 'transparent';
    });
    ctx.restore();

    // صندوق النص (بنسب 0..1) لالتقاطه بالفأرة
    const hw = (bw / 2 + padX) / W, hh = (bh / 2 + padY) / H;
    tx._box = { x0: px - hw, y0: py - hh, x1: px + hw, y1: py + hh };

    if (outline) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, H / 400);
      ctx.setLineDash([H / 90, H / 120]);
      ctx.strokeRect(tx._box.x0 * W, tx._box.y0 * H, hw * 2 * W, hh * 2 * H);
      ctx.restore();
    }
  }

  /** شدة التأثير عند الزمن t، من 0 إلى 1 مضروبة في مقداره */
  function effectLevel(e, t) {
    const lt = t - e.start;
    if (lt < 0 || lt >= e.dur) return 0;
    const p = lt / e.dur, shape = (EFFECTS[e.type] || {}).shape;
    let k;
    if (shape === 'burst') k = Math.sin(Math.PI * p);
    else if (shape === 'sweep') k = 1;
    else if (shape === 'blink') k = p < 0.1 ? p / 0.1 : Math.pow((1 - p) / 0.9, 1.4); // تشتعل فوراً وتخبو
    else if (shape === 'focus') { // يدخل بسرعة، يثبت، ثم يعود قبل نهايته بقليل
      const inT = Math.min(0.35, e.dur * 0.35), outT = Math.min(0.2, e.dur * 0.2);
      k = ease(clamp(Math.min(lt / inT, (e.dur - lt) / outT), 0, 1));
    } else if (shape === 'rise') k = ease(Math.min(1, lt / Math.max(0.05, Math.min(0.6, e.dur * 0.6))));
    else k = clamp(Math.min(lt, e.dur - lt) / 0.04, 0, 1); // ثابت، مع حواف قصيرة جداً كي لا تظهر قفزة
    return k * clamp(prop(e, 'amount', lt), 0, 1);
  }

  // متوسط نسخ متعددة من الصورة: كل نسخة بشفافية 1/(i+1) فتتساوى أوزانها
  function smear(ctx, src, W, H, n, place) {
    for (let i = 1; i <= n; i++) {
      ctx.globalAlpha = 1 / (i + 1);
      place(i / n, (x, y, w, h) => ctx.drawImage(src, x, y, w, h));
    }
    ctx.globalAlpha = 1;
  }

  function applyEffect(ctx, e, s, W, H, t) {
    const src = layer(3, W, H), g = src.getContext('2d');
    g.globalAlpha = 1; g.filter = 'none'; g.globalCompositeOperation = 'copy';
    g.drawImage(ctx.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    switch (e.type) {
      case 'zoomBlur': { // تكبير شعاعي ضبابي من المركز
        const amt = 0.42 * s;
        smear(ctx, src, W, H, 8 + Math.round(22 * s), (f, draw) => { const k = 1 + amt * f; draw((W - W * k) / 2, (H - H * k) / 2, W * k, H * k); });
        break;
      }
      case 'whip': { // سحب أفقي سريع مع إزاحة
        const A = 0.16 * W * s, shift = 0.08 * W * s;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.drawImage(src, shift - A, 0, W, H);
        smear(ctx, src, W, H, 8 + Math.round(18 * s), (f, draw) => draw(shift - A + 2 * A * f, 0, W, H));
        break;
      }
      case 'flash':
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.9 * s;
        ctx.fillRect(0, 0, W, H);
        break;
      case 'shake': {
        const dx = (Math.sin(t * 91) + Math.sin(t * 37) * 0.5) * W * 0.022 * s;
        const dy = (Math.cos(t * 73) + Math.cos(t * 29) * 0.5) * H * 0.016 * s;
        const k = 1 + 0.07 * s;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(src, (W - W * k) / 2 + dx, (H - H * k) / 2 + dy, W * k, H * k);
        break;
      }
      case 'rgb': { // الأحمر يُزاح يساراً والأخضر والأزرق يميناً
        const d = 0.022 * W * s;
        const red = layer(4, W, H), rg = red.getContext('2d');
        const cyan = layer(5, W, H), cg = cyan.getContext('2d');
        for (const [cv, c2, col] of [[red, rg, '#f00'], [cyan, cg, '#0ff']]) {
          c2.globalCompositeOperation = 'copy'; c2.drawImage(src, 0, 0);
          c2.globalCompositeOperation = 'multiply'; c2.fillStyle = col; c2.fillRect(0, 0, W, H);
          c2.globalCompositeOperation = 'source-over';
        }
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(red, -d, 0);
        ctx.drawImage(cyan, d, 0);
        break;
      }
      case 'bw':
        ctx.globalCompositeOperation = 'copy';
        ctx.filter = `grayscale(${s.toFixed(3)}) contrast(${(1 + 0.12 * s).toFixed(3)})`;
        ctx.drawImage(src, 0, 0);
        break;
      case 'sharp':
        ctx.globalCompositeOperation = 'copy';
        ctx.filter = `contrast(${(1 + 0.14 * s).toFixed(3)}) saturate(${(1 + 0.22 * s).toFixed(3)}) brightness(${(1 + 0.03 * s).toFixed(3)})`;
        ctx.drawImage(src, 0, 0);
        break;
      case 'vignette': {
        const r = Math.hypot(W, H) / 2;
        const gr = ctx.createRadialGradient(W / 2, H / 2, r * 0.38, W / 2, H / 2, r);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, `rgba(0,0,0,${(0.8 * s).toFixed(3)})`);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'darken':
        ctx.fillStyle = '#000';
        ctx.globalAlpha = 0.72 * s;
        ctx.fillRect(0, 0, W, H);
        break;
      default:
        if (EFFECTS[e.type] && EFFECTS[e.type].region) applyRegion(ctx, src, e, s, W, H, t);
    }
    ctx.restore();
  }

  /* ---------- تأثيرات المنتج ---------- */
  const R = e => clamp(e.r > 0 ? e.r : 0.3, 0.05, 1);
  const RW = e => clamp(e.w > 0 ? e.w : 0.4, 0.02, 1);
  const RH = e => clamp(e.h > 0 ? e.h : 0.2, 0.02, 1);

  /** تقريب على المنتج: يكبّر الإطار ويحرّك المنتج نحو المركز. يعيد التحويل كي تتبعه بقية التأثيرات */
  function zoomTransform(e, s, W, H) {
    const Z = 1 + (clamp(0.5 / R(e), 1.25, 1.9) - 1) * s;
    const cx = e.x * W, cy = e.y * H;
    const tx = cx + (W / 2 - cx) * s, ty = cy + (H / 2 - cy) * s; // أين يصبح المنتج
    const ox = clamp(tx - cx * Z, W - W * Z, 0), oy = clamp(ty - cy * Z, H - H * Z, 0);
    return { Z, ox, oy };
  }

  function star(ctx, x, y, size) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, rr = i % 2 ? size * 0.18 : size;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function applyRegion(ctx, src, e, s, W, H, t) {
    const cx = e._cx != null ? e._cx : e.x * W, cy = e._cy != null ? e._cy : e.y * H;
    const rad = (e._r != null ? e._r : R(e)) * W;
    const zk = e._r != null ? e._r / R(e) : 1; // تكبير «تقريب على المنتج» إن كان فعّالاً
    const rw = RW(e) * W * zk, rh = RH(e) * H * zk, rx = cx - rw / 2, ry = cy - rh / 2;
    const feather = Math.max(2, Math.min(rw, rh) * 0.07);
    const p = clamp((t - e.start) / e.dur, 0, 1);
    switch (e.type) {
      case 'areaFlash': { // الجزء المحدد يشتعل ضوءاً (مثل الكاونتر في الريل)
        const fl = layer(4, W, H), g = fl.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.filter = 'brightness(1.9) saturate(0.75)';
        g.drawImage(src, 0, 0);
        g.filter = `blur(${feather.toFixed(1)}px)`;
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = '#000'; g.fillRect(rx, ry, rw, rh);
        g.filter = 'none';
        g.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = s;
        ctx.drawImage(fl, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18 * s;
        ctx.filter = `blur(${(feather * 2).toFixed(1)}px)`;
        ctx.fillStyle = '#fff3dc'; ctx.fillRect(rx, ry, rw, rh);
        break;
      }
      case 'backlight': { // الجزء كله يشتعل بضوء دافئ، مع هالة تفيض حول حوافه (كاللوحة المضاءة في الريل)
        // 1) الداخل كله: نسخة مضيئة دافئة من الصورة داخل المستطيل بحواف ناعمة
        const fl = layer(4, W, H), g = fl.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.filter = 'brightness(1.75) sepia(0.35) saturate(1.15)';
        g.drawImage(src, 0, 0);
        g.filter = `blur(${feather.toFixed(1)}px)`;
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = '#000'; g.fillRect(rx, ry, rw, rh);
        g.filter = 'none';
        g.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = s;
        ctx.drawImage(fl, 0, 0);
        // 2) هالة الضوء حول الحواف
        g.globalCompositeOperation = 'copy';
        g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        g.filter = `blur(${(feather * 1.6).toFixed(1)}px)`;
        g.strokeStyle = '#ffd59a'; g.lineWidth = feather * 2.4;
        g.strokeRect(rx, ry, rw, rh);
        g.filter = `blur(${(feather * 0.5).toFixed(1)}px)`;
        g.strokeStyle = '#fff6e6'; g.lineWidth = feather * 0.8;
        g.strokeRect(rx, ry, rw, rh);
        g.filter = 'none';
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(fl, 0, 0);
        ctx.drawImage(fl, 0, 0);
        break;
      }
      case 'zoomTo': {
        const { Z, ox, oy } = zoomTransform(e, s, W, H);
        ctx.globalCompositeOperation = 'copy';
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, ox, oy, W * Z, H * Z);
        break;
      }
      case 'spotlight': {
        const gr = ctx.createRadialGradient(cx, cy, rad * 0.75, cx, cy, rad * 1.9);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, `rgba(0,0,0,${(0.78 * s).toFixed(3)})`);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'soft-light';
        const hi = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        hi.addColorStop(0, `rgba(255,255,255,${(0.5 * s).toFixed(3)})`);
        hi.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hi; ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'shine': { // شريط ضوء مائل يعبر المنتج، يتلاشى عند أطراف المنطقة بلا حافة ظاهرة
        const sl = layer(4, W, H), g = sl.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        g.save();
        g.translate(cx, cy); g.rotate(-0.45);
        const span = rad * 2.6, x0 = -span / 2 + ease(p) * span, bw = rad * 0.35;
        for (const [off, w, a] of [[0, bw, 0.6], [bw * 1.1, bw * 0.35, 0.4]]) {
          const lg = g.createLinearGradient(x0 + off - w, 0, x0 + off + w, 0);
          lg.addColorStop(0, 'rgba(255,250,235,0)');
          lg.addColorStop(0.5, `rgba(255,250,235,${a})`);
          lg.addColorStop(1, 'rgba(255,250,235,0)');
          g.fillStyle = lg; g.fillRect(x0 + off - w, -rad * 2, w * 2, rad * 4);
        }
        g.restore();
        g.globalCompositeOperation = 'destination-in';
        const mk = g.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad * 1.15);
        mk.addColorStop(0, 'rgba(0,0,0,1)'); mk.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = mk; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = s;
        ctx.drawImage(sl, 0, 0);
        break;
      }
      case 'glow': { // نسخة مضيئة ضبابية من المنتج تُضاف فوقه بقناع دائري
        const gl = layer(4, W, H), g = gl.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.filter = `blur(${Math.max(2, rad * 0.09).toFixed(1)}px) brightness(1.5) saturate(1.3)`;
        g.drawImage(src, 0, 0);
        g.filter = 'none';
        g.globalCompositeOperation = 'destination-in';
        const m = g.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad * 1.25);
        m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = m; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.85 * s;
        ctx.drawImage(gl, 0, 0);
        break;
      }
      case 'sparkle': { // نجوم صغيرة تلمع حول المنتج، كل واحدة في توقيتها
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = 'rgba(255,240,200,.9)';
        ctx.shadowBlur = rad * 0.08;
        ctx.fillStyle = '#fffaf0';
        const lt = t - e.start;
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4 + 0.6, d = rad * (0.55 + 0.4 * ((i * 37) % 10) / 10);
          const tw = Math.max(0, Math.sin(lt * 5.5 + i * 1.9));
          if (tw < 0.05) continue;
          ctx.globalAlpha = s * tw;
          star(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 1.1, rad * (0.07 + 0.05 * (i % 3)) * (0.5 + 0.5 * tw));
        }
        break;
      }
    }
  }

  function drawEffects(ctx, W, H, t) {
    // التقريب على المنتج أولاً، وبقية تأثيرات المنتج تتبع موضعه الجديد
    let zt = null;
    const list = state.effects.filter(e => t >= e.start && t < e.start + e.dur);
    const order = [...list.filter(e => e.type === 'zoomTo'), ...list.filter(e => e.type !== 'zoomTo')];
    for (const e of order) {
      const s = effectLevel(e, t);
      const follow = e.type !== 'zoomTo' && EFFECTS[e.type] && EFFECTS[e.type].region && zt;
      e._zt = follow ? { ...zt, W, H } : null; // لمقبض المعاينة وللسحب فيها
      if (s <= 0.004) continue;
      if (follow) {
        e._cx = zt.ox + e.x * W * zt.Z; e._cy = zt.oy + e.y * H * zt.Z; e._r = R(e) * zt.Z;
      } else { e._cx = e._cy = e._r = null; }
      applyEffect(ctx, e, s, W, H, t);
      if (e.type === 'zoomTo' && !zt) zt = zoomTransform(e, s, W, H);
    }
  }

  /** «تقريب على المنتج» الفعّال فوق هذا التأثير عند الزمن t، إن وُجد (يحسبه drawEffects) */
  const zoomAt = (e, t) => (e._zt && t >= e.start && t < e.start + e.dur ? e._zt : null);

  /** نقطة في المعاينة (0 إلى 1) ← موضعها في الصورة قبل «تقريب على المنتج»، كي يقع السحب حيث يُرسم التأثير */
  function unzoom(e, nx, ny, t) {
    const z = zoomAt(e, t);
    return z ? { x: (nx * z.W - z.ox) / (z.W * z.Z), y: (ny * z.H - z.oy) / (z.H * z.Z) } : { x: nx, y: ny };
  }

  /** دائرة موضع التأثير المحدد في المعاينة، ليسحبها المستخدم فوق المنتج. تتبع «تقريب على المنتج» إن كان فعّالاً */
  function drawRegionHandle(ctx, e, W, H, t) {
    if (!e || !EFFECTS[e.type] || !EFFECTS[e.type].region) return;
    const z = zoomAt(e, t), k = z ? z.Z : 1;
    const cx = z ? z.ox + e.x * W * k : e.x * W, cy = z ? z.oy + e.y * H * k : e.y * H, rad = R(e) * W * k;
    ctx.save();
    ctx.strokeStyle = '#ff5cf0'; ctx.lineWidth = Math.max(1.5, H / 400);
    ctx.setLineDash([H / 90, H / 140]);
    ctx.beginPath();
    if (EFFECTS[e.type].rect) ctx.rect(cx - RW(e) * W * k / 2, cy - RH(e) * H * k / 2, RW(e) * W * k, RH(e) * H * k);
    else ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8); ctx.stroke();
    ctx.restore();
  }

  /* ---------- الطبقات فوق المسار الرئيسي ---------- */
  function maskPath(ctx, o, dw, dh) {
    ctx.beginPath();
    if (o.mask === 'circle') ctx.arc(0, 0, Math.min(dw, dh) / 2, 0, Math.PI * 2);
    else if (o.mask === 'round') roundRect(ctx, -dw / 2, -dh / 2, dw, dh, clamp(o.radius != null ? o.radius : 0.08, 0, 0.5) * Math.min(dw, dh));
    else ctx.rect(-dw / 2, -dh / 2, dw, dh);
  }

  /** يرسم طبقة: scale نسبة عرضها من عرض الإطار، و x و y مركزها. يخزّن هندستها في _g لمقابض المعاينة */
  function drawOverlay(ctx, o, W, H, t) {
    const len = overlayLen(o), lt = t - o.start;
    o._g = null;
    if (lt < 0 || lt >= len || !o.el || !o.w || !o.h) return;
    const dw = clamp(prop(o, 'scale', lt), 0.02, 3) * W, dh = dw * o.h / o.w;
    const cx = prop(o, 'x', lt) * W, cy = prop(o, 'y', lt) * H, rot = prop(o, 'rot', lt) * Math.PI / 180;
    o._g = { cx, cy, dw, dh, rot, W, H };

    let alpha = clamp(prop(o, 'opacity', lt), 0, 1), offY = 0, sc = 1;
    if (o.anim && o.anim !== 'none') {
      const f = Math.min(0.4, len / 3);
      const k = clamp(Math.min(lt / f, (len - lt) / f), 0, 1), e = 1 - Math.pow(1 - k, 3);
      alpha *= k;
      if (o.anim === 'rise') offY = (1 - e) * dh * 0.15;
      if (o.anim === 'pop') sc = 0.6 + 0.4 * e;
    }
    if (alpha <= 0.003) return;

    ctx.save();
    ctx.translate(cx, cy + offY);
    if (rot) ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = (BLENDS[o.blend] || BLENDS.normal).op;
    const f = (FILTERS[o.filter] || FILTERS.none).css;
    const shadow = () => { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = H * 0.03; ctx.shadowOffsetY = H * 0.012; };
    const masked = o.mask === 'round' || o.mask === 'circle';
    try {
      if (masked) {
        if (o.shadow) { ctx.save(); shadow(); ctx.fillStyle = '#000'; maskPath(ctx, o, dw, dh); ctx.fill(); ctx.restore(); }
        ctx.save();
        maskPath(ctx, o, dw, dh); ctx.clip();
        ctx.filter = f || 'none';
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(o.el, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      } else {
        // بلا قناع: الظل يتبع شفافية الصورة نفسها (شعار PNG مثلاً)
        ctx.save();
        if (o.shadow) shadow();
        ctx.filter = f || 'none';
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(o.el, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }
      if (o.border > 0) {
        ctx.lineWidth = clamp(o.border, 0, 0.05) * H;
        ctx.strokeStyle = o.borderColor || '#ffffff';
        ctx.lineJoin = 'round';
        maskPath(ctx, o, dw, dh);
        ctx.stroke();
      }
    } catch (e) { /* العنصر غير جاهز بعد */ }
    ctx.restore();
  }

  const overlaysInOrder = () => [...state.overlays].sort((a, b) => (a.track || 0) - (b.track || 0));
  const HANDLE = H => Math.max(7, H / 55);

  /** إطار الطبقة المحددة في المعاينة: زوايا للتكبير ومقبض علوي للتدوير */
  function drawOverlayHandle(ctx, o, W, H) {
    const g = o && o._g;
    if (!g) return;
    const s = HANDLE(H);
    ctx.save();
    ctx.translate(g.cx, g.cy); ctx.rotate(g.rot);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, H / 400);
    ctx.setLineDash([H / 90, H / 120]);
    ctx.strokeRect(-g.dw / 2, -g.dh / 2, g.dw, g.dh);
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b6cff';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath(); ctx.rect(sx * g.dw / 2 - s / 2, sy * g.dh / 2 - s / 2, s, s); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, -g.dh / 2); ctx.lineTo(0, -g.dh / 2 - s * 2.4); ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -g.dh / 2 - s * 2.4, s * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#2b6cff'; ctx.stroke();
    ctx.restore();
  }

  /**
   * ما الذي تحت نقطة المعاينة (nx, ny من 0 إلى 1) في هذه الطبقة؟ 'rot' | 'scale' | 'move' | null.
   * يعتمد على الهندسة التي خزّنها آخر رسم. handles: هل تُفحص المقابض (للطبقة المحددة فقط)
   */
  function overlayHit(o, nx, ny, handles) {
    const g = o && o._g;
    if (!g) return null;
    const dx = nx * g.W - g.cx, dy = ny * g.H - g.cy, c = Math.cos(-g.rot), s = Math.sin(-g.rot);
    const lx = dx * c - dy * s, ly = dx * s + dy * c, hs = HANDLE(g.H) * 1.3;
    if (handles) {
      if (Math.hypot(lx, ly + g.dh / 2 + HANDLE(g.H) * 2.4) < hs) return 'rot';
      if (Math.abs(Math.abs(lx) - g.dw / 2) < hs && Math.abs(Math.abs(ly) - g.dh / 2) < hs) return 'scale';
    }
    return Math.abs(lx) <= g.dw / 2 && Math.abs(ly) <= g.dh / 2 ? 'move' : null;
  }

  /* ---------- الترجمة ---------- */
  /**
   * يرسم كتلة الترجمة الظاهرة عند الزمن t بنمط المشروع، ويميّز الكلمة المنطوقة.
   * التمييز في العربية: الحروف تتصل فلا تُرسم الكلمة وحدها؛ يُرسم السطر كاملاً ثم يُعاد رسمه بلون التمييز
   * داخل مستطيل الكلمة فقط (clip). موضع الكلمة يُحسب بقياس ما قبلها في سطرها مع مراعاة الاتجاه.
   */
  function drawCaptions(ctx, W, H, t, outline) {
    const cap = state.captions;
    cap._box = null; cap._cur = null;
    const it = CaptionTools.itemAt(cap.items, t);
    if (!it || !String(it.text).trim()) return;
    const st = cap.style, size = clamp(st.size, 0.02, 0.2) * H, ff = FONTS[st.font] || FONTS.segoe;
    const words = it.words && it.words.length ? it.words : CaptionTools.spread(it.text, it.start, it.end);
    if (!words.length) return;
    const rtl = RTL.test(it.text);
    ctx.save();
    ctx.font = `${ff.italic ? 'italic ' : ''}700 ${size}px ${ff.css}`;
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // الأسطر: أرقام الكلمات في كل سطر
    const join = l => l.map(k => words[k].w).join(' ');
    const lines = [];
    let cur = [];
    words.forEach((w, i) => {
      if (cur.length && ctx.measureText(join([...cur, i])).width > W * 0.86) { lines.push(cur); cur = [i]; } else cur.push(i);
    });
    lines.push(cur);
    const strs = lines.map(join), widths = strs.map(s => ctx.measureText(s).width);
    const lineH = size * 1.4, bw = Math.max(...widths), bh = lines.length * lineH;
    const padX = size * 0.45, padY = size * 0.18;
    const active = st.mode === 'none' ? -2 : CaptionTools.wordAt({ words }, t);

    ctx.translate(W / 2, st.y * H);
    if (st.bg) {
      ctx.fillStyle = st.bgColor;
      ctx.globalAlpha = 0.72;
      roundRect(ctx, -bw / 2 - padX, -bh / 2 - padY, bw + padX * 2, bh + padY * 2, size * 0.28);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const paint = (s, y, color) => {
      if (st.outline) { ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.14; ctx.strokeStyle = '#000'; ctx.strokeText(s, 0, y); }
      ctx.fillStyle = color;
      ctx.fillText(s, 0, y);
    };
    lines.forEach((l, li) => {
      const y = -bh / 2 + lineH * (li + 0.5), s = strs[li], lw = widths[li];
      // مدى الكلمة أفقياً داخل سطرها: [البداية، العرض]
      const ext = k => {
        const pos = l.indexOf(k), pre = pos ? ctx.measureText(join(l.slice(0, pos)) + ' ').width : 0, ww = ctx.measureText(words[k].w).width;
        return [rtl ? lw / 2 - pre - ww : -lw / 2 + pre, ww];
      };
      const band = (x, w) => { ctx.beginPath(); ctx.rect(x, y - lineH * 0.75, w, lineH * 1.5); };
      if (st.mode === 'reveal') { // تظهر الكلمات واحدة بعد أخرى: يُقص السطر عند آخر كلمة نُطقت
        const shown = l.filter(k => k <= active);
        if (!shown.length) return;
        if (shown.length < l.length) {
          const [x0, ww] = ext(shown[shown.length - 1]), pad = size * 0.1;
          ctx.save();
          if (rtl) band(x0 - pad, lw / 2 - x0 + pad + size); else band(-lw / 2 - size, x0 + ww + pad + lw / 2 + size);
          ctx.clip(); paint(s, y, st.color); ctx.restore();
        } else paint(s, y, st.color);
        return;
      }
      if (!l.includes(active)) return paint(s, y, st.color);
      const [x0, ww] = ext(active), pad = size * 0.06;
      if (st.mode === 'pop') { // الكلمة الحالية أكبر وبلون التمييز: السطر بلا الكلمة، ثم الكلمة مكبّرة حول مركزها
        ctx.save();
        ctx.beginPath(); ctx.rect(-W, y - lineH, 2 * W, 2 * lineH); ctx.rect(x0 - pad, y - lineH, ww + pad * 2, 2 * lineH);
        ctx.clip('evenodd'); paint(s, y, st.color); ctx.restore();
        ctx.save();
        ctx.translate(x0 + ww / 2, y); ctx.scale(1.16, 1.16); ctx.translate(-x0 - ww / 2, -y);
        band(x0 - pad, ww + pad * 2); ctx.clip(); paint(s, y, st.hl); ctx.restore();
      } else {
        paint(s, y, st.color);
        ctx.save(); band(x0 - pad, ww + pad * 2); ctx.clip(); paint(s, y, st.hl); ctx.restore();
      }
    });
    ctx.restore();

    const hw = (bw / 2 + padX) / W, hh = (bh / 2 + padY) / H;
    cap._box = { x0: 0.5 - hw, y0: st.y - hh, x1: 0.5 + hw, y1: st.y + hh };
    cap._cur = it.id;
    if (outline) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, H / 400);
      ctx.setLineDash([H / 90, H / 120]);
      ctx.strokeRect(cap._box.x0 * W, cap._box.y0 * H, hw * 2 * W, hh * 2 * H);
      ctx.restore();
    }
  }

  /** يرسم الإطار عند الزمن t. opts للمعاينة فقط: selText و selFx و selOverlay معرّف العنصر المحدد، و selCaption كتلة ترجمة محددة */
  function frame(ctx, W, H, t, opts = {}) {
    curT = t;
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // بعد نهاية المسار الرئيسي (طبقة تتجاوزه) تبقى الخلفية سوداء
    const i = t < view.main || view.main >= view.total - 1e-6 ? clipIndexAt(t) : -1;
    if (i >= 0) {
      const c = state.clips[i];
      const len = clipLen(c);
      const lt = clamp(t - c._start, 0, len);
      const p = len > 0 ? lt / len : 0;
      const td = trDur(c);
      if (td > 0 && lt < td) drawTransition(ctx, c, state.clips[i - 1] || null, W, H, p, ease(lt / td));
      else drawClip(ctx, c, W, H, p);
    }
    if (state.overlays.length) for (const o of overlaysInOrder()) drawOverlay(ctx, o, W, H, t);
    if (state.effects.length) drawEffects(ctx, W, H, t);
    for (const tx of state.texts) drawText(ctx, tx, W, H, t, opts.selText === tx.id);
    if (state.captions.items.length) drawCaptions(ctx, W, H, t, !!opts.selCaption);
    if (opts.selFx) drawRegionHandle(ctx, state.effects.find(e => e.id === opts.selFx), W, H, t);
    if (opts.selOverlay) drawOverlayHandle(ctx, state.overlays.find(o => o.id === opts.selOverlay), W, H);
  }

  return { FILTERS, FONTS, EFFECTS, BLENDS, MASKS, CAPTION_MODES, filterCss, frame, unzoom, overlayHit, overlaysInOrder };
})();
