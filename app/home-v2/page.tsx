import type { Metadata } from "next";
import { HomeClient } from "@/components/HomeClient";
import { listPublicArticleSummaries } from "@/lib/publicArticles";
import { getHomepageCuration } from "@/lib/homepageCuration";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Context Reader · Book preview",
  description: "Context Reader 书本空间首页预览。",
};

export default async function BookHomePage({
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
