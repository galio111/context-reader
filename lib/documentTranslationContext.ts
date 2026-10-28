import type { ArticleTranslationBlock } from "@/types/reader";
// Keep targets intact and use bounded opening/nearby context. Re-sending a whole
// paper for every small PDF block multiplies both latency and uncached input cost.
export function documentTranslationContext(all: ArticleTranslationBlock[], targets: ArticleTranslationBlock[], maxChars = 4_000, maxBlocks = 24) {
  if (!all.some(b => b.id.startsWith("doc-"))) return all;
  if (all.length <= maxBlocks && all.reduce((n, b) => n + b.text.length, 0) <= maxChars) return all;
  const selected = new Set<number>();
  let used = 0;
  const add = (index: number) => {
    const block = all[index];
    if (!block || selected.has(index) || selected.size >= maxBlocks || used + block.text.length > maxChars) return;
    selected.add(index); used += block.text.length;
  };
  const indexes = targets.map(target => all.findIndex(b => b.id === target.id)).filter(i => i >= 0);
  indexes.forEach(add);
  // The opening abstract normally defines the paper's principal abbreviations.
  for (let i = 0; i < Math.min(2, all.length); i++) add(i);
  for (let distance = 1; distance < all.length && used < maxChars && selected.size < maxBlocks; distance++) {
    for (const index of indexes) { add(index - distance); add(index + distance); }
  }
  return [...selected].sort((a,b) => a-b).map(i => all[i]);
}
