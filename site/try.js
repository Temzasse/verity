// "Try it" demo: analyze an article by link or pasted text with the same server API the extension uses
// (/api/extract → split into sentences here → /api/analyze), then show the findings inline.
// Also renders the live stats card (/api/stats). No dependencies; all text goes in via textContent.

const CATEGORIES = {
  propaganda: { label: 'Propaganda', color: '#dc2626' },
  misinformation: { label: 'Misinformation', color: '#ea580c' },
  'unsupported-claim': { label: 'Unsupported claim', color: '#ca8a04' },
  'loaded-language': { label: 'Loaded language', color: '#db2777' },
  'logical-fallacy': { label: 'Logical fallacy', color: '#7c3aed' },
  'missing-context': { label: 'Missing context', color: '#0891b2' },
};
const VERDICTS = {
  supported: { label: 'Supported by sources', color: '#16a34a' },
  contradicted: { label: 'Contradicted by sources', color: '#dc2626' },
  disputed: { label: 'Disputed or misleading', color: '#d97706' },
  unverifiable: { label: "Couldn't verify", color: '#64748b' },
};
const CHECKABLE = new Set(['unsupported-claim', 'misinformation', 'missing-context']);
const MIN_WORDS = 4; // same rule as the extension: shorter fragments aren't analyzed
const MAX_SENTENCES = 300;
const MAX_TEXT = 30000;
const PASTED_URL = 'pasted-text';

// Original sample texts (written for this demo; the places and people are fictional).
const EXAMPLES = {
  opinion: {
    title: 'Example: opinion column',
    text: `Brookfield's council has once again betrayed the hard-working families who keep this town alive. Their reckless new parking scheme is nothing short of daylight robbery, dreamed up by out-of-touch bureaucrats who have never had to worry about paying a bill.

Experts agree that charges like these destroy high streets within a year. Everyone in town knows the real reason for the scheme: the council needs cash to cover its own failures.

Councillor Hart claims the fees will fund new bus routes. But this is the same council that wasted thousands on a fountain nobody asked for, so why should anyone believe a word they say?

Either we stop this scheme now, or we watch every independent shop in Brookfield close its doors for good. If the charges go ahead, the town centre will be a ghost town by next summer.

It is time for ordinary people to stand up and take our town back before it is too late.`,
  },
  neutral: {
    title: 'Example: news report',
    text: `Brookfield council approved a new parking charge scheme on Tuesday by seven votes to four. The scheme introduces a fee of £1.50 per hour in the town centre's three main car parks from 1 March.

According to the council's budget papers, the charges are expected to raise about £240,000 a year. Councillor Ann Hart, who chairs the transport committee, said the money would be used to fund two new bus routes.

The Brookfield Traders' Association opposed the plan. Its chair, Tom Ellis, said members were worried that shoppers would go to out-of-town retail parks instead.

A council survey of 600 residents, published in October, found that 52 per cent supported the charges if the income was spent on public transport. The first hour will remain free on Saturdays, and blue badge holders will not pay.

The council said it would review the scheme after twelve months.`,
  },
};

const form = document.querySelector('#try-form');
if (form) initTry();
initStats();

