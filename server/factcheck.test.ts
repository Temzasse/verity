import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { renderFactCheckResults } from '../site/fact-check-view.js';
import { VERDICTS, type FactCheckRequest } from '../utils/analysis.ts';

// Exercise the public HTTP endpoint; only external HTTP services are simulated.
const cacheDir = await mkdtemp(join(tmpdir(), 'verity-factcheck-'));
process.env.VERITY_CACHE_DIR = cacheDir;
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.GOOGLE_FACT_CHECK_API_KEY = 'test-key';
process.env.SCRAPER = 'direct';
process.env.VERIFIER = 'none';
process.env.VERITY_TOKEN = '';
process.env.RATE_FACTCHECK_PER_HOUR = '1000';

const realFetch = globalThis.fetch;
let replies: unknown[] = [];
let googleClaims: unknown[] = [];
let googleStatus = 200;
const articles = new Map<string, { text: string; status: number }>();

function message(text: string, citations: unknown[] = []) {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'test-model',
    content: [{ type: 'text', text, citations }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function assessment(verdict: string, summary: string, urls: string[] = [], reviews: unknown[] = []) {
  return message(`<assessment>${JSON.stringify({ verdict, summary, evidenceUrls: urls, reviews })}</assessment>`,
    urls.map((url) => ({ type: 'web_search_result_location', url, title: 'Official figures', cited_text: summary,
      encrypted_index: 'test' })));
}

globalThis.fetch = (async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.hostname === 'api.anthropic.com') {
    const reply = await replies.shift();
    assert.ok(reply, 'Unexpected model request');
    return Response.json(reply);
  }
  if (url.hostname === 'factchecktools.googleapis.com') {
    return Response.json({ claims: googleClaims }, { status: googleStatus });
  }
  const article = articles.get(request.url);
  assert.ok(article, `Unexpected external URL: ${request.url}`);
  return new Response(article.text, { status: article.status, headers: { 'Content-Type': 'text/html' } });
}) as typeof fetch;

const { server } = await import('./index.ts');
let baseUrl: string;
let requestId = 0;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  replies = [];
  googleClaims = [];
  googleStatus = 200;
  articles.clear();
  process.env.GOOGLE_FACT_CHECK_API_KEY = 'test-key';
  delete process.env.FACT_CHECK_HEARTBEAT_MS;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  globalThis.fetch = realFetch;
  await rm(cacheDir, { recursive: true, force: true });
});

async function check(sentence: string, overrides: Partial<FactCheckRequest> = {}) {
  const res = await fetch(`${baseUrl}/fact-check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://example.org/article/${++requestId}`, title: 'An article',
      publishedTime: '2026-01-20T00:00:00Z', claim: sentence, context: sentence, version: 2, ...overrides }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}

test('one sentence returns independently evidenced results for both factual claims', async () => {
  googleClaims = [];
  replies = [
    message(JSON.stringify({ claims: ['Unemployment doubled in 2025.', 'Violent crime rose 40% in 2025.'] })),
    assessment('supported', 'Unemployment rose from 4% to 8%.', ['https://statistics.example/jobs']),
    assessment('contradicted', 'Violent crime rose 5%, rather than 40%.', ['https://statistics.example/crime']),
  ];
  const data = await check('Unemployment doubled in 2025, and violent crime rose 40% in 2025.');
  assert.deepEqual(data.claims.map((c: { claim: string; verdict: string }) => [c.claim, c.verdict]), [
    ['Unemployment doubled in 2025.', 'supported'],
    ['Violent crime rose 40% in 2025.', 'contradicted'],
  ]);
  assert.equal(data.claims[0].sources[0].url, 'https://statistics.example/jobs');
  assert.equal(data.claims[1].sources[0].url, 'https://statistics.example/crime');
  assert.equal(data.verdict, undefined, 'No sentence-wide verdict may mask different claim results');
  const { document } = parseHTML('<html><body></body></html>');
  const rendered = renderFactCheckResults(data, VERDICTS, document as unknown as Document);
  assert.equal(rendered.querySelectorAll('.claim-result').length, 2);
  assert.match(rendered.textContent!, /Supported by sources/);
  assert.match(rendered.textContent!, /Contradicted by sources/);
});

