<p align="center">
  <img src="docs/hero.webp" alt="Verity — See the whole story" width="720">
</p>

<p align="center">
  <a href="https://getverity.store"><strong>getverity.store</strong></a> · <a href="https://getverity.store/#install">Install the extension</a> · <a href="DEVELOPMENT.md">Development guide</a>
</p>

---

Verity works as a browser extension that scans an article you're reading, highlights manipulative language and questionable claims, and explains in plain words which technique is being used, so you learn *why* a sentence is trying to steer you, not just *that* it is.

## What it flags

Verity judges how something is written, not which side it takes. Arguing a point is fine; manipulating the reader is what gets flagged. Among the categories:

- **Loaded language**: emotionally charged wording used where neutral wording was available: "shameless cash grab", "invasion".
- **Propaganda techniques**: name calling, appeals to fear, flag-waving, slogans, bandwagon, casting doubt without evidence.
- **Logical fallacies**: straw man, whataboutism, false dilemma, causal oversimplification, slippery slope.
- **Unsupported claims**: numbers, events or causes stated as fact with no source: "experts say", "studies show".
- **Missing context**: technically true but misleading: cherry-picked statistics, missing baselines, one-sided framing.
- **Misinformation**: only when web sources contradict a claim. Without evidence either way, it stays an unsupported claim.

## Discussion

Analyzing text for its information content, accuracy, truthfulness, or semantic nuances using LLMs is inherently problematic: how can a black-box system provide relevant, measurable insights into a text? What is true and what is not? Which nuances should be flagged as biased or inaccurate? Which sentences should be considered misinformation or outright falsehoods, and why? How confident are we in those judgments?

A frontier language model will happily give you confidence scores for its judgments if you ask it to when analyzing a text. But what are those scores based on? Broadly speaking, LLMs predict the next token, favoring probable continuations. Asking a model to quantify its own certainty is self-referential, and the confidence scores it produces are often unrealistically high.

One way to approach this dilemma and quantitatively analyze LLM output is simply to run multiple iterations. If we ask the model to analyze an article in a fresh context each time, giving it exactly the same inputs (including the system prompt and the unaltered target text), we have a shot at comparing the results statistically. Here is an example.

In a single run, Verity might flag sentence 23 of [this BBC article](https://www.bbc.co.uk/news/articles/cwvg2l312ylqo) as an "unsourced claim" and assign the finding a confidence score of 82%. But if we repeat the same analysis across multiple fresh contexts, we see something quite interesting. Across 25 runs, the "Unsupported claim" category produces the following results:

| Category | Findings | Mean confidence | Median | Range |
|---|---:|---:|---:|---:|
| Unsupported claim | 10 | 83.5% | 83.5% | 78–87% |
| All other categories | 0 | — | — | — |

The confidence scores for those 10 findings are distributed as follows:

| Confidence | Occurrences |
|---|---:|
| 78% | 1 |
| 82% | 2 |
| 83% | 2 |
| 84% | 2 |
| 86% | 2 |
| 87% | 1 |

The same finding appeared in only 40% of runs (10/25): sentence 23, classified as `unsourced-claim`, concerning the claim that Trump had requested a pause in Ukrainian strikes to support Russian diesel supplies and ease fuel prices.

The remaining 60% of runs (15/25) returned no findings. Among the runs that did produce findings, all identified the same sentence and technique. The highlighted wording varied: eight selected "Trump had asked Ukraine to pause"; two selected parts of the stated diesel-supply rationale.

So what does a "confidence" score of roughly 83.5% actually represent if the same finding appears in only 40% of runs? Similar results appear in other experiments. This is something to consider when evaluating Verity's performance from a product development perspective. We need to address this issue carefully and communicate clearly to users what these scores mean.

## Development

Setup, the analysis server, the on-device model, deployment to the Hostinger VPS and the project layout are covered in [DEVELOPMENT.md](DEVELOPMENT.md).
