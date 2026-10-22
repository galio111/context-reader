import type { Metadata } from "next";
import { withinStartupBudget } from "@/lib/startupBudget";
import { preload } from "react-dom";
import { HomeClient } from "@/components/HomeClient";
import { getHomepageCuration } from "@/lib/homepageCuration";
import { listPublicArticleSummaries } from "@/lib/publicArticles";
import { publicArticleSummary } from "@/lib/publicArticleSummary";
import { homepageBootstrap, homepageBootstrapCuration } from "@/lib/homepageBootstrap";
import { shanghaiDay } from "@/lib/discoveryPolicy";
import { homepageShowcaseArticles, orderHomepageRecommendations, HOMEPAGE_RECOMMENDATION_TARGET } from "@/lib/homepageRecommendations";
import { emptyRecommendationPreferences } from "@/lib/recommendationPreferencesShared";
import { coverSource } from "@/lib/coverSources";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Context Reader",
  description: "在真实语境中阅读英文文章，理解词语，并继续自己的阅读进度。",
  alternates: {
    canonical: "/",
  },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  const seed = await withinStartupBudget(Promise.all([
    listPublicArticleSummaries(),
    getHomepageCuration().catch(() => undefined),
  ]));
  const initialPublicArticles = seed?.[0] ?? [];
  const initialHomepageCuration = seed?.[1];

  const bootstrap = homepageBootstrap(initialPublicArticles.map(publicArticleSummary), initialHomepageCuration, shanghaiDay(new Date().toISOString()));
  const showcase = homepageShowcaseArticles(orderHomepageRecommendations(bootstrap.articles, initialHomepageCuration, emptyRecommendationPreferences(), shanghaiDay(new Date().toISOString())), HOMEPAGE_RECOMMENDATION_TARGET);
  for (const [index, article] of showcase.slice(0, 1).entries()) {
    const cover = coverSource(article, index === 0);
    if (cover) preload(cover.src, { as: "image", imageSrcSet: cover.srcSet, imageSizes: cover.sizes, fetchPriority: "high" });
  }
  return (
    <HomeClient
      initialPublicArticles={bootstrap.articles}
      initialCatalogueComplete={seed !== undefined && bootstrap.complete}
      initialCatalogueCounts={seed ? bootstrap.counts : undefined}
      initialHomepageCuration={homepageBootstrapCuration(initialHomepageCuration, bootstrap.articles)}
      homeVariant="book"
      forceGuestPreview={params.preview === "guest"}
      forceMemberPreview={params.preview === "member"}
    />
  );
}
