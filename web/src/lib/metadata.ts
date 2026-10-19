// Work out what song a file is and find its cover, entirely from the browser.
//
// 1. Make a first guess: the file's tags, else an AcoustID audio fingerprint
//    (through /api/identify, which holds the key and the shared rate limit),
//    else the filename. Tags are often junk: YouTube rips carry the video title
//    ("Muse - Space Dementia @ Le Zenith [Hullabaloo]") and the uploader as artist,
//    so "Artist - Title" strings are split and bracketed/venue noise is stripped.
// 2. Confirm against two catalogs: iTunes (called directly) and Deezer (through
//    /api/catalog, since Deezer sends no CORS headers). Small artists are often on
//    one and not the other. A result is accepted only if its artist appears in the
//    original text; among those, the best score wins (see scoreResult): words
//    shared with the file, minus title words the file never mentions ("Live Aid",
//    "Mashup"), plus a bonus that grows as its length nears the file's (length is
//    the strongest evidence of *which* recording it is, e.g. live vs studio).
//    An accepted result replaces the guess: clean title, artist, album, year, cover.
//    A hosted cover is needed even when the file embeds one, because the public
//    feed can only show covers that live on the web.
import { parseBlob } from "music-metadata";

import { SAMPLE_RATE } from "./audio";
import { API_BASE } from "./feed";
import { isCatalogResult, readCatalogStore, normalizeItunesResults, type CatalogResult } from "./catalog";

export type Track = {
  title: string;
  artist: string;
  album: string;
  year: string;
  duration: number;
  // What the page shows: embedded art as a blob: URL, else the hosted cover.
  displayCover: string | null;
  // Hosted cover safe to store in the feed (allowlisted hosts only, see api/feed.ts).
  coverUrl: string | null;
  // How the title/artist were found, shown so a wrong match is easy to spot.
  source: "catalog" | "tags" | "fingerprint" | "filename";
};

export async function identify(file: File, pcm: Float32Array): Promise<Track> {
  const duration = pcm.length / SAMPLE_RATE;
  const { common } = await parseBlob(file).catch(() => ({ common: {} as Awaited<ReturnType<typeof parseBlob>>["common"] }));
  const picture = common.picture?.find((p) => p.type?.toLowerCase().includes("front")) ?? common.picture?.[0];
  const embedded = picture ? await squareCover(new Blob([picture.data as BlobPart], { type: picture.format })) : null;
  const stem = file.name.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();

  let guess: Pick<Track, "title" | "artist" | "album" | "year" | "coverUrl" | "source">;
  if (common.title) {
    guess = { ...splitArtist(common.title, common.artist ?? common.albumartist ?? ""), album: common.album ?? "", year: common.year ? String(common.year) : "", coverUrl: null, source: "tags" };
  } else {
    guess = (await fingerprintLookup(pcm, duration)) ?? { ...splitArtist(stem, ""), album: "", year: "", coverUrl: null, source: "filename" };
  }
  // An album equal to the title is a rip artifact, not an album.
  if (normalize(guess.album) === normalize(common.title ?? "")) guess.album = "";

  // Everything the file says about itself, for checking catalog results against.
  const evidence = [common.title, common.artist, common.album, stem].filter(Boolean).join(" ");
  const match = await catalogMatch(guess.artist, guess.title, evidence, duration);
  if (!match) return { ...guess, duration, displayCover: embedded ?? guess.coverUrl };
  // A catalog cover beats embedded art, which for rips is usually a video thumbnail.
  return {
    ...guess,
    ...match,
    source: guess.source === "fingerprint" ? "fingerprint" : "catalog",
    duration,
    displayCover: match.coverUrl ?? embedded,
  };
}

