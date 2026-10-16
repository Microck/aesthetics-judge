// AcoustID lookup proxy. Every visitor shares one AcoustID key, and AcoustID
// allows 3 requests/second per key in total, so the key stays here and a global
// limiter (2/s, headroom for clock skew between edge locations) guards it.
// Answers are cached by fingerprint so repeat songs cost nothing.
import { allow, ipHash, sha256, tooMany, type Env, type Limit } from "./rate";

const GLOBAL: Limit = { name: "acoustid-global", max: 2, windowMs: 1000 };
const PER_IP: Limit = { name: "acoustid-ip", max: 30, windowMs: 3_600_000 };
const CACHE_MS = 30 * 24 * 3_600_000;

export async function identify(request: Request, env: Env): Promise<Response> {
  if (!env.ACOUSTID_KEY) return Response.json({ error: "identification disabled" }, { status: 503 });
  const body = await request.json<{ fingerprint?: unknown; duration?: unknown }>().catch(() => null);
  const fingerprint = typeof body?.fingerprint === "string" && body.fingerprint.length < 20_000 ? body.fingerprint : null;
  const duration = typeof body?.duration === "number" && body.duration > 0 && body.duration < 7200 ? Math.round(body.duration) : null;
  if (!fingerprint || !duration) return Response.json({ error: "invalid request" }, { status: 400 });

  const key = await sha256(`${duration}:${fingerprint}`);
  const cached = await env.DB.prepare("SELECT response FROM acoustid_cache WHERE fingerprint_hash = ? AND expires_at > ?")
    .bind(key, Date.now())
    .first<{ response: string }>();
  if (cached) return new Response(cached.response, { headers: { "Content-Type": "application/json" } });

  if (!(await allow(env.DB, PER_IP, await ipHash(request, env)))) return tooMany(600);
  if (!(await allow(env.DB, GLOBAL, "all"))) return tooMany(1);

  const upstream = await fetch("https://api.acoustid.org/v2/lookup", {
    method: "POST",
    body: new URLSearchParams({
      client: env.ACOUSTID_KEY,
      meta: "recordings releasegroups",
      duration: String(duration),
      fingerprint,
    }),
  });
  const text = await upstream.text();
  // AcoustID reports its own rate limiting as HTTP 200 with status "error"; don't cache those.
  const ok = upstream.ok && JSON.parse(text)?.status === "ok";
  if (ok) {
    await env.DB.prepare("INSERT OR REPLACE INTO acoustid_cache (fingerprint_hash, response, expires_at) VALUES (?, ?, ?)")
      .bind(key, text, Date.now() + CACHE_MS)
      .run();
  }
  return new Response(text, { status: ok ? 200 : 502, headers: { "Content-Type": "application/json" } });
}
