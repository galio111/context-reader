import { tokenizeArticle } from "@/lib/tokenizer";
import type { ImportedArticleInlineBaseline, ImportedArticleInlineText } from "@/types/article";
import type { ReaderToken } from "@/types/reader";

export interface ReaderInlineTokenGroup {
  id: string;
  baseline?: ImportedArticleInlineBaseline;
  tokens: ReaderToken[];
}

export function tokenizeReaderBlockText(
  text: string,
  paragraphIndex: number,
  scopeTokenId: (tokenId: string) => string = (tokenId) => tokenId,
): ReaderToken[] {
  const masked = text.replace(/[\r\n]/g, " ");
  return (tokenizeArticle(masked)[0]?.tokens ?? []).map((token, tokenIndex) => ({
    ...token,
    id: scopeTokenId(token.id),
    value: text.slice(token.start, token.end),
    paragraphIndex,
    tokenIndex,
  }));
}

export function groupReaderTokensByInline(
  tokens: ReaderToken[],
  inline: ImportedArticleInlineText[],
): ReaderInlineTokenGroup[] {
  const groups: ReaderInlineTokenGroup[] = [];
  let cursor = 0;

  inline.forEach((item, index) => {
    const start = cursor;
    const end = start + item.text.length;
    const groupTokens = tokens.flatMap((token): ReaderToken[] => {
      if (token.type === "word") {
        return token.start >= start && token.start < end ? [token] : [];
      }
      const overlapStart = Math.max(start, token.start);
      const overlapEnd = Math.min(end, token.end);
      if (overlapStart >= overlapEnd) return [];
      return [{
        ...token,
        id: `${token.id}-inline-${index}-${overlapStart}`,
        value: token.value.slice(overlapStart - token.start, overlapEnd - token.start),
        start: overlapStart,
        end: overlapEnd,
      }];
    });
    if (groupTokens.length > 0) {
      groups.push({
        id: `inline-${index}`,
        baseline: item.baseline,
        tokens: groupTokens,
      });
    }
    cursor = end;
  });

  return groups;
}