function initTry() {
  const tabs = document.querySelectorAll('[data-try-mode]');
  const urlField = document.querySelector('#try-url');
  const textField = document.querySelector('#try-text');
  const submit = form.querySelector('button[type=submit]');
  const status = document.querySelector('#try-status');
  const result = document.querySelector('#try-result');
  let mode = 'url';
  let busy = false;

  const setMode = (next) => {
    mode = next;
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.tryMode === mode));
    urlField.hidden = mode !== 'url';
    textField.hidden = mode !== 'text';
    urlField.required = mode === 'url';
    textField.required = mode === 'text';
  };
  for (const tab of tabs) tab.addEventListener('click', () => setMode(tab.dataset.tryMode));

  for (const button of document.querySelectorAll('[data-example]')) {
    button.addEventListener('click', () => {
      const example = EXAMPLES[button.dataset.example];
      setMode('text');
      textField.value = example.text;
      void run({ title: example.title, url: PASTED_URL, paragraphs: splitParagraphs(example.text) });
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (mode === 'url') void run(null, urlField.value.trim());
    else {
      const text = textField.value.trim().slice(0, MAX_TEXT);
      const firstLine = text.split('\n')[0].trim();
      void run({ title: firstLine.length <= 120 ? firstLine : 'Pasted text', url: PASTED_URL, paragraphs: splitParagraphs(text) });
    }
  });

  async function run(article, url) {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    result.hidden = true;
    try {
      if (!article) {
        showStatus('Fetching the article…', true);
        const extracted = await api('/extract', { url });
        article = { ...extracted };
      }
      const { blocks, sentences, truncated } = splitSentences(article.paragraphs);
      if (sentences.length === 0) throw new Error('There is not enough text to analyze. Add a few full sentences.');
      showStatus(`Analyzing ${sentences.length} sentences… this usually takes 10–30 seconds.`, true);
      const response = await api('/analyze', {
        url: article.url,
        title: article.title || 'Untitled',
        byline: article.byline ?? null,
        siteName: article.siteName ?? null,
        publishedTime: article.publishedTime ?? null,
        lang: article.lang ?? 'en',
        excerpt: article.excerpt ?? null,
        isArticle: true,
        sentences: sentences.map(({ id, text, block }) => ({ id, text, block })),
      });
      status.hidden = true;
      renderResult(result, article, blocks, sentences, response, truncated);
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      void initStats();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : String(err), false, true);
    } finally {
      busy = false;
      submit.disabled = false;
    }
  }

  function showStatus(message, loading = false, error = false) {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle('is-loading', loading);
    status.classList.toggle('is-error', error);
  }
}

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Paragraphs → display blocks of sentence pieces; pieces with enough words get an id and are analyzed. */
function splitSentences(paragraphs) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const blocks = [];
  const sentences = [];
  let truncated = false;
  paragraphs.forEach((paragraph, block) => {
    const pieces = [];
    for (const { segment } of segmenter.segment(paragraph)) {
      const text = segment.trim();
      if (!text) continue;
      const piece = { text, id: null, block };
      if (text.split(/\s+/).length >= MIN_WORDS) {
        if (sentences.length < MAX_SENTENCES) {
          piece.id = sentences.length;
          sentences.push(piece);
        } else truncated = true;
      }
      pieces.push(piece);
    }
    blocks.push(pieces);
  });
  return { blocks, sentences, truncated };
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach the analysis server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error ?? `The analysis server returned an error (${res.status}).`);
  return data;
}

// ---------- Result view ----------

