# Montaji — مونتاجي

[العربية](README.md) · **English**

A simple, Arabic-first video editor that runs in your browser, on your own machine, with a built-in AI assistant: describe the edit you want and watch it happen on the timeline. Open source, no account, and no dependencies to install.

- Import images, video clips and music by button or drag and drop
- Reorder, trim and split clips, with undo and redo
- Music with fades, animated text overlays
- Transitions, filters, camera motion, and 16:9, 9:16, 1:1 and 4:5 frames
- Automatic beat detection and beat-synced cuts
- MP4 export up to 4K (WebCodecs, rendered locally)
- **Image studio**: crop, rotate, filters, color-based background removal, and PNG / JPEG / WebP conversion for one image or a whole batch (downloaded as a ZIP), and merging several images into one (side by side, stacked, or a grid)
- **Video to audio**: pull the music or speech out of any video, trim it, then download it as M4A (AAC) or WAV or drop it on the music track; a clip's sound can be detached in sync with one click
- **Split video**: cut a video into separate MP4 files every N seconds (e.g. 30 s parts for WhatsApp or Instagram stories), into N equal parts, or at chosen times. MP4/MOV files are copied without re-encoding, so it is fast and lossless; each cut moves back to the nearest keyframe
- **AI assistant** using your own API key (Gemini, OpenAI, Claude, OpenRouter, any OpenAI-compatible service, or local models through Ollama)
- **MCP server** so external clients (Claude Code, Cursor, ...) can drive the editor

The interface is in Arabic (RTL). Code comments are in Arabic; tool descriptions and protocol messages are in English.

## Run it

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. Get the code:

   ```bash
   git clone https://github.com/saeedbark/montaji.git
   ```

3. Start it. There is nothing to `npm install`.

   ```bash
   npm start
   ```

   On Windows you can double-click `start.bat`; on macOS and Linux run `./start.sh`.

The editor opens at `http://localhost:4747`. Export needs a recent Chrome or Edge. Set `PORT` to use another port.

## AI assistant

On first run the server creates `.env` from `.env.example`. Put one API key in it and save; no restart is needed.

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

Tools: `get_project` `import_media` `set_ratio` `update_clips` `reorder_clips` `split` `add_text` `update_texts` `update_audio` `analyze_audio` `sync_to_beat` `duplicate_item` `delete_items` `edit_image` `merge_images` `extract_audio` `split_video_file` `save_image` `view_frame` `seek` `undo` `export_video`

## Project layout

```
server/      Local Node.js server, no dependencies
  index.js     entry point and routing
  config.js    .env parsing and AI providers
  http.js      HTTP helpers and static files
  chat.js      /api/chat proxy to the AI provider (the key stays here)
  bridge.js    /api/bridge channel between the server and the editor tab
  mcp.js       /mcp MCP server
public/      Everything the browser loads
  js/core.js     shared state and helpers
  js/beats.js    beat detection
  js/render.js   frame rendering and effects
  js/export.js   MP4 export (WebCodecs)
  js/audiotools.js   audio processing: trim, normalize, fades, WAV and M4A encoding
  js/app.js      editor UI and timeline
  js/imagetools.js   image processing: background removal, conversion, ZIP
  js/imagestudio.js  image studio UI
  js/extractaudio.js video-to-audio dialog
  js/videotools.js   MP4 parsing and lossless part copying
  js/splitvideo.js   split-video dialog
  js/tools.js    tool definitions, shared by the chat and MCP
  js/agent.js    tool implementations
  js/chat.js     assistant panel and conversation loop
test/        Tests (node --test)
docs/        Architecture notes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (Arabic) for the data flow.

## Contributing

Issues and pull requests are welcome, in Arabic or English. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report security problems privately as described in [SECURITY.md](SECURITY.md).

```bash
npm test
```

## License

[MIT](LICENSE). Bundles [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT).
