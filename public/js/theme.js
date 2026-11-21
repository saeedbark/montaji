/* اللون المميز للواجهة: ثلاثة ألوان يبدّل بينها زر في الشريط العلوي، ويُحفظ الاختيار في المتصفح.
   القيم نفسها في css/style.css (‎:root[data-accent]‎)، والسكربت في رأس index.html يطبّقها قبل الرسم كي لا تومض. */
const THEME = (() => {
  const KEY = 'montaji.accent';
  const ACCENTS = [
    { id: 'pink', label: ['وردي', 'Pink'] },
    { id: 'amber', label: ['عنبري', 'Amber'] },
    { id: 'blue', label: ['أزرق', 'Blue'] },
  ];
  const ids = ACCENTS.map(a => a.id);
  const valid = id => (ids.includes(id) ? id : ids[0]);
  /** اللون التالي في الدورة، ويرجع إلى الأول بعد الأخير */
  const next = id => ids[(ids.indexOf(valid(id)) + 1) % ids.length];

  const hasDom = typeof document !== 'undefined';
  let current = ids[0];
  if (hasDom) {
    try { current = valid(localStorage.getItem(KEY)); } catch (e) { /* وضع خاص */ }
  }

  const tr = l => (typeof tt === 'function' ? tt(l[0], l[1]) : l[0]);
  const labelOf = id => tr(ACCENTS.find(a => a.id === id).label);

  function apply() {
    if (!hasDom) return;
    const root = document.documentElement;
    if (current === ids[0]) root.removeAttribute('data-accent');
    else root.dataset.accent = current;
    const b = document.getElementById('btnAccent');
    if (b) {
      const t = tr(['لون الواجهة: ', 'Interface colour: ']) + labelOf(current) + tr([' — اضغط للتالي', ' — click for the next']);
      b.title = t;
      b.setAttribute('aria-label', t);
      b.onclick = () => set(next(current));
    }
    applyIcon();
  }

  /* ===== أيقونة التبويب (favicon) بلون الواجهة =====
     الأيقونة الأصلية وردية؛ لغيره تُدار درجة اللون لكل بكسل ملوّن بمقدار الفرق بين الوردي واللون المختار،
     فيبقى التدرّج والظل كما هما، والأجزاء الداكنة (شريط الفيلم والخلفية) لا تتغير */
  const PINK_HUE = 349; // درجة ‎#ff5c7a‎

  /** درجة اللون (0–360) من ‎#rrggbb‎ */
  function hueOf(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }

  /** يدير درجة لون كل بكسل مشبع في بيانات RGBA بمقدار shift درجة (يعدّل px في مكانه) */
  function recolor(px, shift) {
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const l = (max + min) / 2;
      const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
      if (px[i + 3] === 0 || s < 0.25 || d < 0.12) continue; // رمادي أو داكن: يبقى كما هو
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = ((h * 60 + shift) % 360 + 360) % 360;
      // HSL → RGB
      const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
      const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
      px[i] = Math.round((r1 + m) * 255); px[i + 1] = Math.round((g1 + m) * 255); px[i + 2] = Math.round((b1 + m) * 255);
    }
    return px;
  }

  const iconCache = {};
  function applyIcon() {
    const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')];
    links.forEach(l => { if (!l.dataset.src) l.dataset.src = l.getAttribute('href'); });
    const id = current;
    const put = url => { if (id === current) links.forEach(l => { l.href = url || l.dataset.src; }); };
    if (id === ids[0]) return put('');
    if (iconCache[id]) return put(iconCache[id]);
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        const data = g.getImageData(0, 0, cv.width, cv.height);
        recolor(data.data, hueOf(color()) - PINK_HUE);
        g.putImageData(data, 0, 0);
        put(iconCache[id] = cv.toDataURL('image/png'));
      } catch (e) { /* الأيقونة الأصلية تبقى */ }
    };
    img.src = 'icons/icon-192.png';
  }

  function set(id) {
    current = valid(id);
    try { localStorage.setItem(KEY, current); } catch (e) { /* وضع خاص */ }
    apply();
  }

  /** قيمة ‎--accent‎ الحالية، لما يُرسم على canvas */
  const color = () => (hasDom ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() : '') || '#ff5c7a';

  if (hasDom) {
    apply();
    if (typeof I18N !== 'undefined') I18N.onChange(apply);
  }
  return { ACCENTS, next, valid, set, color, hueOf, recolor, get current() { return current; } };
})();

if (typeof module !== 'undefined') module.exports = THEME;
