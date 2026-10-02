import { createHash } from "node:crypto";
import { englishWordCount } from "@/lib/billingPolicy";
export function translationBlockCharge(block: { id: string; text: string }) {
  const text = block.text.trim().slice(0, 32_000);
  return { id: block.id, hash: createHash("sha256").update(text).digest("hex"), words: englishWordCount(text) };
}
