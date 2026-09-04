import type { ImportedArticle, ImportedArticleBlock } from "@/types/article";

function normalizedIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function reindexBlocks(blocks: ImportedArticleBlock[]): ImportedArticleBlock[] {
  return blocks.map((block, index) => ({ ...block, id: `block-${index}` }));
}

function stripTitlePrefix(value: string, title: string): string | null {
  const normalizedValue = value.replace(/\s+/g, " ").trim();
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (!normalizedTitle || !normalizedValue) return null;
  if (normalizedIdentity(normalizedValue) === normalizedIdentity(normalizedTitle)) return "";

  const escapedTitle = normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalizedValue.match(new RegExp(`^${escapedTitle}(?=\\s|[.!?,:;–—-])\\s*`, "i"));
  if (!match) return null;
  const remainder = normalizedValue.slice(match[0].length).trim();
  return remainder.length >= 24 ? remainder : null;
}

/**
 * Keep one visible title and one copy of each adjacent text block. Publishers
 * frequently repeat the headline at the start of the standfirst, which then
 * makes the following lead paragraph appear twice after extraction.
 */
export function normalizeImportedArticleStructure(
  article: ImportedArticle,
): ImportedArticle {
  const title = article.title.trim();
  const hasHeading = article.blocks.some((block) => block.type === "heading");
  const withoutRepeatedTitle: ImportedArticleBlock[] = [];
  let inspectedTextBlocks = 0;

  for (const block of article.blocks) {
    if (block.type === "image" || block.type === "table") {
      withoutRepeatedTitle.push(block);
      continue;
    }

    let nextBlock = block;
    if (hasHeading && inspectedTextBlocks < 4 && block.type !== "heading") {
      const stripped = stripTitlePrefix(block.text ?? "", title);
      if (stripped === "") {
        inspectedTextBlocks += 1;
        continue;
      }
      if (stripped !== null) {
        nextBlock = { ...block, text: stripped, inline: undefined };
      }
    }
    inspectedTextBlocks += 1;

    const previous = withoutRepeatedTitle[withoutRepeatedTitle.length - 1];
    if (
      previous
      && previous.type !== "image"
      && previous.type !== "table"
      && normalizedIdentity(previous.text ?? "")
      && normalizedIdentity(previous.text ?? "") === normalizedIdentity(nextBlock.text ?? "")
    ) {
      continue;
    }
    withoutRepeatedTitle.push(nextBlock);
  }

  const blocks = reindexBlocks(withoutRepeatedTitle);
  const text = blocks
    .filter((block) => block.type !== "image")
    .map((block) => block.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return { ...article, text: text || article.text.trim(), blocks };
}
