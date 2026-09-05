import sharp from "sharp";
import { safeRemoteFetch, readResponseBytes } from "@/lib/safeRemoteFetch";
export async function discoveryImageIsReadable(url: string): Promise<boolean> {
  try {
    const response = await safeRemoteFetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return false;
    const metadata = await sharp(await readResponseBytes(response, 5_000_000), { limitInputPixels: 40_000_000 }).metadata();
    return (metadata.width || 0) >= 300 && (metadata.height || 0) >= 150;
  } catch { return false; }
}
