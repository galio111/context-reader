import sharp from "sharp";

// Run only during publishing/backfill, never during a public read. Every output
// preserves the accepted source's composition; the browser applies one crop.
export async function generateCoverVariants(bytes) {
  const source = sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 });
  const metadata = await source.metadata();
  const { width, height } = metadata.autoOrient || metadata;
  if (!width || !height) throw new Error("封面尺寸无效。");
  const items = [];
  for (const target of [480, 768, 1080, 1440, 1920]) {
    if (target >= width) continue; // Never enlarge, and keep the original at full resolution.
    const { data, info } = await source.clone().rotate().resize({ width: target, withoutEnlargement: true })
      .webp({ quality: 92, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (data.length > 5 * 1024 * 1024) throw new Error("封面变体超过大小上限。");
    // Some already-efficient sources are smaller than a re-encode. In that case
    // the original is both clearer and cheaper; omit this redundant candidate.
    if (data.length < bytes.length) items.push({ bytes: data, width: info.width, height: info.height });
  }
  return { width, height, items };
}
