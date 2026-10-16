// API Worker for music.micr.dev. The static site lives on Netlify; browsers call
// this Worker directly (cross-origin), so CF-Connecting-IP is the visitor's real
// IP and the per-IP rate limits in rate.ts hold.
import { searchCatalog } from "./catalog";
import { listFeed, postFeed } from "./feed";
import { identify } from "./identify";
import type { Env } from "./rate";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = {
      "Access-Control-Allow-Origin": env.SITE_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Expose-Headers": "Retry-After",
      "Access-Control-Max-Age": "86400",
      // The site runs cross-origin isolated (COEP); this lets it embed our responses.
      "Cross-Origin-Resource-Policy": "cross-origin",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;
    const response =
      route === "GET /api/feed" ? await listFeed(env)
      : route === "POST /api/feed" ? await postFeed(request, env)
      : route === "POST /api/identify" ? await identify(request, env)
      : route === "GET /api/catalog" ? await searchCatalog(request, env)
      : Response.json({ error: "not found" }, { status: 404 });

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
