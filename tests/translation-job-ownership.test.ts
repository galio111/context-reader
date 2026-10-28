import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { getArticleTranslationJobSnapshot, startArticleTranslationJob, subscribeArticleTranslationJob } from "../lib/articleTranslationJobs";
import { flushLearningStorage, getLearningStorage, initializeLearningStorage, isLearningStorage } from "../lib/learningStorage";
import { getCachedArticleTranslation } from "../lib/cache";
import { clearLocalAccountData, prepareLocalAccountForUser } from "../lib/accountSyncClient";
import { beginAccountStorageTransition, isAccountStorageTransition } from "../lib/accountStorageTransition";

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
    assert.throws(() => oldStream!.enqueue(line("迟到的旧译文")), /closed/, "superseded stream is actively cancelled");
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

test("real account prepare blocks stale streams and new jobs throughout archive and restore waits", async () => {
  await inBrowser(async storage => {
    assert.ok(isLearningStorage(storage));
    storage.setItem(ownerKey, "prepare-A"); await storage.flush();
    const key = `prepare-window-${crypto.randomUUID()}`;
    const pendingKey = `${key}-pending-start`;
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let starts = 0, providers = 0, archiveEntered = false, restoreEntered = false;
    let confirmPendingStart: ((response: Response) => void) | undefined;
    let releaseArchive!: () => void, releaseRestore!: () => void;
    const archiveWait = new Promise<void>(resolve => { releaseArchive = resolve; });
    const restoreWait = new Promise<void>(resolve => { releaseRestore = resolve; });
    const archive = storage.archiveOwner.bind(storage), restore = storage.restoreOwner.bind(storage);
    storage.archiveOwner = async owner => { archiveEntered = true; await archiveWait; await archive(owner); };
    storage.restoreOwner = async owner => { restoreEntered = true; await restoreWait; await restore(owner); };
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/start")) {
        starts++;
        if (JSON.parse(String(init?.body)).cacheKey === pendingKey) return new Promise<Response>(resolve => { confirmPendingStart = resolve; });
        return Response.json({ actionId: `prepare-action-${starts}` });
      }
      if (String(url).endsWith("/finish")) return Response.json({ ok: true });
      providers++;
      return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    };
    let preparing: Promise<boolean> | undefined;
    try {
      const old = startArticleTranslationJob(key, [block]);
      await until(() => Boolean(stream));
      const pendingStart = startArticleTranslationJob(pendingKey, [block]);
      await until(() => Boolean(confirmPendingStart));
      preparing = prepareLocalAccountForUser("prepare-B");
      await until(() => archiveEntered);
      assert.equal(storage.getItem(ownerKey), "prepare-A", "owner is not prematurely rewritten");
      assert.equal(isAccountStorageTransition(storage), true);
      assert.equal(getArticleTranslationJobSnapshot(key), null);
      assert.throws(() => stream!.enqueue(line("不得进入新账号的旧译文")), /closed/); await old;
      confirmPendingStart!(Response.json({ actionId: "confirmed-during-archive" })); await pendingStart;
      assert.equal(providers, 1, "a previously pending start confirmed inside the archive window cannot invoke its provider");
      assert.equal(getCachedArticleTranslation(key), null);
      assert.equal(getCachedArticleTranslation(pendingKey), null);
      await startArticleTranslationJob(key, [block]);
      assert.equal(starts, 2, "no new action during archive wait");
      releaseArchive(); await until(() => restoreEntered);
      assert.equal(isAccountStorageTransition(storage), true);
      await startArticleTranslationJob(key, [block]);
      assert.equal(starts, 2, "no new action while old buckets were removed and restore is pending");
      releaseRestore(); await preparing;
      assert.equal(isAccountStorageTransition(storage), false);
      assert.equal(storage.getItem(ownerKey), "prepare-B");
      assert.equal(getCachedArticleTranslation(key), null);
      stream = undefined;
      const current = startArticleTranslationJob(key, [block]);
      await until(() => Boolean(stream));
      stream!.enqueue(line("准备完成后账户 B 的译文")); stream!.close(); await current;
      assert.equal(starts, 3);
      assert.equal(getCachedArticleTranslation(key)?.[0].translation, "准备完成后账户 B 的译文");
    } finally {
      releaseArchive(); releaseRestore(); await preparing?.catch(() => {});
      storage.archiveOwner = archive; storage.restoreOwner = restore;
    }
  });
});

test("logout archive wait blocks translation work and transition state is released on errors", async () => {
  await inBrowser(async storage => {
    assert.ok(isLearningStorage(storage));
    storage.setItem(ownerKey, "logout-A"); await storage.flush();
    let entered = false, starts = 0, release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const archive = storage.archiveOwner.bind(storage);
    storage.archiveOwner = async owner => { entered = true; await wait; await archive(owner); };
    globalThis.fetch = async url => { if (String(url).endsWith("/start")) starts++; return Response.json({ ok: true }); };
    const clearing = clearLocalAccountData();
    await until(() => entered);
    assert.equal(storage.getItem(ownerKey), "logout-A");
    assert.equal(isAccountStorageTransition(storage), true);
    await startArticleTranslationJob(`logout-${crypto.randomUUID()}`, [block]);
    assert.equal(starts, 0);
    release(); await clearing;
    assert.equal(storage.getItem(ownerKey), null);
    assert.equal(isAccountStorageTransition(storage), false);
    storage.archiveOwner = archive;

    storage.setItem(ownerKey, "archive-error-A");
    storage.archiveOwner = async () => { throw new Error("simulated archive failure"); };
    await assert.rejects(prepareLocalAccountForUser("archive-error-B"), /simulated archive failure/);
    assert.equal(isAccountStorageTransition(storage), false, "finally releases the failed transition");
    assert.equal(storage.getItem(ownerKey), "archive-error-A");
    storage.archiveOwner = archive;
    const endOuter = beginAccountStorageTransition(storage), endInner = beginAccountStorageTransition(storage);
    endOuter(); endOuter();
    assert.equal(isAccountStorageTransition(storage), true, "nested transitions and repeated cleanup cannot release an active inner transition");
    endInner(); assert.equal(isAccountStorageTransition(storage), false);
  });
});
