'use strict';
/* تعريف أدوات المونتاج — ملف واحد يستخدمه الشات داخل المتصفح وخادم MCP معاً.
   الأوصاف بالإنجليزية لأن النماذج تفهمها بدقة أعلى؛ التنفيذ في js/agent.js */

const MONTAJI_TOOLS = (() => {
  const num = description => ({ type: 'number', description });
  const str = description => ({ type: 'string', description });
  const bool = description => ({ type: 'boolean', description });
  const pick = (values, description) => ({ type: 'string', enum: values, description });
  const ids = description => ({ type: 'array', items: { type: 'string' }, description });
  const obj = (properties, required = []) => ({ type: 'object', properties, required });

  const textStyle = {
    position: pick(['top', 'middle', 'bottom'], 'Quick vertical placement, horizontally centered.'),
    x: num('Horizontal center, 0 (left) to 1 (right). Overrides position.'),
    y: num('Vertical center, 0 (top) to 1 (bottom). Overrides position.'),
    size: num('Font size as a percent of frame HEIGHT, 3 to 22, so it depends on the ratio. Titles: ~10 on 16:9, ~8 on 1:1, ~7 on 4:5, ~5.5 on 9:16. Captions: ~6 on 16:9, ~4.5 on 1:1, ~4 on 4:5, ~3.5 on 9:16.'),
    color: str('Text color as #rrggbb.'),
    font: pick(['segoe', 'tahoma', 'arial', 'times', 'courier'], 'Font family.'),
    bold: bool('Bold weight.'),
    stroke: bool('Draw an outline around the letters.'),
    stroke_color: str('Outline color as #rrggbb.'),
    background: bool('Draw a rounded box behind the text.'),
    background_color: str('Box color as #rrggbb.'),
    shadow: bool('Soft drop shadow.'),
    animation: pick(['none', 'fade', 'rise', 'pop'], 'Entrance and exit animation.'),
  };

  return [
    {
      name: 'get_project',
      description: 'Read the whole project: aspect ratio, total duration, and every clip, audio item and text with its id and settings. Call this before editing if you do not already have the current state.',
      parameters: obj({}),
    },
    {
      name: 'set_ratio',
      description: 'Set the output aspect ratio of the video.',
      parameters: obj({ ratio: pick(['16:9', '9:16', '1:1', '4:5'], '16:9 YouTube, 9:16 TikTok/Reels/Shorts, 1:1 square, 4:5 Instagram feed.') }, ['ratio']),
    },
    {
      name: 'update_clips',
      description: 'Change settings of one or more clips on the main track (images and videos). Only the fields you pass are changed. Pass ids ["all"] to apply to every clip.',
      parameters: obj({
        ids: ids('Clip ids, or ["all"].'),
        duration: num('Seconds the clip stays on screen. For a video this moves its trim end.'),
        trim_start: num('Video only: second in the source file where the clip starts.'),
        trim_end: num('Video only: second in the source file where the clip ends.'),
        speed: num('Video only: playback speed, 0.25 to 4. 1 is normal.'),
        volume: num('Video only: clip sound level, 0 to 100.'),
        muted: bool('Video only: silence the clip sound.'),
        transition: pick(['none', 'fade', 'slide', 'zoom', 'wipe', 'black'], 'Transition played when this clip enters. Has no visible effect on the first clip.'),
        motion: pick(['none', 'zoomIn', 'zoomOut', 'panRight', 'panLeft'], 'Slow camera move over the clip (Ken Burns).'),
        fit: pick(['blur', 'contain', 'cover'], 'How media that does not match the frame is fitted: blurred background, black bars, or crop to fill.'),
        filter: pick(['none', 'vivid', 'warm', 'cool', 'bw', 'vintage', 'soft'], 'Color look.'),
        brightness: num('50 to 150, 100 is unchanged.'),
        contrast: num('50 to 150, 100 is unchanged.'),
        saturation: num('0 to 200, 100 is unchanged.'),
      }, ['ids']),
    },
    {
      name: 'reorder_clips',
      description: 'Reorder the main track. The listed clip ids are placed first in the given order; clips you do not list keep their relative order after them.',
      parameters: obj({ order: ids('Clip ids in the desired playing order.') }, ['order']),
    },
    {
      name: 'split',
      description: 'Cut an item in two at a project time. Without id it cuts the main-track clip playing at that time. To remove a middle section, split twice and delete the piece in between.',
      parameters: obj({
        time: num('Project time in seconds where the cut is made.'),
        id: str('Optional id of an audio or text item (or a clip) to cut instead.'),
      }, ['time']),
    },
    {
      name: 'add_text',
      description: 'Add a text overlay (title, caption, subtitle) on top of the video.',
      parameters: obj({
        text: str('The text. Use \\n for a line break.'),
        start: num('Project time in seconds when the text appears.'),
        duration: num('Seconds the text stays visible.'),
        ...textStyle,
      }, ['text', 'start', 'duration']),
    },
    {
      name: 'update_texts',
      description: 'Change one or more existing text overlays. Only the fields you pass are changed.',
      parameters: obj({
        ids: ids('Text ids, or ["all"].'),
        text: str('New text content.'),
        start: num('Project time in seconds when the text appears.'),
        duration: num('Seconds the text stays visible.'),
        ...textStyle,
      }, ['ids']),
    },
    {
      name: 'update_audio',
      description: 'Change music or sound items. Audio that runs past the end of the video is cut there automatically.',
      parameters: obj({
        ids: ids('Audio ids, or ["all"].'),
        start: num('Project time in seconds when the audio starts.'),
        trim_start: num('Second in the source file where playback starts.'),
        trim_end: num('Second in the source file where playback ends.'),
        volume: num('Level, 0 to 100.'),
        fade_in: num('Fade-in length in seconds, 0 to 5.'),
        fade_out: num('Fade-out length in seconds, 0 to 5.'),
      }, ['ids']),
    },
    {
      name: 'duplicate_item',
      description: 'Duplicate a clip, audio item or text. The copy is placed right after the original.',
      parameters: obj({ id: str('Id of the item to copy.') }, ['id']),
    },
    {
      name: 'delete_items',
      description: 'Remove clips, audio items or texts from the project.',
      parameters: obj({ ids: ids('Ids of the items to remove.') }, ['ids']),
    },
    {
      name: 'view_frame',
      description: 'Look at the composed video frame (media, filters, texts) at up to 4 project times. Use it to see what a clip contains or to check your work. Returns images.',
      parameters: obj({ times: { type: 'array', items: { type: 'number' }, description: 'Project times in seconds, at most 4.' } }, ['times']),
    },
    {
      name: 'seek',
      description: 'Move the playhead in the editor so the user sees a given moment, and optionally start playback.',
      parameters: obj({ time: num('Project time in seconds.'), play: bool('Start playing from there.') }, ['time']),
    },
    {
      name: 'undo',
      description: 'Undo the most recent edits (the user\'s or yours).',
      parameters: obj({ steps: num('How many steps to undo. Default 1.') }),
    },
    {
      name: 'export_video',
      description: 'Render the project to an MP4 file. This can take minutes; when it finishes the editor shows a download button to the user. Only call it when the user asks to export.',
      parameters: obj({
        resolution: pick(['720', '1080', '1440', '2160'], 'Short side in pixels. Default 1080.'),
        fps: pick(['24', '30', '60'], 'Frames per second. Default 30.'),
        quality: pick(['normal', 'high', 'ultra'], 'Bitrate level. Default high.'),
      }),
    },
  ];
})();

if (typeof module !== 'undefined') module.exports = MONTAJI_TOOLS;
