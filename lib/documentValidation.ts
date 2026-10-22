import { MAX_DOCUMENT_BYTES } from "./documentSource";

// Inspect the ZIP directory before any decompression (also used in the browser).
export function validateDocumentBytes(bytes: Uint8Array, format: "pdf" | "docx") {
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) throw new Error("文档不能超过 20MB。");
  if (format === "pdf") {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("这不是有效的 PDF 文件。");
    return;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error("Word 文件已损坏，请重新另存为 .docx。");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true), total = 0, hasDocument = false;
  if (count > 3000 || count === 0) throw new Error("Word 文件内容过多，请拆分后导入。");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Word 文件结构不完整。");
    const size = view.getUint32(offset + 24, true);
    total += size;
    if (size > 40 * 1024 * 1024 || total > 80 * 1024 * 1024 || (view.getUint16(offset + 8, true) & 1)) throw new Error("Word 文件解压内容过大或已加密。");
    const length = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + length));
    if (name === "word/document.xml") hasDocument = true;
    if (/vbaProject|activeX|embeddings/i.test(name)) throw new Error("请移除宏和嵌入对象后另存为 .docx。");
    offset += 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (!hasDocument) throw new Error("请选择 Word 的 .docx 文件。");
}
