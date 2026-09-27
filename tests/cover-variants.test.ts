import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { generateCoverVariants } from "../lib/coverVariants.mjs";

test("cover variants keep the accepted composition, never upscale, and preserve original as largest candidate", async () => {
  const source = await sharp({ create: { width: 1020, height: 776, channels: 3, background: "#c04020" } }).png().toBuffer();
  const result = await generateCoverVariants(source);
  assert.equal(result.width, 1020); assert.equal(result.height, 776);
  assert.deepEqual(result.items.map(i => i.width), [480, 768]);
  for (const item of result.items) {
    assert.ok(Math.abs(item.height - item.width * 776 / 1020) <= 1);
    const metadata = await sharp(item.bytes).metadata();
    assert.equal(metadata.width, item.width); assert.equal(metadata.height, item.height);
  }
  const small = await generateCoverVariants(await sharp(source).resize(240).toBuffer());
  assert.equal(small.items.length, 0);
});
