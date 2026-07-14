import { NextResponse } from "next/server";
import { extractImageText } from "@/lib/visionOcr";
import {
  readResponseBytes,
  RemoteBodyTooLargeError,
  safeRemoteFetch,
  UnsafeRemoteUrlError,
} from "@/lib/safeRemoteFetch";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { CostCapacityError, withCostSlot } from "@/lib/costConcurrency";
import { finishUsage, refundUsage } from "@/lib/accountStore";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_OCR_ENABLED = true;

function imageToDataUrl(contentType: string, buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

export async function POST(request: Request) {
  if (!IMAGE_OCR_ENABLED) {
    return NextResponse.json({ error: "图片文字识别暂不可用。" }, { status: 503 });
  }

  let body: { url?: unknown } | null;
  try {
    body = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求体必须是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
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

  let actionId = "";
  try {
    actionId = (await gateUsage(request, {
      feature: "article_image_ocr",
      metricKey: "deep_reading",
      units: 5,
      loginRequired: true,
    })).actionId;
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "用量校验失败。" }, { status: 500 });
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
      return NextResponse.json(
        { error: `图片读取失败，目标网站返回 ${imageResponse.status}。` },
        { status: 502 },
      );
    }

    const contentType = imageResponse.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "这个链接返回的内容不是图片。" }, { status: 400 });
    }

    const buffer = await readResponseBytes(imageResponse, MAX_IMAGE_BYTES);

    const text = await withCostSlot("ocr", 2, () => extractImageText({
      dataUrl: imageToDataUrl(contentType, buffer),
      mode: "article-image",
    }));

    await finishUsage(actionId, "succeeded").catch(() => undefined);
    return NextResponse.json({ text });
  } catch (error) {
    await refundUsage(actionId, "failed", error instanceof Error ? error.name : "ocr_failed").catch(() => undefined);
    if (error instanceof CostCapacityError) {
      return NextResponse.json({ error: "OCR 服务当前请求较多，请稍后再试。" }, { status: 503, headers: { "Retry-After": "3" } });
    }
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: "该图片地址指向受保护的内部网络，无法识别。" }, { status: 400 });
    }
    if (error instanceof RemoteBodyTooLargeError) {
      return NextResponse.json({ error: "图片不能超过 8MB。" }, { status: 413 });
    }
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "图片文字识别超时，请换一张更清晰或更小的图片。"
        : error instanceof Error
          ? error.message
          : "图片文字识别失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
