import type { Metadata } from "next";
import { HomeClient } from "@/components/HomeClient";
import { listPublicArticles } from "@/lib/publicArticles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Context Reader · Book preview",
  description: "Context Reader 书本空间首页预览。",
};

export default async function BookHomePage() {
  const initialPublicArticles = await listPublicArticles().catch(() => []);
  return <HomeClient initialPublicArticles={initialPublicArticles} homeVariant="book" />;
}
