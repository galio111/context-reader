import { NextResponse } from "next/server";
import {
  readResponseBytes,
  RemoteBodyTooLargeError,
  safeRemoteFetch,
  UnsafeRemoteUrlError,
} from "@/lib/safeRemoteFetch";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function safeFilename(value: string): string {
  const filename = value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
  return filename || `context-reader-image-${Date.now()}.jpg`;
}

function filenameFromUrl(url: URL): string {
  const lastPathSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return safeFilename(lastPathSegment || `context-reader-image-${Date.now()}.jpg`);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url")?.trim() ?? "";
  const requestedFilename = requestUrl.searchParams.get("filename")?.trim() ?? "";

  if (!rawUrl) {
    return NextResponse.json({ error: "缺少图片 URL。" }, { status: 400 });
  }

  let imageUrl: URL;
  try {
    imageUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "图片 URL 格式不正确。" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(imageUrl.protocol)) {
    return NextResponse.json({ error: "只支持下载 http 或 https 图片。" }, { status: 400 });
  }

  try {
    const imageResponse = await safeRemoteFetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!imageResponse.ok) {
      return NextResponse.json({ error: `图片读取失败，目标网站返回 ${imageResponse.status}。` }, { status: 502 });
    }

    const contentType = imageResponse.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "这个链接返回的内容不是图片。" }, { status: 400 });
    }

    const buffer = await readResponseBytes(imageResponse, MAX_IMAGE_BYTES);

    const filename = safeFilename(requestedFilename) || filenameFromUrl(imageUrl);
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: "该图片地址指向受保护的内部网络，无法下载。" }, { status: 400 });
    }
    if (error instanceof RemoteBodyTooLargeError) {
      return NextResponse.json({ error: "图片不能超过 20MB。" }, { status: 413 });
    }
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "图片下载超时，请稍后重试。"
        : error instanceof Error
          ? error.message
          : "图片下载失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
