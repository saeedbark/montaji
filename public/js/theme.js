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
  return { ACCENTS, next, valid, set, color, get current() { return current; } };
})();

if (typeof module !== 'undefined') module.exports = THEME;
