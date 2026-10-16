// Optional "bring your own fetcher": any service the visitor runs or may use that
// turns a link into audio. The site ships none, because public download services
// forbid third-party use without permission. Settings stay in this browser's
// localStorage and are never sent to the feed.
//
// Two request styles, picked by the URL the visitor enters:
// - Contains "{url}": GET with the link substituted in, e.g.
//   https://my-proxy.example/audio?src={url}
// - Otherwise: POST a cobalt-style JSON body ({ url, downloadMode: "audio" }),
//   which cobalt instances and lookalikes accept.
// Either way the response may be audio bytes, or JSON naming where the audio is
// (cobalt's { status: "tunnel" | "redirect", url }, or any { url | download | link }).

export type FetcherSettings = { url: string; authorization: string };

const STORAGE_KEY = "aesthetics-judge:fetcher";
const EMPTY: FetcherSettings = { url: "", authorization: "" };

export function loadFetcher(): FetcherSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { url: stored.url ?? "", authorization: stored.authorization ?? "" };
  } catch {
    return EMPTY;
  }
}

export function saveFetcher(settings: FetcherSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export async function fetchAudio(link: string, { url, authorization }: FetcherSettings): Promise<File> {
  const auth: Record<string, string> = authorization ? { Authorization: authorization } : {};
  const response = url.includes("{url}")
    ? await fetch(url.replace("{url}", encodeURIComponent(link)), { headers: auth })
    : await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ url: link, downloadMode: "audio", audioFormat: "best" }),
      });

  const type = response.headers.get("Content-Type") ?? "";
  if (!type.includes("json")) {
    if (!response.ok) throw new Error(`fetcher failed (${response.status})`);
    return new File([await response.blob()], filenameFrom(response) ?? "audio", { type });
  }

  const body = await response.json().catch(() => null);
  const target = body?.url ?? body?.download ?? body?.link;
  if (!response.ok || body?.status === "error" || typeof target !== "string") {
    const code = body?.error?.code ?? body?.error ?? body?.message;
    throw new Error(code ? `fetcher said ${typeof code === "string" ? code : JSON.stringify(code)}` : `fetcher failed (${response.status})`);
  }
  const audio = await fetch(target);
  if (!audio.ok) throw new Error(`audio download failed (${audio.status})`);
  return new File([await audio.blob()], body.filename ?? filenameFrom(audio) ?? "audio", {
    type: audio.headers.get("Content-Type") ?? "",
  });
}

function filenameFrom(response: Response): string | null {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(response.headers.get("Content-Disposition") ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}
