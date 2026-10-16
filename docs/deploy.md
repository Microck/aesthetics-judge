# aesthetics judge: run and deploy

Live at https://music.micr.dev.

```
browser (music.micr.dev, Netlify static site)
  file / fetcher link -> decode (Web Audio, 16 kHz mono)
                      -> model worker (ONNX int8 from Hugging Face, 10 s windows) -> scores
                      -> tags (music-metadata) -> /api/identify -> iTunes  -> title, cover
                      -> canvas card (PNG)
  on done -> POST /api/feed

API (Cloudflare Worker aesthetics-judge-api.marcos-jaen-lego.workers.dev, D1 aesthetics-judge)
  GET/POST /api/feed, POST /api/identify (AcoustID proxy)
```

| Piece | Where | Notes |
|---|---|---|
| Static site | Netlify | `music.micr.dev` record lives in the Netlify DNS zone for micr.dev |
| API | Cloudflare Worker `aesthetics-judge-api` | `web/api/`, config in `web/wrangler.toml` |
| Database | Cloudflare D1 `aesthetics-judge` (WEUR) | schema in `web/schema.sql` |
| Model | https://huggingface.co/Microck/audiobox-aesthetics-onnx | 126 MB, CC-BY 4.0 |

Browsers call the Worker directly (not through a Netlify proxy) so `CF-Connecting-IP`
is the visitor's IP and per-IP rate limits work. The Worker allows only the
`SITE_ORIGIN` origin.

## Local

```sh
cd web
bun install
uv run python ../tools/export-onnx.py   # public/models/aes.int8.onnx
bun run db:local
bun run api        # wrangler dev on :8787, reads .dev.vars (ACOUSTID_KEY, IP_SALT)
bun run dev        # vite on :5173, proxies /api to :8787
```

## Deploy

Needs a Cloudflare API token with Workers and D1 permissions, and Netlify access to
the site. Build anywhere, then:

```sh
cd web && bun run build:prod
# API
CLOUDFLARE_ACCOUNT_ID=<account id> npx wrangler@4 deploy
# Site: deploy web/dist to Netlify (netlify deploy --prod --dir dist, or the deploys API)
```

`web/.env.production` (gitignored) holds the public build settings:

```
VITE_MODEL_URL=https://huggingface.co/Microck/audiobox-aesthetics-onnx/resolve/main/aes.int8.onnx
VITE_API_URL=<the Worker URL>
```

Secrets on the Worker: `IP_SALT` (set), `ACOUSTID_KEY` (not set: needs an AcoustID
*application* key; the user key is rejected). Set it with
`npx wrangler@4 secret put ACOUSTID_KEY`. Until then `/api/identify` answers 503 and
untagged files fall back to filename parsing.

## Rate limits

| Service | Limit | Where |
|---|---|---|
| AcoustID (3 req/s per key) | 2/s global, 30/h per IP, 30-day cache | `api/identify.ts` |
| Feed posts | 20/h per IP, 300/h global | `api/feed.ts` |
| iTunes Search (~20/min per IP) | 15/min per browser, local cache | `src/lib/metadata.ts` |

## Constraints worth knowing

- COOP/COEP headers (`public/_headers`) enable multithreaded WASM. Under COEP every
  cross-origin resource needs CORS or CORP; iTunes artwork, Cover Art Archive,
  Hugging Face and the Worker (sends CORP: cross-origin) all comply.
- Scores are computed client-side, so feed entries can be forged; the API only bounds
  values (0-11), caps text, allowlists cover hosts and rate-limits. IPs are stored only
  as salted SHA-256.
- Browser decoding differs slightly from ffmpeg: ~0.1 point differences from the Python
  reference on the same file.
