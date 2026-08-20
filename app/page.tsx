import type { Metadata } from "next";
import { HomeClient } from "@/components/HomeClient";
import { getHomepageCuration } from "@/lib/homepageCuration";
import { listPublicArticleSummaries } from "@/lib/publicArticles";

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
  const [initialPublicArticles, initialHomepageCuration] = await Promise.all([
    listPublicArticleSummaries().catch(() => []),
    getHomepageCuration().catch(() => undefined),
  ]);

  return (
    <HomeClient
      initialPublicArticles={initialPublicArticles}
      initialHomepageCuration={initialHomepageCuration}
      homeVariant="book"
      forceGuestPreview={params.preview === "guest"}
      forceMemberPreview={params.preview === "member"}
    />
  );
}
