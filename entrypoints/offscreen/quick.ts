import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Category, Finding, QuickRequest, QuickResponse } from '@/utils/analysis';
import { EXEMPLARS } from './exemplars';

/**
 * On-device "Quick findings": a small sentence-embedding model (all-MiniLM-L6-v2, ~23 MB,
 * downloaded once from Hugging Face and cached) compares each sentence with the technique
 * examples in exemplars.ts, plus a word list that pinpoints charged wording.
 * It is fast and free but much less accurate than the smart analysis.
 */

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MIN_SIMILARITY = 0.45; // to the technique's examples
const MIN_MARGIN = 0.06; // how much closer to the technique than to neutral reporting
const MAX_FINDINGS = 12;

// Use the ONNX Runtime files bundled in the extension (public/ort via wxt.config.ts), never a CDN,
// and load them directly (blob: URLs are blocked by the extension CSP).
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  // This page runs on the extension's origin, so these resolve to the bundled files.
  onnx.wasm.wasmPaths = {
    mjs: new URL('/ort/ort-wasm-simd-threaded.asyncify.mjs', location.origin).href,
    wasm: new URL('/ort/ort-wasm-simd-threaded.asyncify.wasm', location.origin).href,
  };
  onnx.wasm.numThreads = 1; // extension pages aren't cross-origin isolated (no SharedArrayBuffer)
}
env.useWasmCache = false;
env.allowLocalModels = false;

type Model = { extractor: FeatureExtractionPipeline; device: string; classes: ClassVectors[] };
type ClassVectors = { technique: string; category: Category | 'neutral'; vectors: Float32Array[] };

let modelPromise: Promise<Model> | undefined;

/** Loads the model (WebGPU when available, else WASM) and embeds the examples once. */
function loadModel(): Promise<Model> {
  modelPromise ??= (async () => {
    let extractor: FeatureExtractionPipeline;
    let device = 'webgpu';
    try {
      if (!('gpu' in navigator)) throw new Error('no WebGPU');
      extractor = await pipeline('feature-extraction', MODEL_ID, { device: 'webgpu', dtype: 'fp32' });
    } catch {
      device = 'wasm';
      extractor = await pipeline('feature-extraction', MODEL_ID, { device: 'wasm', dtype: 'q8' });
    }
    const classes: ClassVectors[] = [];
    for (const ex of EXEMPLARS) {
      classes.push({ technique: ex.technique, category: ex.category, vectors: await embed(extractor, ex.examples) });
    }
    return { extractor, device, classes };
  })();
  modelPromise.catch(() => (modelPromise = undefined)); // allow a retry after a failed load
  return modelPromise;
}

/** Warm up early (model download + example embeddings) so the first scan is fast. */
export function preload() {
  void loadModel().catch((err) => console.warn('[Verity quick] preload failed', err));
}

async function embed(extractor: FeatureExtractionPipeline, texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    const data = tensor.data as Float32Array;
    const dim = data.length / batch.length;
    for (let j = 0; j < batch.length; j++) out.push(data.slice(j * dim, (j + 1) * dim));
  }
  return out;
}

function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Mean of the two highest similarities to a class's examples (robust to one odd example). */
function classScore(v: Float32Array, c: ClassVectors) {
  let a = -1;
  let b = -1;
  for (const e of c.vectors) {
    const s = dot(v, e);
    if (s > a) [a, b] = [s, a];
    else if (s > b) b = s;
  }
  return b < 0 ? a : (a + b) / 2;
}

