// Rate limiting and IP hashing shared by the API routes.

export interface Env {
  DB: D1Database;
  // Secret mixed into IP hashes so stored hashes can't be reversed by brute force.
  IP_SALT?: string;
  ACOUSTID_KEY?: string;
  // Origin allowed to call the API from a browser (the static site).
  SITE_ORIGIN: string;
}

export type Limit = { name: string; max: number; windowMs: number };

// Fixed-window counter in D1. One upsert per check: atomic, and consistent across
// every edge isolate, which in-memory counters would not be. Returns false when
// the window's budget is spent.
export async function allow(db: D1Database, limit: Limit, subject: string): Promise<boolean> {
  const now = Date.now();
  const window = Math.floor(now / limit.windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(`${limit.name}:${subject}:${window}`, (window + 1) * limit.windowMs)
    .first<{ count: number }>();
  // Occasional sweep keeps the table small without a cron.
  if (Math.random() < 0.01) await db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(now).run();
  return (row?.count ?? 0) <= limit.max;
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ipHash(request: Request, env: Env): Promise<string> {
  return sha256(`${env.IP_SALT ?? ""}:${request.headers.get("CF-Connecting-IP") ?? "local"}`);
}

export const tooMany = (retryAfterSeconds: number) =>
  Response.json({ error: "slow down" }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