function renderResult(root, article, blocks, sentences, response, truncated) {
  const findings = response.findings
    .filter((f) => sentences[f.sentenceId] && CATEGORIES[f.category])
    .sort((a, b) => a.sentenceId - b.sentenceId);
  const flaggedSentences = new Set(findings.map((f) => f.sentenceId)).size;
  const state = { article, sentences, findings, active: -1, votes: new Map(), checks: new Map() };

  const summary =
    findings.length === 0
      ? `No manipulation techniques found in ${sentences.length} sentences. That's the expected result for neutral, well-sourced writing.`
      : `${flaggedSentences} of ${sentences.length} sentences flagged, ${findings.length} finding${findings.length === 1 ? '' : 's'}.`;
  const topCategories = Object.entries(
    findings.reduce((acc, f) => ({ ...acc, [f.category]: (acc[f.category] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);

  const head = el('div', 'try-head', [
    el('div', null, [
      el('h3', 'try-title', article.title || 'Untitled'),
      el('p', 'try-meta', [article.siteName, article.byline].filter(Boolean).join(' · ') || (article.url === PASTED_URL ? 'Pasted text' : article.url)),
    ]),
    el('p', 'try-summary', summary),
    ...(topCategories.length
      ? [el('div', 'try-cats', topCategories.map(([c, n]) => chip(c, `${CATEGORIES[c].label} ${n}`)))]
      : []),
    ...(truncated ? [el('p', 'try-note', `Long article: only the first ${MAX_SENTENCES} sentences were analyzed.`)] : []),
  ]);

  const text = el('div', 'try-article');
  for (const pieces of blocks) {
    const p = el('p');
    pieces.forEach((piece, i) => {
      if (i) p.append(' ');
      p.append(renderSentence(piece, findings, state));
    });
    text.append(p);
  }

  const list = el('div', 'try-findings');
  if (findings.length === 0) {
    list.append(
      el('div', 'try-empty', [
        el('p', 'try-empty-title', 'Nothing flagged'),
        el('p', null, 'Verity only flags clear instances of manipulation, so neutral reporting should come back clean.'),
      ]),
    );
  }
  findings.forEach((f, i) => list.append(renderCard(f, i, state)));

  state.text = text;
  state.list = list;
  root.replaceChildren(head, el('div', 'try-grid', [text, list]));
}

function renderSentence(piece, findings, state) {
  const own = piece.id === null ? [] : findings.map((f, i) => [f, i]).filter(([f]) => f.sentenceId === piece.id);
  if (own.length === 0) return piece.text;

  // Locate each finding's quoted words; if any can't be placed (or overlap), mark the whole sentence.
  const ranges = [];
  let whole = false;
  for (const [f, i] of own) {
    const at = f.quote ? piece.text.indexOf(f.quote) : -1;
    if (at < 0) {
      whole = true;
      break;
    }
    const range = { start: at, end: at + f.quote.length, items: [i] };
    const overlap = ranges.find((r) => range.start < r.end && r.start < range.end);
    if (overlap) overlap.items.push(i);
    else ranges.push(range);
  }
  if (whole) return mark(piece.text, own.map(([, i]) => i), state);

  ranges.sort((a, b) => a.start - b.start);
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const r of ranges) {
    frag.append(piece.text.slice(pos, r.start), mark(piece.text.slice(r.start, r.end), r.items, state));
    pos = r.end;
  }
  frag.append(piece.text.slice(pos));
  return frag;
}

function mark(text, items, state) {
  const m = el('mark', 'try-mark', text);
  m.style.setProperty('--cat', CATEGORIES[state.findings[items[0]].category].color);
  m.dataset.items = items.join(',');
  m.tabIndex = 0;
  const open = () => activate(items[0], state, 'card');
  m.addEventListener('click', open);
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return m;
}

/** Highlights a finding in both columns and scrolls the other column to it. */
function activate(index, state, scrollTo) {
  state.active = index;
  for (const card of state.list.querySelectorAll('.try-card')) card.classList.toggle('is-active', card.dataset.index === String(index));
  for (const m of state.text.querySelectorAll('.try-mark')) m.classList.toggle('is-active', m.dataset.items.split(',').includes(String(index)));
  const target =
    scrollTo === 'card'
      ? state.list.querySelector(`.try-card[data-index="${index}"]`)
      : [...state.text.querySelectorAll('.try-mark')].find((m) => m.dataset.items.split(',').includes(String(index)));
  target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderCard(finding, index, state) {
  const card = el('article', 'try-card');
  card.dataset.index = String(index);
  card.style.setProperty('--cat', CATEGORIES[finding.category].color);
  card.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    activate(index, state, 'text');
  });
  fillCard(card, finding, index, state);
  return card;
}

function fillCard(card, finding, index, state) {
  const label = CATEGORIES[finding.category].label;
  const showTechnique = finding.technique && finding.technique.toLowerCase() !== label.toLowerCase();
  const quote = finding.quote || state.sentences[finding.sentenceId].text;
  card.replaceChildren(
    el('div', 'try-card-head', [chip(finding.category), confidence(finding.confidence)]),
    ...(showTechnique ? [el('p', 'try-technique', finding.technique)] : []),
    el('blockquote', 'try-quote', `“${quote.length > 160 ? `${quote.slice(0, 157)}…` : quote}”`),
    el('p', 'try-rationale', finding.rationale),
    ...(CHECKABLE.has(finding.category) ? [factCheckSection(card, finding, index, state)] : []),
    feedbackRow(card, finding, index, state),
  );
}

function confidence(value) {
  const pct = Math.round(value * 100);
  const wrap = el('span', 'try-confidence', [el('span', 'try-confidence-bar'), `${pct}%`]);
  wrap.title = `Confidence ${pct}%`;
  wrap.style.setProperty('--pct', `${pct}%`);
  return wrap;
}

function feedbackRow(card, finding, index, state) {
  const vote = state.votes.get(index);
  const row = el('div', 'try-feedback');
  if (vote?.status === 'sending' || vote?.status === 'sent') {
    row.append(
      el('span', 'try-feedback-label', vote.status === 'sending' ? 'Sending…' : vote.vote === 'agree' ? 'Thanks! Marked as a fair flag.' : 'Thanks! Marked as a false flag.'),
    );
    return row;
  }
  const button = (choice, text) => {
    const b = el('button', 'try-vote', text);
    b.type = 'button';
    b.addEventListener('click', async () => {
      state.votes.set(index, { status: 'sending', vote: choice });
      fillCard(card, finding, index, state);
      try {
        await api('/feedback', {
          vote: choice,
          url: state.article.url,
          sentence: state.sentences[finding.sentenceId].text,
          ...(finding.quote ? { quote: finding.quote } : {}),
          category: finding.category,
          technique: finding.technique || CATEGORIES[finding.category].label,
          confidence: finding.confidence,
          source: 'smart',
          client: 'web',
        });
        state.votes.set(index, { status: 'sent', vote: choice });
        void initStats();
      } catch (err) {
        state.votes.set(index, { status: 'error', error: err.message });
      }
      fillCard(card, finding, index, state);
    });
    return b;
  };
  row.append(el('span', 'try-feedback-label', 'Is this flag right?'), button('agree', 'Yes'), button('disagree', 'No'));
  if (vote?.status === 'error') row.append(el('p', 'try-error', vote.error));
  return row;
}

function factCheckSection(card, finding, index, state) {
  const check = state.checks.get(index);
  const section = el('div', 'try-check');
  if (!check || check.status === 'error') {
    if (check) section.append(el('p', 'try-error', check.error));
    const b = el('button', 'button button-secondary try-check-button', check ? 'Retry fact-check' : 'Check with web sources');
    b.type = 'button';
    b.addEventListener('click', async () => {
      state.checks.set(index, { status: 'loading' });
      fillCard(card, finding, index, state);
      try {
        const context = state.sentences
          .filter((s) => Math.abs(s.id - finding.sentenceId) <= 2)
          .map((s) => s.text)
          .join(' ');
        const data = await api('/fact-check', {
          url: state.article.url,
          title: state.article.title || 'Untitled',
          publishedTime: state.article.publishedTime ?? null,
          claim: state.sentences[finding.sentenceId].text,
          context,
        });
        state.checks.set(index, { status: 'done', data });
      } catch (err) {
        state.checks.set(index, { status: 'error', error: err.message });
      }
      fillCard(card, finding, index, state);
    });
    section.append(b);
  } else if (check.status === 'loading') {
    section.append(el('p', 'try-checking', 'Searching the web for sources…'));
  } else {
    const { verdict, summary, sources } = check.data;
    const v = VERDICTS[verdict] ?? VERDICTS.unverifiable;
    const badge = el('span', 'chip', v.label);
    badge.style.setProperty('--cat', v.color);
    section.append(badge);
    if (summary) section.append(el('p', 'try-rationale', summary));
    const links = el('ul', 'try-sources');
    for (const s of sources ?? []) {
      let host;
      try {
        const u = new URL(s.url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
        host = u.hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      const a = el('a', null, s.title || host);
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      links.append(el('li', null, [a, el('span', 'try-host', host)]));
    }
    if (links.children.length) section.append(links);
  }
  return section;
}

// ---------- Live stats ----------

async function initStats() {
  const root = document.querySelector('#live-stats');
  if (!root) return;
  let stats;
  try {
    const res = await fetch('/api/stats', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    stats = await res.json();
  } catch {
    root.querySelector('[data-stat-note]').textContent = 'Live numbers are unavailable right now.';
    return;
  }
  const set = (name, value) => {
    const node = root.querySelector(`[data-stat="${name}"]`);
    if (node) node.textContent = value;
  };
  const votes = stats.feedback.agree + stats.feedback.disagree;
  set('analyses', fmt(stats.analyses));
  set('sentences', fmt(stats.sentences));
  set('findings', fmt(stats.findings));
  set('votes', fmt(votes));
  set('false-flags', votes ? `${Math.round((stats.feedback.disagree / votes) * 100)}%` : '–');
  const since = new Date(stats.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  root.querySelector('[data-stat-note]').textContent =
    votes < 10
      ? `Counted since ${since}. Too few reader votes yet for a meaningful false-flag rate: rate a few findings above to add yours.`
      : `Counted since ${since}. False-flag rate = share of reader votes saying a flag was wrong.`;
}

const fmt = (n) => n.toLocaleString('en-GB');

// ---------- Helpers ----------

function chip(category, text) {
  const c = el('span', 'chip', text ?? CATEGORIES[category].label);
  c.style.setProperty('--cat', CATEGORIES[category].color);
  return c;
}

function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (children === undefined) return node;
  if (typeof children === 'string') node.textContent = children;
  else node.append(...children);
  return node;
}
