// Draws the 1200x675 share card (the 16:9 size X shows uncropped) on a canvas.
// Same palette and font as the site: Departure Mono, amber on charcoal.
// Departure Mono is drawn on an 11px grid, so every font size is a multiple of 11.
import { AXES, AXIS_LABELS, barHeight, type Scores } from "./scores";
import type { Track } from "./metadata";

const COLORS = { ground: "#222222", ink: "#ffa132", subtle: "#b0732c", muted: "#594128", surface: "#2a2a2a" };
const W = 1200;
const H = 675;
const font = (size: number) => `${size}px "Departure Mono"`;

let fontReady: Promise<unknown> | null = null;
function loadFont() {
  fontReady ??= new FontFace("Departure Mono", "url(/fonts/departure-mono.woff2)").load().then((face) => document.fonts.add(face));
  return fontReady;
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  image.crossOrigin = "anonymous"; // keeps the canvas exportable for remote covers
  image.src = src;
  return image.decode().then(() => image, () => null);
}

// Truncate with an ellipsis so long text never runs off the card.
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}...`).width > width) text = text.slice(0, -1);
  return `${text.trimEnd()}...`;
}

export async function renderCard(track: Track, scores: Scores, windows: number[]): Promise<Blob> {
  await loadFont();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  const coverSize = 480;
  const cover = track.displayCover ? await loadImage(track.displayCover) : null;
  if (cover) {
    // Center-crop non-square art.
    const side = Math.min(cover.naturalWidth, cover.naturalHeight);
    ctx.drawImage(cover, (cover.naturalWidth - side) / 2, (cover.naturalHeight - side) / 2, side, side, 90, 80, coverSize, coverSize);
  } else {
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(90, 80, coverSize, coverSize);
  }

  const left = 640;
  const width = W - 90 - left;
  ctx.fillStyle = COLORS.muted;
  ctx.font = font(22);
  ctx.fillText("audiobox aesthetics", left, 102);

  // Long titles step down the 11px grid (44 -> 33 -> 22) before truncating.
  ctx.fillStyle = COLORS.ink;
  const title = track.title || "untitled";
  for (const size of [44, 33, 22]) {
    ctx.font = font(size);
    if (ctx.measureText(title).width <= width) break;
  }
  ctx.fillText(fit(ctx, title, width), left, 160);

  ctx.fillStyle = COLORS.subtle;
  ctx.font = font(22);
  ctx.fillText(fit(ctx, [track.artist, track.year].filter(Boolean).join(" · "), width), left, 198);

  // Headline is content enjoyment: the axis closest to "is this song good".
  ctx.fillStyle = COLORS.ink;
  ctx.font = font(132);
  // Pull the monospace digits together, matching the page's score.
  ctx.letterSpacing = "-20px"; // advance 84px, ink 60px: digits sit 4px apart
  ctx.fillText(scores.CE.toFixed(1), left - 6, 352);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = COLORS.muted;
  ctx.font = font(22);
  ctx.fillText("/ 10 enjoyment", left, 388);

  AXES.forEach((axis, i) => {
    const y = 450 + i * 34;
    ctx.fillStyle = COLORS.subtle;
    ctx.fillText(AXIS_LABELS[axis], left, y);
    ctx.fillStyle = COLORS.ink;
    const value = scores[axis].toFixed(2);
    ctx.fillText(value, left + width - ctx.measureText(value).width, y);
  });

  drawTimeline(ctx, windows, 90, 600, W - 180, 34);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("card render failed"))), "image/png"));
}

// One bar per 10 s window, height = that window's enjoyment relative to the song.
// The same strip the page shows while it listens.
function drawTimeline(ctx: CanvasRenderingContext2D, windows: number[], x: number, y: number, width: number, height: number) {
  if (!windows.length) return;
  const gap = 3;
  const bar = (width - gap * (windows.length - 1)) / windows.length;
  const peak = Math.max(...windows);
  windows.forEach((score, i) => {
    const h = barHeight(score, windows) * height;
    ctx.fillStyle = score === peak ? COLORS.ink : COLORS.muted;
    ctx.fillRect(x + i * (bar + gap), y + height - h, bar, h);
  });
}
