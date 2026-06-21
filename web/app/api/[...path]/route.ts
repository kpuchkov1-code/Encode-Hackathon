import type { NextRequest } from "next/server";

/*
  Server-side proxy to the backend (mock or real, via BACKEND_BASE_URL).

  Why: a Vercel-hosted HTTPS page cannot call the WSL backend on http://localhost:8000
  (mixed-content + CORS). The browser only ever calls same-origin /api/*; this handler
  forwards server-side. BACKEND_BASE_URL is server-only — it never reaches the client.

  Swap mock -> tunnel -> real backend by changing one env var. No UI changes.
*/

const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL ?? "http://localhost:8000";

// Never cache proxied responses — job state is live.
export const dynamic = "force-dynamic";

async function forward(req: NextRequest, path: string[]): Promise<Response> {
  const target = `${BACKEND_BASE_URL}/${path.join("/")}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    // GET/HEAD must not carry a body.
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const upstream = await fetch(target, init);
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    // Binary responses (e.g. the results .zip from /jobs/<id>/download) must NOT be decoded
    // as text — stream the bytes through and preserve the download headers.
    if (!contentType.includes("application/json")) {
      const headers = new Headers({ "Content-Type": contentType });
      const dispo = upstream.headers.get("content-disposition");
      if (dispo) headers.set("Content-Disposition", dispo);
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    const text = await upstream.text();
    // Pass status + JSON through verbatim so the UI sees the contract's codes.
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(
      { error: `backend unreachable at ${BACKEND_BASE_URL}` },
      { status: 502 },
    );
  }
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/[...path]">,
) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/[...path]">,
) {
  const { path } = await ctx.params;
  return forward(req, path);
}
