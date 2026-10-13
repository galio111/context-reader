import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { compactStudyResponse, hydrateStudyResponse, isStudyEntrySummary } from "../lib/studyTransport";
import type { VocabularyEntry } from "../types/vocabulary";

import { transportFixture } from "./fixtures/study-transport-fixture";

test("compact snapshots preserve scheduling and inline the first eight ready full entries", () => {
  const original = transportFixture();
  original.cards[0].memory.due = "2026-10-14T07:00:00Z";
  original.cards[1].suspended = true;
  original.entries[2].dictionaryResult = { query: "saved dictionary" } as VocabularyEntry["dictionaryResult"];
  const compact = compactStudyResponse(original);
  assert.notEqual(compact, original);
  assert.equal(compact.cards, original.cards);
  assert.equal(compact.today, original.today);
  assert.equal(compact.reviews, original.reviews);
  assert.equal(compact.policy, original.policy);
  assert.deepEqual(compact.entries.filter(e => !isStudyEntrySummary(e)).map(e => e.id), Array.from({ length: 8 }, (_, i) => `entry-${i + 2}`));
  assert.equal(compact.entries[2].usageNote, original.entries[2].usageNote);
  assert.equal(compact.entries[2].dictionaryResult, undefined);
  assert.ok(original.entries[2].dictionaryResult, "serialization never mutates the saved entry");
  assert.deepEqual(Object.keys(compact.entries[0]).sort(), ["basicMeaning", "contextMeaning", "createdAt", "id", "studySummary", "updatedAt", "word"]);
});

test("nested mutation responses compact and hydrate with explicit summary markers while full legacy responses remain unchanged", () => {
  const snapshot = transportFixture();
  const legacy = { saved: true, id: "review", snapshot };
  assert.equal(hydrateStudyResponse(snapshot), snapshot);
  assert.equal(hydrateStudyResponse(legacy), legacy);
  const compact = compactStudyResponse(legacy);
  assert.equal(compact.saved, true);
  assert.equal(compact.id, "review");
  const hydrated = hydrateStudyResponse(compact);
  const summary = hydrated.snapshot.entries[19];
  assert.ok(isStudyEntrySummary(summary), "default fields cannot disguise a missing full result");
  assert.equal(summary.sourceSentence, "");
  assert.equal(summary.anki.cardMode, "basic_en_to_cn");
  assert.equal(summary.basicMeaning, snapshot.entries[19].basicMeaning);
  assert.equal(hydrated.snapshot.entries[0], compact.snapshot.entries[0]);
  assert.equal(hydrated.snapshot.cards, snapshot.cards);
  assert.equal(isStudyEntrySummary(undefined), false);
  assert.deepEqual(hydrateStudyResponse({ token: "presentation" }), { token: "presentation" });
});

test("a large vocabulary no longer downloads all detailed explanations in each snapshot", () => {
  const snapshot = transportFixture(1200);
  const before = JSON.stringify(snapshot), after = JSON.stringify(compactStudyResponse(snapshot));
  assert.ok(Buffer.byteLength(after) < Buffer.byteLength(before) * .12);
  assert.ok(gzipSync(after).byteLength < gzipSync(before).byteLength * .25);
  assert.equal(compactStudyResponse(snapshot).cards.length, 1200);
});
