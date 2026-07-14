import { tokenizeArticle } from "@/lib/tokenizer";
import type { ImportedArticle } from "@/types/article";
import type { ArticleTranslationBlock, ReaderToken } from "@/types/reader";

function tokensToText(tokens?: ReaderToken[]): string {
  return tokens?.map((token) => token.value).join("").trim() ?? "";
}

function isTranslationBlockType(type: string): type is ArticleTranslationBlock["type"] {
  return type === "heading" || type === "subheading" || type === "paragraph" || type === "quote" || type === "list-item";
}

export function createArticleTranslationBlocks(article: string, importedArticle?: ImportedArticle | null): ArticleTranslationBlock[] {
  if (importedArticle?.blocks?.length) {
    return importedArticle.blocks
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