// Embedded art from rips is often a video thumbnail: 4:3 or 16:9, with black bars
// baked in. Trim near-black borders, then center-crop to a square, so the cover
// fills its square slot on the page and the card.
async function squareCover(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  // A line is border if 98% of its pixels are near black (JPEG noise allowed).
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data[i] + data[i + 1] + data[i + 2] < 60;
  };
  const rowIsBorder = (y: number) => {
    let n = 0;
    for (let x = 0; x < width; x++) n += dark(x, y) ? 1 : 0;
    return n >= width * 0.98;
  };
  const colIsBorder = (x: number, top: number, bottom: number) => {
    let n = 0;
    for (let y = top; y < bottom; y++) n += dark(x, y) ? 1 : 0;
    return n >= (bottom - top) * 0.98;
  };
  let top = 0;
  let bottom = height;
  let left = 0;
  let right = width;
  while (top < bottom - 1 && rowIsBorder(top)) top++;
  while (bottom - 1 > top && rowIsBorder(bottom - 1)) bottom--;
  while (left < right - 1 && colIsBorder(left, top, bottom)) left++;
  while (right - 1 > left && colIsBorder(right - 1, top, bottom)) right--;
  // An all-dark image would trim to nothing; keep it whole instead.
  if (bottom - top < height * 0.2 || right - left < width * 0.2) [top, bottom, left, right] = [0, height, 0, width];

  const side = Math.min(right - left, bottom - top);
  const out = new OffscreenCanvas(side, side);
  out.getContext("2d")!.drawImage(bitmap, left + (right - left - side) / 2, top + (bottom - top - side) / 2, side, side, 0, 0, side, side);
  return URL.createObjectURL(await out.convertToBlob({ type: "image/jpeg", quality: 0.92 }));
}

// "Artist - Title" is the usual convention for rips and filenames; when present it
// beats a tag artist, which for rips is usually the uploader. The title is then
// stripped of decorations the catalog won't have.
function splitArtist(text: string, fallbackArtist: string): { artist: string; title: string } {
  const [left, ...rest] = text.split(" - ");
  const [artist, title] = rest.length ? [left, rest.join(" - ")] : [fallbackArtist, text];
  return { artist: artist.trim(), title: cleanTitle(title) };
}

