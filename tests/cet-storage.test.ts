import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCetActivity, cetAnswer, cetFinalize } from "../lib/cetActivity";
import { CET_ACTIVITIES_KEY, CET_FINALIZATIONS_KEY, readCetActivities, readCetCommitPackages, saveCetActivity } from "../lib/cetActivityStorage";
import { claimGuestCetRecords } from "../lib/accountSyncClient";
import { exposureFor, readCetExposures, saveCetExposure } from "../lib/cetExposure";
import type { CetPaper } from "../types/cet";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failOn: string | null = null;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) {
    if (this.failOn === key) { this.failOn = null; throw new Error("simulated storage interruption"); }
    this.data.set(key, value);
  }
}

const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8")) as CetPaper;

test("commit package survives an interrupted activity write and restores the reveal boundary", () => {
  const storage = new MemoryStorage();
  const started = createCetActivity({ paper, purpose: "self_test", owner: "guest", id: "a", now: "2026-09-23T00:00:00Z" });
  const draft = cetAnswer(started, started.questionKeys[0], "A", "2026-09-23T00:00:01Z", "answer-1");
  saveCetActivity(draft, storage);
  const final = cetFinalize(draft, paper, "manual_submit", undefined, "2026-09-23T00:01:00Z", "final-1");
  storage.failOn = CET_ACTIVITIES_KEY;
  assert.throws(() => saveCetActivity(final, storage), /interruption/);
  assert.equal(readCetCommitPackages(storage).length, 1);
  const restored = readCetActivities(storage)[0];
  assert.equal(restored.status, "submitted");
  assert.equal(restored.finalizations["final-1"].answers[draft.questionKeys[0]], "A");
  saveCetActivity(restored, storage);
  assert.equal(readCetCommitPackages(storage).length, 1);
  assert.ok(storage.getItem(CET_FINALIZATIONS_KEY));
});

test("first login adopts guest CET history without changing answers or finalization IDs", () => {
  const storage = new MemoryStorage();
  const started = createCetActivity({ paper, purpose: "self_test", owner: "guest", id: "guest-1", now: "2026-09-23T00:00:00Z" });
  const final = cetFinalize(cetAnswer(started, started.questionKeys[0], "C", "2026-09-23T00:00:01Z", "answer"), paper, "manual_submit", undefined, "2026-09-23T00:01:00Z", "final");
  saveCetActivity(final, storage);
  saveCetExposure(exposureFor(paper.sections[0], paper.id, "guest", "answer_view", "view-1", final.id), storage);
  claimGuestCetRecords(storage, "account-1");
  claimGuestCetRecords(storage, "account-1");
  const adopted = readCetActivities(storage);
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0].owner, "account-1");
  assert.equal(adopted[0].finalizations.final.answers[started.questionKeys[0]], "C");
  assert.equal(readCetCommitPackages(storage).length, 1);
  assert.equal(readCetExposures(storage)[0].owner, "account-1");
});
