import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { AnalysisError } from './claude.ts';

/** Article fetched by URL for the landing page's "Try it" demo. Sentence splitting happens in the browser. */
export type ExtractedArticle = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  lang: string;
  excerpt: string | null;
  paragraphs: string[];
};

const MAX_HTML_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 10_000;

/**
 * How article pages are fetched for the "Try it" demo, set with SCRAPER in server/.env:
 *  - "contextdev" (default): Context.dev's scrape API (JS rendering, rotating proxies, so fewer bot blocks).
 *    Needs CONTEXT_DEV_API_KEY; falls back to "direct" if the key is missing or the scrape fails.
 *  - "direct": fetch the page from this server (free, but many news sites block data-centre IPs).
 */
const SCRAPER = process.env.SCRAPER === 'direct' ? 'direct' : 'contextdev';
const CONTEXT_DEV_API_KEY = process.env.CONTEXT_DEV_API_KEY;
const CONTEXT_DEV_TIMEOUT_MS = Number(process.env.CONTEXT_DEV_TIMEOUT_MS ?? 45_000);
if (SCRAPER === 'contextdev' && !CONTEXT_DEV_API_KEY) {
  console.warn('[server] SCRAPER=contextdev but CONTEXT_DEV_API_KEY is not set: fetching pages directly instead.');
}

export async function extractArticle(rawUrl: string): Promise<ExtractedArticle> {
  const requested = parseUrl(rawUrl);
  await assertPublicHost(requested.hostname);
  if (SCRAPER === 'contextdev' && CONTEXT_DEV_API_KEY) {
    try {
      const page = await fetchWithContextDev(requested, CONTEXT_DEV_API_KEY);
      return parseArticle(page.url, page.html);
    } catch (err) {
      // Scrape error, or the scraped page had no usable article (e.g. a bot check): try ourselves once.
      console.warn(`[server] Context.dev: ${err instanceof Error ? err.message : err}; trying a direct fetch`);
    }
  }
  const page = await fetchDirect(requested);
  return parseArticle(page.url, page.html);
}

/** Context.dev scrape API: https://docs.context.dev/api-reference/web-scraping/scrape */
async function fetchWithContextDev(url: URL, apiKey: string): Promise<{ url: URL; html: string }> {
  const res = await fetch('https://api.context.dev/v1/web/scrape', {
    method: 'POST',
    signal: AbortSignal.timeout(CONTEXT_DEV_TIMEOUT_MS + 10_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: url.toString(),
      formats: { html: true },
      sharedParams: { dismissCookies: true, dismissPopups: true },
      timeoutOpts: { milliseconds: CONTEXT_DEV_TIMEOUT_MS, behavior: 'fail' },
      // Zero data retention needs to be enabled for the Context.dev organization first.
      ...(process.env.CONTEXT_DEV_ZDR === 'enabled' ? { zdr: 'enabled' } : {}),
    }),
  });
  const data = (await res.json().catch(() => null)) as {
    url?: string;
    html?: { success: boolean | null; data: string | null; error_code?: string; message?: string };
    error_code?: string;
    message?: string;
  } | null;
  if (!res.ok || !data) throw new Error(`HTTP ${res.status} ${data?.error_code ?? ''} ${data?.message ?? ''}`.trim());
  if (!data.html?.success || !data.html.data) {
    throw new Error(`no HTML (${data.html?.error_code ?? 'unknown'}: ${data.html?.message ?? ''})`);
  }
  let finalUrl = url;
  try {
    if (data.url) finalUrl = new URL(data.url);
  } catch {}
  console.log(`[server] scraped with Context.dev: ${finalUrl}`);
  return { url: finalUrl, html: data.html.data };
}

async function fetchDirect(start: URL): Promise<{ url: URL; html: string }> {
  let url = start;
  let res: Response | null = null;
  // Follow redirects by hand so every hop gets the private-address check.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // A browser-like UA: many news sites refuse unknown clients.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en;q=0.9',
      },
    }).catch(() => {
      throw new AnalysisError("Couldn't load that page. Check the link, or paste the article text instead.", 422);
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) break;
    url = parseUrl(new URL(location, url).toString());
    res = null;
  }
  if (!res) throw new AnalysisError('That page redirects too many times.', 422);
  if (!res.ok) {
    throw new AnalysisError(`The site refused the request (HTTP ${res.status}). Paste the article text instead.`, 422);
  }
  if (!(res.headers.get('content-type') ?? '').includes('html')) {
    throw new AnalysisError("That link isn't a web page. Paste the article text instead.", 422);
  }
  return { url, html: await readLimited(res) };
}

function parseArticle(url: URL, html: string): ExtractedArticle {
  const { document } = parseHTML(html);
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute('content')?.trim() || null;
  const lang = document.documentElement.getAttribute('lang') || 'en';
  const publishedTime = meta('meta[property="article:published_time"]') ?? meta('meta[name="date"]');
  // Readability mutates the document; it only needs a DOM-like tree, which linkedom provides.
  const article = new Readability(document as unknown as Document, { charThreshold: 300 }).parse();
  if (!article?.content) {
    throw new AnalysisError("Couldn't find an article on that page. Paste the article text instead.", 422);
  }

  const { document: body } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
  const paragraphs = [...body.querySelectorAll('p, li, blockquote, h2, h3, h4')]
    .filter((el) => !el.querySelector('p, li, blockquote')) // leaf blocks only, so text isn't counted twice
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 0);
  // Bot-check interstitials ("Verifying your device", "Just a moment…") parse as tiny "articles".
  const words = paragraphs.join(' ').split(' ').length;
  if (words < 120) {
    throw new AnalysisError(
      "That site blocked automatic access or the page has little text. Open the article in your browser and paste its text instead.",
      422,
    );
  }

  return {
    url: url.toString(),
    title: (article.title ?? '').trim() || url.hostname,
    byline: article.byline?.trim() || null,
    siteName: article.siteName?.trim() || url.hostname.replace(/^www\./, ''),
    publishedTime: article.publishedTime ?? publishedTime,
    lang,
    excerpt: article.excerpt?.trim() || null,
    paragraphs,
  };
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AnalysisError("That doesn't look like a link. It should start with https://", 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AnalysisError('Only http and https links work.', 400);
  if (url.username || url.password) throw new AnalysisError('Links with credentials are not supported.', 400);
  if (url.port && url.port !== '80' && url.port !== '443') throw new AnalysisError('Links with custom ports are not supported.', 400);
  url.hash = ''; // #fragments don't change the page
  return url;
}

/** Blocks requests to the VPS itself or private networks (SSRF), checking every resolved address. */
async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new AnalysisError("Couldn't find that website. Check the link.", 422);
  if (addresses.some(isPrivate)) throw new AnalysisError('That address is not allowed.', 400);
}

function isPrivate(address: string): boolean {
  const a = address.toLowerCase();
  if (a.startsWith('::ffff:')) return isPrivate(a.slice(7));
  if (isIP(a) === 4) {
    const [p, q] = a.split('.').map(Number) as [number, number];
    return (
      p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224
    );
  }
  return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_HTML_BYTES) {
      await reader.cancel();
      break; // a truncated page usually still contains the article
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
