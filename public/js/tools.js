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
    font: pick(['segoe', 'tahoma', 'arial', 'times', 'courier', 'elegant'], 'Font family. elegant is a thin italic serif for luxury and product ads (Latin text).'),
    bold: bool('Bold weight.'),
    stroke: bool('Draw an outline around the letters.'),
    stroke_color: str('Outline color as #rrggbb.'),
    background: bool('Draw a rounded box behind the text.'),
    background_color: str('Box color as #rrggbb.'),
    shadow: bool('Soft drop shadow.'),
    animation: pick(['none', 'fade', 'rise', 'pop'], 'Entrance and exit animation.'),
  };

  const EFFECT_TYPES = ['zoomBlur', 'whip', 'flash', 'shake', 'rgb', 'bw', 'sharp', 'vignette', 'darken', 'zoomTo', 'spotlight', 'shine', 'glow', 'sparkle', 'areaFlash', 'backlight'];
  const EFFECT_HELP = 'zoomBlur: radial zoom blur burst. whip: fast horizontal motion blur. flash: white flash. shake: camera shake. rgb: color split glitch. bw: black and white. sharp: crisper, punchier colors (the "4K" look). vignette: dark edges. darken: dim the picture. '
    + 'On the product (need x, y, size): zoomTo: the camera pushes in and brings the product to the center. spotlight: darkens everything around the product. shine: a light band sweeps across the product. glow: soft light bloom on the product. sparkle: little twinkling stars around it. '
    + 'On a rectangle of the picture (need x, y, width, height): areaFlash: that part lights up for an instant on the beat (a counter, a podium, a price badge). backlight: the whole part flashes with warm light, with a glowing halo spilling around its edges.';
  const productSpot = {
    x: num('Product effects: horizontal center of the product in the frame, 0 (left) to 1 (right). Default 0.5.'),
    y: num('Product effects: vertical center of the product in the frame, 0 (top) to 1 (bottom). Default 0.5.'),
    size: num('Product effects: radius of the product area as a percent of the frame width, 5 to 100. Default 30.'),
    width: num('areaFlash and backlight: rectangle width as a percent of the frame width, 2 to 100. Default 40.'),
    height: num('areaFlash and backlight: rectangle height as a percent of the frame height, 2 to 100. Default 20.'),
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
        transition_duration: num('Transition length in seconds, 0.1 to 1.5 (default 0.6). Use 0.15 to 0.3 on fast music so the cut still hits the beat.'),
        pulse: bool('Quick zoom bump on every music beat, strongest on bar starts. Great for energetic music.'),
        motion: pick(['none', 'zoomIn', 'zoomOut', 'panRight', 'panLeft', 'panUp', 'panDown', 'handheld'], 'Camera move over the clip. zoom/pan: slow Ken Burns. panUp/panDown scroll vertically; with fit cover on a tall image (pictures merged in a column) they travel over the whole image. handheld: gentle drifting hand-held camera that makes a still photo feel filmed.'),
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
      name: 'analyze_audio',
      description: 'Detect the rhythm of a music item: tempo (BPM), beat interval and the beat times in PROJECT seconds (bar starts are marked down=true). Use it to plan cuts and to time texts on beats.',
      parameters: obj({ id: str('Audio id. Default: all music items combined.') }),
    },
    {
      name: 'sync_to_beat',
      description: 'Make the montage follow the music: re-times every main-track clip so each cut lands exactly on a beat (videos are trimmed, never stretched). Call it after the clips are in their final order, and again after adding, removing or reordering clips, or changing the music.',
      parameters: obj({
        audio_id: str('Music item to follow. Default: all music items combined.'),
        beats_per_clip: num('Beats each clip lasts: 1, 2, 4 or 8. Default: chosen so a clip lasts about clip_seconds.'),
        pattern: { type: 'array', items: { type: 'number' }, description: 'Optional repeating beat counts per clip, e.g. [4,2,2] for a varied rhythm. Overrides beats_per_clip.' },
        clip_seconds: num('Target clip length used to choose beats_per_clip automatically. Default 2.'),
        last_clip_beats: num('Beats for the final clip (often longer, e.g. 8, for a closing card with contact info).'),
        hits_only: bool('Cut only on audible hits and hold the picture through silent or quiet parts of the music. Best for sound-effect templates (whooshes, booms) rather than steady music.'),
        end_with_music: bool('Stretch the last clip so the video ends together with the music. Default true.'),
        on_bars: bool('Start the first cut on a bar start so cuts fall on the strongest beats. Default true when beats_per_clip is 4 or 8.'),
        transition_duration: num('Also set every transition to this length in seconds. Default 0.25 when the beat interval is under 0.6 s.'),
        pulse: bool('Also turn the beat zoom bump on (true) or off (false) for all clips.'),
        snap_texts: bool('Also move every text start to the nearest beat. Default true.'),
      }),
    },
    {
      name: 'add_effect',
      description: 'Add a visual effect on the effects track, applied over the picture (below the texts), like the effects track in CapCut. '
        + 'Burst effects (zoom_blur style: zoomBlur, whip, flash, shake, rgb) peak in their middle, so put them ON the cuts with at_cuts to make punchy beat transitions. '
        + 'Hold effects (bw, sharp, vignette) stay constant: bw over the first clips then a cut to color is a strong reveal. darken fades the picture down, good under a closing logo or handle. '
        + 'Effects placed with at_cuts or clip_ids are anchored to their clip and follow it when sync_to_beat or reordering changes the timing. '
        + 'Product effects (zoomTo, spotlight, shine, glow, sparkle) act on one spot of the frame: give x, y (the product center in the composed frame, check it with view_frame) and size. Use them on the product itself to make it the hero of the shot.',
      parameters: obj({
        type: pick(EFFECT_TYPES, EFFECT_HELP),
        start: num('Project time in seconds when the effect starts. Not needed with at_cuts or clip_ids.'),
        duration: num('Seconds. Defaults: zoomBlur 0.4, whip 0.35, flash 0.25, shake 0.4, rgb 0.3, bw 2, sharp 3, vignette 3, darken 1.2, zoomTo 1.2, spotlight 1.5, shine 0.9, glow 1.5, sparkle 1.5. On fast music keep bursts at 0.25 to 0.4.'),
        intensity: num('Strength, 0 to 100. Default 100.'),
        ...productSpot,
        at_cuts: bool('Add one effect centered on every cut of the main track (anchored to the cuts).'),
        every: num('With at_cuts: only every Nth cut (2 = every other cut). Default 1.'),
        clip_ids: ids('Cover each of these clips for its whole length (anchored), e.g. bw on the opening clips.'),
      }, ['type']),
    },
    {
      name: 'update_effects',
      description: 'Change effects on the effects track. Only the fields you pass are changed. Setting start detaches an anchored effect from its clip.',
      parameters: obj({
        ids: ids('Effect ids, or ["all"].'),
        type: pick(EFFECT_TYPES, 'Effect kind.'),
        start: num('Project time in seconds.'),
        duration: num('Seconds.'),
        intensity: num('Strength, 0 to 100.'),
        ...productSpot,
      }, ['ids']),
    },
    {
      name: 'duplicate_item',
      description: 'Duplicate a clip, audio item, text or effect. The copy is placed right after the original.',
      parameters: obj({ id: str('Id of the item to copy.') }, ['id']),
    },
    {
      name: 'delete_items',
      description: 'Remove clips, audio items, texts or effects from the project.',
      parameters: obj({ ids: ids('Ids of the items to remove.') }, ['ids']),
    },
    {
      name: 'edit_image',
      description: 'Edit the picture of an IMAGE clip on the main track: crop, rotate, flip, and remove its background. Steps run in that order. Background removal is color based, not AI: it works when the background is one plain color or a soft gradient (product shots, logos, green screen) and does little on busy photos.',
      parameters: obj({
        id: str('Id of the image clip.'),
        crop_x: num('Left edge of the crop as a fraction of the image width, 0 to 1. Default 0.'),
        crop_y: num('Top edge of the crop as a fraction of the image height, 0 to 1. Default 0.'),
        crop_width: num('Crop width as a fraction of the image width, 0 to 1. Default: up to the right edge.'),
        crop_height: num('Crop height as a fraction of the image height, 0 to 1. Default: up to the bottom edge.'),
        rotate: pick(['90', '180', '270'], 'Rotate clockwise by this many degrees.'),
        flip: pick(['horizontal', 'vertical'], 'Mirror the image.'),
        remove_background: bool('Make the background transparent, starting from the image edges.'),
        tolerance: num('Background removal strength, 1 to 100 (default 22). Raise it if background remains, lower it if parts of the subject disappear.'),
        background_color: str('Fill transparent areas with this color (#rrggbb). In the video, transparent areas show as black unless filled.'),
      }, ['id']),
    },
    {
      name: 'merge_images',
      description: 'Combine several IMAGE clips into one picture: side by side, stacked, or a grid collage. The new image clip takes the place of the first listed clip. Good for before/after shots, product variants, or a collage slide.',
      parameters: obj({
        ids: ids('Image clip ids in the order they should appear, at least 2. The first is placed on the right for row and grid (Arabic reading order) unless right_to_left is false.'),
        layout: pick(['row', 'column', 'grid'], 'row: side by side with equal height. column: stacked with equal width. grid: equal cells. Default row.'),
        columns: num('Grid only: number of columns. Default: the nearest square.'),
        fit: pick(['cover', 'contain'], 'Grid only: cover fills each cell by cropping the edges, contain shows the whole image. Default cover.'),
        gap: num('Space between images as a percent of the image size, 0 to 20. Default 2.'),
        padding: num('Frame around the whole picture as a percent of the image size, 0 to 20. Default 0.'),
        radius: num('Corner rounding of each image, 0 to 25. Default 0.'),
        background_color: str('Color behind and between the images as #rrggbb. Default #ffffff.'),
        right_to_left: bool('Place the first image on the right. Default true.'),
        replace: bool('Remove the original clips after merging. Default true.'),
      }, ['ids']),
    },
    {
      name: 'extract_audio',
      description: 'Extract the sound of a VIDEO clip as music. By default it is added to the music track right under the clip (so it stays in sync) and the clip itself is muted, which lets you move, trim, fade or loop the sound separately. It can also save the sound as an audio file for the user.',
      parameters: obj({
        id: str('Id of the video clip.'),
        start: num('Second in the SOURCE video where the extracted part starts. Default: the clip trim start.'),
        end: num('Second in the SOURCE video where the extracted part ends. Default: the clip trim end.'),
        add_to_project: bool('Add the sound to the music track. Default true.'),
        mute_clip: bool('Mute the clip after adding its sound, so it is not heard twice. Default true.'),
        normalize: bool('Raise the level so the loudest peak reaches -1 dB.'),
        fade_in: num('Fade-in in seconds, 0 to 5.'),
        fade_out: num('Fade-out in seconds, 0 to 5.'),
        download: bool('Also save the sound as a file in the user\'s Downloads folder. Only when the user asks for a file.'),
        format: pick(['m4a', 'wav'], 'File format for download. Default m4a (AAC).'),
      }, ['id']),
    },
    {
      name: 'split_video_file',
      description: 'Cut the SOURCE FILE of a video clip into several separate MP4 files, saved in the exports folder next to the app. It does not change the project; to cut a clip on the timeline use split instead. Use it only when the user asks for separate video files (for example 30-second parts for WhatsApp or Instagram stories). Give exactly one of every, parts or times. MP4/MOV files are copied without re-encoding (fast, original quality) and each cut moves back to the nearest keyframe; other formats are re-encoded with exact cuts.',
      parameters: obj({
        id: str('Id of the video clip.'),
        every: num('Length of each part in seconds, for example 30.'),
        parts: num('Number of equal parts, 2 to 100.'),
        times: { type: 'array', items: { type: 'number' }, description: 'Cut points in seconds of the SOURCE video.' },
        start: num('Second in the SOURCE video where splitting starts. Default: the clip trim start.'),
        end: num('Second in the SOURCE video where splitting ends. Default: the clip trim end.'),
        keep_audio: bool('Keep the sound in the parts. Default true.'),
      }, ['id']),
    },
    {
      name: 'save_image',
      description: 'Save the composed video frame at a project time as an image file, for example a thumbnail or cover. The file is downloaded to the user\'s Downloads folder. Only call it when the user asks for an image.',
      parameters: obj({
        time: num('Project time in seconds. Default: the playhead.'),
        format: pick(['jpeg', 'png', 'webp'], 'File format. Default jpeg.'),
        quality: num('JPEG or WebP quality, 10 to 100. Default 92.'),
        resolution: pick(['720', '1080', '1440', '2160'], 'Short side in pixels. Default 1080.'),
      }),
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
        save_as: str('Also save the MP4 in the "exports" folder of the Montaji project on this computer, under this file name (no folders). Never overwrites: a number is added if the name exists.'),
      }),
    },
  ];
})();

if (typeof module !== 'undefined') module.exports = MONTAJI_TOOLS;