test('a read, applicable published review contributes evidence with its original rating and attribution', async () => {
  const url = 'https://203.0.113.10/review';
  googleClaims = [{ text: 'Unemployment doubled in 2025.', claimant: 'Example speaker', claimDate: '2026-01-01T00:00:00Z',
    claimReview: [{ publisher: { name: 'Example Fact Checker', site: 'example.org' }, url,
      title: 'Checking unemployment figures', reviewDate: '2026-01-10T00:00:00Z', textualRating: 'Mostly false' }] }];
  const explanation = 'Official figures show unemployment rose from 4% to 5%, rather than doubling.';
  articles.set(url, { status: 200, text: `<html><head><title>Checking unemployment figures</title></head><body><article><h1>Checking unemployment figures</h1><p>${explanation}</p><p>${'This investigation compares the original official employment statistics for the same country and year. '.repeat(15)}</p></article></body></html>` });
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    assessment('contradicted', explanation, [], [{ id: 'review-1', applicable: true, explanation: 'Same country, year and unemployment measure.' }])];
  const data = await check('Unemployment doubled in 2025.');
  assert.equal(data.claims[0].verdict, 'contradicted');
  assert.equal(data.claims[0].sources[0].url, url);
  assert.equal(data.claims[0].reviews[0].status, 'used');
  assert.equal(data.claims[0].reviews[0].publisher, 'Example Fact Checker');
  assert.equal(data.claims[0].reviews[0].rating, 'Mostly false');
  assert.equal(data.claims[0].reviews[0].reviewDate, '2026-01-10T00:00:00Z');
});

test('mixed evidence cannot be asserted when only one inspected source is provided', async () => {
  googleClaims = [];
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    assessment('mixed', 'Sources disagree.', ['https://statistics.example/jobs'])];
  const data = await check('Unemployment doubled in 2025.');
  assert.equal(data.claims[0].verdict, 'unverifiable');
  assert.doesNotMatch(data.claims[0].summary, /Sources disagree/);
});

test('an unread review cannot justify a verdict even if the model marks it applicable and cites its URL', async () => {
  const url = 'https://203.0.113.10/blocked-review';
  googleClaims = [{ text: 'Unemployment doubled in 2025.', claimReview: [{
    publisher: { name: 'Example Fact Checker' }, url, textualRating: 'False' }] }];
  articles.set(url, { text: 'Access denied', status: 403 });
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    assessment('contradicted', 'The publisher rated it false.', [url + '?utm_source=search#evidence'],
      [{ id: 'review-1', applicable: true, explanation: 'Same assertion.' }])];
  const data = await check('Unemployment doubled in 2025.');
  assert.equal(data.claims[0].verdict, 'unverifiable');
  assert.equal(data.claims[0].reviews[0].status, 'unavailable');
  assert.deepEqual(data.claims[0].sources, []);
});

