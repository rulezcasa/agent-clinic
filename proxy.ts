import { NextResponse, type NextRequest } from "next/server";

/**
 * Frontend-only deploys set BACKEND_URL (the public ngrok tunnel to the backend machine) and every
 * /api/* call is forwarded there, so this deploy's copies of the API routes never execute.
 * Unset (local dev / the backend machine itself): requests fall through to the routes here.
 * ngrok-skip-browser-warning keeps ngrok's free-tier interstitial from answering browser requests with HTML.
 */
export function proxy(request: NextRequest) {
  const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, "");
  if (!backendUrl) return NextResponse.next();

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, backendUrl);
  const headers = new Headers(request.headers);
  headers.set("ngrok-skip-browser-warning", "1");
  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = { matcher: "/api/:path*" };
