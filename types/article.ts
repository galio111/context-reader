export type ImportedArticleBlockType =
  | "heading"
  | "subheading"
  | "paragraph"
  | "list-item"
  | "quote"
  | "image";

export type ImportedArticleInlineBaseline = "sup" | "sub";

export interface ImportedArticleInlineText {
  text: string;
  baseline?: ImportedArticleInlineBaseline;
}

export interface ImportedArticleBlock {
  id: string;
  type: ImportedArticleBlockType;
  text?: string;
  inline?: ImportedArticleInlineText[];
  src?: string;
  alt?: string;
  ocrText?: string;
}

export interface ImportedArticle {
  title: string;
  url: string;
  siteName: string;
  text: string;
  blocks: ImportedArticleBlock[];
}

export interface SavedArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  importedArticle?: ImportedArticle;
  createdAt: string;
  updatedAt: string;
}
