import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'wxt';

// ONNX Runtime (used by Transformers.js for the on-device "Quick findings" model) loads its WASM
// files from a CDN by default; MV3 forbids remote code, so ship them inside the extension.
// onnxruntime-web is a dependency of @huggingface/transformers, so resolve it from there.
const fromTransformers = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'));
const ortDist = dirname(fromTransformers.resolve('onnxruntime-web'));
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Verity',
    description: 'Verity Chrome extension',
    // activeTab + scripting: inject into the current tab only when the toolbar button is clicked.
    // offscreen: hosts the on-device model (needs a DOM page; service workers can't load it).
    permissions: ['storage', 'activeTab', 'scripting', 'offscreen'],
    action: { default_title: 'Scan this page with Verity' },
    content_security_policy: {
      // 'wasm-unsafe-eval' lets extension pages compile the bundled ONNX Runtime WASM.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const file of ORT_FILES) files.push({ absoluteSrc: join(ortDist, file), relativeDest: `ort/${file}` });
    },
  },
  webExt: {
    // Keep a persistent dev profile so logins and extension storage survive restarts.
    chromiumArgs: ['--user-data-dir=./.chrome-profile'],
    // Pages to open on `pnpm dev`: set startUrls in web-ext.config.ts (personal, gitignored).
  },
});
