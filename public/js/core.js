'use strict';
/* الحالة المشتركة ودوال مساعدة يستخدمها الرسم والتصدير والواجهة */

const state = {
  name: '',    // اسم المشروع: من ملف المشروع عند فتحه أو حفظه
  ratio: '16:9',
  clips: [],   // المسار الرئيسي: صور ومقاطع فيديو متتابعة
  overlays: [], // الطبقات فوق المسار الرئيسي: صور وفيديوهات بزمن بداية حر (track الأعلى يُرسم فوق)
  audios: [],  // الموسيقى والأصوات
  texts: [],   // النصوص فوق الفيديو
  effects: [], // التأثيرات فوق الصورة (تكبير ضبابي، وميض، أبيض وأسود…)، توضع بحرية بزمن البداية
  captions: null, // الترجمة: { lang, style, items: [{ id, start, end, text, words: [{ w, t0, t1 }] }] } — تُضبط أدناه
  sel: null,   // { kind: 'clip' | 'overlay' | 'audio' | 'text' | 'effect' | 'caption', id }
};

/** نمط الترجمة الافتراضي: يُطبَّق على كل الكتل. mode: none | word | pop | reveal */
const CAPTION_STYLE = {
  font: 'segoe', size: 0.06, y: 0.82, color: '#ffffff', hl: '#ffd400',
  bg: true, bgColor: '#000000', outline: true, mode: 'word',
};
const emptyCaptions = () => ({ lang: '', style: { ...CAPTION_STYLE }, items: [] });
state.captions = emptyCaptions();

// main = نهاية المسار الرئيسي، total = نهاية المشروع (قد تتجاوزها طبقة)
const view = { pps: 60, t: 0, total: 0, main: 0, playing: false, exporting: false };

const MIN_LEN = 0.2;
const RATIOS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const even = n => Math.max(2, Math.round(n / 2) * 2);

/** أبعاد الإخراج: الضلع الأقصر = res */
function outputSize(ratio, res) {
  const [a, b] = RATIOS[ratio] || RATIOS['16:9'];
  return a >= b ? [even(res * a / b), even(res)] : [even(res), even(res * b / a)];
}

const clipLen = c => (c.out - c.in) / c.speed;
const audioLen = a => a.out - a.in;
const overlayLen = o => (o.out - o.in) / (o.speed || 1);
/** بداية العنصر وطوله على الخط الزمني، لأي نوع */
const itemStart = (kind, o) => (kind === 'clip' ? o._start : o.start);
const itemLen = (kind, o) => (kind === 'clip' ? clipLen(o) : kind === 'audio' ? audioLen(o) : kind === 'overlay' ? overlayLen(o) : kind === 'caption' ? o.end - o.start : o.dur);
// trLen: طول الانتقال المخصّص بالثواني (الافتراضي 0.6). الموسيقى السريعة تحتاج انتقالات قصيرة كي لا تُميّع الضربة
const trDur = c => (c.transition && c.transition !== 'none') ? Math.min(c.trLen > 0 ? c.trLen : 0.6, clipLen(c) / 2) : 0;

/** يحسب بداية كل مقطع والمدة الكلية */
function layout() {
  let t = 0;
  for (const c of state.clips) { c._start = t; t += clipLen(c); }
  view.main = t;
  anchorEffects();
  let total = t;
  // الطبقة قد تتجاوز المسار الرئيسي: يمتد المشروع إلى نهايتها (والخلفية سوداء)
  for (const o of state.overlays) total = Math.max(total, o.start + overlayLen(o));
  if (!state.clips.length) {
    for (const c of state.captions.items) total = Math.max(total, c.end);
    for (const a of state.audios) total = Math.max(total, a.start + audioLen(a));
    for (const x of state.texts) total = Math.max(total, x.start + x.dur);
    for (const e of state.effects) total = Math.max(total, e.start + e.dur);
  }
  view.total = total;
  return total;
}

/**
 * التأثير المربوط بمقطع (at = معرّف المقطع) يتبعه حين يتغيّر التوقيت (مزامنة الإيقاع، إعادة الترتيب):
 * atMode 'cut' = متمركز على لحظة القطع عند دخول المقطع، 'clip' = يغطي المقطع كله.
 * يُفك الربط إن حُذف المقطع، ويبقى التأثير في آخر موضع له.
 * إن صار المقطع أولاً فلا قطع عنده: يبقى التأثير في آخر موضع له ويظل مربوطاً، فيعود إلى القطع إن رجع المقطع.
 */
function anchorEffects() {
  const first = state.clips[0];
  for (const e of state.effects) {
    if (!e.at) continue;
    const c = state.clips.find(k => k.id === e.at);
    if (!c) { e.at = null; continue; }
    if (e.atMode === 'clip') { e.start = c._start; e.dur = Math.max(MIN_LEN, clipLen(c)); }
    else if (c !== first) e.start = Math.max(0, c._start - e.dur / 2);
  }
}

