import { tokenizeArticle } from "@/lib/tokenizer";
import { documentReadingContent, type DocumentTranslationScope } from "@/lib/documentReadingContent";
import type { ImportedArticle } from "@/types/article";
import type { ArticleTranslationBlock, ReaderToken } from "@/types/reader";

function tokensToText(tokens?: ReaderToken[]): string {
  return tokens?.map((token) => token.value).join("").trim() ?? "";
}

function isTranslationBlockType(type: string): type is ArticleTranslationBlock["type"] {
  return type === "heading" || type === "subheading" || type === "paragraph" || type === "quote" || type === "list-item" || type === "caption" || type === "table";
}

export function createArticleTranslationBlocks(article: string, importedArticle?: ImportedArticle | null, scope: DocumentTranslationScope | "context" = "body"): ArticleTranslationBlock[] {
  if (importedArticle?.blocks?.length) {
    const reading = importedArticle.document ? documentReadingContent(importedArticle.blocks) : null;
    const selectedIds = reading && scope === "context" ? new Set([...reading.body, ...reading.captions].map(block => block.id)) : null;
    const blocks = reading ? scope === "context" ? importedArticle.blocks.filter(block => selectedIds!.has(block.id)) : reading[scope] : importedArticle.blocks;
    return blocks
      .filter((block) => block.type !== "image" && isTranslationBlockType(block.type))
      .map((block) => ({
        id: block.id,
        type: block.type as ArticleTranslationBlock["type"],
        text: block.text ?? "",
      }))
      .filter((block) => block.text.length > 0);
  }

  return tokenizeArticle(article)
    .map((paragraph) => ({
      id: paragraph.id,
      type: "paragraph" as const,
      text: tokensToText(paragraph.tokens),
    }))
    .filter((block) => block.text.length > 0);
}
