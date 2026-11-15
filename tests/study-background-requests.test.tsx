import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import * as React from "react";
import { DEFAULT_STUDY_SETTINGS, shanghaiDay } from "../lib/studyScheduler";
import type { StudySnapshot } from "../types/study";

test("an idle mounted study panel does not repeatedly start or refresh in the background", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://context-reader.com", pretendToBeVisual: true });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, indexedDB: new IDBFactory(), React, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  dom.window.HTMLElement.prototype.scrollTo = () => {}; dom.window.scrollTo = () => {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  const require = createRequire(import.meta.url); require.extensions[".css"] = module => { module.exports = {}; };
  const mock = (path: string, exports: object) => { const filename = require.resolve(path); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule; };
  const owner = "study-idle-owner";
  const account = { account: { profile: { userId: owner } }, isOffline: false,
    syncNow: async () => ({ pushedCount: 0, pulledCount: 0 }), refreshAccount: async () => {} };
  mock("../components/AccountProvider", { useAccount: () => account });
  mock("../lib/studySnapshotCache", { createStudySnapshotCache: () => ({ read: async () => null, save: async () => {} }) });
  mock("../components/useStudyVocabularyEntries", { useStudyVocabularyEntries: (entries: unknown[]) => entries ?? [] });
  mock("../components/useStudyTimer", { useStudyTimer: () => () => 2000 });
  mock("../components/StudyDictionaryHint", { StudyDictionaryHint: () => null });
  mock("../components/BookDictionary", { BookDictionary: () => null });
  for (const name of ["StudyRewards", "StudyVocabulary", "StudyStats"]) mock("../components/" + name, { [name]: () => null });
  const { StudyPanel } = await import("../components/StudyPanel");
  const { render, act, cleanup } = await import("@testing-library/react");
  const calls: string[] = [], originalFetch = globalThis.fetch, originalNow = Date.now;
  let clock=originalNow(), rejected=false;
  Date.now=()=>clock;
  const snapshot = (): StudySnapshot => ({ serverNow: new Date().toISOString(), settings: DEFAULT_STUDY_SETTINGS,
    cards: [], entries: [], today: { day: shanghaiDay(new Date()), card_ids: [], new_ids: [], settings: DEFAULT_STUDY_SETTINGS, reward_points: 0, completed_at: null },
    reviews: [], daily: [], policy: {}, streak: { current: 0, best: 0, last_day: null }, rewards: [], claims: [], offlinePermit: "fixture" } as unknown as StudySnapshot);
  globalThis.fetch = async (_url, init) => {
    const op = JSON.parse(String(init?.body ?? "{}" )).op ?? "GET"; calls.push(op);
    if(rejected)return Response.json({error:"temporarily limited"},{status:429,headers:{"Retry-After":"60"}});
    if (calls.length > 30) return Response.json({ error: "request loop" }, { status: 429 });
    return Response.json(op === "local_revision" ? { revision: "unchanged" } : snapshot());
  };
  try {
    const ui = render(<StudyPanel visible={false} onClose={() => {}} onSource={() => {}} notice="" />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.ok(calls.length <= 3, JSON.stringify(calls));
    ui.rerender(<StudyPanel visible onClose={() => {}} onSource={() => {}} notice="" />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.ok(calls.length <= 5, JSON.stringify(calls));
    const beforeFocus = calls.length;
    for (let count = 0; count < 20; count++) {
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); await new Promise(resolve => setTimeout(resolve, 5)); });
    }
    assert.ok(calls.length <= beforeFocus + 2, JSON.stringify(calls));
    rejected=true;clock+=11000;
    await act(async()=>{dom.window.dispatchEvent(new dom.window.Event("focus"));await new Promise(resolve=>setTimeout(resolve,15));});
    const afterRejection=calls.length;assert.equal(afterRejection,beforeFocus+1);
    clock+=11000;
    await act(async()=>{dom.window.dispatchEvent(new dom.window.Event("focus"));await new Promise(resolve=>setTimeout(resolve,15));});
    assert.equal(calls.length,afterRejection,"Retry-After survives further focus events");
    clock+=50000;
    await act(async()=>{dom.window.dispatchEvent(new dom.window.Event("focus"));await new Promise(resolve=>setTimeout(resolve,15));});
    assert.equal(calls.length,afterRejection+1,"a retry becomes eligible after the server wait");
    ui.rerender(<StudyPanel visible={false} onClose={()=>{}} onSource={()=>{}} notice=""/>);clock+=120000;
    await act(async()=>{dom.window.dispatchEvent(new dom.window.Event("focus"));await new Promise(resolve=>setTimeout(resolve,15));});
    assert.equal(calls.length,afterRejection+1,"hidden panels stop revision polling");
  } finally { cleanup(); Date.now=originalNow;globalThis.fetch = originalFetch; dom.window.close(); }
});
