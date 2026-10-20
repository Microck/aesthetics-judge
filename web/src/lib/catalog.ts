// Catalog lookups are optional: malformed upstream rows must not discard a score.
export type CatalogResult = {
  artistName: string; trackName: string; collectionName: string;
  releaseDate: string; artworkUrl: string; durationSec: number;
};
export function isCatalogResult(value: unknown): value is CatalogResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<CatalogResult>;
  return typeof row.artistName === "string" && row.artistName.trim().length > 0 &&
    typeof row.trackName === "string" && row.trackName.trim().length > 0 &&
    typeof row.collectionName === "string" && typeof row.releaseDate === "string" &&
    typeof row.artworkUrl === "string" && typeof row.durationSec === "number" &&
    Number.isFinite(row.durationSec) && row.durationSec >= 0;
}

export function readCatalogStore(storage: Pick<Storage, "getItem">, name: string): Record<string, CatalogResult[]> {
  try {
    const value: unknown = JSON.parse(storage.getItem(`aesthetics-judge:${name}`) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([term, rows]) => {
      if (!Array.isArray(rows)) return [];
      const valid = rows.filter(isCatalogResult);
      return rows.length > 0 && valid.length === 0 ? [] : [[term, valid]];
    }));
  } catch {
    return {};
  }
}

export function normalizeItunesResults(value: unknown): CatalogResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const result = {
      artistName: row.artistName, trackName: row.trackName,
      collectionName: row.collectionName ?? "", releaseDate: row.releaseDate ?? "",
      artworkUrl: typeof row.artworkUrl100 === "string" ? row.artworkUrl100.replace("100x100bb", "1200x1200bb") : "",
      durationSec: typeof row.trackTimeMillis === "number" ? row.trackTimeMillis / 1000 : 0,
    };
    return isCatalogResult(result) ? [result] : [];
  });
}

// Invalid nonempty responses are retryable misses, not durable empty results.
export function itunesResultsForCache(value: unknown): CatalogResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = normalizeItunesResults(value);
  return value.length > 0 && normalized.length === 0 ? undefined : normalized;
}
