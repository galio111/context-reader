import { NextRequest, NextResponse } from "next/server";
import { protectApiRequest } from "@/lib/requestSecurity";
import { acceptsBrotli } from "@/lib/staticEncoding";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/_next/static/")) {
    const response = process.env.NODE_ENV === "production"
      && /\.(js|css)$/.test(request.nextUrl.pathname)
      && !request.headers.has("range")
      && acceptsBrotli(request.headers.get("accept-encoding"))
      ? NextResponse.rewrite(new URL("/api/static-asset/" + request.nextUrl.pathname.slice("/_next/static/".length), request.url))
      : NextResponse.next();
    response.headers.set("Vary", "Accept-Encoding");
    return response;
  }
  const blocked = protectApiRequest(request);
  if (blocked) {
    return blocked;
  }

  const response = NextResponse.next();
  response.headers.set("X-Request-Id", crypto.randomUUID());
  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/_next/static/:path*"],
};
