import { NextResponse } from "next/server";
import { extractImageText } from "@/lib/visionOcr";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_OCR_ENABLED = false;

function imageToDataUrl(contentType: string, buffer: ArrayBuffer): string {
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

export async function POST(request: Request) {
  if (!IMAGE_OCR_ENABLED) {
    return NextResponse.json({ error: "图片文字识别暂不可用。" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";

  if (!rawUrl) {
    return NextResponse.json({ error: "请先提供图片 URL。" }, { status: 400 });
  }

  let imageUrl: URL;
  try {
    imageUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "图片 URL 格式不正确。" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(imageUrl.protocol)) {
    return NextResponse.json({ error: "只支持 http 或 https 图片链接。" }, { status: 400 });
  }

  try {
    const imageResponse = await fetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: `图片读取失败，目标网站返回 ${imageResponse.status}。` },
        { status: 502 },
      );
    }

    const contentType = imageResponse.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "这个链接返回的内容不是图片。" }, { status: 400 });
    }

    const contentLength = Number.parseInt(imageResponse.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "图片不能超过 8MB。" }, { status: 400 });
    }

    const buffer = await imageResponse.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "图片不能超过 8MB。" }, { status: 400 });
    }

    const text = await extractImageText({
      dataUrl: imageToDataUrl(contentType, buffer),
      mode: "article-image",
    });

    return NextResponse.json({ text });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "图片文字识别超时，请换一张更清晰或更小的图片。"
        : error instanceof Error
          ? error.message
          : "图片文字识别失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
