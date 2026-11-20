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

  // نفس قائمة Render.FONTS و ENUMS.fonts في projecttools.js (يتحقق منها اختبار)
  const FONTS = ['segoe', 'tahoma', 'arial', 'times', 'courier', 'elegant', 'cairo', 'tajawal', 'almarai', 'changa', 'reemkufi', 'elmessiri', 'amiri', 'lalezar'];
  const FONT_HELP = 'Font family. Arabic fonts bundled with the app: cairo (modern clean sans, the best all-round choice for titles and captions), '
    + 'tajawal (light and airy), almarai (rounded, friendly), changa (geometric, tech and gaming), reemkufi (kufi display, headlines), '
    + 'elmessiri (elegant, weddings and luxury), amiri (classic naskh, religious and emotional), lalezar (heavy display, one weight, big punchy titles). '
    + 'System fonts: segoe, tahoma, arial, times, courier; elegant is a thin italic serif for luxury ads (Latin text).';

  const textStyle = {
    position: pick(['top', 'middle', 'bottom'], 'Quick vertical placement, horizontally centered.'),
    x: num('Horizontal center, 0 (left) to 1 (right). Overrides position.'),
    y: num('Vertical center, 0 (top) to 1 (bottom). Overrides position.'),
    size: num('Font size as a percent of frame HEIGHT, 3 to 22, so it depends on the ratio. Titles: ~10 on 16:9, ~8 on 1:1, ~7 on 4:5, ~5.5 on 9:16. Captions: ~6 on 16:9, ~4.5 on 1:1, ~4 on 4:5, ~3.5 on 9:16.'),
    color: str('Text color as #rrggbb.'),
    font: pick(FONTS, FONT_HELP),
    bold: bool('Bold weight.'),
    stroke: bool('Draw an outline around the letters.'),
    stroke_color: str('Outline color as #rrggbb.'),
    background: bool('Draw a rounded box behind the text.'),
    background_color: str('Box color as #rrggbb.'),
    shadow: bool('Soft drop shadow.'),
    animation: pick(['none', 'fade', 'rise', 'pop'], 'Entrance and exit animation.'),
    opacity: num('Opacity, 0 (invisible) to 100. Default 100.'),
    rotation: num('Rotation in degrees, -180 to 180. Default 0.'),
  };

  const overlayStyle = {
    x: num('Horizontal center of the layer, 0 (left) to 1 (right). Default 0.5.'),
    y: num('Vertical center of the layer, 0 (top) to 1 (bottom). Default 0.5.'),
    scale: num('Layer width as a percent of the frame width, 2 to 300 (height follows the media aspect). Default 40. A corner logo is about 15, picture-in-picture about 30.'),
    rotation: num('Rotation in degrees, -180 to 180.'),
    opacity: num('Opacity, 0 to 100.'),
    mask: pick(['none', 'round', 'circle'], 'Crop shape: none, rounded corners, or a circle (shows the center of the media).'),
    radius: num('Corner rounding for mask round, 0 to 50 percent. Default 8.'),
    border: num('Border thickness, 0 to 40 (tenths of a percent of the frame height). 0 = no border.'),
    border_color: str('Border color as #rrggbb.'),
    shadow: bool('Soft drop shadow under the layer.'),
    blend: pick(['normal', 'screen', 'multiply', 'lighten'], 'Blend mode with the picture below. screen drops black backgrounds (light leaks, fire), multiply drops white ones.'),
    filter: pick(['none', 'vivid', 'warm', 'cool', 'bw', 'vintage', 'soft'], 'Color look.'),
    animation: pick(['none', 'fade', 'rise', 'pop'], 'Entrance and exit animation.'),
    track: num('Stacking row, 0 to 20. Higher rows are drawn on top.'),
    speed: num('Video layers: playback speed, 0.25 to 4.'),
    volume: num('Video layers: sound level, 0 to 100.'),
    muted: bool('Video layers: silence the sound.'),
  };

  const captionStyle = {
    font: pick(FONTS, 'Caption font. ' + FONT_HELP),
    size: num('Caption font size as a percent of frame height, 2 to 20. Default 6 (about 4 on 9:16).'),
    y: num('Vertical center of the captions, 0.05 (top) to 0.95 (bottom). Default 0.82.'),
    color: str('Caption text color as #rrggbb.'),
    highlight_color: str('Color of the word being spoken, as #rrggbb.'),
    background: bool('Rounded box behind the captions.'),
    background_color: str('Box color as #rrggbb.'),
    outline: bool('Black outline around the letters.'),
    highlight: pick(['none', 'word', 'pop', 'reveal'], 'How the spoken word is marked: none, word (colored), pop (colored and enlarged), reveal (words appear one by one).'),
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
      description: 'Read the whole project: aspect ratio, total duration, and every clip, overlay layer, audio item, text, effect and caption with its id and settings (and its keyframes, if any). Call this before editing if you do not already have the current state.',
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
        transition: pick(['none', 'fade', 'slide', 'zoom', 'wipe', 'black'], 'Transition played when this clip enters. On the first clip it enters from black, so the video opens on a black frame: use none there for a clean first frame.'),
        transition_duration: num('Transition length in seconds, 0.1 to 1.5 (default 0.6). Use 0.15 to 0.3 on fast music so the cut still hits the beat.'),
        pulse: bool('Quick zoom bump on every music beat, strongest on bar starts. Great for energetic music.'),
        motion: pick(['none', 'zoomIn', 'zoomOut', 'panRight', 'panLeft', 'panUp', 'panDown', 'handheld'], 'Camera move over the clip. zoom/pan: slow Ken Burns. panUp/panDown scroll vertically; with fit cover on a tall image (pictures merged in a column) they travel over the whole image. handheld: gentle drifting hand-held camera that makes a still photo feel filmed.'),
        fit: pick(['blur', 'contain', 'cover'], 'How media that does not match the frame is fitted: blurred background, black bars, or crop to fill.'),
        filter: pick(['none', 'vivid', 'warm', 'cool', 'bw', 'vintage', 'soft'], 'Color look.'),
        brightness: num('50 to 150, 100 is unchanged.'),
        contrast: num('50 to 150, 100 is unchanged.'),
        saturation: num('0 to 200, 100 is unchanged.'),
        zoom: num('Constant zoom of the picture in percent, 20 to 500. 100 is unchanged. Animate it with set_keyframes.'),
        pan_x: num('Shift the picture horizontally, in percent of the frame width, -100 to 100. Default 0.'),
        pan_y: num('Shift the picture vertically, in percent of the frame height, -100 to 100. Default 0.'),
        opacity: num('Opacity over black, 0 to 100. Default 100.'),
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
        id: str('Optional id of an audio, text, effect, overlay or caption item (or a clip) to cut instead.'),
      }, ['time']),
    },
    {
      name: 'add_overlay',
      description: 'Put a picture or video ON TOP of the main track as a free layer: picture-in-picture, a logo in a corner, a product cut-out over a background, or two videos side by side. '
        + 'The layer is made from the media of an existing clip (import it first, then pass its id); the clip itself stays on the main track unless you use to_overlay instead. '
        + 'Layers are drawn above the main track and below effects, texts and captions. Check the placement with view_frame.',
      parameters: obj({
        clip_id: str('Id of a main-track clip (or another overlay) whose media is used for the layer.'),
        start: num('Project time in seconds when the layer appears. Default 0.'),
        duration: num('Seconds the layer stays. Default: 4 for an image, the clip length for a video.'),
        ...overlayStyle,
      }, ['clip_id']),
    },
    {
      name: 'update_overlays',
      description: 'Change one or more overlay layers. Only the fields you pass are changed.',
      parameters: obj({
        ids: ids('Overlay ids, or ["all"].'),
        start: num('Project time in seconds when the layer appears.'),
        duration: num('Seconds the layer stays. For a video this moves its trim end.'),
        trim_start: num('Video layers: second in the source file where the layer starts.'),
        ...overlayStyle,
      }, ['ids']),
    },
    {
      name: 'to_overlay',
      description: 'Move a clip off the main track and make it an overlay layer at the same time position (the clips after it close the gap).',
      parameters: obj({ id: str('Id of the main-track clip.') }, ['id']),
    },
    {
      name: 'to_main',
      description: 'Move an overlay layer onto the main track, inserted near its current time.',
      parameters: obj({ id: str('Id of the overlay.') }, ['id']),
    },
    {
      name: 'set_keyframes',
      description: 'Animate one property of an item over time with keyframes. The list REPLACES all keyframes of that property. Times are seconds from the START OF THE ITEM, not project time. '
        + 'Properties by item kind — text: x, y, size, opacity, rotation. overlay: x, y, scale, rotation, opacity, volume. clip (main track): zoom, pan_x, pan_y, opacity, volume (zoom or pan keyframes replace the preset camera motion). audio: volume. effect: intensity. '
        + 'Values use the same units as the update tools: x and y 0 to 1 (may go outside to slide in from off-screen, -0.5 to 1.5), size/scale/zoom/pan/opacity/volume/intensity in percent, rotation in degrees. '
        + 'Examples: slide a title in from the right: prop x, keys [{t:0,v:1.3},{t:0.8,v:0.5}]. Duck music under speech: prop volume, keys [{t:4,v:80},{t:4.5,v:20},{t:9,v:20},{t:9.5,v:80}].',
      parameters: obj({
        id: str('Id of the item (clip, overlay, text, audio or effect).'),
        prop: pick(['x', 'y', 'size', 'scale', 'rotation', 'opacity', 'volume', 'zoom', 'pan_x', 'pan_y', 'intensity'], 'Property to animate. Must be valid for the item kind.'),
        keys: {
          type: 'array', description: 'Keyframes, at least 1 and at most 200.',
          items: obj({
            t: num('Seconds from the start of the item.'),
            v: num('Value at that time.'),
            e: pick(['smooth', 'linear', 'hold'], 'Easing from this keyframe to the next. smooth (default) eases in and out, hold jumps.'),
          }, ['t', 'v']),
        },
      }, ['id', 'prop', 'keys']),
    },
    {
      name: 'clear_keyframes',
      description: 'Remove the keyframes of an item so the property is constant again (it keeps the value of its first keyframe).',
      parameters: obj({
        id: str('Id of the item.'),
        prop: pick(['x', 'y', 'size', 'scale', 'rotation', 'opacity', 'volume', 'zoom', 'pan_x', 'pan_y', 'intensity'], 'Only this property. Default: every animated property of the item.'),
      }, ['id']),
    },
    {
      name: 'transcribe',
      description: 'Automatic captions: turn the speech of the project into timed caption blocks on the captions track, with per-word timing so the spoken word can be highlighted. '
        + 'Needs a speech-to-text provider configured in the .env file (OpenAI, Groq or Gemini key, or a local Whisper server); the audio is sent to that provider. It can take a minute. '
        + 'Existing captions in the same time range are replaced. Afterwards get_project lists the caption texts, so you can fix spelling with update_captions.',
      parameters: obj({
        source_id: str('Id of a video clip, video overlay or audio item to transcribe. Default: the sound of the whole project as it is heard.'),
        language: str('Two-letter language code of the speech, e.g. ar, en, fr. Default: auto-detect.'),
      }),
    },
    {
      name: 'update_captions',
      description: 'Change the caption style (one style for all caption blocks) and/or edit caption blocks: fix their text, retime them, or delete them with delete_items. Only the fields you pass are changed.',
      parameters: obj({
        ...captionStyle,
        items: {
          type: 'array', description: 'Caption blocks to change.',
          items: obj({
            id: str('Caption id.'),
            text: str('New text. Keeping the same number of words keeps the per-word timing.'),
            start: num('Project time in seconds when the block appears.'),
            end: num('Project time in seconds when the block disappears.'),
          }, ['id']),
        },
      }),
    },
    {
      name: 'export_captions',
      description: 'Save the captions as a subtitle file (SRT or WebVTT) for YouTube or a video player. Only call it when the user asks for a subtitle file.',
      parameters: obj({
        format: pick(['srt', 'vtt'], 'File format. Default srt.'),
        save_as: str('Save the file in the "exports" folder of the Montaji app under this name (no folders). Never overwrites. Without it the file goes to the user\'s Downloads folder.'),
      }),
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
      name: 'analyze_reference',
      description: 'Study a REFERENCE video the user wants to imitate (a reel, an ad, a template from any app or platform) so the same edit can be rebuilt with the user\'s own media. '
        + 'It reads the picture and sound of the file itself: every cut with its time, the length of each shot, how each shot enters (cut, fade, black, flash), whether the shot is a still photo or moving footage, '
        + 'the camera zoom of each shot (in or out, how much, and whether it punches in early or runs through the shot), light flashes inside shots with their place in the frame (a product or a sign that lights up for an instant), '
        + 'the effects it can recognize (a blurred or whip transition on a cut, a black-and-white shot, a fade in from black or out to black), '
        + 'the aspect ratio, and the music rhythm (BPM, beats per shot, share of cuts that land on a beat). '
        + 'Returns contact-sheet images with one numbered frame per shot: look at them to learn what each shot shows, which texts appear and the visual style. '
        + 'It does not change the project. Follow it with apply_reference. Takes about as long as the video itself.',
      parameters: obj({
        clip_id: str('Id of a video clip in the project to use as the reference. Default: the only video clip of the project.'),
        sensitivity: pick(['low', 'normal', 'high'], 'Cut detection sensitivity. Default normal. Use high if the contact sheet shows two different shots merged in one, low if one continuous shot was split by fast motion.'),
      }),
    },
    {
      name: 'view_media',
      description: 'Look at the user\'s photos and videos before building anything. Returns one image with every media numbered, and the name, type, size and length of each. It changes nothing in the project. '
        + 'Use it to learn what the user has (products, people, posters that already carry text, a logo), so your questions are precise and you can decide which media suits which shot. The numbers are the ones apply_reference takes in order.',
      parameters: obj({
        clip_ids: ids('Main-track clips to look at. Default: every clip on the main track.'),
      }),
    },
    {
      name: 'apply_reference',
      description: 'Rebuild the edit of the analyzed reference video with the user\'s media (call analyze_reference first). '
        + 'The main track becomes one clip per reference shot, each with that shot\'s exact length, transition and flash, in the reference aspect ratio. Photos get the camera zoom measured in their shot (a hand-held drift where the reference moves without zooming). '
        + 'Effects found in the reference are added too: zoomBlur or whip on the cuts that had one, bw over black-and-white shots, a fade in and out. '
        + 'Flashes inside the reference shots become areaFlash effects at the same moment and place in the frame; the answer lists them so you can move each onto the product of the user\'s picture with update_effects. '
        + 'When the reference shows several products in one shot, per_shot puts several of the user\'s images together in that shot, merged into one picture. '
        + 'Rhythm: with the reference music the cuts keep their original times, so they hit the same beats. With other music (already in the project, or among the files) the beat pattern of the reference, beats per shot, is re-timed onto the new music. '
        + 'Media shorter than the shot count is reused in a loop; extra media is left out. Videos longer than their shot are trimmed to their middle, shorter ones are slowed down. '
        + 'Returns an image of all the media, each tagged with the number of the shot it took. Call it again with clip_ids in another order to change which media takes which shot. One undo step.',
      parameters: obj({
        clip_ids: ids('Main-track clips to use, in shot order (an id may repeat). Default: every clip on the main track except the reference clip.'),
        music: bool('Put the sound of the reference video on the music track. Default: true when the project has no music of its own.'),
        sync: bool('With music other than the reference: re-time the cuts onto its beats, keeping the reference beats per shot. Default true.'),
        fill: pick(['loop', 'trim'], 'When there is less media than shots: loop reuses the media from the start (default), trim ends the video after the last media.'),
        order: { type: 'array', items: { type: 'number' }, description: 'Which media goes in which shot, by the numbers shown by view_media, in shot order. A number may repeat; media you leave out are not used. Default: the order of the files or clips.' },
        per_shot: { type: 'array', items: { type: 'number' }, description: 'How many media each shot shows together, in shot order, 1 to 9 (default 1 each). Media are taken in order, and the images of a shot are merged into one picture arranged to fill the frame. Example [1,3,3,1]: the first shot one image, the next two shots three each.' },
        motion: bool('Give photos the camera zoom of their reference shot. Default true.'),
        effects: bool('Add the effects of the reference: flashes on its cuts and inside its shots, blurred or whip transitions, black and white, fade in and out. Default true.'),
        durations: { type: 'array', items: { type: 'number' }, description: 'Override the shot lengths, in seconds, for example to merge two shots the detection split or to drop the last shots.' },
        replace: bool('The main track already has other clips and new files are being brought in: start from an empty project. The old clips are removed together with everything else of the previous project (its music, overlays, texts, effects and captions), so the reference music is used unless an audio file is among the new files. One undo step brings it all back.'),
      }),
    },
    {
      name: 'duplicate_item',
      description: 'Duplicate a clip, overlay, audio item, text, effect or caption. The copy is placed right after the original.',
      parameters: obj({ id: str('Id of the item to copy.') }, ['id']),
    },
    {
      name: 'delete_items',
      description: 'Remove clips, overlays, audio items, texts, effects or caption blocks from the project.',
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
        fill_last_row: bool('Grid only: when the last row is not full (3 images in 2 columns, 5 in 3), its images widen to fill the row instead of sitting centered with empty space beside them. Use it for a collage that fills the frame. Default false.'),
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
      description: 'Cut the SOURCE FILE of a video clip into several separate MP4 files, saved in the exports folder next to the app. It does not change the project; to cut a clip on the timeline use split instead. Use it only when the user asks for separate video files (for example 30-second parts for WhatsApp or Instagram stories). Give exactly one of every, parts or times. MP4/MOV files are copied without re-encoding (fast, original quality) and each cut moves back to the nearest keyframe; when the keyframes are too far from the cuts (the parts would change a lot), and for other formats, the parts are re-encoded with exact cuts.',
      parameters: obj({
        id: str('Id of the video clip.'),
        every: num('Length of each part in seconds, for example 30.'),
        parts: num('Number of equal parts, 2 to 100.'),
        times: { type: 'array', items: { type: 'number' }, description: 'Cut points in seconds of the SOURCE video.' },
        start: num('Second in the SOURCE video where splitting starts. Default: the clip trim start.'),
        end: num('Second in the SOURCE video where splitting ends. Default: the clip trim end.'),
        keep_audio: bool('Keep the sound in the parts. Default true.'),
        exact_cuts: bool('Re-encode so every cut lands exactly on the requested time instead of on a keyframe. Slower and recompresses the video. Default false.'),
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
      name: 'save_project',
      description: 'Save the whole project as one .montaji file: the timeline (clips, trims, texts, effects, music settings) together with its media files, so it can be reopened later exactly as it is. Only call it when the user asks to save the project. This is not a video: use export_video for the final MP4.',
      parameters: obj({
        save_as: str('Save the file in the "projects" folder of the Montaji app on this computer under this name (no folders). Never overwrites: a number is added if the name exists. Without it the file goes to the user\'s Downloads folder.'),
      }),
    },
    {
      name: 'export_video',
      description: 'Render the project to an MP4 file. This can take minutes; when it finishes the editor shows a download button to the user. Only call it when the user asks to export.',
      parameters: obj({
        resolution: pick(['720', '1080', '1440', '2160'], 'Short side in pixels. Default 1080.'),
        fps: pick(['24', '30', '60'], 'Frames per second. Default 30.'),
        quality: pick(['small', 'normal', 'high', 'ultra', 'size'], 'Bitrate level. Default high (about 90 MB per minute at 1080p). small is a compact file for sharing (about 23 MB per minute at 1080p). size aims at size_mb.'),
        size_mb: num('Target file size in megabytes (1 to 4000); implies quality "size". Use it when the user names a size, e.g. 35 for a 3 minute video. Low sizes look sharper at 720p.'),
        save_as: str('Also save the MP4 in the "exports" folder of the Montaji project on this computer, under this file name (no folders). Never overwrites: a number is added if the name exists.'),
      }),
    },
  ];
})();

if (typeof module !== 'undefined') module.exports = MONTAJI_TOOLS;
