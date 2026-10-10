import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { accountFetch } from "@/lib/accountStore";
import { shanghaiDay } from "@/lib/discoveryPolicy";
import { shufflePublishedHomepageCuration } from "@/lib/editorialCuration";
import { invalidateHomepageCuration } from "@/lib/homepageCuration";
import { normalizeHomepageCuration } from "@/lib/homepageCurationShared";
import type { PublicArticle } from "@/types/publicArticle";

/** Caller holds the discovery lease. Order and receipt commit together, so a
 * retry after a crash cannot reshuffle an already completed publication set. */
export async function finalizeEditorialShuffle(day: string, articles: PublicArticle[]): Promise<void> {
  const key = "homepage_publication_curation";
  const publicationSignature = createHash("sha256").update(JSON.stringify(articles
    .filter(article => shanghaiDay(article.recommendation?.autoPublishedAt || "") === day)
    .map(article => article.id).sort())).digest("hex");
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await accountFetch<Array<{ value: unknown; updated_at: string }>>(
      `account_settings?key=eq.${key}&select=value,updated_at`,
    );
    if (!rows[0]) {
      await accountFetch("account_settings?on_conflict=key", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify([{ key, value: normalizeHomepageCuration(null), updated_at: new Date().toISOString() }]),
      });
      continue;
    }
    const current = normalizeHomepageCuration(rows[0].value);
    if (current.editorialShuffle?.day === day && current.editorialShuffle.publicationSignature === publicationSignature) {
      // Also repair a crash after the database write but before cache invalidation.
      invalidateHomepageCuration();
      revalidatePath("/");
      return;
    }
    const value = shufflePublishedHomepageCuration(current, articles, `${day}T12:00:00+08:00`);
    value.updatedAt = new Date().toISOString();
    value.editorialShuffle = { day, publicationSignature, completedAt: value.updatedAt };
    const saved = await accountFetch<unknown[]>(
      `account_settings?key=eq.${key}&updated_at=eq.${encodeURIComponent(rows[0].updated_at)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ value, updated_at: value.updatedAt }) },
    );
    if (saved.length) {
      invalidateHomepageCuration();
      revalidatePath("/");
      return;
    }
  }
  throw new Error("每日精选排序保存冲突，下批自动重试。");
}
