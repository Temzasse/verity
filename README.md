# Verity

Chrome extension (Manifest V3), built with [WXT](https://wxt.dev) and TypeScript.

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

This starts both the extension dev server and the analysis server (see below) in one terminal, with `[ext]` / `[server]` prefixed logs. WXT builds to `.output/chrome-mv3-dev` and opens a separate Chrome window with the extension already loaded. Run them separately with `pnpm dev:ext` and `pnpm server`.

- Click the Verity scan icon in the toolbar (pin it from the puzzle-piece menu) to scan the current page.
- **Content scripts**: rebuilt on save and re-injected. Refresh the tab if state looks stale.
- **Background service worker**: rebuilt on save, and the extension reloads.
- `o` + Enter in the terminal reopens the browser if you closed it.
- The dev browser uses a persistent profile in `.chrome-profile/` (gitignored), so logins and `chrome.storage` survive restarts. Delete the folder to reset.

Logs: page DevTools for the content script and overlay, and `chrome://extensions` → Verity → "service worker" for the background.

### Loading manually (fallback)

If Chrome doesn't open, go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `.output/chrome-mv3-dev`. It still reloads on save while `pnpm dev` runs.

## Analysis server

Page analysis runs on a small local server (`server/`) that calls Claude Haiku 5.5, so the API key never ships in the extension.

1. Put your Anthropic API key in `server/.env` (`ANTHROPIC_API_KEY=...`; see `server/.env.example`).
2. `pnpm dev` starts it automatically (or run `pnpm server` on its own).

It listens on `http://127.0.0.1:8787`, restarts on file changes, and logs tokens and estimated cost for every call.

- **Cache:** results are stored in `server/.cache/` per URL + article text + prompt version, so re-scanning a page is free. Delete the folder to force fresh analysis.
- **Budget:** `DAILY_BUDGET_USD` (default $1) stops Claude calls for the day once reached. `GET /health` shows today's spend.
- **Prompt:** `server/prompt.ts`. Editing it invalidates cached results automatically.

## Project layout

```
entrypoints/
  background.ts      service worker: toolbar button click → inject content script → send scan message
  content/
    index.ts         overlay panel (shadow DOM, top layer): findings list, tooltip
    scan.ts          scan pipeline: extract → analyze → findings
    extract.ts       article text extraction (Readability) → sentences with live DOM ranges
    analyze.ts       sends the article to the analysis server via the background
    highlight.ts     on-page highlights (CSS Custom Highlight API, no DOM changes)
    dither.ts        scan line + dither animation
    style.css        overlay styles
utils/analysis.ts    analysis contract (categories, Finding, request/response) shared with server/
utils/messages.ts    message types shared by background and content
server/              local analysis server (Node, Claude Haiku 5.5): index.ts, claude.ts, prompt.ts, store.ts
public/icon/         toolbar/extension icons
wxt.config.ts        manifest + dev browser config
```

New entrypoints (e.g. `entrypoints/sidepanel/index.html`, `entrypoints/options/index.html`) are picked up automatically and added to the manifest.

## Scripts

| Command        | What it does                                  |
| -------------- | --------------------------------------------- |
| `pnpm dev`     | Extension dev server + Chrome + analysis server |
| `pnpm dev:ext` | Extension dev server + Chrome only            |
| `pnpm build`   | Production build to `.output/chrome-mv3`      |
| `pnpm zip`     | Build and zip for the Chrome Web Store        |
| `pnpm compile` | Type-check                                    |
| `pnpm server`  | Analysis server on :8787 (needs `server/.env`) |
