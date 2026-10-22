import type { ArticleTranslationBlock } from "@/types/reader";
// Preserve the complete paper when it fits. Longer documents retain the opening
// definitions plus a target-centred window, rather than always truncating the tail.
export function documentTranslationContext(all: ArticleTranslationBlock[], targets: ArticleTranslationBlock[], maxChars = 60_000, maxBlocks = 230) {
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
  for (let i = 0; i < Math.min(8, all.length); i++) add(i);
  for (let distance = 1; distance < all.length && used < maxChars && selected.size < maxBlocks; distance++) {
    for (const index of indexes) { add(index - distance); add(index + distance); }
  }
  return [...selected].sort((a,b) => a-b).map(i => all[i]);
}