function clipIndexAt(t) {
  const cs = state.clips;
  if (!cs.length) return -1;
  for (let i = 0; i < cs.length; i++) if (t < cs[i]._start + clipLen(cs[i])) return i;
  return cs.length - 1;
}

/** مستوى صوت الموسيقى مع الظهور/الاختفاء التدريجي (lt = الزمن منذ بداية العنصر) */
function audioGain(a, lt) {
  const len = Math.min(audioLen(a), view.total - a.start);
  let g = 1;
  if (a.fadeIn > 0) g = Math.min(g, lt / a.fadeIn);
  if (a.fadeOut > 0) g = Math.min(g, (len - lt) / a.fadeOut);
  return clamp(g, 0, 1) * prop(a, 'volume', lt);
}

/* ================= الإطارات المفتاحية ================= */
/*
 * item.kf = { x: [{ t, v, e }], opacity: [...] } — t نسبي من بداية العنصر (بزمن الخط الزمني)،
 * و e انسيابية الانتقال إلى الإطار التالي: linear | smooth | hold.
 * كل تعديل ينشئ كائن kf جديداً ولا يغيّر القديم، فلقطات سجل التراجع (نسخ سطحية) تبقى سليمة.
 */
const KF_EASES = ['linear', 'smooth', 'hold'];
const KF_MAX = 200;
// الخصائص القابلة للتحريك ومداها لكل نوع عنصر
const KF_PROPS = {
  clip:    { zoom: [0.2, 5], panX: [-1, 1], panY: [-1, 1], opacity: [0, 1], volume: [0, 1] },
  overlay: { x: [-0.5, 1.5], y: [-0.5, 1.5], scale: [0.02, 3], rot: [-720, 720], opacity: [0, 1], volume: [0, 1] },
  text:    { x: [-0.5, 1.5], y: [-0.5, 1.5], size: [0.01, 0.4], opacity: [0, 1], rot: [-720, 720] },
  audio:   { volume: [0, 1] },
  effect:  { amount: [0, 1] },
};
// قيمة الخاصية حين لا يحملها العنصر (مشاريع أقدم من هذه الخصائص)
const KF_DEFAULT = { zoom: 1, panX: 0, panY: 0, opacity: 1, rot: 0, volume: 1, amount: 1 };
const KF_EPS = 0.02; // إطاران أقرب من هذا يُعدّان إطاراً واحداً

const hasKf = (item, key) => !!(item.kf && item.kf[key] && item.kf[key].length);
const anyKf = item => !!item.kf && Object.keys(item.kf).some(k => item.kf[k].length);

