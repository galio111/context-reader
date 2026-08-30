import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  finishUsage,
  getUsageAction,
  reserveUsage,
  setUsageActionMetadata,
} from "@/lib/accountStore";
import { readJsonBody } from "@/lib/limitedBody";
import { getPublicArticle, getPublishedArticleTranslation } from "@/lib/publicArticles";
import { resolveUsageIdentity } from "@/lib/usageIdentity";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StartBody {
  actionId?: unknown;
  cacheKey?: unknown;
  publicArticleId?: unknown;
  source?: unknown;
  articleCharacters?: unknown;
  blockCount?: unknown;
}

function stableUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function POST(request: Request) {
  const body = await readJsonBody<StartBody>(request, 64 * 1024).catch(() => null);
  const cacheKey = typeof body?.cacheKey === "string" ? body.cacheKey.trim() : "";
  const source = body?.source === "public_cache" ? "public_cache" : "generated";
  if (!cacheKey || cacheKey.length > 64) return NextResponse.json({ error: "全文翻译任务缺少文章版本。" }, { status: 400 });

  try {
    const identity = await resolveUsageIdentity(request);
    if (!identity.authenticated) return NextResponse.json({ error: "登录后才能使用全文翻译。", code: "login_required" }, { status: 401 });
    if (identity.suspended) return NextResponse.json({ error: "此账号已暂停使用，请联系管理员。", code: "account_suspended" }, { status: 403 });

    if (identity.localOnly) {
      const actionId = typeof body?.actionId === "string" && UUID_PATTERN.test(body.actionId) ? body.actionId : crypto.randomUUID();
      return NextResponse.json({ actionId, charged: false, localOnly: true, source });
    }

    let actionId = typeof body?.actionId === "string" && UUID_PATTERN.test(body.actionId) ? body.actionId : "";
    let metadata: Record<string, unknown> = {
      source,
      articleKey: cacheKey,
      articleCharacters: Math.max(0, Math.floor(Number(body?.articleCharacters) || 0)),
      blockCount: Math.max(0, Math.floor(Number(body?.blockCount) || 0)),
    };
    let publicTranslation: Awaited<ReturnType<typeof getPublishedArticleTranslation>> = null;

    if (source === "public_cache") {
      const publicArticleId = typeof body?.publicArticleId === "string" ? body.publicArticleId : "";
      publicTranslation = publicArticleId ? await getPublishedArticleTranslation(publicArticleId, cacheKey) : null;
      if (!publicTranslation) return NextResponse.json({ error: "这篇精选文章的预发布译文已失效，请刷新后重试。" }, { status: 409 });
      actionId = stableUuid(`public-translation:${identity.userId}:${publicArticleId}:${cacheKey}`);
      metadata = {
        ...metadata,
        publicArticleId,
        articleLabel: publicTranslation.article.title.slice(0, 160),
        blockCount: publicTranslation.blockCount,
        avoidedDeepSeekCalls: publicTranslation.providerBatchCount,
      };
    } else if (!actionId) {
      return NextResponse.json({ error: "全文翻译任务编号无效。" }, { status: 400 });
    } else if (typeof body?.publicArticleId === "string") {
      const article = await getPublicArticle(body.publicArticleId);
      if (article) metadata = { ...metadata, publicArticleId: article.id, articleLabel: article.title.slice(0, 160) };
    }

    const reservation = await reserveUsage({
      actionId,
      ownerKey: identity.ownerKey,
      userId: identity.userId,
      guestId: identity.guestId,
      planId: identity.planId,
      feature: "full_article_translation",
      metricKey: "full_article_translation",
      units: 1,
    });
    if (!reservation.allowed) return NextResponse.json({ error: "本月全文翻译次数已用完，可在用量页查看详情。", code: "quota_exhausted" }, { status: 429 });

    const existing = reservation.duplicate ? await getUsageAction(actionId) : null;
    if (!existing || existing.ownerKey === identity.ownerKey) {
      await setUsageActionMetadata(actionId, metadata).catch(() => undefined);
    }

    if (source === "public_cache" && publicTranslation) {
      await finishUsage(actionId, "cached", true, false);
      return NextResponse.json({
        actionId,
        charged: !reservation.duplicate,
        source,
        translations: publicTranslation.translation.translations,
      });
    }

    return NextResponse.json({ actionId, charged: !reservation.duplicate, source });
  } catch {
    return NextResponse.json({ error: "全文翻译用量服务暂时不可用，请稍后重试。", code: "account_unavailable" }, { status: 503 });
  }
}
