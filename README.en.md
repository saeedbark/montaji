# Montaji — مونتاجي

[العربية](README.md) · **English**

A simple, Arabic-first video editor that runs in your browser, on your own machine, with a built-in AI assistant: describe the edit you want and watch it happen on the timeline. Open source, no account, and no dependencies to install.

- Import images, video clips and music by button or drag and drop
- Reorder, trim and split clips, with undo and redo
- Music with fades, animated text overlays
- Transitions, filters, camera motion, and 16:9, 9:16, 1:1 and 4:5 frames
- Automatic beat detection and beat-synced cuts
- **Automatic captions**: speech becomes timed caption blocks on the timeline with the spoken word highlighted (Arabic first, RTL-aware), editable, and exportable as SRT / VTT. Speech-to-text runs through your own key (`GROQ_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env`) or a local Whisper server (`STT_BASE_URL`), in which case the audio never leaves your machine
- **Overlay layers**: pictures and videos on top of the main track (picture-in-picture, logos, cut-outs), moved, scaled and rotated by mouse or touch, with masks, borders, shadows and blend modes
- **Keyframes**: animate position, size, opacity, rotation, clip zoom and pan, effect intensity and audio volume over time
- MP4 export up to 4K (WebCodecs, rendered locally)
- **Save and open projects**: one `.montaji` file holds the timeline and its media files, so a project reopens exactly as it was, on this computer or another. It is a plain uncompressed ZIP (`project.json` plus a `media/` folder). Project menu, `Ctrl+S` / `Ctrl+O`, or drop the file on the editor
- **Image studio**: crop, rotate, filters, color-based background removal, and PNG / JPEG / WebP conversion for one image or a whole batch (downloaded as a ZIP), and merging several images into one (side by side, stacked, or a grid)
- **Video to audio**: pull the music or speech out of any video, trim it, then download it as M4A (AAC) or WAV or drop it on the music track; a clip's sound can be detached in sync with one click
- **Split video**: cut a video into separate MP4 files every N seconds (e.g. 30 s parts for WhatsApp or Instagram stories), into N equal parts, or at chosen times. MP4/MOV files are copied without re-encoding, so it is fast and lossless; each cut moves back to the nearest keyframe (or turn on exact cuts to re-encode). The parts can also go straight onto the timeline as clips
- **Remix from a reference video**: hand the editor a video you like (a reel or an ad from any app or platform) and your own photos or clips, and it rebuilds the edit with them: the same cuts, shot lengths, transitions and flashes, on the same beat or re-timed onto your music
- **AI assistant** using your own API key (Gemini, OpenAI, Claude, OpenRouter, any OpenAI-compatible service, or local models through Ollama)
- **MCP server** so external clients (Claude Code, Cursor, ...) can drive the editor, with a ready-made **Agent Skill** (`montaji-remix`)

The interface is in Arabic (RTL). Code comments are in Arabic; tool descriptions and protocol messages are in English.

## Run it

### First time, no programming needed

