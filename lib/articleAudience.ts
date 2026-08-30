import type { ArticleAudienceStage, ArticleDifficulty } from "@/types/publicArticle";

export function audienceForDifficulty(difficulty: ArticleDifficulty): ArticleAudienceStage[] {
  const mapping: Record<ArticleDifficulty, ArticleAudienceStage[]> = {
    小学高年级: ["小学"],
    初中: ["初中"],
    "高中 / CET-4": ["高中", "CET-4", "IELTS", "TOEFL"],
    "CET-6 / 考研": ["CET-6", "考研", "IELTS", "TOEFL"],
    "雅思 / 托福基础": ["高中", "CET-4", "IELTS", "TOEFL"],
    "雅思 / 托福进阶": ["CET-6", "考研", "IELTS", "TOEFL"],
  };
  return mapping[difficulty];
}
