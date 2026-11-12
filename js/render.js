'use strict';
/* رسم إطار واحد من المشروع على أي Canvas — يُستخدم للمعاينة وللتصدير معاً */

const Render = (() => {
  const FILTERS = {
    none:    { label: 'بدون',        css: '' },
    vivid:   { label: 'زاهٍ',         css: 'saturate(1.5) contrast(1.08)' },
    warm:    { label: 'دافئ',        css: 'sepia(0.28) saturate(1.3) hue-rotate(-8deg)' },
    cool:    { label: 'بارد',        css: 'saturate(1.1) hue-rotate(14deg) brightness(1.03)' },
    bw:      { label: 'أبيض وأسود',  css: 'grayscale(1) contrast(1.12)' },
    vintage: { label: 'قديم',        css: 'sepia(0.55) contrast(0.92) brightness(1.05) saturate(0.85)' },
    soft:    { label: 'ناعم',        css: 'contrast(0.86) brightness(1.08) saturate(0.82)' },
  };

  const FONTS = {
    segoe:   { label: 'الافتراضي', css: '"Segoe UI", Tahoma, Arial, sans-serif' },
    tahoma:  { label: 'تاهوما',    css: 'Tahoma, "Segoe UI", sans-serif' },
    arial:   { label: 'آريال',     css: 'Arial, "Segoe UI", sans-serif' },
    times:   { label: 'تايمز',     css: '"Times New Roman", "Traditional Arabic", serif' },
    courier: { label: 'كوريير',    css: '"Courier New", monospace' },
  };

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
      let m = 1, dx = 0;
      const Z = 0.14;
      if (c.motion === 'zoomIn') m = 1 + Z * p;
      else if (c.motion === 'zoomOut') m = 1 + Z * (1 - p);
      else if (c.motion === 'panLeft' || c.motion === 'panRight') {
        m = 1 + Z;
        const extra = sw * s * Z;
        dx = (c.motion === 'panLeft' ? 0.5 - p : p - 0.5) * extra;
      }
      const dw = sw * s * m, dh = sh * s * m;
      ctx.drawImage(el, (W - dw) / 2 + dx, (H - dh) / 2, dw, dh);
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

    const size = tx.size * H;
    const font = (FONTS[tx.font] || FONTS.segoe).css;
    ctx.save();
    ctx.font = `${tx.bold ? 700 : 400} ${size}px ${font}`;
    ctx.direction = /[֐-ࣿיִ-ﻼ]/.test(tx.text) ? 'rtl' : 'ltr';
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

    const cx = tx.x * W, cy = tx.y * H;
    ctx.translate(cx, cy + offY);
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
    tx._box = { x0: tx.x - hw, y0: tx.y - hh, x1: tx.x + hw, y1: tx.y + hh };

    if (outline) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, H / 400);
      ctx.setLineDash([H / 90, H / 120]);
      ctx.strokeRect(tx._box.x0 * W, tx._box.y0 * H, hw * 2 * W, hh * 2 * H);
      ctx.restore();
    }
  }

  /** يرسم الإطار عند الزمن t. opts.selText = معرّف النص المحدد (للمعاينة فقط) */
  function frame(ctx, W, H, t, opts = {}) {
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const i = clipIndexAt(t);
    if (i >= 0) {
      const c = state.clips[i];
      const len = clipLen(c);
      const lt = clamp(t - c._start, 0, len);
      const p = len > 0 ? lt / len : 0;
      const td = trDur(c);
      if (td > 0 && lt < td) drawTransition(ctx, c, state.clips[i - 1] || null, W, H, p, ease(lt / td));
      else drawClip(ctx, c, W, H, p);
    }
    for (const tx of state.texts) drawText(ctx, tx, W, H, t, opts.selText === tx.id);
  }

  return { FILTERS, FONTS, frame };
})();
