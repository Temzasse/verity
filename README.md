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

This starts the WXT dev server, builds to `.output/chrome-mv3-dev`, and opens a separate Chrome window with the extension already loaded.

- Click the Verity scan icon in the toolbar (pin it from the puzzle-piece menu) to scan the current page.
- **Content scripts**: rebuilt on save and re-injected. Refresh the tab if state looks stale.
- **Background service worker**: rebuilt on save, and the extension reloads.
- `o` + Enter in the terminal reopens the browser if you closed it.
- The dev browser uses a persistent profile in `.chrome-profile/` (gitignored), so logins and `chrome.storage` survive restarts. Delete the folder to reset.

Logs: page DevTools for the content script and overlay, and `chrome://extensions` → Verity → "service worker" for the background.

### Loading manually (fallback)

If Chrome doesn't open, go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `.output/chrome-mv3-dev`. It still reloads on save while `pnpm dev` runs.

## Project layout

```
entrypoints/
  background.ts      service worker: toolbar button click → inject content script → send scan message
  content/
    index.ts         overlay panel (shadow DOM, isolated from page CSS)
    scan.ts          scan logic (placeholder: page stats)
    style.css        overlay styles
utils/messages.ts    message types shared by background and content
public/icon/         toolbar/extension icons
wxt.config.ts        manifest + dev browser config
```

New entrypoints (e.g. `entrypoints/sidepanel/index.html`, `entrypoints/options/index.html`) are picked up automatically and added to the manifest.

## Scripts

| Command        | What it does                                  |
| -------------- | --------------------------------------------- |
| `pnpm dev`     | Dev server + auto-launched Chrome             |
| `pnpm build`   | Production build to `.output/chrome-mv3`      |
| `pnpm zip`     | Build and zip for the Chrome Web Store        |
| `pnpm compile` | Type-check                                    |
