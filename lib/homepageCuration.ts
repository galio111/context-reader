import { accountFetch } from "@/lib/accountStore";
import { revalidatePath } from "next/cache";
import { normalizeHomepageCuration, type HomepageCuration } from "@/lib/homepageCurationShared";
import { BoundedAsyncCache } from "@/lib/boundedAsyncCache";

const curationGlobal = globalThis as typeof globalThis & { __homepageCurationRead?: BoundedAsyncCache<HomepageCuration> };
const curationCache = curationGlobal.__homepageCurationRead ??= new BoundedAsyncCache<HomepageCuration>(30_000, 1, 512 * 1024);

const SETTING_KEY = "homepage_publication_curation";

export async function getHomepageCuration(): Promise<HomepageCuration> {
  return curationCache.get("public", async () => {
  const rows = await accountFetch<Array<{ value: unknown }>>(
    `account_settings?key=eq.${SETTING_KEY}&select=value&limit=1`,
  );
  return normalizeHomepageCuration(rows[0]?.value);
  });
}

export async function saveHomepageCuration(value: unknown): Promise<HomepageCuration> {
  const normalized = normalizeHomepageCuration(value);
  const next: HomepageCuration = { ...normalized, updatedAt: new Date().toISOString() };
  await accountFetch("account_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key: SETTING_KEY, value: next, updated_at: next.updatedAt }]),
  });
  revalidatePath("/");
  curationCache.clear();
  return next;
}
