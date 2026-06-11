import { HomeClient } from "@/components/HomeClient";
import { listPublicArticles } from "@/lib/publicArticles";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialPublicArticles = await listPublicArticles().catch(() => []);

  return <HomeClient initialPublicArticles={initialPublicArticles} />;
}
