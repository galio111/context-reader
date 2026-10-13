import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as React from "react";
import { DEFAULT_STUDY_SETTINGS, newMemory, shanghaiDay } from "../lib/studyScheduler";
import { readStudyReviews, storeStudyReview } from "../lib/studyReviewQueue";
import type { StudySnapshot } from "../types/study";

test("cached Study views never replace live data, authorize answers, duplicate a cross-day start, or reveal pending cards", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://context-reader.com", pretendToBeVisual: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, React })) Object.defineProperty(globalThis, key, { configurable: true, value });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  dom.window.HTMLElement.prototype.scrollTo = () => {}; dom.window.scrollTo = () => {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  const require = createRequire(import.meta.url); require.extensions[".css"] = module => { module.exports = {}; };
  const mock = (path: string, exports: object) => { const filename = require.resolve(path); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule; };
  let owner = "00000000-0000-4000-8000-000000000001";
  let resolveDisk!: (snapshot: StudySnapshot | null) => void;
  const diskReads: string[] = [], saves: Array<{ owner: string; snapshot: StudySnapshot }> = [];
  mock("../lib/studySnapshotCache", { createStudySnapshotCache: (account: string) => ({ read: () => { diskReads.push(account); return new Promise(resolve => { resolveDisk = resolve; }); }, save: async (snapshot: StudySnapshot) => { saves.push({ owner: account, snapshot }); } }) });
  mock("../components/AccountProvider", { useAccount: () => ({ account: { profile: { userId: owner } }, isOffline: false, syncNow: async () => ({ pushedCount: 0, pulledCount: 0 }), refreshAccount: async () => {} }) });
  mock("../components/useStudyVocabularyEntries", { useStudyVocabularyEntries: (entries: unknown[]) => entries ?? [] });
  mock("../components/useStudyTimer", { useStudyTimer: () => () => 2000 });
  mock("../components/StudyWord", { StudyWord: ({ entry }: { entry: { word: string } }) => <div>{entry.word} answer</div> });
  mock("../components/StudyDictionaryHint", { StudyDictionaryHint: () => null });
  mock("../components/BookDictionary", { BookDictionary: () => null });
  for (const name of ["StudyRewards", "StudySettings", "StudyVocabulary", "StudyStats"]) mock("../components/" + name, { [name]: () => null });
  const { StudyPanel } = await import("../components/StudyPanel");
  const { render, act, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
  const now = new Date(), ids = ["a".repeat(40), "b".repeat(40)];
  function snapshot(first = "alpha", at = now): StudySnapshot {
    const words = [first, "beta"];
    return { serverNow: at.toISOString(), settings: DEFAULT_STUDY_SETTINGS,
      cards: ids.map((id, i) => ({ id, entry_id: words[i], mode: "basic_en_to_cn", memory: newMemory(now), version: 0, suspended: false, anki_pending: false, created_at: at.toISOString() })),
      entries: words.map(word => ({ id: word, word, sourceSentence: "", basicMeaning: "释义", contextMeaning: "", anki: { cardMode: "basic_en_to_cn" } })),
      today: { day: shanghaiDay(at), card_ids: ids, new_ids: ids, settings: DEFAULT_STUDY_SETTINGS, reward_points: 0, completed_at: null }, reviews: [], daily: [], policy: {}, streak: { current: 0, best: 0, last_day: null }, rewards: [], claims: [],
    } as unknown as StudySnapshot;
  }
  const starts: Array<(value: Response) => void> = [], reviewResponses: Array<(value: Response) => void> = [];
  let presents = 0, getResponse = snapshot();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.op === "start") return new Promise(resolve => { starts.push(resolve); });
    if (body?.op === "present") { presents++; return Response.json({ token: "00000000-0000-4000-8000-000000000099" }); }
    if (body?.op === "review") return new Promise(resolve => { reviewResponses.push(resolve); });
    return Response.json(getResponse);
  };
  const props = { visible: true, onClose() {}, onSource() {}, notice: "" };
  let ui = render(<StudyPanel {...props} key={owner} />);
  try {
    await waitFor(() => assert.equal(starts.length, 1));
    await act(async () => { resolveDisk(snapshot("alpha", new Date(now.getTime() + 60_000))); });
    assert.ok(ui.getByText("alpha")); assert.equal(ui.queryByText("正在连接学习记录…"), null);
    assert.equal(ui.getByRole("button", { name: /不记得/ }).hasAttribute("disabled"), false);
    fireEvent.click(ui.getByRole("button", { name: /不记得/ }));
    assert.ok(ui.getByText("alpha answer")); assert.equal(presents, 0);
    assert.equal(ui.getByRole("button", { name: "准备中…" }).hasAttribute("disabled"), true);
    await act(async () => { starts[0](Response.json(snapshot())); });
    await waitFor(() => assert.equal(presents, 1));
    assert.ok(ui.getByText("alpha answer")); assert.equal(saves.length, 1);
    ui.unmount();

    // The network may win the disk race. Even a disk snapshot with a future
    // server timestamp must not establish acceptedAt or replace live state.
    ui = render(<StudyPanel {...props} key={owner} />);
    await waitFor(() => assert.equal(starts.length, 2));
    await act(async () => { starts[1](Response.json(snapshot("live"))); });
    await act(async () => { resolveDisk(snapshot("stale-disk", new Date(now.getTime() + 60_000))); });
    assert.ok(ui.getByText("live")); assert.equal(ui.queryByText("stale-disk"), null);
    ui.unmount();

    // A prior day's cache can render the shell, but only the initial request
    // may prepare today's plan. The tick effect must not issue a second start.
    const presentsBefore = presents;
    ui = render(<StudyPanel {...props} key={owner} />);
    await waitFor(() => assert.equal(starts.length, 3));
    await act(async () => { resolveDisk(snapshot("yesterday", new Date(now.getTime() - 86_400_000))); });
    assert.ok(ui.getByText("正在准备今日学习…"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    assert.equal(starts.length, 3); assert.equal(presents, presentsBefore);
    await act(async () => { starts[2](Response.json({ error: "暂时无法读取学习记录" }, { status: 503 })); });
    assert.ok(ui.getByText("暂时无法读取学习记录"));
    getResponse = snapshot("recovered"); fireEvent.click(ui.getByRole("button", { name: "重试" }));
    await waitFor(() => assert.ok(ui.getByText("recovered")));
    ui.unmount();

    // Persisted answers remain masked during hydration and cannot hold the
    // first authoritative start. Later acceptance reconciles the queue as usual.
    storeStudyReview(localStorage, owner, { op: "review", id: "00000000-0000-4000-8000-000000000088", cardId: ids[0], version: 0, token: "00000000-0000-4000-8000-000000000099", answer: "forgot", activeMs: 2000, queuedAt: Date.now() });
    ui = render(<StudyPanel {...props} key={owner} />);
    await waitFor(() => assert.equal(starts.length, 4));
    await waitFor(() => assert.equal(reviewResponses.length, 1));
    await act(async () => { resolveDisk(snapshot()); });
    assert.ok(ui.getByText("beta")); assert.equal(ui.queryByText("alpha"), null);
    await act(async () => { starts[3](Response.json(snapshot())); });
    assert.ok(ui.getByText("beta")); assert.equal(readStudyReviews(localStorage, owner).length, 1);
    const acknowledged = snapshot(); acknowledged.cards[0].memory.due = new Date(now.getTime() + 300000).toISOString(); acknowledged.cards[0].memory.state = 1;
    await act(async () => { reviewResponses[0](Response.json({ snapshot: acknowledged })); });
    await waitFor(() => assert.equal(readStudyReviews(localStorage, owner).length, 0));
    assert.ok(ui.getByText("beta")); ui.unmount();

    // A late read from the previous keyed account cannot hydrate the next one.
    ui = render(<StudyPanel {...props} key={owner} />);
    const oldDisk = resolveDisk; owner = "00000000-0000-4000-8000-000000000002";
    ui.rerender(<StudyPanel {...props} key={owner} />);
    await act(async () => { oldDisk(snapshot("alice-private")); });
    assert.equal(ui.queryByText("alice-private"), null); assert.equal(diskReads.at(-1), owner);
    await act(async () => { resolveDisk(null); starts.at(-1)!(Response.json(snapshot("bob-live"))); });
    await waitFor(() => assert.ok(ui.getByText("bob-live")));
    assert.equal(saves.at(-1)?.owner, owner);
  } finally { cleanup(); globalThis.fetch = originalFetch; dom.window.close(); }
});
