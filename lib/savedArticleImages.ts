import { accountFetch, writeSyncObjects } from "@/lib/accountStore";
import { hasExternalImportedArticleImages } from "@/lib/articleImageUrls";
import { localizeImportedArticleImages } from "@/lib/publicArticleCovers";
import type { SavedArticle } from "@/types/article";

interface SavedArticleObjectRow {
  user_id: string;
  object_key: string;
  payload: SavedArticle;
  client_updated_at: string;
  server_version: number | string;
}

const PAGE_SIZE = 250;
const MAX_ROWS = 20_000;

async function listActiveSavedArticleObjects(): Promise<SavedArticleObjectRow[]> {
  const rows: SavedArticleObjectRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await accountFetch<SavedArticleObjectRow[]>(
      `user_data_objects?kind=eq.article&deleted_at=is.null&select=user_id,object_key,payload,client_updated_at,server_version&order=user_id.asc,object_key.asc&limit=${PAGE_SIZE}&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function repairExternalSavedArticleImages() {
  const rows = await listActiveSavedArticleObjects();
  const result = {
    scanned: rows.length,
    eligible: 0,
    updated: [] as Array<{ userId: string; articleId: string; title: string; localizedImages: number }>,
    skipped: 0,
    failed: [] as Array<{ userId: string; articleId: string; title: string; error: string }>,
  };

  for (const row of rows) {
    const savedArticle = row.payload;
    if (!savedArticle?.id || !savedArticle.importedArticle || !hasExternalImportedArticleImages(savedArticle.importedArticle)) {
      result.skipped += 1;
      continue;
    }
    result.eligible += 1;
    const title = savedArticle.title || savedArticle.importedArticle.title || "未命名文章";
    try {
      const localized = await localizeImportedArticleImages(
        savedArticle.importedArticle,
        savedArticle.importedArticle.url,
      );
      if (!localized.localized) {
        result.failed.push({
          userId: row.user_id,
          articleId: row.object_key,
          title,
          error: localized.failures[0]?.error || "没有图片成功保存到本站。",
        });
        continue;
      }

      const writeResult = await writeSyncObjects(row.user_id, [{
        kind: "article",
        objectKey: row.object_key,
        payload: { ...savedArticle, importedArticle: localized.article },
        clientUpdatedAt: new Date().toISOString(),
        serverVersion: Number(row.server_version),
      }]);
      if (!writeResult[0]?.accepted) {
        result.failed.push({
          userId: row.user_id,
          articleId: row.object_key,
          title,
          error: "文章在修复期间被另一台设备更新，请重新运行修复。",
        });
        continue;
      }
      result.updated.push({
        userId: row.user_id,
        articleId: row.object_key,
        title,
        localizedImages: localized.localized,
      });
      for (const failure of localized.failures) {
        result.failed.push({
          userId: row.user_id,
          articleId: row.object_key,
          title,
          error: failure.error,
        });
      }
    } catch (error) {
      result.failed.push({
        userId: row.user_id,
        articleId: row.object_key,
        title,
        error: error instanceof Error ? error.message : "保存文章图片修复失败。",
      });
    }
  }
  return result;
}
