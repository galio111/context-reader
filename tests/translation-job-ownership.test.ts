import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { getArticleTranslationJobSnapshot, startArticleTranslationJob, subscribeArticleTranslationJob } from "../lib/articleTranslationJobs";
import { flushLearningStorage, getLearningStorage, initializeLearningStorage, isLearningStorage } from "../lib/learningStorage";
import { getCachedArticleTranslation } from "../lib/cache";

const block = { id: "one", type: "paragraph" as const, text: "One reading session." };
const line = (translation: string) => new TextEncoder().encode(JSON.stringify({ type: "translation", translation: { id: "one", translation } }) + "\n");
const ownerKey = "context-reader:local-account-owner:v1";
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 1));
async function until(ready: () => boolean) { for (let i = 0; i < 500 && !ready(); i++) await tick(); assert.ok(ready(), "asynchronous fixture reached its boundary"); }

async function inBrowser(action: (storage: Storage) => Promise<void>) {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  const descriptors = new Map(["window", "document", "CustomEvent"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of descriptors.keys()) Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  const originalFetch = globalThis.fetch;
  try { await initializeLearningStorage(); await action(getLearningStorage()); }
  finally {
    await flushLearningStorage();
    const storage = getLearningStorage(); if (isLearningStorage(storage)) storage.close();
    globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

test("forced regeneration rejects a late old stream even when transport ignores abort", async () => {
  await inBrowser(async () => {
    const key = `force-${crypto.randomUUID()}`;
    let oldStream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let starts = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/start")) return Response.json({ actionId: `action-${++starts}` });
      if (String(url).endsWith("/finish")) return Response.json({ ok: true });
      const action = (init?.headers as Record<string, string>)["x-context-translation-action-id"];
      return action === "action-1"
        ? new Response(new ReadableStream({ start(controller) { oldStream = controller; } }))
        : new Response(line("新的译文"));
    };
    const old = startArticleTranslationJob(key, [block]);
    await until(() => Boolean(oldStream));
    await startArticleTranslationJob(key, [block], { force: true });
    assert.equal(getCachedArticleTranslation(key)?.[0].translation, "新的译文");
    oldStream!.enqueue(line("迟到的旧译文")); oldStream!.close();
    await old;
    assert.equal(getCachedArticleTranslation(key)?.[0].translation, "新的译文");
    assert.equal(getArticleTranslationJobSnapshot(key)?.translations[0].translation, "新的译文");
    assert.equal(starts, 2);
  });
});

test("owner A to B to A cancels a suspended start and cannot resume the old provider request", async () => {
  await inBrowser(async storage => {
    storage.setItem(ownerKey, "owner-A");
    const key = `owner-start-${crypto.randomUUID()}`;
    let resolveStart: ((response: Response) => void) | undefined;
    let providers = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith("/start")) return new Promise<Response>(resolve => { resolveStart = resolve; });
      if (String(url).endsWith("/finish")) return Response.json({ ok: true });
      providers++; return new Response(line("旧账号内容"));
    };
    const running = startArticleTranslationJob(key, [block]);
    await until(() => Boolean(resolveStart));
    storage.setItem(ownerKey, "owner-B");
    storage.setItem(ownerKey, "owner-A");
    resolveStart!(Response.json({ actionId: "old-account-action" }));
    await running;
    assert.equal(providers, 0);
    assert.equal(getCachedArticleTranslation(key), null);
    assert.equal(getArticleTranslationJobSnapshot(key), null);
  });
});

test("force during a suspended start settles once after confirmation using the server action id", async () => {
  await inBrowser(async () => {
    const key = `force-start-${crypto.randomUUID()}`;
    let starts = 0, oldConfirmed = false;
    let resolveOldStart: ((response: Response) => void) | undefined;
    const finished: Array<{ actionId: string; status: string }> = [];
    const providerActions: string[] = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/start")) {
        starts++;
        if (starts === 1) return new Promise<Response>(resolve => { resolveOldStart = resolve; });
        return Response.json({ actionId: "new-server-action" });
      }
      if (String(url).endsWith("/finish")) {
        const body = JSON.parse(String(init?.body));
        if (body.actionId !== "new-server-action") {
          assert.equal(oldConfirmed, true, "old reservation must finish creation before cancellation settlement");
          assert.equal(body.actionId, "old-server-action", "use the confirmed server id");
        }
        finished.push(body); return Response.json({ ok: true });
      }
      providerActions.push((init?.headers as Record<string, string>)["x-context-translation-action-id"]);
      return new Response(line("新任务结果"));
    };
    const old = startArticleTranslationJob(key, [block]);
    await until(() => Boolean(resolveOldStart));
    await startArticleTranslationJob(key, [block], { force: true });
    assert.deepEqual(finished, [{ actionId: "new-server-action", status: "succeeded" }]);
    oldConfirmed = true;
    resolveOldStart!(Response.json({ actionId: "old-server-action" }));
    await old;
    assert.deepEqual(finished, [
      { actionId: "new-server-action", status: "succeeded" },
      { actionId: "old-server-action", status: "cancelled" },
    ]);
    assert.deepEqual(providerActions, ["new-server-action"]);
    assert.equal(getCachedArticleTranslation(key)?.[0].translation, "新任务结果");
  });
});

test("completed jobs and listeners remain isolated when the next account translates the same article", async () => {
  await inBrowser(async storage => {
    storage.setItem(ownerKey, "owner-A");
    let starts = 0, oldNotifications = 0;
    const key = `owner-replay-${crypto.randomUUID()}`;
    globalThis.fetch = async url => {
      if (String(url).endsWith("/start")) return Response.json({ actionId: `account-action-${++starts}` });
      if (String(url).endsWith("/finish")) return Response.json({ ok: true });
      return new Response(line(`账号译文${starts}`));
    };
    const unsubscribeA = subscribeArticleTranslationJob(key, () => oldNotifications++);
    await startArticleTranslationJob(key, [block]);
    const beforeSwitch = oldNotifications;
    storage.removeItem("context-reader:article-translations:v1");
    storage.removeItem("context-reader:article-translation-blocks:v1");
    storage.setItem(ownerKey, "owner-B");
    assert.equal(getArticleTranslationJobSnapshot(key), null);
    await startArticleTranslationJob(key, [block]);
    assert.equal(starts, 2, "new owner must not reuse the previous owner's completed runtime job");
    assert.equal(oldNotifications, beforeSwitch);
    assert.equal(getArticleTranslationJobSnapshot(key)?.translations[0].translation, "账号译文2");
    unsubscribeA();
  });
});
