/**
 * Scan effect: a line sweeps down the viewport and the real page content right behind it
 * turns into an ordered dither in the line's color, which then dissolves back into the page.
 *
 * Works from a screenshot of the visible tab: it's dithered once up front, and each frame
 * shows only the band of cells around the line.
 */

const CELL = 3; // CSS px per dither cell
const TRAIL = 240; // CSS px of dithered content behind (above) the line
const LEAD = 18; // CSS px of dithered content ahead of the line
const CONTRAST_GAIN = 2.4;
const GLOW = 0.45; // max density of ink dots added to the background right at the line

// 4x4 Bayer matrix, normalized to (0, 1).
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export type ScanEffectOptions = {
  canvas: HTMLCanvasElement;
  line: HTMLElement;
  /** PNG data URL of the visible viewport, or null to dither without page content. */
  screenshot: string | null;
  /** Any CSS color; dithered "ink" uses it. */
  color: string;
  durationMs: number;
};

export async function playScanEffect(opts: ScanEffectOptions): Promise<void> {
  const { canvas, line, screenshot, color, durationMs } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gw = Math.ceil(vw / CELL);
  const gh = Math.ceil(vh / CELL);
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, gw, gh);

  const ink = parseColor(ctx, color);
  const { px: dithered, isInk } = await buildDitheredLayer(screenshot, gw, gh, ink);
  const inkPx = pack(ink, 255);

  // Static noise decides which cells dissolve first, so the trail breaks up organically.
  const noise = new Float32Array(gw * gh);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.random();

  const frame = ctx.createImageData(gw, gh);
  const out = new Uint32Array(frame.data.buffer);
  const trailRows = Math.ceil(TRAIL / CELL);
  const leadRows = Math.ceil(LEAD / CELL);
  let prevTop = 0;
  let prevBottom = 0;

  line.hidden = false;

  await new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      // Overshoot past the bottom so the trail fully leaves the viewport.
      const lineY = easeInOut(p) * (vh + TRAIL);
      const lineRow = Math.floor(lineY / CELL);
      line.style.transform = `translateY(${Math.min(lineY, vh + 4)}px)`;

      const top = clamp(lineRow - trailRows, 0, gh);
      const bottom = clamp(lineRow + leadRows, 0, gh);

      // Clear the previous band, then paint the current one.
      out.fill(0, prevTop * gw, prevBottom * gw);
      for (let r = top; r < bottom; r++) {
        const f =
          r <= lineRow
            ? Math.pow(1 - (lineRow - r) / trailRows, 1.6) // fades out behind the line
            : 1 - (r - lineRow) / leadRows; // short fade-in ahead of it
        // Dithered glow: extra ink dots in the background, densest at the line.
        const glow = GLOW * f * f * f;
        const rowStart = r * gw;
        const bayerRow = (r & 3) * 4;
        for (let x = 0; x < gw; x++) {
          const i = rowStart + x;
          if (noise[i]! >= f) continue; // dissolved back to the real page
          out[i] = !isInk[i] && BAYER4[bayerRow + (x & 3)]! < glow ? inkPx : dithered[i]!;
        }
      }

      const dirtyTop = Math.min(prevTop, top);
      const dirtyBottom = Math.max(prevBottom, bottom);
      if (dirtyBottom > dirtyTop) ctx.putImageData(frame, 0, 0, 0, dirtyTop, gw, dirtyBottom - dirtyTop);
      prevTop = top;
      prevBottom = bottom;

      if (p < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  ctx.clearRect(0, 0, gw, gh);
  line.hidden = true;
}

/**
 * Dithers the screenshot at grid resolution: cells that contrast with the page background
 * become `ink`; the rest become the background color (opaque, hiding the original content).
 */
async function buildDitheredLayer(
  screenshot: string | null,
  gw: number,
  gh: number,
  ink: RGB,
): Promise<{ px: Uint32Array; isInk: Uint8Array }> {
  const result = new Uint32Array(gw * gh);
  const isInk = new Uint8Array(gw * gh);
  const inkPx = pack(ink, 255);

  // No screenshot (capture blocked): transparent layer; only the glow dots show.
  if (!screenshot) return { px: result, isInk };

  const img = new Image();
  img.src = screenshot;
  await img.decode();
  const off = new OffscreenCanvas(gw, gh);
  const octx = off.getContext('2d', { willReadFrequently: true })!;
  octx.drawImage(img, 0, 0, gw, gh);
  const src = octx.getImageData(0, 0, gw, gh).data;

  const bg = dominantColor(src);
  const bgL = luminance(bg.r, bg.g, bg.b);
  const bgPx = pack(bg, 255);

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      const l = luminance(src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!);
      const contrast = Math.min(1, Math.abs(l - bgL) * CONTRAST_GAIN);
      const on = contrast > BAYER4[(y & 3) * 4 + (x & 3)]!;
      result[i] = on ? inkPx : bgPx;
      isInk[i] = on ? 1 : 0;
    }
  }
  return { px: result, isInk };
}

type RGB = { r: number; g: number; b: number };

/** Most common color (4-bit quantized buckets), averaged within its bucket. */
function dominantColor(px: Uint8ClampedArray): RGB {
  const count = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  for (let i = 0; i < px.length; i += 4) {
    const k = ((px[i]! >> 4) << 8) | ((px[i + 1]! >> 4) << 4) | (px[i + 2]! >> 4);
    count[k] = count[k]! + 1;
    sums[k * 3] = sums[k * 3]! + px[i]!;
    sums[k * 3 + 1] = sums[k * 3 + 1]! + px[i + 1]!;
    sums[k * 3 + 2] = sums[k * 3 + 2]! + px[i + 2]!;
  }
  let best = 0;
  for (let k = 1; k < 4096; k++) if (count[k]! > count[best]!) best = k;
  const n = count[best]! || 1;
  return { r: sums[best * 3]! / n, g: sums[best * 3 + 1]! / n, b: sums[best * 3 + 2]! / n };
}

function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** RGBA → little-endian Uint32 pixel for ImageData. */
function pack({ r, g, b }: RGB, a: number) {
  return ((a << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

/** Normalizes any CSS color through the canvas (fillStyle reads back as #rrggbb). */
function parseColor(ctx: CanvasRenderingContext2D, color: string): RGB {
  ctx.fillStyle = '#2563eb';
  ctx.fillStyle = color;
  const hex = String(ctx.fillStyle);
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 37, g: 99, b: 235 };
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) };
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
