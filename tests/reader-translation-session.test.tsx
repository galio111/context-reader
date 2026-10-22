import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { useReaderTranslationSession } from "../components/useReaderTranslationSession";
import { startArticleTranslationJob } from "../lib/articleTranslationJobs";
import { initializeLearningStorage, getLearningStorage, flushLearningStorage, isLearningStorage } from "../lib/learningStorage";
import { prepareLocalAccountForUser } from "../lib/accountSyncClient";
import { notifyAccountDataMerged } from "../lib/accountEvents";
import type { ArticleTranslationBlock } from "../types/reader";

const ownerKey = "context-reader:local-account-owner:v1";
const blocks: ArticleTranslationBlock[] = [{ id: "one", type: "paragraph", text: "One sentence." }, { id: "two", type: "paragraph", text: "Another sentence." }];
const line = (id: string, translation: string) => new TextEncoder().encode(JSON.stringify({ type: "translation", translation: { id, translation } }) + "\n");
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 1));

test("mounted Reader translation session rebinds after login, survives panel changes and clears across owners", async () => {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  const descriptors = new Map(["window", "document", "navigator", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of ["window", "document", "navigator", "CustomEvent"]) Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  const { renderHook, act, cleanup } = await import("@testing-library/react");
  const originalFetch = globalThis.fetch;
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let starts = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/start")) return Response.json({ actionId: `mounted-action-${++starts}` });
    if (String(url).endsWith("/finish")) return Response.json({ ok: true });
    return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  };
  try {
    await initializeLearningStorage();
    const storage = getLearningStorage();
    const key = `mounted-reader-${crypto.randomUUID()}`;
    const ui = renderHook(({ owner, sourceKey, sourceBlocks }) => useReaderTranslationSession(sourceKey, sourceBlocks, owner), {
      initialProps: { owner: null as string | null, sourceKey: key, sourceBlocks: blocks },
    });
    assert.equal(ui.result.current.ready, true);
    assert.deepEqual(ui.result.current.translations, []);
    // Storage preparation completes before AccountProvider publishes its verified account.
    await act(async () => { storage.setItem(ownerKey, "account-A"); });
    assert.equal(ui.result.current.ready, false);
    assert.deepEqual(ui.result.current.translations, []);
    ui.rerender({ owner: "account-A", sourceKey: key, sourceBlocks: blocks });
    assert.equal(ui.result.current.ready, true);
    const lateKey = `${key}-late-cloud`;
    ui.rerender({ owner: "account-A", sourceKey: lateKey, sourceBlocks: blocks });
    await act(async () => {
      storage.setItem("context-reader:article-translations:v1", JSON.stringify({ [lateKey]: [{ id: "one", translation: "稍后同步到的译文" }] }));
      notifyAccountDataMerged(["article_translation"]);
    });
    assert.deepEqual(ui.result.current.translations, [{ id: "one", translation: "稍后同步到的译文" }]);
    assert.equal(starts, 0, "late cloud replay does not start or charge a translation job");
    ui.rerender({ owner: "account-A", sourceKey: key, sourceBlocks: blocks });
    let running!: Promise<void>;
    await act(async () => {
      running = startArticleTranslationJob(key, blocks);
      for (let i = 0; i < 100 && !stream; i++) await tick();
    });
    assert.ok(stream);
    assert.equal(ui.result.current.loading, true, "same mounted Reader receives the new owner's loading snapshot");
    await act(async () => { stream!.enqueue(line("one", "账户 A 的第一段")); await tick(); });
    assert.deepEqual(ui.result.current.translations, [{ id: "one", translation: "账户 A 的第一段" }]);
    // An ordinary Reader rerender/tool switch keeps the active subscription and does not start another action.
    ui.rerender({ owner: "account-A", sourceKey: key, sourceBlocks: blocks });
    await act(async () => { stream!.enqueue(line("two", "账户 A 的第二段")); stream!.close(); await running; });
    assert.equal(ui.result.current.loading, false);
    assert.equal(ui.result.current.translations.length, 2);
    assert.equal(starts, 1);

    const editedBlocks = [{ ...blocks[0], text: "Edited sentence." }];
    ui.rerender({ owner: "account-A", sourceKey: `${key}-edit`, sourceBlocks: editedBlocks });
    assert.deepEqual(ui.result.current.staleBlockIds, ["one"], "same-owner body edits preserve stale translations");
    assert.equal(ui.result.current.removedCount, 1);

    // Cover the inverse race: account context changes before its storage owner is ready.
    ui.rerender({ owner: "account-B", sourceKey: `${key}-edit`, sourceBlocks: editedBlocks });
    assert.equal(ui.result.current.ready, false);
    assert.deepEqual(ui.result.current.translations, []);
    await act(async () => {
      storage.removeItem("context-reader:article-translations:v1");
      storage.removeItem("context-reader:article-translation-blocks:v1");
      storage.setItem(ownerKey, "account-B");
    });
    assert.equal(ui.result.current.ready, true);
    assert.deepEqual(ui.result.current.translations, [], "previous owner's stale translations cannot be merged");
    assert.deepEqual(ui.result.current.staleBlockIds, []);
    assert.equal(ui.result.current.removedCount, 0);
    assert.equal(ui.result.current.requested, false);
    stream = undefined;
    await act(async () => {
      running = startArticleTranslationJob(`${key}-edit`, editedBlocks);
      for (let i = 0; i < 100 && !stream; i++) await tick();
    });
    assert.equal(ui.result.current.loading, true);
    await act(async () => { stream!.enqueue(line("one", "账户 B 新译文")); stream!.close(); await running; });
    assert.deepEqual(ui.result.current.translations, [{ id: "one", translation: "账户 B 新译文" }]);

    // A complete round trip inside one React batch must clear old display state too.
    await act(async () => {
      storage.removeItem("context-reader:article-translations:v1");
      storage.removeItem("context-reader:article-translation-blocks:v1");
      storage.setItem(ownerKey, "account-C"); storage.setItem(ownerKey, "account-B");
    });
    assert.deepEqual(ui.result.current.translations, []);
    assert.deepEqual(ui.result.current.staleBlockIds, []);
    assert.ok(isLearningStorage(storage));
    await act(async () => { ui.result.current.showCachedTranslations([{ id: "one", translation: "切换前的显示译文" }]); });
    let releaseArchive!: () => void, archiveEntered = false;
    const archiveWait = new Promise<void>(resolve => { releaseArchive = resolve; });
    const archive = storage.archiveOwner.bind(storage);
    storage.archiveOwner = async owner => { archiveEntered = true; await archiveWait; await archive(owner); };
    let preparing!: Promise<boolean>;
    await act(async () => {
      preparing = prepareLocalAccountForUser("account-D");
      for (let i = 0; i < 100 && !archiveEntered; i++) await tick();
    });
    assert.equal(archiveEntered, true);
    assert.equal(storage.getItem(ownerKey), "account-B", "real preparation is paused before rewriting owner");
    assert.equal(ui.result.current.ready, false);
    assert.deepEqual(ui.result.current.translations, [], "transition entry hides old display before archive awaits");
    await act(async () => { releaseArchive(); await preparing; });
    storage.archiveOwner = archive;
    assert.equal(ui.result.current.ready, false, "verified account context has not caught up yet");
    ui.rerender({ owner: "account-D", sourceKey: `${key}-edit`, sourceBlocks: editedBlocks });
    assert.equal(ui.result.current.ready, true);
    assert.deepEqual(ui.result.current.translations, []);
    ui.unmount();
  } finally {
    cleanup(); await flushLearningStorage();
    const storage = getLearningStorage(); if (isLearningStorage(storage)) storage.close();
    globalThis.fetch = originalFetch; dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