/** قيمة الخاصية عند الزمن المحلي lt: من الإطارات المفتاحية إن وُجدت، وإلا القيمة الثابتة */
function prop(item, key, lt) {
  const ks = item.kf && item.kf[key];
  if (!ks || !ks.length) { const v = item[key]; return v == null ? KF_DEFAULT[key] : v; }
  if (lt <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (lt >= last.t) return last.v;
  let i = 0;
  while (ks[i + 1].t <= lt) i++;
  const a = ks[i], b = ks[i + 1];
  if (a.e === 'hold') return a.v;
  let k = (lt - a.t) / (b.t - a.t);
  if (a.e !== 'linear') k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  return a.v + (b.v - a.v) * k;
}

/** يضع إطاراً مفتاحياً (أو يستبدل الإطار الموجود عند الزمن نفسه) */
function setKey(item, key, t, v, e) {
  const old = (item.kf && item.kf[key]) || [];
  const at = old.find(k => Math.abs(k.t - t) < KF_EPS);
  const ks = old.filter(k => k !== at);
  ks.push({ t: at ? at.t : Math.max(0, t), v, e: KF_EASES.includes(e) ? e : at ? at.e : 'smooth' });
  ks.sort((a, b) => a.t - b.t);
  item.kf = { ...item.kf, [key]: ks.slice(0, KF_MAX) };
}

function dropEmptyKf(item, kf) {
  for (const k of Object.keys(kf)) if (!kf[k].length) delete kf[k];
  if (Object.keys(kf).length) item.kf = kf; else delete item.kf;
}

/** يحذف إطار الخاصية عند الزمن t. بلا key: إطارات كل الخصائص عند ذلك الزمن */
function removeKey(item, key, t) {
  if (!item.kf) return;
  const kf = { ...item.kf };
  for (const k of key ? [key] : Object.keys(kf)) {
    if (!kf[k]) continue;
    const left = kf[k].filter(x => Math.abs(x.t - t) >= KF_EPS);
    if (!left.length && kf[k].length) item[k] = kf[k][0].v; // آخر إطار: قيمته تصير القيمة الثابتة
    kf[k] = left;
  }
  dropEmptyKf(item, kf);
}

/** يحذف إطارات خاصية، أو كل الإطارات. القيمة الثابتة تأخذ قيمة أول إطار كي لا يقفز العنصر */
function clearKeys(item, key) {
  if (!item.kf) return;
  const kf = { ...item.kf };
  for (const k of key ? [key] : Object.keys(kf)) {
    if (kf[k] && kf[k].length) item[k] = kf[k][0].v;
    delete kf[k];
  }
  dropEmptyKf(item, kf);
}

/** أزمنة الإطارات في العنصر (كل الخصائص)، مرتبة بلا تكرار */
function kfTimes(item) {
  const out = [];
  if (item.kf) for (const k in item.kf) for (const x of item.kf[k]) if (!out.some(t => Math.abs(t - x.t) < KF_EPS)) out.push(x.t);
  return out.sort((a, b) => a - b);
}

/** ينقل كل الإطارات التي عند الزمن from إلى الزمن to (سحب نقطة الإطار في الخط الزمني) */
function moveKeys(item, from, to) {
  if (!item.kf) return;
  const kf = {};
  to = Math.max(0, to);
  for (const k in item.kf) {
    const moved = item.kf[k].find(x => Math.abs(x.t - from) < KF_EPS);
    const ks = item.kf[k].filter(x => x === moved || !moved || Math.abs(x.t - to) >= KF_EPS).map(x => (x === moved ? { ...x, t: to } : x));
    kf[k] = ks.sort((a, b) => a.t - b.t);
  }
  item.kf = kf;
}

/** يغيّر انسيابية الإطارات التي عند الزمن t */
function setKeyEase(item, t, e) {
  if (!item.kf || !KF_EASES.includes(e)) return;
  const kf = {};
  for (const k in item.kf) kf[k] = item.kf[k].map(x => (Math.abs(x.t - t) < KF_EPS ? { ...x, e } : x));
  item.kf = kf;
}

/**
 * تقسيم عنصر عند الزمن المحلي cut: يعيد إطارات الجزأين [الأول، الثاني].
 * يُضاف إطار عند نقطة القطع بالقيمة المحسوبة فلا تقفز الحركة، وتُزاح أزمنة الجزء الثاني.
 */
function splitKf(item, cut) {
  if (!item.kf) return [undefined, undefined];
  const A = {}, B = {};
  for (const k in item.kf) {
    const ks = item.kf[k];
    if (!ks.length) continue;
    const v = prop(item, k, cut);
    const before = ks.filter(x => x.t < cut - KF_EPS), after = ks.filter(x => x.t > cut + KF_EPS);
    const prev = before[before.length - 1];
    // المقطع المقطوع يصير خطياً في جزأيه (الناعم تقريبي) كي تتطابق القيمة عند نقطة القطع
    A[k] = before.length
      ? [...before.slice(0, -1), { ...prev, e: prev.e === 'hold' ? 'hold' : 'linear' }, { t: cut, v, e: 'linear' }]
      : [{ t: 0, v, e: 'linear' }];
    B[k] = [{ t: 0, v, e: prev && prev.e === 'hold' ? 'hold' : 'linear' }, ...after.map(x => ({ ...x, t: x.t - cut }))];
  }
  const out = o => (Object.keys(o).length ? o : undefined);
  return [out(A), out(B)];
}

/** يكتب قيمة خاصية: إطاراً عند الزمن المحلي lt إن كانت الخاصية متحركة، وإلا القيمة الثابتة */
function setVal(item, key, v, lt) {
  if (hasKf(item, key)) setKey(item, key, Math.max(0, lt), v);
  else item[key] = v;
}

function fmtTime(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** انتقال دقيق إلى زمن في فيديو مع انتظار جاهزية الإطار */
function seekExact(v, time) {
  return new Promise(resolve => {
    const max = isFinite(v.duration) ? Math.max(0, v.duration - 0.02) : time;
    time = clamp(time, 0, max);
    if (Math.abs(v.currentTime - time) < 0.0005 && !v.seeking && v.readyState >= 2) return resolve();
    let timer;
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
    timer = setTimeout(done, 5000);
    v.addEventListener('seeked', done);
    v.currentTime = time;
  });
}

/** فك ترميز ملف صوتي (أو صوت ملف فيديو) إلى AudioBuffer بتردد 48 كيلوهرتز */
async function decodeAudioFile(file) {
  const ctx = new OfflineAudioContext(2, 2, 48000);
  return ctx.decodeAudioData(await file.arrayBuffer());
}

if (typeof module !== 'undefined') {
  module.exports = {
    state, view, layout, clamp, clipLen, audioLen, overlayLen, itemStart, itemLen, emptyCaptions, CAPTION_STYLE,
    KF_PROPS, KF_EASES, KF_MAX, prop, setKey, removeKey, clearKeys, kfTimes, moveKeys, setKeyEase, splitKf, setVal, hasKf, anyKf,
  };
}
