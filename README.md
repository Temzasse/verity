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

This starts the extension dev server, the analysis server (see below) and the landing page (http://localhost:4321, live reload, `/api` proxied to the local server) in one terminal, with `[ext]` / `[server]` / `[site]` prefixed logs. WXT builds to `.output/chrome-mv3-dev` and opens a separate Chrome window with the extension already loaded. Run them separately with `pnpm dev:ext` and `pnpm server`.

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
- **Techniques:** a fixed list of 19 techniques (`TECHNIQUES` in `utils/analysis.ts`, based on the SemEval-2020 propaganda techniques). Each belongs to exactly one category; the analysis must pick a technique id and the category follows from it. Definitions are shown in the tooltip and on the website (`GET /techniques`), and the on-device model uses the same ids.
- **Confidence check:** with `TYPESAFE_API_KEY` set, every Smart analysis finding is re-checked by TypeSafe's Jev decision model (`server/verify.ts`, with the article as context). It asks per finding whether an expert would call it a fair example of the technique (`fair`, shown by default), whether the passage is manipulative at all, which category fits best, and the stricter first-version question; `JEV_SCORE` picks which becomes the finding's `confidence` and all are logged side by side and stored in `checks`; the analysis model's own value is kept as `aiConfidence` and shown on hover. Per-finding results are logged as `[jev]` lines. Raw and checked findings are cached separately, so enabling it re-checks cached pages without re-analyzing them.
- **Scraping ("Try it" links):** `SCRAPER` in `server/.env` picks how `/extract` fetches pages: `contextdev` (default, [Context.dev](https://www.context.dev/) scrape API, needs `CONTEXT_DEV_API_KEY`) or `direct` (fetched from the server itself). A failed Context.dev scrape or a missing key falls back to `direct`.
- **Other endpoints:** `POST /extract` fetches an article by URL for the landing page's "Try it" demo (blocks private addresses, follows redirects by hand), `POST /feedback` records a reader's vote on a finding (raw votes in `server/.cache/feedback.jsonl`), and `GET /stats` returns scan counts and the reader-reported false-flag rate shown on the landing page.

## Quick findings (on-device model)

Each scan also runs a small model in the browser, so first results show up before Claude answers. These are labelled **Quick** in the panel and drawn with a dotted underline.

- **Model:** `Xenova/all-MiniLM-L6-v2` sentence embeddings (~23 MB) via Transformers.js, on WebGPU when available, otherwise WASM. It runs in an offscreen document (`entrypoints/offscreen/`). The model downloads from Hugging Face on first use and is then cached; page text never leaves the browser for this step.
- **How it classifies:** compares each sentence with example sentences per technique in `entrypoints/offscreen/exemplars.ts`, and a word list of charged wording in `quick.ts`. Add examples there to improve it. Thresholds are at the top of `quick.ts`.
- **Merging:** once Claude's analysis arrives, Quick findings on sentences Claude also flagged are folded into Claude's findings (tagged "Also on-device"); the rest stay under "Quick findings".
- The ONNX Runtime WASM files are copied into the build (`ort/`) by a hook in `wxt.config.ts`, because MV3 extensions can't load code from a CDN.

## Deployment (Hostinger VPS)

The landing page (`site/`) and the analysis server run on one VPS with Docker Compose: Caddy serves the page with automatic HTTPS and proxies `/api/*` to the server.

1. In `.env` set `VERITY_DOMAIN` (domain whose A record points at the VPS) and `VPS_HOST` (e.g. `root@203.0.113.10`). Optional `VERITY_ALIASES="www.example.com other.host"` serves extra hostnames too (quote it: the file is sourced by bash).
2. Make sure `server/.env` has the production API key and budget (it is copied to the VPS).
3. Deploy:

```bash
pnpm deploy:vps
```

This builds the extension zip for `https://<domain>/api` (`pnpm release`), copies the stack to `/opt/verity` over SSH and runs `docker compose up -d --build`. Re-run it to ship updates.

- Try the stack locally: `pnpm release example.test && VERITY_DOMAIN=:80 docker compose up --build`, then open http://localhost.
- Hero video: put the clip in `site/assets/hero.mp4` and swap the placeholder in `site/index.html` (instructions in the comment there).
- To use Hostinger's AI Router instead of Anthropic directly, set `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` and `VERITY_MODEL` in `server/.env`.

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
site/                landing page (static), served by Caddy
deploy/Caddyfile     HTTPS + /api proxy config
docker-compose.yml   production stack (server + Caddy)
scripts/             release.sh (extension zip), deploy.sh (ship to the VPS)
wxt.config.ts        manifest + dev browser config
```

New entrypoints (e.g. `entrypoints/sidepanel/index.html`, `entrypoints/options/index.html`) are picked up automatically and added to the manifest.

## Scripts

| Command        | What it does                                  |
| -------------- | --------------------------------------------- |
| `pnpm dev`     | Extension dev server + Chrome + analysis server |
| `pnpm dev:ext` | Extension dev server + Chrome only            |
| `pnpm site`    | Landing page only, on :4321 with live reload  |
| `pnpm build`   | Production build to `.output/chrome-mv3`      |
| `pnpm zip`     | Build and zip for the Chrome Web Store        |
| `pnpm compile` | Type-check                                    |
| `pnpm server`  | Analysis server on :8787 (needs `server/.env`) |
| `pnpm release` | Extension zip for the production domain → `site/downloads/` |
| `pnpm deploy:vps` | Release + deploy the stack to the Hostinger VPS |
