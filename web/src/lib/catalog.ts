// Catalog lookups are optional: malformed upstream rows must not discard a score.
export type CatalogResult = {
  artistName: string; trackName: string; collectionName: string;
  releaseDate: string; artworkUrl: string; durationSec: number;
};
export function isCatalogResult(value: unknown): value is CatalogResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<CatalogResult>;
  return typeof row.artistName === "string" && typeof row.trackName === "string" &&
    typeof row.collectionName === "string" && typeof row.releaseDate === "string" &&
    typeof row.artworkUrl === "string" && typeof row.durationSec === "number" &&
    Number.isFinite(row.durationSec) && row.durationSec >= 0;
}