1. Install [Node.js](https://nodejs.org) once: download the **LTS** version and click through the installer.
2. On the GitHub page click **Code → Download ZIP** and extract it.
3. Double-click **`start.bat`** (Windows), **`start.command`** (macOS) or run `./start.sh` (Linux). The editor opens in your browser.
4. **Keep the black window open** while you use the editor; closing it stops Montaji.
5. To turn on the AI assistant, open **Assistant** in the editor and paste your API key there. No file editing needed.

The first launch may show a warning because the scripts are not signed: on Windows choose **More info → Run anyway**; on macOS open **System Settings → Privacy & Security** and click **Open Anyway** next to `start.command`.

### For developers

```bash
git clone https://github.com/saeedbark/montaji.git
cd montaji
npm start            # nothing to npm install; add -- --open to open the browser
```

The editor opens at `http://localhost:4747`. Export needs a recent Chrome or Edge. Set `PORT` to use another port.

> [!WARNING]
> **Montaji is for use on your own machine only. Do not run it on a public server or expose it to the internet** (hosting, a tunnel such as ngrok or Cloudflare Tunnel, a reverse proxy, or a port published from Docker or your router).
> The server has no login: anyone who reaches it can use the assistant **on your API key** (and your bill), drive the editor over MCP, and write files into `exports/` and `projects/`. That is why it listens on `127.0.0.1` only and rejects any other host; do not change that.

## AI assistant

Open **Assistant** in the editor, pick a provider, paste your key and click save; the settings button in the assistant header changes it later or adds a Groq key for captions. The key is written to `.env` on your machine and never sent back to the browser.

You can also edit `.env` yourself (created from `.env.example` on first run; on macOS press `Cmd+Shift+.` in Finder to see it). No restart is needed. Advanced options (model, Ollama, custom providers, `AI_VISION`) live only in that file.

| Provider | Variable |
| --- | --- |
| Google Gemini | `GEMINI_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic Claude | `ANTHROPIC_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Any OpenAI-compatible service | `AI_PROVIDER=custom` with `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` |
| Ollama (local, offline) | `AI_PROVIDER=ollama` with `AI_MODEL` |

Use `AI_MODEL` to pick a model and `AI_PROVIDER` to choose between several keys.

**Privacy.** Editing and export happen entirely on your machine. The key stays in `.env`: only the local server reads it, and it never reaches the browser. When you use the assistant, your messages, a description of the project (file names, durations, texts) and small thumbnails of your media are sent to the provider you chose. Set `AI_VISION=off` to stop sending thumbnails.

## MCP server

The same server speaks [MCP](https://modelcontextprotocol.io) at `http://localhost:4747/mcp`. Keep the editor tab open: tools run inside it.

```bash
claude mcp add --transport http montaji http://localhost:4747/mcp
```

```json
{ "mcpServers": { "montaji": { "url": "http://localhost:4747/mcp" } } }
```

Tools: `get_project` `import_media` `set_ratio` `update_clips` `reorder_clips` `split` `add_overlay` `update_overlays` `to_overlay` `to_main` `set_keyframes` `clear_keyframes` `transcribe` `update_captions` `export_captions` `add_text` `update_texts` `update_audio` `analyze_audio` `sync_to_beat` `add_effect` `update_effects` `duplicate_item` `delete_items` `edit_image` `merge_images` `extract_audio` `split_video_file` `save_image` `view_frame` `seek` `undo` `save_project` `open_project` `export_video` `analyze_reference` `apply_reference`

## Remix: imitate any video with your own media

Ask the assistant or your agent for "the same as this video with my photos" and two tools do the work:

1. `analyze_reference` reads the picture and sound of the video file itself, so any file the browser plays works, not only Montaji projects. It finds every cut and shot length, how each shot enters (cut, cross-fade, dip to black, flash), whether the picture is still or moving, the aspect ratio, and the music rhythm: BPM and beats per shot. It returns a contact sheet with one numbered frame per shot.
2. `apply_reference` puts one of your clips in each shot with that shot's length, transition and flash, in the reference ratio. Fewer media than shots loop; extra media are left out. Longer videos are trimmed to their middle, shorter ones slowed down. With the reference music the cuts keep their times; with other music the beats-per-shot pattern is re-timed onto the new beats. It is one undo step and can be re-applied in another media order without a new analysis.

Over MCP both tools take any path on the computer (`path`, `paths`, `folder`). With no arguments the reference is the newest video in the `مرجع` (or `reference`) folder of the app or in the app folder itself, and the media come from its `خام` (or `raw`) folder, else from the open project. These folders are optional and git-ignored.

Cut detection compares color histograms rather than pixels, so fast hand-held footage does not confuse it. It does not detect speed ramps, the kind of camera move, masks, stickers or text animation. Texts are never copied from the reference, and its music belongs to its owner.

### Agent Skill

`skills/montaji-remix/SKILL.md` teaches an agent the whole flow: find the files, analyze, build a draft, say what it understood, ask two or three questions with ready answers, then match the media to the shots by looking at them.

Claude Code (installs the skill and the MCP connection):

```bash
claude plugin marketplace add saeedbark/montaji
```

```bash
claude plugin install montaji@montaji
```

Other agents that support [Agent Skills](https://agentskills.io) (Cursor, Codex and more):

```bash
npx skills add saeedbark/montaji
```

Agents without skill support can read `AGENTS.md`. In every case Montaji must be running with its page open.

## Project layout

```
server/      Local Node.js server, no dependencies
  index.js     entry point and routing
  config.js    .env parsing and AI providers
  http.js      HTTP helpers and static files
  chat.js      /api/chat proxy to the AI provider (the key stays here)
  settings.js  /api/settings/key: saves the key from the editor into .env
  stt.js       /api/transcribe proxy to the speech-to-text provider (automatic captions)
  bridge.js    /api/bridge channel between the server and the editor tab
  mcp.js       /mcp MCP server
public/      Everything the browser loads
  js/core.js     shared state, keyframes and helpers
  js/beats.js    beat detection
  js/captiontools.js caption logic: words to blocks, SRT and VTT
  js/captions.js     automatic captions dialog and subtitle export
  js/render.js   frame rendering and effects
  js/export.js   MP4 export (WebCodecs)
  js/audiotools.js   audio processing: trim, normalize, fades, WAV and M4A encoding
  js/projecttools.js project file (.montaji): ZIP writing and reading, validation
  js/reftools.js     reference analysis logic: cut detection, rhythm, media assignment
  js/reference.js    reads the frames and sound of a reference video, builds the contact sheet
  js/app.js      editor UI and timeline
  js/imagetools.js   image processing: background removal, conversion, ZIP
  js/projectio.js    saving and opening projects
  js/imagestudio.js  image studio UI
  js/extractaudio.js video-to-audio dialog
  js/videotools.js   MP4 parsing and lossless part copying
  js/splitvideo.js   split-video dialog
  js/tools.js    tool definitions, shared by the chat and MCP
  js/agent.js    tool implementations
  js/chat.js     assistant panel and conversation loop
skills/      Agent Skill: remix a reference video with the user's media
test/        Tests (node --test)
docs/        Architecture notes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (Arabic) for the data flow, and [docs/ROADMAP.md](docs/ROADMAP.md) (Arabic) for what is done and what is left of automatic captions, overlay tracks and keyframes.

## Contributing

Issues and pull requests are welcome, in Arabic or English. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report security problems privately as described in [SECURITY.md](SECURITY.md).

```bash
npm test
```

## License

[MIT](LICENSE). Bundles [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT).
