'use strict';
/* حساب معدّل البت وحجم الملف عند التصدير — الجزء الذي لا يحتاج واجهة.
   مستويات الجودة تُحسب بالبت لكل بكسل، و«حجم محدد» يقسم الحجم المطلوب على المدة.
   يعمل في Node أيضاً (test/exporttools.test.js). التصدير نفسه في js/export.js */

const ExportTools = (() => {
  const QUALITIES = ['small', 'normal', 'high', 'ultra', 'size'];
  // بت لكل بكسل في الإطار عند 30 إطاراً/ثانية
  const BPP = { small: 0.05, normal: 0.1, high: 0.2, ultra: 0.3 };
  const MB = 1048576;
  const OVERHEAD = 1.02;       // حاوية MP4 وفهارسها
  const MIN_VIDEO = 300000;    // أقل معدّل للصورة: ما دونه يتكسّر الفيديو
  const SOFT_BPP = 0.03;       // دون هذا تفقد الصورة حدّتها عند هذه الدقة، فدقة أقل تعطي صورة أنقى
  const SIZE_DEFAULT = 35;     // الحجم المقترح بالميغابايت في «حجم محدد»

  /** معدّل بت الصورة لمستوى جودة ثابت */
  function bitrateFor(W, H, fps, quality) {
    const bpp = BPP[quality] || BPP.high;
    return Math.round(W * H * 30 * bpp * Math.pow(fps / 30, 0.7));
  }

  /** معدّل بت الصوت: 128 ك.ب/ث تكفي حين يهمّ الحجم، و192 لغير ذلك */
  const audioBitrate = quality => (quality === 'small' || quality === 'size' ? 128000 : 192000);

  /**
   * خطة الترميز: { video, audio, mb, bpp, soft, minMB, clamped, gop }
   * targetMB يُستعمل فقط حين quality = 'size'. gop بعدد الإطارات بين كل إطارين مفتاحيين.
   */
  function plan({ W, H, fps, duration, quality, targetMB, hasAudio = true }) {
    const D = Math.max(0.1, +duration || 0);
    const audio = hasAudio ? audioBitrate(quality) : 0;
    const minMB = (MIN_VIDEO + audio) * D / 8 / MB * OVERHEAD;
    let video, clamped = false;
    if (quality === 'size') {
      const want = Math.max(0, +targetMB || SIZE_DEFAULT);
      video = Math.round(want * MB * 8 / OVERHEAD / D - audio);
      const hi = bitrateFor(W, H, fps, 'ultra');
      if (video < MIN_VIDEO) { video = MIN_VIDEO; clamped = 'min'; }
      else if (video > hi) { video = hi; clamped = 'max'; }
    } else {
      video = bitrateFor(W, H, fps, quality);
    }
    const bpp = video / (W * H * fps);
    // الإطار المفتاحي مكلف: حين يكون المعدّل منخفضاً نباعد بينها فيبقى للإطارات الأخرى أكثر
    const gop = Math.round(fps * (bpp < 0.06 ? 5 : 2));
    return {
      video, audio, bpp, gop, clamped,
      mb: (video + audio) * D / 8 / MB * OVERHEAD,
      minMB,
      soft: bpp < SOFT_BPP,
    };
  }

  /**
   * دقة أقل من current تكون فيها الصورة أنقى بمعدّل video: أعلاها التي تبقى حادّة،
   * وإن لم تبقَ أي منها حادّة فأصغرها. null إن لم توجد دقة أقل.
   */
  function sharperRes(sizes, fps, video, current) {
    const lower = sizes.filter(s => s.res < current);
    if (!lower.length) return null;
    const ok = lower.filter(s => video / (s.W * s.H * fps) >= SOFT_BPP);
    const pick = ok.length ? ok.reduce((a, b) => (b.res > a.res ? b : a)) : lower.reduce((a, b) => (b.res < a.res ? b : a));
    return pick.res;
  }

  return { QUALITIES, BPP, MIN_VIDEO, SOFT_BPP, SIZE_DEFAULT, bitrateFor, audioBitrate, plan, sharperRes };
})();

if (typeof module !== 'undefined') module.exports = ExportTools;
