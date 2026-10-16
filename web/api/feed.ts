// Public feed of recent judgments.
// GET  -> latest scans, newest first.
// POST -> add one scan. Scores come from the visitor's browser, so this can only
//         bound them, not verify them. Abuse control: per-IP and site-wide hourly caps.

import { allow, ipHash, tooMany, type Env, type Limit } from "./rate";

const FEED_SIZE = 40;
const PER_IP: Limit = { name: "feed-ip", max: 20, windowMs: 3_600_000 };
// Site-wide ceiling so a botnet can't flood the feed even with many IPs.
const GLOBAL: Limit = { name: "feed-global", max: 300, windowMs: 3_600_000 };
// Only covers from these hosts are stored; embedded file art never leaves the browser.
const COVER_HOSTS = [/\.mzstatic\.com$/, /^coverartarchive\.org$/, /^i\.scdn\.co$/, /^cdn-images\.dzcdn\.net$/];

type Scan = {
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  coverUrl: string | null;
  scores: { CE: number; CU: number; PC: number; PQ: number };
  duration: number;
};

export async function listFeed(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, artist, album, year, cover_url, ce, cu, pc, pq, duration, created_at
     FROM scans ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(FEED_SIZE)
    .all();
  return Response.json(results, { headers: { "Cache-Control": "public, max-age=10" } });
}

export async function postFeed(request: Request, env: Env): Promise<Response> {
  const scan = parseScan(await request.json().catch(() => null));
  if (!scan) return Response.json({ error: "invalid scan" }, { status: 400 });

  const ip = await ipHash(request, env);
  if (!(await allow(env.DB, PER_IP, ip)) || !(await allow(env.DB, GLOBAL, "all"))) return tooMany(600);

  await env.DB.prepare(
    `INSERT INTO scans (title, artist, album, year, cover_url, ce, cu, pc, pq, duration, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      scan.title, scan.artist, scan.album, scan.year, scan.coverUrl,
      scan.scores.CE, scan.scores.CU, scan.scores.PC, scan.scores.PQ,
      scan.duration, ip, Date.now(),
    )
    .run();
  return Response.json({ ok: true }, { status: 201 });
}

function parseScan(body: unknown): Scan | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
  // The model's outputs sit on a 1-10 scale; small overshoot is real, beyond is forged.
  const score = (value: unknown) => (typeof value === "number" && value >= 0 && value <= 11 ? value : null);

  const title = text(b.title, 200);
  const artist = text(b.artist, 200);
  const scores = (b.scores ?? {}) as Record<string, unknown>;
  const [CE, CU, PC, PQ] = ["CE", "CU", "PC", "PQ"].map((axis) => score(scores[axis]));
  const duration = typeof b.duration === "number" && b.duration > 0 && b.duration < 7200 ? b.duration : null;
  if (!title || !artist || CE === null || CU === null || PC === null || PQ === null || duration === null) return null;

  return {
    title,
    artist,
    album: text(b.album, 200),
    year: text(b.year, 10),
    coverUrl: allowedCover(b.coverUrl),
    scores: { CE, CU, PC, PQ },
    duration,
  };
}

function allowedCover(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && COVER_HOSTS.some((host) => host.test(url.hostname)) ? url.href : null;
  } catch {
    return null;
  }
}
