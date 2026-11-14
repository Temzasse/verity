// Animated ordered-dither background for the install section: slow drifting waves rendered as
// a coarse 4px Bayer pattern in the accent blue, strongest at the bottom and fading upwards. With
// data-dither-below="<selector>" the dots start only below that element, so its text stays clear.
// Runs only while visible, ~24 fps, and draws a single still frame for visitors who prefer reduced motion.

const CELL = 4; // CSS px per dither dot
const FPS = 24;
const MAX_DENSITY = 0.5;
const COLOR = [79, 124, 240];
const ALPHA = 70; // 0–255
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35,
  11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

for (const canvas of document.querySelectorAll('canvas[data-dither]')) start(canvas);

function start(canvas) {
  const host = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0;
  let h = 0;
  let img = null;
  let visible = false;
  let frame = 0;
  let last = 0;
  let startAt = 0.15; // fraction of the height where the dots begin

  const resize = () => {
    w = Math.max(1, Math.ceil(host.offsetWidth / CELL));
    h = Math.max(1, Math.ceil(host.offsetHeight / CELL));
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w * CELL}px`;
    canvas.style.height = `${h * CELL}px`;
    img = ctx.createImageData(w, h);
    const below = canvas.dataset.ditherBelow && host.querySelector(canvas.dataset.ditherBelow);
    if (below) {
      const top = host.getBoundingClientRect().top;
      const bottom = below.getBoundingClientRect().bottom + 24; // a little clear space under the text
      startAt = Math.min(0.9, Math.max(0, (bottom - top) / host.offsetHeight));
    }
    draw(performance.now() / 1000);
  };

  const draw = (t) => {
    if (!img) return;
    const data = img.data;
    data.fill(0);
    for (let y = 0; y < h; y++) {
      const v = y / h;
      // Fade in towards the bottom so the heading and buttons sit on a calm background.
      const fade = Math.pow(Math.max(0, (v - startAt) / (1 - startAt)), 1.3);
      if (fade <= 0) continue;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const wave =
          Math.sin(u * 7 + t * 0.6) * 0.5 +
          Math.sin(v * 9 - t * 0.45 + u * 3) * 0.35 +
          Math.sin((u + v) * 5 + t * 0.3) * 0.25;
        const density = MAX_DENSITY * fade * (0.55 + 0.45 * wave);
        if (BAYER[(y & 7) * 8 + (x & 7)] >= density) continue;
        const i = (y * w + x) * 4;
        data[i] = COLOR[0];
        data[i + 1] = COLOR[1];
        data[i + 2] = COLOR[2];
        data[i + 3] = ALPHA;
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const loop = (now) => {
    frame = 0;
    if (!visible) return;
    if (now - last >= 1000 / FPS) {
      last = now;
      draw(now / 1000);
    }
    frame = requestAnimationFrame(loop);
  };

  new ResizeObserver(resize).observe(host);
  if (still) return;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frame) frame = requestAnimationFrame(loop);
  }).observe(host);
}
