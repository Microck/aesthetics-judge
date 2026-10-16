// Client for the API Worker (api/). In dev, Vite proxies /api to `wrangler dev`;
// in production the site (Netlify) and API (Cloudflare Worker) are separate origins.
export const API_BASE = import.meta.env.VITE_API_URL ?? "";
import type { Track } from "./metadata";
import type { Scores } from "./scores";

export type FeedItem = {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  cover_url: string | null;
  ce: number;
  cu: number;
  pc: number;
  pq: number;
  duration: number;
  created_at: number;
};

export async function getFeed(): Promise<FeedItem[]> {
  const response = await fetch(`${API_BASE}/api/feed`);
  return response.ok ? response.json() : [];
}

export async function publish(track: Track, scores: Scores): Promise<void> {
  const response = await fetch(`${API_BASE}/api/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: track.title,
      artist: track.artist,
      album: track.album || null,
      year: track.year || null,
      coverUrl: track.coverUrl,
      scores,
      duration: track.duration,
    }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "too many posts, try later" : "could not post");
}
