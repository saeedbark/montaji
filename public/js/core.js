'use strict';
/* الحالة المشتركة ودوال مساعدة يستخدمها الرسم والتصدير والواجهة */

const state = {
  ratio: '16:9',
  clips: [],   // المسار الرئيسي: صور ومقاطع فيديو متتابعة
  audios: [],  // الموسيقى والأصوات
  texts: [],   // النصوص فوق الفيديو
  sel: null,   // { kind: 'clip' | 'audio' | 'text', id }
};

const view = { pps: 60, t: 0, total: 0, playing: false, exporting: false };

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
// trLen: طول الانتقال المخصّص بالثواني (الافتراضي 0.6). الموسيقى السريعة تحتاج انتقالات قصيرة كي لا تُميّع الضربة
const trDur = c => (c.transition && c.transition !== 'none') ? Math.min(c.trLen > 0 ? c.trLen : 0.6, clipLen(c) / 2) : 0;

/** يحسب بداية كل مقطع والمدة الكلية */
function layout() {
  let t = 0;
  for (const c of state.clips) { c._start = t; t += clipLen(c); }
  let total = t;
  if (!state.clips.length) {
    for (const a of state.audios) total = Math.max(total, a.start + audioLen(a));
    for (const x of state.texts) total = Math.max(total, x.start + x.dur);
  }
  view.total = total;
  return total;
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
  return clamp(g, 0, 1) * a.volume;
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
