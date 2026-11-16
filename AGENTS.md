# Montaji — notes for AI agents

Montaji (مونتاجي) is a local video editor that runs in the browser, with an MCP server so an agent can
edit the open project. This file is for agents; people start with [README.md](README.md).

## Editing videos with Montaji

1. Start the app: `npm start` (Node.js 18 or later, no install step), then keep `http://localhost:4747`
   open in Chrome or Edge. The tools run inside that page.
2. Connect the MCP server `http://localhost:4747/mcp` (streamable HTTP, no key) under the name `montaji`.
   Claude Code reads [.mcp.json](.mcp.json) from this folder; elsewhere use
   `{ "mcpServers": { "montaji": { "url": "http://localhost:4747/mcp" } } }`.
3. Call `get_project` first. The server's instructions describe the project model and the tools.

### Ask before you edit

Before your first change to a project in a conversation, ask the user a few short questions, unless their
message already answers them or asks for one small precise edit:

- what the video is for and where it will be posted (this sets the ratio)
- which music
- which words should appear on screen (a title, a price, a phone number or an account)
- whether it should be calm or lively, with zooms and flashes on the beat

At most four questions, in the user's language, each with ready answers and your default marked, so one
word or one tap is enough. Look first so the questions are precise: `get_project`, `view_media`,
`view_frame` and `analyze_reference` change nothing. If the user says to decide yourself, or leaves a
question unanswered, take the default and go on. Never ask a second round.

### Skill: remix a reference video

[skills/montaji-remix/SKILL.md](skills/montaji-remix/SKILL.md) is an Agent Skill: rebuild a video the
user likes (any reel, ad or template) with their own photos and clips, on the same cuts, transitions,
zooms, effects and beat rhythm. If your agent does not load skills by itself, read that file and follow it when the user
asks for "the same as this video", "remix", "ريمكس" or "نفس المقطع بصوري".

The short version: `analyze_reference` (cuts, shot lengths, zooms, effects, beat pattern, contact sheet)
and `view_media` (the user's media, numbered) to look, the questions above, then `apply_reference`
(one clip per shot from the user's media). All three work with no arguments when the
reference video is in the `مرجع` folder (or dropped in the app folder) and the media in the `خام` folder.

## Working on the code

- No dependencies and no build step. The browser code is in `public/js/`, the server in `server/`.
- `npm test` runs everything (`node --test`). Logic that needs no browser lives in the `*tools.js`
  modules and is tested there; keep new logic testable the same way.
- A tool for the assistant is declared in `public/js/tools.js` and implemented in `public/js/agent.js`;
  the MCP server and the in-page assistant share both.
- Code comments and user-facing text are in Arabic, tool descriptions in English.
- Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [CONTRIBUTING.md](CONTRIBUTING.md).
