import { NextRequest, NextResponse } from "next/server";
import { protectApiRequest } from "@/lib/requestSecurity";

export function middleware(request: NextRequest) {
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
  matcher: "/api/:path*",
};

