---
name: montaji-remix
description: Recreate a reference video (a reel, an ad, a template from any app or platform) with the user's own photos and clips in the Montaji editor over MCP - same cuts, shot lengths, transitions, camera zooms, flashes on the products and beat rhythm, re-timed onto other music when needed. Use when the user says things like "اعمل مثل هذا المقطع", "نفس الفيديو بصوري", "ريمكس", "قلّد هذا الريل", "same as this video with my photos", "remix this reel", "copy this edit", or hands over a video plus images and wants a similar video. Also use to pull the music out of a video.
license: MIT
compatibility: Needs the Montaji editor (https://github.com/saeedbark/montaji) running on this computer, its page open in Chrome or Edge at http://localhost:4747, and its MCP server connected under the name "montaji".
---

# Montaji remix

The user has a video they like (the **reference**) and their own photos or clips (the **media**). They want a
video that feels like the reference: same pacing, same cuts on the same beats, same zooms and flashes. Build
it for them in Montaji. Every tool named here belongs to the `montaji` MCP server.

## How to talk to the user

Most users write one short line, or only "ريمكس". Keep their typing close to zero:

- Do the work first, ask afterwards. Find the inputs, analyze, and build a first draft without a single
  question. Then ask the few questions in step 4, which the analysis lets you make short and precise.
- Never ask for what you can see or decide yourself (file locations, ratio, order, shot lengths).
- Every question offers ready answers, so one word or one tap is enough.
- Answer in the user's language, in short lines. Do not mention tool names or ids.

## 0. Make sure the editor is reachable

If the `montaji` tools are missing, or a call answers that the editor is not open:

1. Start the app from its folder: `npm start` (no install step, it has no dependencies), or the user
   double-clicks `start.bat` (Windows), `start.command` (macOS) or runs `./start.sh` (Linux).
2. The page `http://localhost:4747` must stay open in Chrome or Edge: the tools run inside it.
3. Connect the MCP server once. Claude Code: `claude mcp add --transport http montaji http://localhost:4747/mcp`.
   Other agents: `{ "mcpServers": { "montaji": { "url": "http://localhost:4747/mcp" } } }`.

## 1. Find the inputs without asking

| Input | The user gave a path or a file | The user gave nothing |
|---|---|---|
| Reference video | pass it as `path` | call with no `path`: the newest video in the `مرجع` (or `reference`) folder of the Montaji app, or dropped in the app folder itself, else the only video in the open project |
| Media | pass `paths` (in the order you want) or `folder` | call with no arguments: the `خام` (or `raw`) folder of the Montaji app, else the clips already in the open project |

If the user points at one folder holding a single video and several images, the video is the reference and
the rest is the media. Any video file the browser can play works as a reference; it does not have to come
from Montaji.

## 2. Analyze the reference

Call `analyze_reference`. It takes about as long as the video. Read the answer:

- `ratio`, `shot_count`, `pace`
- `shots[]`: `n`, `duration`, `enters` (cut, fade, black), `flash`, `picture` (still or moving), `beats`,
  `camera` (zoom in or out, how much, early punch or steady) and `flashes` (how many inside the shot)
- `music`: `bpm` and `cuts_on_beat_percent`, or a note that there is no clear beat
- `flashes[]`: each light flash inside a shot with its time and its place in the frame. A small one is a
  product or a sign lighting up for an instant. Several in one shot at different places usually mean several
  products lit one after another.

Then look at the contact sheets (one numbered frame per shot). Note for each shot what it shows (wide
establishing view, close-up, product, text card, closing logo or contact card), **how many products or
subjects share the frame**, whether text is on screen and where, and the overall mood.

Check the cut detection once: if two neighbouring frames are clearly the same continuous shot, re-run with
`sensitivity: "low"`; if one shot is several times longer than the rest and looks like it hides more scenes,
re-run with `sensitivity: "high"`. Do this at most once.

## 3. Build a first draft

Call `apply_reference`. With no arguments it takes the media from step 1 and:

- puts one clip in each shot, with that shot's exact length, transition and flash, in the reference ratio
- gives photos the camera zoom measured in their shot (a hand-held drift where it moves without zooming)
- places every flash of the reference at the same moment and the same place in the frame (`flashes` in
  the answer, each with its effect id)
- loops the media if there are fewer than shots, leaves out the extra if there are more (`unused`)
- adds the reference sound as the music when the project has none of its own

It returns one image with every media tagged by the number of the shot it took (× = not used). Look at it:
this is how you learn what the user's photos and clips show.

Then `seek` to 0 with `play: true`, so the user watches the draft while reading your questions.

If it answers that the main track already has clips: when those clips are the media for this remix, call
again with `clip_ids`; otherwise call again with `replace: true` (one undo step) and say so in your summary.

## 4. Say what you understood, then ask

Now you have seen both sides. Tell the user in two or three lines what you understood, so they can correct
you with one word. For example: "المرجع: ريل لمحل، 11 لقطة سريعة، قصّة كل 4 ضربات على 130 BPM، ووميض
عند لقطتين. موادك: 14 ملصق منتج لمحل اتصالات. جهّزت مسودة أولى وهي تعمل الآن أمامك."

Then ask **at most three** questions, only the ones whose answer changes the result and that you cannot
settle by looking. Skip any the user's message already answered. Pick from:

| Ask when | Question | Ready answers (first is the default) |
|---|---|---|
| the reference has sound | Which music? | the reference music (check you may reuse it) · my own file · no music |
| the reference shows titles or captions and the media carry no text | Add texts like the reference? | no texts · yes, title: … |
| the reference ends on a logo or contact card and no media looks like one | What closes the video? | my last image as it is · a card with: account / phone … |
| shots of the reference show several products together and the user has more media than shots | Group your products like the reference? | yes, several per shot · one per shot |
| fewer media than shots | Repeat the media or make it shorter? | repeat to keep the full length · shorter video |
| more media than shots, and you cannot tell which matter most | Which ones must appear? | you choose · these: … |
| the media are a different shape from the reference | Which shape? | like the reference · keep my media's shape |
| you cannot tell what the video is for | What is it for? | product ad · shop tour · event or memory · other: … |

Use your question tool when you have one (one tap per answer). Otherwise write the questions numbered, the
answers lettered with the default marked, and end with: answer like "1ب 2أ", or just "تمام" for the defaults.
If the user does not answer a question, or says "you decide", take the default and continue. Do not ask a
second round.

## 5. Match each media to a shot, and apply the answers

The draft fills the shots in file-name order. Improve it once, together with the answers:

1. Compare the media image with the contact sheet of the reference.
2. Decide the order: the strongest or widest image opens; an image with a logo, a price or contact details
   takes the long closing shot; busy images with text take the longer shots and simple bold images the
   shots under one second; similar images are spread apart; whatever the user said must appear, appears.
3. Call `apply_reference` again with `clip_ids` in the new order (ids come from the previous answer; an id
   may repeat), plus what the answers need: `music: false`, `fill: "trim"`, or new `paths` with
   `replace: true` when the user sends other files. Nothing is imported twice and the music is kept.
4. Check two or three moments with `view_frame`.

Posters and images that carry text keep the default fit, which shows the whole image over a blurred
background. For plain photos whose shape is close to the frame, `update_clips` with `fit: "cover"` fills it.

### Several products in one shot

When a shot of the reference shows two or three products side by side, do the same with the user's images:
pass `per_shot` to `apply_reference`, one number per shot. `per_shot: [1, 1, 3, 3]` gives the first two
shots one image each and the next two shots three images each, merged into one picture arranged to fill the
frame. Media are taken in order, so order them first (`paths` or `clip_ids`). It is the natural answer
when there are more media than shots: nothing is left out. For a custom layout (a row, a grid with a
background color, rounded corners) use `merge_images` on the clips, then `apply_reference` with
`clip_ids`.

### Put the flashes on the user's products

The flashes come back where the reference had them, which is rarely where the user's product sits. For
each entry of `flashes`: look at the frame at its `start` (`view_frame`), find the product, and move the
effect onto it with `update_effects` (`x`, `y`, `width`, `height`). Three flashes in one shot that
walked across three products in the reference should walk across the user's products in the same order,
which is one more reason to group images with `per_shot`. If an image has no clear product, delete
its flashes. Keep each flash under a second, as in the reference.

The look can be changed with `type`: `areaFlash` (the part lights up, the default), `backlight` (a warm
glow with a halo, good for a sign or a logo), `glow`, `shine` (a light band sweeping across) or
`sparkle`. To add one the detection missed, `add_effect` with the same fields.

### Zoom

Photos already carry the zoom of their shot, limited to 30 percent and always ending on the whole picture:
a zoom in starts smaller and grows to it, a zoom out starts closer and opens up to it, so the text of a
poster is never cut while it is being read.
`camera` in the answer says what each got. To change one, `set_keyframes` on the clip with `prop: "zoom"`
(for a punch on the beat: 80 at 0, 100 at half a beat). To push in on the product instead of the center,
`add_effect` with `type: "zoomTo"` and the product's `x`, `y`.

### Other tools worth offering

Suggest these in one line when the media call for it, and use them on a yes:

- product photo on a plain background → `edit_image` with `remove_background`, then `add_overlay` to
  place the cut-out over another image
- a shop logo → `add_overlay` in a corner (scale about 15) for the whole video
- one product that must stand out → `add_effect` `spotlight` on it
- before and after, or variants of one product → `merge_images` with `layout: "row"`

## 6. Rhythm

- **Reference music kept:** the cuts already sit on the reference times, so they hit the same beats. Do not
  call `sync_to_beat`; it would replace the pattern of the reference with a uniform one.
- **The user's own music** (an audio file among the media, or music already in the project):
  `apply_reference` re-times the cuts onto the new beats and keeps the beats per shot of the reference
  (`music.retimed`). If it reports no clear beat, leave the shot lengths as they are.
- **Extra punch**, only when the reference visibly has it: `pace` is fast and most cuts are on the beat →
  `update_clips` with `ids: ["all"], pulse: true`; cuts that blur or whip in the reference → `add_effect`
  with `type: "zoomBlur"` or `"whip"` and `at_cuts: true`.

## 7. Texts

Texts of the reference are never copied; they belong to someone else's content. Add texts only when the
user asked for them in step 4 or in their message: use `add_text` at a similar place and time as in the
reference, with the user's own words. If the media are finished posters that already carry text, add
nothing.

## 8. Finish

1. `seek` to 0 with `play: true` so the user watches the final result.
2. Summarize in 2 to 4 short lines: how many shots, what rhythm, which music.
3. If the reference music was used, add one line: it belongs to the original video, so they should make
   sure they may reuse it before publishing.
4. Offer the export in a few words and wait. On yes: `export_video` with `save_as`, then give the saved path.

## Related requests

- **Only the music of a video:** `import_media` the video, then `extract_audio` on its clip with
  `download: true` (add `add_to_project: false` to leave the project untouched).
- **Same template, other media:** call `apply_reference` again with the new `paths` and `replace: true`.
  The analysis stays in memory until the editor page is reloaded.
- **Shorter or adjusted:** `fill: "trim"` ends the video after the last media; `durations` overrides the
  shot lengths, for example to merge two shots or drop the last ones.

## What it cannot see

Say so plainly when it matters, and approximate by eye:

- Detected: hard cuts, cross-fades, dips to black, flashes and where they are in the frame, camera zoom
  per shot, still versus moving picture, beat pattern.
- Zoom is an estimate: reliable for a clear push in or pull out, silent when the camera mostly pans or
  shakes. Flashes in shots with strong camera motion can be missed. Check both against the contact sheet.
- Not detected: speed ramps, pans and whips, masks, stickers, text animation, color grade, and how many
  products a shot shows (count them on the contact sheet). Imitate them with `update_clips` (motion,
  filter, speed), `add_effect` and `set_keyframes`.
- A cross-fade between two moving shots can be missed; the contact sheet shows it as one long shot.
- The browser must be able to play the file: MP4 (H.264) and WebM work, some MOV or HEVC files do not.
