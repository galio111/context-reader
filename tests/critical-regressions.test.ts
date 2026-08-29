import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildContextCloze } from "../lib/ankiData";
import { waitForFastImageLocalization } from "../lib/articleImageLocalizationPolicy";
import { parseDictionaryStream } from "../lib/dictionaryStream";
import { scopeReaderTokenId } from "../lib/readerTokenIdentity";
import { classifyStreamTermination } from "../lib/requestCancellation";
import { USER_SESSION_MAX_AGE_SECONDS } from "../lib/sessionPolicy";

test("reader token ids stay unique across article blocks", () => {
  assert.notEqual(scopeReaderTokenId("paragraph-0-", "word-4"), scopeReaderTokenId("paragraph-1-", "word-4"));
});

test("client cancellation is not classified as a provider failure", () => {
  assert.equal(classifyStreamTermination({ clientAborted: true, timedOut: false, error: new Error("aborted") }), "cancelled");
  assert.equal(classifyStreamTermination({ clientAborted: false, timedOut: true, error: new Error("aborted") }), "timeout");
  assert.equal(classifyStreamTermination({ clientAborted: false, timedOut: false, error: new Error("failed") }), "failed");
});

test("context cloze tolerates normalized apostrophes in saved phrases", () => {
  assert.equal(
    buildContextCloze(
      "But a mutual fund or ETF won’t necessarily provide diversification.",
      "won t necessarily",
    ),
    "But a mutual fund or ETF ________ provide diversification.",
  );
});

test("normal image localization completes inline while slow localization falls back to background", async () => {
  const fast = await waitForFastImageLocalization(Promise.resolve("localized"), 20);
  assert.deepEqual(fast, { mode: "fast", value: "localized" });

  let resolveSlow!: (value: string) => void;
  const slowPromise = new Promise<string>((resolve) => { resolveSlow = resolve; });
  const slow = await waitForFastImageLocalization(slowPromise, 1);
  assert.equal(slow.mode, "background");
  resolveSlow("localized-later");
  if (slow.mode === "background") assert.equal(await slow.pending, "localized-later");
});

test("authenticated browser session uses the accepted 400-day rolling window", () => {
  assert.equal(USER_SESSION_MAX_AGE_SECONDS, 400 * 24 * 60 * 60);
});

test("ambiguous standalone lookup preserves inflection and independent headword senses", () => {
  const parsed = parseDictionaryStream([
    JSON.stringify({ type: "head", query: "fell", lemma: "fall / fell", inputStatus: "ambiguous" }),
    JSON.stringify({ type: "sense", headword: "fall", headwordNote: "fall 的过去式", partOfSpeech: "verb", meaning: "落下；下降" }),
    JSON.stringify({ type: "sense", headword: "fell", headwordNote: "独立词头", partOfSpeech: "verb", meaning: "砍倒" }),
    JSON.stringify({ type: "done" }),
  ].join("\n"), "fell");
  assert.equal(parsed.result.inputStatus, "ambiguous");
  assert.deepEqual(parsed.result.senses.map((sense) => sense.headword), ["fall", "fell"]);
});

test("admin curation remounts and releases per-article working state", () => {
  const page = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  const inspector = readFileSync(new URL("../components/AdminArticleMetadataInspector.tsx", import.meta.url), "utf8");
  assert.match(page, /<AdminArticleMetadataInspector\s+key=\{`\$\{readerState\.kind\}:\$\{readerState\.article\.id\}`\}/);
  assert.match(inspector, /finally \{ setWorking\(""\); \}/);
});
