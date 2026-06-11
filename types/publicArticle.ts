import type { ImportedArticle } from "@/types/article";
import type { WordExplanation } from "@/types/reader";

export interface PublicExplanation {
  id?: string;
  cacheKey: string;
  word: string;
  sentence: string;
  explanation: WordExplanation;
}

export interface PublicArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  sourceUrl: string;
  sourceName: string;
  importedArticle?: ImportedArticle;
  explanations?: PublicExplanation[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicArticleInput {
  title: string;
  summary: string;
  body: string;
  sourceUrl?: string;
  sourceName?: string;
  importedArticle?: ImportedArticle | null;
  explanations?: PublicExplanation[];
}

