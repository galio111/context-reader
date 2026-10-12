import type { ImportedArticle, ImportedArticleBlock, ImportedArticleInlineText, ImportedArticleTableCell, ImportedImageLayoutWord } from "@/types/article";
import type { ReaderToken } from "@/types/reader";
import { groupReaderTokensByInline, tokenizeReaderBlockText, type ReaderInlineTokenGroup } from "@/lib/readerBlockTokens";
import { scopeReaderTokenId } from "@/lib/readerTokenIdentity";
import { createSourceSentenceIndex, normalizeForSourceMatch } from "@/lib/sourceMatching";

export type ImageOcrStatus = "idle" | "loading" | "ready" | "error";
export interface ImageOcrState { status: ImageOcrStatus; text: string; error: string }
export type ReaderTokenCache = Map<string, { text: string; paragraphIndex: number; idPrefix: string; tokens: ReaderToken[] }>;

export interface RenderableArticleBlock {
  id: string;
  type: ImportedArticleBlock["type"];
  tokens?: ReaderToken[];
  captionTokens?: ReaderToken[];
  tokenGroups?: RenderableTokenGroup[];
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  ocrStatus?: ImageOcrStatus;
  ocrError?: string;
  layoutWords?: ImportedImageLayoutWord[];
  layoutError?: string;
  listStyle?: ImportedArticleBlock["listStyle"];
  listLevel?: number;
  listOrdinal?: number;
  table?: ImportedArticleBlock["table"];
  tableRows?: RenderableTableCell[][];
  plainText?: string;
}

interface RenderableTableCell {
  cell: ImportedArticleTableCell;
  tokens: ReaderToken[];
}

export type RenderableTokenGroup = ReaderInlineTokenGroup;

export function importedBlockText(block: ImportedArticleBlock): string {
  if (block.type !== "table") {
    return block.text ?? "";
  }
  return block.text || block.table?.rows.map((row) => row.map((cell) => cell.text).join(" | ")).join("\n") || "";
}

export function inlinePlainText(inline: ImportedArticleInlineText[]): string {
  return inline.map((item) => item.text).join("");
}

