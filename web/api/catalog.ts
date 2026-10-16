// Deezer catalog proxy. Deezer's API sends no CORS headers, so browsers can't call
// it directly. Deezer allows ~50 requests per 5 s per IP and every visitor shares
// this Worker's egress, so answers are cached in D1 for a week (the edge Cache API
// is a no-op on workers.dev) and a global limiter keeps well under the cap.
import { allow, ipHash, tooMany, type Env, type Limit } from "./rate";

const GLOBAL: Limit = { name: "deezer-global", max: 40, windowMs: 5000 };
const PER_IP: Limit = { name: "deezer-ip", max: 30, windowMs: 60_000 };
const CACHE_MS = 7 * 86_400_000;

// Shape shared with the browser's iTunes results (src/lib/metadata.ts CatalogResult).
type Result = { artistName: string; trackName: string; collectionName: string; releaseDate: string; artworkUrl: string; durationSec: number };

export async function searchCatalog(request: Request, env: Env): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 200);
  if (!query) return Response.json({ error: "missing q" }, { status: 400 });

  const key = query.toLowerCase();
  const cached = await env.DB.prepare("SELECT response FROM catalog_cache WHERE query = ? AND expires_at > ?")
    .bind(key, Date.now())
    .first<{ response: string }>();
  if (cached) return new Response(cached.response, { headers: { "Content-Type": "application/json" } });

  if (!(await allow(env.DB, PER_IP, await ipHash(request, env)))) return tooMany(60);
  if (!(await allow(env.DB, GLOBAL, "all"))) return tooMany(5);

  const search = await fetch(`https://api.deezer.com/search?limit=10&q=${encodeURIComponent(query)}`);
  if (!search.ok) return Response.json({ error: "catalog unavailable" }, { status: 502 });
  const { data = [] } = await search.json<{ data?: DeezerTrack[] }>();
  // Search results lack release dates; fetch them for the distinct albums (usually 1-5).
  const albumIds = [...new Set(data.map((track) => track.album.id))].slice(0, 5);
  const dates = new Map(
    await Promise.all(
      albumIds.map(async (id) => {
        const album = await fetch(`https://api.deezer.com/album/${id}`).then((r) => r.json<{ release_date?: string }>()).catch(() => ({}) as { release_date?: string });
        return [id, album.release_date ?? ""] as const;
      }),
    ),
  );
  const results: Result[] = data.map((track) => ({
    artistName: track.artist.name,
    trackName: track.title,
    collectionName: track.album.title,
    releaseDate: dates.get(track.album.id) ?? "",
    artworkUrl: track.album.cover_xl,
    durationSec: track.duration,
  }));

  const body = JSON.stringify(results);
  await env.DB.prepare("INSERT OR REPLACE INTO catalog_cache (query, response, expires_at) VALUES (?, ?, ?)")
    .bind(key, body, Date.now() + CACHE_MS)
    .run();
  return new Response(body, { headers: { "Content-Type": "application/json" } });
}

type DeezerTrack = { title: string; duration: number; artist: { name: string }; album: { id: number; title: string; cover_xl: string } };