test('an overlong compound assertion is not silently reported as having no factual claims', async () => {
  replies = [message(JSON.stringify({ claims: [], tooManyClaims: true }))];
  const res = await fetch(`${baseUrl}/fact-check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/compound', title: 'Compound sentence',
      publishedTime: null, claim: 'A long sentence with many distinct assertions.', context: '' }),
  });
  assert.equal(res.status, 422);
});

test('web research works without a Google key', async () => {
  delete process.env.GOOGLE_FACT_CHECK_API_KEY;
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    assessment('supported', 'Official figures confirm the increase.', ['https://statistics.example/jobs'])];
  const data = await check('Unemployment doubled in 2025.');
  assert.equal(data.claims[0].verdict, 'supported');
  assert.equal(data.claims[0].reviewSearchStatus, 'not-configured');
});

test('a failed Google lookup falls back to web research and is retried rather than cached', async () => {
  const claim = 'Unemployment doubled in 2025.';
  const response = () => [message(JSON.stringify({ claims: [claim] })),
    assessment('supported', 'Official figures confirm the increase.', ['https://statistics.example/jobs'])];
  replies = [...response(), ...response()];
  googleStatus = 503;
  const overrides = { url: 'https://example.org/retry-lookup' };
  const first = await check(claim, overrides);
  assert.equal(first.claims[0].verdict, 'supported');
  assert.equal(first.claims[0].reviewSearchStatus, 'unavailable');
  googleStatus = 200;
  const second = await check(claim, overrides);
  assert.equal(second.cached, false);
  assert.equal(second.claims[0].reviewSearchStatus, 'complete');
  const third = await check(claim, overrides);
  assert.equal(third.cached, true);
});

test('uncited search hits and invented evidence URLs cannot establish a verdict', async () => {
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    message('<assessment>{"verdict":"contradicted","summary":"This is false.","evidenceUrls":["https://invented.example/proof"],"reviews":[]}</assessment>')];
  const data = await check('Unemployment doubled in 2025.');
  assert.equal(data.claims[0].verdict, 'unverifiable');
  assert.deepEqual(data.claims[0].sources, []);
});

test('unresolved disagreement retains both cited sources and a mixed-evidence result', async () => {
  const summary = 'Two investigations reach different conclusions for the same period and measure.';
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    assessment('mixed', summary, ['https://statistics.example/jobs', 'https://research.example/jobs'])];
  const data = await check('Unemployment doubled in 2025.');
  assert.equal(data.claims[0].verdict, 'mixed');
  assert.equal(data.claims[0].summary, summary);
  assert.equal(data.claims[0].sources.length, 2);
});

test('opinions alone produce no factual verdict', async () => {
  replies = [message(JSON.stringify({ claims: [] }))];
  const data = await check('This is the most beautiful city.');
  assert.deepEqual(data.claims, []);
  assert.equal(data.searches, 0);
});

test('publication dates are part of the fact-check cache identity', async () => {
  const response = (verdict: string) => [message(JSON.stringify({ claims: ['Unemployment has doubled.'] })),
    assessment(verdict, 'Figures for the relevant publication date.', ['https://statistics.example/jobs'])];
  replies = [...response('supported'), ...response('contradicted')];
  const first = await check('Unemployment has doubled.', { url: 'https://example.org/updated-article', publishedTime: '2025-01-01' });
  const second = await check('Unemployment has doubled.', { url: 'https://example.org/updated-article', publishedTime: '2026-01-01' });
  assert.equal(first.claims[0].verdict, 'supported');
  assert.equal(second.claims[0].verdict, 'contradicted');
  assert.equal(second.cached, false);
});

test('the initial technique label stays neutral before any factual verification', async () => {
  const res = await fetch(`${baseUrl}/techniques`);
  const techniques = await res.json();
  assert.equal(techniques['false-claim'].label, 'Claim to check');
});

test('installed clients without a response version still receive their single-claim result contract', async () => {
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    assessment('supported', 'Official figures confirm the increase.', ['https://statistics.example/jobs'])];
  const res = await fetch(`${baseUrl}/fact-check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/legacy-client', title: 'Legacy client', publishedTime: null,
      claim: 'Unemployment doubled in 2025.', context: '' }),
  });
  const data = await res.json();
  assert.equal(data.verdict, 'supported');
  assert.equal(data.summary, 'Official figures confirm the increase.');
  assert.equal(data.sources[0].url, 'https://statistics.example/jobs');
});

test('a delayed fact-check sends a heartbeat before research finishes and still returns valid JSON', async () => {
  process.env.FACT_CHECK_HEARTBEAT_MS = '20';
  let release!: (reply: unknown) => void;
  replies = [new Promise((resolve) => { release = resolve; }),
    assessment('supported', 'Official figures confirm the increase.', ['https://statistics.example/jobs'])];
  try {
    const res = await fetch(`${baseUrl}/fact-check`, {
      method: 'POST', signal: AbortSignal.timeout(2000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, url: 'https://example.org/delayed', title: 'Delayed check', publishedTime: null,
        claim: 'Unemployment doubled in 2025.', context: '' }),
    });
    const reader = res.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /^\s+$/);
    release(message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })));
    let text = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    assert.equal(JSON.parse(text).claims[0].verdict, 'supported');
  } finally {
    release(message(JSON.stringify({ claims: [] })));
  }
});

test('errors after a heartbeat remain explicit errors in the JSON response', async () => {
  process.env.FACT_CHECK_HEARTBEAT_MS = '20';
  let release!: (reply: unknown) => void;
  replies = [new Promise((resolve) => { release = resolve; })];
  try {
    const res = await fetch(`${baseUrl}/fact-check`, {
      method: 'POST', signal: AbortSignal.timeout(2000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, url: 'https://example.org/delayed-error', title: 'Delayed error', publishedTime: null,
        claim: 'Unemployment doubled in 2025.', context: '' }),
    });
    release(message('Not a valid claim-extraction response'));
    const data = await res.json();
    assert.equal(data.errorStatus, 502);
    assert.ok(data.error);
    assert.equal(data.claims, undefined);
  } finally {
    release(message(JSON.stringify({ claims: [] })));
  }
});

test('legacy clients receive their existing disputed verdict for a mixed-evidence result', async () => {
  replies = [message(JSON.stringify({ claims: ['Unemployment doubled in 2025.'] })),
    assessment('mixed', 'Applicable sources disagree.', ['https://statistics.example/jobs', 'https://research.example/jobs'])];
  const data = await check('Unemployment doubled in 2025.', { version: undefined });
  assert.equal(data.verdict, 'disputed');
  assert.equal(data.claims[0].verdict, 'mixed');
});