/** A document-scoped compiler. It owns token reuse and derived indexes, never UI state or storage. */
export function createReaderDocumentModel(
  article: string,
  effectiveImportedArticle: ImportedArticle | null,
  imageOcr: Record<string, ImageOcrState>,
  tokenCache: ReaderTokenCache,
  ocrEnabled = false,
) {
  const activeCacheIds = new Set<string>();
  const cachedBlockTokens = (cacheId: string, text: string, paragraphIndex: number, idPrefix = "") => {
    activeCacheIds.add(cacheId);
    const cached = tokenCache.get(cacheId);
    if (cached?.text === text && cached.paragraphIndex === paragraphIndex && cached.idPrefix === idPrefix) return cached.tokens;
    const tokens = tokenizeReaderBlockText(text, paragraphIndex, tokenId => scopeReaderTokenId(idPrefix, tokenId));
    tokenCache.set(cacheId, { text, paragraphIndex, idPrefix, tokens });
    return tokens;
  };
  const plainArticleParagraphs = effectiveImportedArticle?.blocks?.length ? [] : article.split(/\r?\n/);
  const renderableBlocks: RenderableArticleBlock[] = (() => {
    if (!effectiveImportedArticle?.blocks?.length) {
      return plainArticleParagraphs.map((text, paragraphIndex) => {
        const id = `paragraph-${paragraphIndex}`;
        const tokens = cachedBlockTokens(`plain:${id}`, text, paragraphIndex, `${id}-`);
        return {
          id,
          type: "paragraph",
          tokens,
          plainText: text,
        };
      });
    }

    let textBlockIndex = 0;
    return effectiveImportedArticle.blocks
      .map((block): RenderableArticleBlock | null => {
        if (block.type === "image") {
          const captionText = block.alt?.trim() || "";
          const captionTokens = captionText
            ? cachedBlockTokens(`image-caption:${block.id}`, captionText, textBlockIndex, `${block.id}-caption-`)
            : undefined;
          if (captionTokens) textBlockIndex += 1;
          const ocrState = imageOcr[block.id];
          const ocrText = ocrEnabled ? ocrState?.text || block.ocrText?.trim() || "" : "";
          const tokens = ocrText
            ? tokenizeReaderBlockText(ocrText, textBlockIndex, (tokenId) => scopeReaderTokenId(`${block.id}-ocr-`, tokenId))
            : undefined;
          if (tokens) {
            textBlockIndex += 1;
          }
          return {
            id: block.id,
            type: "image",
            src: block.src,
            alt: block.alt,
            width: block.width,
            height: block.height,
            tokens,
            captionTokens,
            ocrStatus: ocrText ? "ready" : ocrState?.status ?? "idle",
            ocrError: ocrState?.error,
            layoutWords: block.layoutWords,
            layoutError: block.layoutError,
          };
        }

        if (block.type === "table" && block.table) {
          const tableTokens: ReaderToken[] = [];
          const tableRows = block.table.rows.map((row, rowIndex) => row.map((cell, cellIndex) => {
            const tokens = cachedBlockTokens(
              `table:${block.id}:${rowIndex}:${cellIndex}`,
              cell.text,
              textBlockIndex,
              `${block.id}-cell-${rowIndex}-${cellIndex}-`,
            );
            textBlockIndex += 1;
            tableTokens.push(...tokens);
            return { cell, tokens };
          }));
          return {
            id: block.id,
            type: "table",
            tokens: tableTokens,
            table: block.table,
            tableRows,
          };
        }

        const text = importedBlockText(block);
        if (!text.trim()) {
          textBlockIndex += 1;
          return {
            id: block.id,
            type: block.type,
            tokens: [],
          };
        }

        const tokens = cachedBlockTokens(`block:${block.id}`, text, textBlockIndex, `${block.id}-`);
        const inline = block.inline?.length && inlinePlainText(block.inline) === text ? block.inline : null;
        textBlockIndex += 1;

        return {
          id: block.id,
          type: block.type,
          tokens,
          plainText: text,
          ...(inline && tokens ? { tokenGroups: groupReaderTokensByInline(tokens, inline) } : {}),
          listStyle: block.listStyle,
          listLevel: block.listLevel,
          listOrdinal: block.listOrdinal,
          table: block.table,
        };
      })
      .filter((block): block is RenderableArticleBlock => Boolean(block));
  })();
  // Retain only this document's live keys. A long document must not evict itself at 400 blocks.
  for (const key of tokenCache.keys()) if (!activeCacheIds.has(key)) tokenCache.delete(key);

  const wordTokens: ReaderToken[] = [];
  const tokenBlockIdByTokenId = new Map<string, string>();
  const tokenById = new Map<string, ReaderToken>();
  const wordTokensByParagraph = new Map<number, ReaderToken[]>();
  const wordTokensBySentence = new Map<string, ReaderToken[]>();
  const sourceWordSet = new Set<string>();
  const sentenceNormalization = new Map<string, string>();
  const uniqueSentenceTokens: ReaderToken[] = [];
  for (const block of renderableBlocks) {
    for (const tokens of [block.tokens, block.captionTokens]) {
      for (const token of tokens ?? []) {
        tokenBlockIdByTokenId.set(token.id, block.id);
        if (token.type !== "word") continue;
        wordTokens.push(token);
        tokenById.set(token.id, token);
        const paragraph = wordTokensByParagraph.get(token.paragraphIndex) ?? [];
        paragraph.push(token);
        wordTokensByParagraph.set(token.paragraphIndex, paragraph);
        let sentence = sentenceNormalization.get(token.sentence);
        if (sentence === undefined) {
          sentence = normalizeForSourceMatch(token.sentence);
          sentenceNormalization.set(token.sentence, sentence);
          uniqueSentenceTokens.push(token);
        }
        const sentenceTokens = wordTokensBySentence.get(sentence) ?? [];
        sentenceTokens.push(token);
        wordTokensBySentence.set(sentence, sentenceTokens);
        const word = normalizeForSourceMatch(token.value);
        if (word) sourceWordSet.add(word);
      }
    }
  }
  const sourceSentenceIndex = createSourceSentenceIndex(uniqueSentenceTokens);
  const sourceSentenceSet = new Set(sourceSentenceIndex.exact.keys());
  return { renderableBlocks, wordTokens, tokenBlockIdByTokenId, tokenById, wordTokensByParagraph,
    wordTokensBySentence, sourceSentenceIndex, sourceSentenceSet, sourceWordSet };
}