export async function quickAnalyze({ sentences }: QuickRequest): Promise<QuickResponse> {
  const started = performance.now();
  const findings: Finding[] = [];
  const texts = sentences.map((s) => s.text);

  let device = 'none';
  let vectors: Float32Array[] = [];
  let classes: ClassVectors[] = [];
  try {
    const model = await loadModel();
    device = model.device;
    classes = model.classes;
    vectors = await embed(model.extractor, texts);
  } catch (err) {
    console.warn('[Verity quick] model unavailable, word list only', err);
  }

  sentences.forEach((s, i) => {
    const lexical = matchLexicon(s.text);
    const v = vectors[i];
    let best: { c: ClassVectors; score: number } | null = null;
    let neutral = 0;
    if (v) {
      for (const c of classes) {
        const score = classScore(v, c);
        if (c.category === 'neutral') neutral = score;
        else if (!best || score > best.score) best = { c, score };
      }
    }

    if (best && best.c.category !== 'neutral' && best.score >= MIN_SIMILARITY && best.score - neutral >= MIN_MARGIN) {
      const margin = best.score - neutral;
      findings.push({
        sentenceId: s.id,
        category: best.c.category,
        technique: best.c.technique,
        confidence: round(Math.min(0.9, 0.35 + margin * 3 + (lexical ? 0.1 : 0))),
        rationale: `On-device model: this sentence reads like examples of ${best.c.technique.toLowerCase()}${lexical ? ` ("${lexical.quote}")` : ''}.`,
        quote: lexical && lexical.category === best.c.category ? lexical.quote : undefined,
        source: 'quick',
      });
    } else if (lexical && lexical.strong) {
      findings.push({
        sentenceId: s.id,
        category: lexical.category,
        technique: lexical.technique,
        confidence: 0.45,
        rationale: `On-device word list: "${lexical.quote}" is ${lexical.category === 'unsupported-claim' ? 'an unattributed-source phrase' : 'charged wording'}.`,
        quote: lexical.quote,
        source: 'quick',
      });
    }
  });

  findings.sort((a, b) => b.confidence - a.confidence);
  const top = findings.slice(0, MAX_FINDINGS).sort((a, b) => a.sentenceId - b.sentenceId);
  return { findings: top, ms: Math.round(performance.now() - started), device };
}

const round = (n: number) => Math.round(n * 100) / 100;

// Word list: tabloid-style charged words, labels, and unattributed-source phrases.
const LEXICON: { category: Category; technique: string; strong: boolean; pattern: RegExp }[] = [
  {
    category: 'loaded-language',
    technique: 'Loaded language',
    strong: true,
    pattern:
      /\b(shameless|disgrace(?:ful)?|outrage(?:ous)?|sickening|horrif(?:ying|ic)|scandal(?:ous)?|barmy|bonkers|madness|fury|furious|slam(?:s|med)?|blasts?|chaos|carnage|meltdown|betrayal|betrayed|catastroph(?:e|ic)|crackdown|raid|bled dry|swarm(?:s|ing)?|flood(?:ing)? in|invasion|hordes?|onslaught|savage(?:ly)?|brutal(?:ly)?|vile|despicable|disgusting|appalling|shock(?:ing)?|terrifying|nightmare|fiasco|farce|sham|rip-?off|war on)\b/i,
  },
  {
    category: 'propaganda',
    technique: 'Name calling / labeling',
    strong: true,
    pattern:
      /\b(woke|snowflakes?|loony|lefties|lefty|traitors?|eco-?(?:zealots?|loons?|mob)|zealots?|thugs?|yobs?|crooks?|cronies|elites?|do-?gooders?|luvvies|scroungers?|spongers?|militants?|extremists?|so-called experts?|mob)\b/i,
  },
  {
    category: 'unsupported-claim',
    technique: 'Unattributed claim',
    strong: false,
    pattern:
      /\b(experts (?:say|warn|believe|claim)|it is (?:widely )?(?:believed|feared|thought)|insiders? (?:say|claim|reveal)|sources? (?:say|claim|suggest)|studies (?:show|suggest)|many people (?:are saying|say|believe)|critics (?:say|claim)|reportedly)\b/i,
  },
];

function matchLexicon(text: string) {
  for (const entry of LEXICON) {
    const m = entry.pattern.exec(text);
    if (m) return { category: entry.category, technique: entry.technique, strong: entry.strong, quote: m[0] };
  }
  return null;
}
