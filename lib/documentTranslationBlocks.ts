import type { ArticleTranslationBlock } from "@/types/reader";

const page = (id: string) => id.match(/^doc-p(\d+)-/)?.[1];
const endsSentence = (text: string) => /[.!?。！？:：][\s\])}"'’”\d–—-]*$/.test(text);
const isLabel = (text: string) => /^(?:\d+(?:\.\d+)*\.?\s+[A-Z]|(?:abstract|introduction|conclusions?|references|keywords)\s*[:：]?$)/i.test(text)
  || /^[A-Z\s\d.,:()–-]{3,80}$/.test(text);

/** Join PDF line-wrap fragments for translation only. Source blocks, native
 * selection and their durable IDs remain untouched. A joined target has a new
 * identity so an old line translation cannot masquerade as a complete sentence. */
export function documentTranslationBlocks(blocks: ArticleTranslationBlock[]): ArticleTranslationBlock[] {
  const result: ArticleTranslationBlock[] = [];
  let sourceIds: string[] = [];
  for (const block of blocks) {
    const last = result.at(-1);
    const samePage = page(block.id) && page(block.id) === page(last?.id ?? "");
    if (last && samePage && last.type === "paragraph" && block.type === "paragraph"
      && !endsSentence(last.text) && !isLabel(last.text) && !isLabel(block.text)
      && last.text.length + block.text.length < 5_000) {
      sourceIds.push(block.id);
      const hyphenated = /[a-z]-$/.test(last.text) && /^[a-z]/.test(block.text);
      const join = hyphenated
        && !/^(?:resistant|negative|positive|dependent|induced|responsive|activated|targeting|functionalized)\b/.test(block.text);
      last.text = join ? last.text.slice(0, -1) + block.text : last.text + (hyphenated ? "" : " ") + block.text;
      last.id = `${sourceIds[0]}-joined-${sourceIds.at(-1)!.split("-").slice(2).join("-")}`;
    } else {
      result.push({ ...block });
      sourceIds = [block.id];
    }
  }
  return result;
}
