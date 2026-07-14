import { NextResponse } from "next/server";
import { extractImageText } from "@/lib/visionOcr";
import { readFormDataBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { CostCapacityError, withCostSlot } from "@/lib/costConcurrency";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_OCR_ENABLED = true;

function imageToDataUrl(file: File, buffer: ArrayBuffer): string {
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${file.type};base64,${base64}`;
}

export async function POST(request: Request) {
  if (!IMAGE_OCR_ENABLED) {
    return NextResponse.json({ error: "OCR 识别暂不可用。" }, { status: 503 });
  }

  let formData: FormData | null;
  try {
    formData = await readFormDataBody(request, MAX_IMAGE_BYTES + 512 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "图片不能超过 8MB。" : "上传数据格式无效。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  const file = formData?.get("image");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传一张需要 OCR 的图片。" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "OCR 只支持图片文件。" }, { status: 400 });
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "图片不能超过 8MB。" }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const text = await withCostSlot("ocr", 2, () => extractImageText({
      dataUrl: imageToDataUrl(file, buffer),
      mode: "upload",
    }));

    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof CostCapacityError) {
      return NextResponse.json({ error: "OCR 服务当前请求较多，请稍后再试。" }, { status: 503, headers: { "Retry-After": "3" } });
    }
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "OCR 识别超时，请换一张更清晰或更小的图片。"
        : error instanceof Error
          ? error.message
          : "OCR 识别失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