function cleanTitle(title: string): string {
  return title
    .replace(/\[[^\]]*\]/g, "") // [Hullabaloo], [4K]
    .replace(/\((?:official|lyric|lyrics|audio|video|visualizer|hd|hq|4k|remaster)[^)]*\)/gi, "")
    .replace(/\s@\s.*$/, "") // "@ Le Zenith, Paris 2001"
    // Unbracketed video junk ends the title: "Respect Official Video Winner",
    // "GANGNAM STYLE M/V". Needs a word before it, so "Video Games" survives.
    .replace(/(\S)\s+(?:official|lyrics?|(?:music\s+)?video|visuali[sz]er|m\/v|mv|hd|hq|4k)\b.*$/i, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function fingerprintLookup(pcm: Float32Array, duration: number): Promise<Pick<Track, "title" | "artist" | "album" | "year" | "coverUrl" | "source"> | null> {
  try {
    // Chromaprint only needs the opening; AcoustID fingerprints cover ~2 minutes.
    const { fingerprintFromSamples } = await import("rusty-chromaprint-wasm");
    const head = pcm.subarray(0, 120 * SAMPLE_RATE);
    const ints = new Int16Array(head.length);
    for (let i = 0; i < head.length; i++) ints[i] = Math.max(-32768, Math.min(32767, head[i] * 32768));
    const { compressed } = fingerprintFromSamples(SAMPLE_RATE, 1, ints);

    // The server's global limiter answers 429 with a short Retry-After when the
    // shared key is busy; wait it out a few times before giving up.
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch(`${API_BASE}/api/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: compressed, duration }),
      });
      const retryAfter = Number(response.headers.get("Retry-After"));
      if (response.status !== 429 || retryAfter > 5) break;
      await new Promise((resolve) => setTimeout(resolve, (retryAfter || 1) * 1000 * (attempt + 1)));
    }
    if (!response?.ok) return null;
    const body = await response.json();
    const recording = body.results?.[0]?.recordings?.[0];
    if (!recording?.title) return null;
    const releaseGroup = recording.releasegroups?.[0];
    return {
      title: recording.title,
      artist: recording.artists?.map((a: { name: string }) => a.name).join(", ") ?? "",
      album: releaseGroup?.title ?? "",
      year: "",
      coverUrl: releaseGroup ? `https://coverartarchive.org/release-group/${releaseGroup.id}/front-500` : null,
      source: "fingerprint",
    };
  } catch {
    return null; // fingerprinting is a nice-to-have; the filename fallback still runs
  }
}

// One shape for both catalogs; api/catalog.ts returns Deezer results in it directly.
type CatalogMatch = Pick<Track, "title" | "artist" | "album" | "year" | "coverUrl">;

async function catalogMatch(artist: string, title: string, evidence: string, duration: number): Promise<CatalogMatch | null> {
  if (!title) return null;
  const words = new Set(tokens(evidence));
  // Artist + title first; title alone catches files whose artist guess is wrong.
  for (const term of artist ? [`${artist} ${title}`, title] : [title]) {
    const results = (await Promise.all([itunesSearch(term), deezerSearch(term)])).flat().filter(isCatalogResult);
    let best: CatalogResult | null = null;
    let bestScore = 0;
    for (const result of results) {
      // The artist must be named somewhere in the file's own text.
      if (!normalize(evidence).includes(normalize(result.artistName))) continue;
      // Catalogs list the original album before compilations of the same recording,
      // so a later result must win clearly, not by a fraction of a second of length.
      const score = scoreResult(result, words, duration);
      if (score > bestScore + (best ? 1 : 0)) [best, bestScore] = [result, score];
    }
    if (best) {
      return {
        title: best.trackName,
        artist: best.artistName,
        album: best.collectionName,
        year: best.releaseDate.slice(0, 4),
        coverUrl: best.artworkUrl,
      };
    }
  }
  return null;
}

// Title words that say nothing about which recording it is.
const NEUTRAL_WORDS = new Set(["remaster", "remastered", "version", "feat", "single", "original"]);

function scoreResult(result: CatalogResult, words: Set<string>, duration: number): number {
  // Distinct words: a soundtrack or single named after the song ("Bohemian Rhapsody
  // (The Original Soundtrack)") must not count the title twice. The artist's own name
  // is already required above, so "Bob Dylan's Greatest Hits" earns nothing for it.
  const artistWords = new Set(tokens(result.artistName));
  const shared = new Set(tokens(`${result.trackName} ${result.collectionName}`).filter((word) => words.has(word) && !artistWords.has(word))).size;
  // A version the file never mentions is a different recording: "(Live Aid)",
  // "/ 2 Legit 2 Quit Mashup", "(Sped Up)".
  const unmentioned = tokens(result.trackName).filter((word) => !words.has(word) && !NEUTRAL_WORDS.has(word) && !/^\d+$/.test(word)).length;
  // Videos carry a few seconds of intro or outro, so closeness is graded rather than
  // a hard cutoff: 10 points for the same length, none past 12 s off. Reissues of one
  // recording differ by a second or so; that counts as equal.
  const offBy = Math.max(0, Math.abs(result.durationSec - duration) - 2);
  const length = Math.max(0, 10 - offBy);
  return shared - 2 * unmentioned + length;
}

// Both catalogs cache raw answers in localStorage so re-judging a song never asks again.
function cached(name: string, term: string): CatalogResult[] | undefined {
  try { return readCatalogStore(localStorage, name)[term]; } catch { return undefined; }
}
function remember(name: string, term: string, results: CatalogResult[]) {
  let store: Record<string, CatalogResult[]>;
  try { store = readCatalogStore(localStorage, name); } catch { return; }
  // Keep it bounded: drop the oldest entries past 100.
  const keys = Object.keys(store);
  if (keys.length >= 100) for (const old of keys.slice(0, keys.length - 99)) delete store[old];
  try { localStorage.setItem(`aesthetics-judge:${name}`, JSON.stringify({ ...store, [term]: results })); } catch { /* optional cache: quota/privacy failures must not discard scores */ }
}

// iTunes Search allows roughly 20 calls/minute per IP. Calls come from each
// visitor's own IP, so a per-browser limiter is enough.
const ITUNES_PER_MINUTE = 15;
const itunesCalls: number[] = [];

async function itunesSearch(term: string): Promise<CatalogResult[]> {
  const key = term.toLowerCase();
  const hit = cached("itunes-v3", key);
  if (hit) return hit;

  const now = Date.now();
  while (itunesCalls.length && now - itunesCalls[0] > 60_000) itunesCalls.shift();
  if (itunesCalls.length >= ITUNES_PER_MINUTE) return []; // skip rather than get this IP blocked
  itunesCalls.push(now);

  try {
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(key)}&entity=song&limit=10`);
    if (!response.ok) return []; // don't cache failures (403 means Apple is throttling)
    const { results = [] } = await response.json();
    const normalized = normalizeItunesResults(results);
    remember("itunes-v3", key, normalized);
    return normalized;
  } catch {
    return [];
  }
}

// Deezer goes through the API Worker, which holds the shared rate limit and cache.
async function deezerSearch(term: string): Promise<CatalogResult[]> {
  const key = term.toLowerCase();
  const hit = cached("deezer", key);
  if (hit) return hit;
  try {
    const response = await fetch(`${API_BASE}/api/catalog?q=${encodeURIComponent(key)}`);
    if (!response.ok) return [];
    const results: CatalogResult[] = await response.json();
    remember("deezer", key, results);
    return results;
  } catch {
    return [];
  }
}

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
// Words of 3+ letters, accent-folded, for overlap scoring ("Zénith" matches "Zenith").
const tokens = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 2);
