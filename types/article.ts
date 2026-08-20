export type ImportedArticleBlockType =
  | "heading"
  | "subheading"
  | "paragraph"
  | "list-item"
  | "quote"
  | "caption"
  | "table"
  | "image";

export type ImportedArticleInlineBaseline = "sup" | "sub";

export interface ImportedArticleInlineText {
  text: string;
  baseline?: ImportedArticleInlineBaseline;
}

export interface ImportedArticleTableCell {
  text: string;
  header?: boolean;
  scope?: "row" | "col";
  rowSpan?: number;
  colSpan?: number;
}

export interface ImportedArticleTable {
  caption?: string;
  rows: ImportedArticleTableCell[][];
}

export interface ImportedImageLayoutWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lineText: string;
}

export interface ImportedArticleBlock {
  id: string;
  type: ImportedArticleBlockType;
  text?: string;
  inline?: ImportedArticleInlineText[];
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  caption?: string;
  listStyle?: "ordered" | "unordered";
  listLevel?: number;
  listOrdinal?: number;
  table?: ImportedArticleTable;
  ocrText?: string;
  layoutWords?: ImportedImageLayoutWord[];
  layoutError?: string;
}

export interface ArticleReadingStyle {
  fontFamily?: "system" | "serif" | "mono";
  fontSize?: "small" | "default" | "large" | "xlarge";
  lineHeight?: "compact" | "default" | "relaxed";
  paragraphSpacing?: "compact" | "default" | "relaxed";
  contentWidth?: "narrow" | "default" | "wide";
  imageWidth?: "small" | "medium" | "full";
}

export interface ImportedArticle {
  title: string;
  url: string;
  siteName: string;
  text: string;
  blocks: ImportedArticleBlock[];
  byline?: string;
  publishedTime?: string;
  language?: string;
  style?: ArticleReadingStyle;
  recommendation?: import("@/types/publicArticle").ArticleRecommendationMetadata;
}

export interface SavedArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  importedArticle?: ImportedArticle;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  readingProgress?: import("@/types/reader").ReaderReadingProgress;
}
