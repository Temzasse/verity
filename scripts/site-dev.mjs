#!/usr/bin/env node
// Local dev server for the landing page (site/): static files, /api/* proxied to the analysis server
// (like Caddy in production), and live reload when anything in site/ changes. No dependencies.
//   node scripts/site-dev.mjs   → http://localhost:4321
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'site');
const PORT = Number(process.env.SITE_PORT ?? 4321);
const API = new URL(process.env.SITE_API ?? 'http://127.0.0.1:8787');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Pages get a tiny script that reloads them (CSS changes swap the stylesheet without a reload).
const RELOAD = `<script>
new EventSource('/__reload').onmessage = (e) => {
  if (e.data.endsWith('.css')) {
    for (const l of document.querySelectorAll('link[rel=stylesheet]')) l.href = l.href.split('?')[0] + '?' + Date.now();
  } else location.reload();
};
</script>`;

const clients = new Set();
let timer;
watch(ROOT, { recursive: true }, (_event, file) => {
  if (!file || file.startsWith('downloads')) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const res of clients) res.write(`data: ${file}\n\n`);
  }, 50);
});

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const upstream = request(
      { host: API.hostname, port: API.port, method: req.method, path: url.pathname.slice(4) + url.search, headers: { ...req.headers, host: API.host } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Analysis server is not running' }));
    });
    req.pipe(upstream);
    return;
  }

  let path = normalize(decodeURIComponent(url.pathname));
  if (path.endsWith('/')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (path.startsWith('/downloads/')) headers['Content-Disposition'] = 'attachment';

  if (type.startsWith('text/html')) {
    import('node:fs/promises').then(async ({ readFile }) => {
      const html = await readFile(file, 'utf8');
      res.writeHead(200, headers);
      res.end(html.includes('</body>') ? html.replace('</body>', `${RELOAD}</body>`) : html + RELOAD);
    });
    return;
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`[site] Landing page on http://localhost:${PORT} (live reload, /api → ${API.origin})`);
});
