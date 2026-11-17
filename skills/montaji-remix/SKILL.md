---
name: montaji-remix
description: Recreate a reference video (a reel, an ad, a template from any app or platform) with the user's own photos and clips in the Montaji editor over MCP - same cuts, shot lengths, transitions, camera zooms, effects, flashes on the products and beat rhythm, re-timed onto other music when needed. Use when the user says things like "اعمل مثل هذا المقطع", "نفس الفيديو بصوري", "ريمكس", "قلّد هذا الريل", "same as this video with my photos", "remix this reel", "copy this edit", or hands over a video plus images and wants a similar video. Also use to pull the music out of a video.
license: MIT
compatibility: Needs the Montaji editor (https://github.com/saeedbark/montaji) running on this computer, its page open in Chrome or Edge at http://localhost:4747, and its MCP server connected under the name "montaji".
---

# Montaji remix

The user has a video they like (the **reference**) and their own photos or clips (the **media**). They want a
video that feels like the reference: same pacing, same cuts on the same beats, same zooms, effects and
flashes. Build it for them in Montaji. Every tool named here belongs to the `montaji` MCP server.

## How to talk to the user: look, ask, then edit

1. **Look first.** Find the files, analyze the reference and look at the media. None of this changes the
   project (`get_project`, `analyze_reference`, `view_media`, `view_frame` only read).
2. **Ask before the first edit.** Tell the user what you understood and ask a few short questions (step 4).
   Nothing is built until they answer or tell you to decide.
3. **Then edit**, in as few calls as possible.

Most users write one short line, so keep their typing close to zero: never ask for what you can see or
decide yourself (file locations, ratio, shot lengths); give every question ready answers with your default
marked, so one word or one tap is enough; ask one round only. Answer in the user's language, in short
lines, without tool names or ids.

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
from Montaji. Ask for a file only when nothing is found.

## 2. Analyze the reference

Call `analyze_reference`. It takes about as long as the video and changes nothing. Read the answer:

- `ratio`, `shot_count`, `pace`
- `shots[]`: `n`, `duration`, `enters` (cut, fade, black), `flash`, `picture` (still or moving), `beats`,
  `camera` (zoom in or out, how much, early punch or steady), `cut_effect` (`zoomBlur` or `whip` on the cut
  into the shot), `look` (`bw` for black and white), `flashes` (how many inside the shot)
- `effects_found`: one line listing every effect it recognized, and `opens` / `closes` for a fade in or out
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

## 3. Look at the user's media

Call `view_media` with the same `paths` or `folder` as in step 1 (or nothing). It returns one image with
every photo and video numbered, and the size and length of each, and adds nothing to the project. Note what
the media are (products, people, places, finished posters that already carry text, a logo), how many there
are compared with the shots, and their shape compared with the reference.

## 4. Say what you understood, then ask

Tell the user in two or three lines what you understood, so they can correct you with one word. For
example: "المرجع: ريل لمحل، 11 لقطة سريعة، قصّة كل 4 ضربات، زوم في 5 لقطات، ووميض على المنتجات.
موادك: 14 ملصق منتج لمحل اتصالات."

Then ask **at most four** questions, only the ones whose answer changes the result and that you cannot
settle by looking. Skip any the user's message already answered. Pick from:

| Ask when | Question | Ready answers (first is the default) |
|---|---|---|
| the reference has sound | Which music? | the reference music (check you may reuse it) · my own file · no music |
| the reference uses effects (`effects_found`) | Same effects as the reference? | yes, all of them · lighter (cuts and zoom only) · none |
| shots of the reference show several products together and the user has more media than shots | Group your products like the reference? | yes, several per shot · one per shot |
| the reference shows titles or captions and the media carry no text | Which words on screen? | no texts · title: … / phone or account: … |
| the reference ends on a logo or contact card and no media looks like one | What closes the video? | my last image as it is · a card with: account / phone … |
| fewer media than shots | Repeat the media or make it shorter? | repeat to keep the full length · shorter video |
| more media than shots, and you cannot tell which matter most | Which ones must appear? | you choose · these numbers: … |
| the media are a different shape from the reference | Which shape? | like the reference · keep my media's shape |
| you cannot tell what the video is for or where it will be posted | What is it for? | product ad for Reels or TikTok · shop tour · event or memory · other: … |

Use your question tool when you have one (one tap per answer). Otherwise write the questions numbered, the
answers lettered with the default marked, and end with: answer like "1ب 2أ", or just "تمام" for the defaults.
If the user does not answer a question, or says "you decide", take the default and continue. Do not ask a
second round.

## 5. Build it

Decide which media suits which shot from the two images you have (the contact sheet of the reference and
the numbered media): the strongest or widest image opens; an image with a logo, a price or contact details
takes the long closing shot; busy images with text take the longer shots and simple bold images the shots
under one second; similar images are spread apart; whatever the user said must appear, appears.

Then one call to `apply_reference` with what the answers need:

| Answer | Argument |
|---|---|
| your choice of media per shot | `order`: the media numbers in shot order, for example `[14, 3, 1, 2]` (a number may repeat) |
| several products per shot | `per_shot`: how many media each shot shows, for example `[1, 1, 3, 3]`; the images of a shot are merged into one picture arranged to fill the frame |
| no music, or the user's own file | `music: false`, or include the audio file in `paths` |
| lighter or no effects | `effects: false` (no flashes, blur, black and white or fades), and `motion: false` for no zoom |
| shorter video | `fill: "trim"` |
| the project already holds other clips | `replace: true`: it starts from an empty project, so the old music, overlays, texts and effects go too (one undo step, listed in `removed_from_old_project`); say so in your summary |

It puts one clip in each shot with that shot's exact length and transition, in the reference ratio, and adds
what was recognized in the reference: the camera zoom of each shot, the effects on the cuts, the flashes
inside the shots at the same moment and place, the fade in and out, and the reference sound as the music
when the project has none. It returns an image of the media with the shot each took. To change the result
later, call it again with `clip_ids` in another order; nothing is imported twice.

Check three or four moments with `view_frame`, then `seek` to 0 with `play: true` so the user watches.

Posters and images that carry text keep the default fit, which shows the whole image over a blurred
background. For plain photos whose shape is close to the frame, `update_clips` with `fit: "cover"` fills it.

## 6. Refine

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

### Effects

`effects_added` in the answer lists what was copied from the reference. The contact sheet and your own
eyes complete what the detection cannot name:

| You see in the reference | Do |
|---|---|
| a blur or a swipe on a cut that was not recognized | `add_effect` with `type: "zoomBlur"` or `"whip"` and `start` a fifth of a second before that cut, or `at_cuts: true` for every cut |
| the picture jolts on the beat | `add_effect` `shake` on those cuts; `update_clips` with `pulse: true` for a zoom bump on every beat |
| a color-split glitch | `add_effect` `rgb` on the cut |
| dark corners, or a moody look | `add_effect` `vignette` over the clips; `update_clips` with `filter` (`warm`, `cool`, `vintage`, `bw`) |
| crisp, saturated product shots | `add_effect` `sharp` over the clips |
| the product is singled out | `add_effect` `spotlight` or `zoomTo` with the product's `x`, `y` |

Do not pile effects on. Keep to what the reference shows, and to what the user chose in step 4.

### Zoom

Photos already carry the zoom of their shot, limited to 30 percent and always ending on the whole picture:
a zoom in starts smaller and grows to it, a zoom out starts closer and opens up to it, so the text of a
poster is never cut while it is being read. `camera` in the answer says what each got. To change one,
`set_keyframes` on the clip with `prop: "zoom"` (for a punch on the beat: 80 at 0, 100 at half a beat).

### Several products, custom layout

`per_shot` chooses the arrangement by itself. For a specific one (a row, a grid with a background color,
rounded corners) use `merge_images` on the clips, then `apply_reference` with `clip_ids`.

### Other tools worth offering

Suggest these in one line when the media call for it, and use them on a yes:

- product photo on a plain background → `edit_image` with `remove_background`, then `add_overlay` to
  place the cut-out over another image
- a shop logo → `add_overlay` in a corner (scale about 15) for the whole video
- before and after, or variants of one product → `merge_images` with `layout: "row"`
- speech in the video → `transcribe` for captions

## 7. Rhythm

- **Reference music kept:** the cuts already sit on the reference times, so they hit the same beats. Do not
  call `sync_to_beat`; it would replace the pattern of the reference with a uniform one.
- **The user's own music** (an audio file among the media, or music already in the project):
  `apply_reference` re-times the cuts onto the new beats and keeps the beats per shot of the reference
  (`music.retimed`). If it reports no clear beat, leave the shot lengths as they are.

## 8. Texts

Texts of the reference are never copied; they belong to someone else's content. Add texts only when the
user gave the words in step 4 or in their message: use `add_text` at a similar place and time as in the
reference. If the media are finished posters that already carry text, add nothing.

## 9. Finish

1. `seek` to 0 with `play: true` so the user watches the final result.
2. Summarize in 2 to 4 short lines: how many shots, what rhythm, which music, which effects.
3. If the reference music was used, add one line: it belongs to the original video, so they should make
   sure they may reuse it before publishing.
4. Offer the export in a few words and wait. On yes: `export_video` with `save_as`, then give the saved path.

## Related requests

- **Only the music of a video:** `import_media` the video, then `extract_audio` on its clip with
  `download: true` (add `add_to_project: false` to leave the project untouched).
- **Same template, other media:** call `apply_reference` again with the new `paths` and `replace: true`.
  The analysis stays in memory until the editor page is reloaded. It starts from an empty project, so add
  the user's texts and move the flashes again afterwards.
- **Shorter or adjusted:** `fill: "trim"` ends the video after the last media; `durations` overrides the
  shot lengths, for example to merge two shots or drop the last ones.

## What it cannot see

Say so plainly when it matters, and approximate by eye:

- Detected: hard cuts, cross-fades, dips to black, flashes and where they are in the frame, camera zoom
  per shot, a blurred or whip transition on a cut, black-and-white shots, fade in and out, still versus
  moving picture, beat pattern.
- Zoom is an estimate: reliable for a clear push in or pull out, silent when the camera mostly pans or
  shakes. Flashes in shots with strong camera motion can be missed. A blur on a cut is recognized by lost
  detail, so a soft or out-of-focus shot can look like one. Check all three against the contact sheet.
- Not detected: speed ramps, pans, shake, glitches, masks, stickers, text animation, color grade, and how
  many products a shot shows (count them on the contact sheet). Imitate them with the table in step 6.
- A cross-fade between two moving shots can be missed; the contact sheet shows it as one long shot.
- The browser must be able to play the file: MP4 (H.264) and WebM work, some MOV or HEVC files do not.
