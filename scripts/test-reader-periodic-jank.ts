import { performance } from "node:perf_hooks";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  readonly reads = new Map<string, number>();
  readonly writes = new Map<string, number>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key: string): string | null {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    return this.values.get(key) ?? null;
  }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
    this.values.set(key, value);
  }
  resetCounts(): void { this.reads.clear(); this.writes.clear(); }
}

const storage = new MemoryStorage();
const eventTarget = new EventTarget();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: storage,
    setTimeout,
    clearTimeout,
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
  },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {},
});

const ARTICLES_KEY = "context-reader:articles:v1";
const READING_STATES_KEY = "context-reader:reading-states:v1";
const SYNC_STATE_KEY = "context-reader:sync-state:v2";
const articleBody = "The same realistic long-form paragraph is repeated for a storage benchmark. ".repeat(900);
const articles = Array.from({ length: 48 }, (_, index) => ({
  id: `article-${index}`,
  title: `Article ${index}`,
  summary: "",
  body: `${articleBody}${index}`,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  lastOpenedAt: "2026-08-28T00:00:00.000Z",
}));
const articleJson = JSON.stringify(articles);
storage.setItem(ARTICLES_KEY, articleJson);

const oldDurations: number[] = [];
for (let index = 0; index < 12; index += 1) {
  const startedAt = performance.now();
  const parsed = JSON.parse(articleJson) as typeof articles;
  parsed[0] = { ...parsed[0], lastOpenedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  JSON.stringify(parsed);
  oldDurations.push(performance.now() - startedAt);
}

async function main(): Promise<void> {
  const { getSavedArticles, resetArticleReadingProgress, saveArticleReadingProgress, touchSavedArticle } = await import("../lib/articles");
  getSavedArticles();
  storage.resetCounts();
  const newDurations: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    const startedAt = performance.now();
    saveArticleReadingProgress("article-0", {
      blockId: `paragraph-${index}`,
      blockIndex: index,
      blockText: `Paragraph ${index}`,
      top: 80,
      scrollY: 800 + index * 500,
      scrollRatio: 0.1 + index * 0.02,
    });
    newDurations.push(performance.now() - startedAt);
  }
  saveArticleReadingProgress("article-0", {
    blockId: "paragraph-0",
    blockIndex: 0,
    blockText: "Paragraph 0",
    top: 80,
    scrollY: 0,
    scrollRatio: 0,
  });
  let latestReadingState = JSON.parse(storage.getItem(READING_STATES_KEY) || "{}") as Record<string, { readingProgress?: { scrollY?: number } }>;
  if (latestReadingState["article-0"]?.readingProgress?.scrollY === 0) {
    throw new Error("Ordinary backward scrolling replaced the last stable forward position.");
  }
  resetArticleReadingProgress("article-0");
  latestReadingState = JSON.parse(storage.getItem(READING_STATES_KEY) || "{}") as Record<string, { readingProgress?: { scrollY?: number } }>;
  if (latestReadingState["article-0"]?.readingProgress?.scrollY !== 0) {
    throw new Error("Explicit restart did not replace the older reading position with the article top.");
  }
  touchSavedArticle("article-0");

  if ((storage.writes.get(ARTICLES_KEY) ?? 0) !== 0) {
    throw new Error("Reading progress rewrote the full saved-article payload.");
  }
  if ((storage.writes.get(READING_STATES_KEY) ?? 0) < 14) {
    throw new Error("Reading progress did not persist through the lightweight reading-state store.");
  }

  storage.setItem(SYNC_STATE_KEY, JSON.stringify({
    protocol: 2,
    initialized: true,
    cursor: "cursor-1",
    manifest: {},
  }));
  storage.resetCounts();
  let mergeEvents = 0;
  eventTarget.addEventListener("context-reader:account-data-merged", () => { mergeEvents += 1; });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(JSON.stringify({ objects: [], nextCursor: "cursor-1", hasMore: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });
  const { syncAccountData } = await import("../lib/accountSyncClient");
  await syncAccountData({ mode: "pull-only" });
  for (const key of [ARTICLES_KEY, "context-reader:vocabulary:v1", "context-reader:explanations:v5"]) {
    if ((storage.reads.get(key) ?? 0) !== 0 || (storage.writes.get(key) ?? 0) !== 0) {
      throw new Error(`No-change pull touched heavy local payload: ${key}`);
    }
  }
  if (mergeEvents !== 0) throw new Error("No-change pull emitted a data-merged event.");

  storage.resetCounts();
  const remoteReadingState = {
    articleId: "article-remote",
    lastOpenedAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-08-28T12:00:00.000Z",
    readingProgress: {
      blockId: "paragraph-7",
      blockIndex: 7,
      blockText: "Remote paragraph",
      top: 96,
      scrollY: 2400,
      scrollRatio: 0.42,
      capturedAt: "2026-08-28T12:00:00.000Z",
    },
  };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(JSON.stringify({
      objects: [{
        kind: "reading_state",
        objectKey: remoteReadingState.articleId,
        payload: remoteReadingState,
        clientUpdatedAt: remoteReadingState.updatedAt,
        serverVersion: 1,
      }],
      nextCursor: "cursor-2",
      hasMore: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  await syncAccountData({ mode: "pull-only" });
  const mergedReadingStates = JSON.parse(storage.getItem(READING_STATES_KEY) || "{}") as Record<string, unknown>;
  if (!mergedReadingStates[remoteReadingState.articleId]) {
    throw new Error("Cloud reading state was not merged into the lightweight store.");
  }
  for (const key of [ARTICLES_KEY, "context-reader:vocabulary:v1", "context-reader:explanations:v5"]) {
    if ((storage.reads.get(key) ?? 0) !== 0 || (storage.writes.get(key) ?? 0) !== 0) {
      throw new Error(`Reading-state pull touched unrelated heavy payload: ${key}`);
    }
  }
  if (Number(mergeEvents) !== 1) throw new Error("Reading-state pull did not emit exactly one merge event.");

  let pushedKinds: string[] = [];
  storage.resetCounts();
  Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      const payload = JSON.parse(String(init.body)) as { objects: Array<{ kind: string; objectKey: string; payload: unknown; clientUpdatedAt: string; serverVersion: number }> };
      pushedKinds = payload.objects.map((object) => object.kind);
      return new Response(JSON.stringify({
        objects: payload.objects.map((object, index) => ({ ...object, accepted: true, serverVersion: index + 1 })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ objects: [], nextCursor: "cursor-1", hasMore: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
  });
  await syncAccountData({ mode: "full", dirtyKinds: ["reading_state"] });
  if (pushedKinds.length === 0 || pushedKinds.some((kind) => kind !== "reading_state")) {
    throw new Error(`Scoped reading-state sync pushed unexpected kinds: ${JSON.stringify(pushedKinds)}`);
  }
  for (const key of [ARTICLES_KEY, "context-reader:vocabulary:v1", "context-reader:explanations:v5"]) {
    if ((storage.reads.get(key) ?? 0) !== 0 || (storage.writes.get(key) ?? 0) !== 0) {
      throw new Error(`Scoped reading-state sync touched heavy local payload: ${key}`);
    }
  }

  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const result = {
    articlePayloadBytes: articleJson.length,
    oldAverageMs: Number(average(oldDurations).toFixed(2)),
    newAverageMs: Number(average(newDurations).toFixed(2)),
    fullArticleWritesDuringProgress: storage.writes.get(ARTICLES_KEY) ?? 0,
    heavyPayloadReadsDuringNoChangePull: [
      ARTICLES_KEY,
      "context-reader:vocabulary:v1",
      "context-reader:explanations:v5",
    ].reduce((sum, key) => sum + (storage.reads.get(key) ?? 0), 0),
    cloudReadingStateMergedWithoutHeavyPayloads: true,
    scopedPushKinds: pushedKinds,
  };
  if (result.newAverageMs >= result.oldAverageMs) {
    throw new Error(`Reading-state path did not improve the benchmark: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
