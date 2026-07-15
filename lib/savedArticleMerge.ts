import type { SavedArticle } from "../types/article";

const RECOVERY_ID_SUFFIX = /(?:-local-recovered-[a-z0-9]+)+$/i;
const RECOVERY_TITLE_SUFFIX = /(?:\uFF08\u672C\u5730\u6062\u590D\u526F\u672C\uFF09)+$/u;

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value && timestamp(value)))
    .sort((left, right) => timestamp(right) - timestamp(left))[0];
}

function earliestDate(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value && timestamp(value)))
    .sort((left, right) => timestamp(left) - timestamp(right))[0];
}

function articleRichness(article: SavedArticle): number {
  return article.body.length
    + article.summary.length * 4
    + JSON.stringify(article.importedArticle ?? null).length;
}

function isRecoveryArticle(article: SavedArticle): boolean {
  return RECOVERY_ID_SUFFIX.test(article.id) || RECOVERY_TITLE_SUFFIX.test(article.title.trim());
}

function baseArticleId(id: string): string {
  return id.replace(RECOVERY_ID_SUFFIX, "");
}

function cleanArticleTitle(title: string): string {
  return title.trim().replace(RECOVERY_TITLE_SUFFIX, "").trim();
}

export function savedArticleBodyIdentity(body: string): string {
  return body.trim().replace(/\s+/g, " ").toLowerCase();
}

export function savedArticleOpenTimestamp(article: SavedArticle): number {
  return timestamp(article.lastOpenedAt || article.updatedAt || article.createdAt);
}

export function mergeDuplicateSavedArticles(source: SavedArticle[]): {
  articles: SavedArticle[];
  removedIds: string[];
} {
  const validArticles = source.filter((article) => savedArticleBodyIdentity(article.body));
  const parents = validArticles.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const bodyOwners = new Map<string, number>();
  const idOwners = new Map<string, number>();

  validArticles.forEach((article, index) => {
    const bodyIdentity = savedArticleBodyIdentity(article.body);
    const bodyOwner = bodyOwners.get(bodyIdentity);
    if (bodyOwner === undefined) bodyOwners.set(bodyIdentity, index);
    else union(index, bodyOwner);

    const lineageId = baseArticleId(article.id);
    const idOwner = idOwners.get(lineageId);
    if (idOwner === undefined) idOwners.set(lineageId, index);
    else union(index, idOwner);
  });

  const groups = new Map<number, SavedArticle[]>();
  validArticles.forEach((article, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(article);
    groups.set(root, group);
  });

  const canonicalOriginal = (group: SavedArticle[]): SavedArticle | undefined => {
    const lineageOriginal = group.find((candidate) => (
      !isRecoveryArticle(candidate)
      && group.some((article) => article.id !== candidate.id && baseArticleId(article.id) === candidate.id)
    ));
    if (lineageOriginal) return lineageOriginal;
    return group
      .filter((article) => !isRecoveryArticle(article))
      .sort((left, right) => timestamp(left.createdAt) - timestamp(right.createdAt))[0];
  }

  const removedIds = new Set<string>();
  const articles = Array.from(groups.values()).map((group) => {
    const original = canonicalOriginal(group);
    const richest = [...group].sort((left, right) => articleRichness(right) - articleRichness(left))[0];
    const canonicalId = original?.id || baseArticleId(group[0].id);
    const canonicalTitle = cleanArticleTitle(original?.title || richest.title) || cleanArticleTitle(richest.title);
    const createdAt = earliestDate(group.map((article) => article.createdAt)) || richest.createdAt;
    const updatedAt = latestDate(group.map((article) => article.updatedAt)) || richest.updatedAt;
    const lastOpenedAt = latestDate(group.map((article) => article.lastOpenedAt)) || updatedAt;

    for (const article of group) {
      if (article.id !== canonicalId) removedIds.add(article.id);
    }

    return {
      ...richest,
      id: canonicalId,
      title: canonicalTitle,
      createdAt,
      updatedAt,
      lastOpenedAt,
    };
  });

  articles.sort((left, right) => savedArticleOpenTimestamp(right) - savedArticleOpenTimestamp(left));
  return { articles, removedIds: Array.from(removedIds) };
}
