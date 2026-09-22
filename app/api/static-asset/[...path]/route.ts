import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { acceptsBrotli, staticAssetParts } from "@/lib/staticEncoding";

export const runtime = "nodejs";

/** Same-origin immutable build assets only. No account, API or HTML response is cached here. */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!staticAssetParts(path)) return new Response(null, { status: 404 });
  if (!acceptsBrotli(request.headers.get("accept-encoding"))) return new Response(null, { status: 406 });
  try {
    const bytes = await readFile(join(process.cwd(), ".next", "static", ...path) + ".br");
    return new Response(bytes, { headers: {
      "Content-Type": path.at(-1)!.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8",
      "Content-Encoding": "br",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Vary": "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
    throw error;
  }
}
