import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseDictionaryStream } from "../lib/dictionaryStream";
import { normalizeDictionaryStreamLine } from "../lib/dictionaryStreamServer";
import { currentFormPhonetic } from "../lib/pronunciation";

const ROOT = resolve(process.cwd());

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function requireSource(path: string, fragments: string[]): void {
  const value = source(path);
  for (const fragment of fragments) {
    assert.ok(value.includes(fragment), `${path} is missing protected release contract: ${fragment}`);
  }
}

const unsafeHead = normalizeDictionaryStreamLine(
  JSON.stringify({
    type: "head",
    query: "tilted",
    lemma: "tilt",
    phonetic: "/tɪlt/",
    direction: "en_to_cn",
    inputStatus: "inflection",
    suggestedQuery: "",
  }),
  "tilted",
);
const unsafeEvent = JSON.parse(unsafeHead) as { phonetic?: string; phoneticFor?: string };
assert.equal(unsafeEvent.phonetic, "", "an unowned lemma IPA must be removed on the server");
assert.equal(unsafeEvent.phoneticFor, "", "an unowned lemma IPA must not gain ownership");

const safeHead = normalizeDictionaryStreamLine(
  JSON.stringify({
    type: "head",
    query: "tilted",
    lemma: "tilt",
    phonetic: "/ˈtɪltɪd/",
    phoneticFor: "tilted",
    direction: "en_to_cn",
    inputStatus: "inflection",
    suggestedQuery: "",
  }),
  "tilted",
);
const parsedSafe = parseDictionaryStream(
  `${safeHead}\n${JSON.stringify({ type: "sense", partOfSpeech: "verb", meaning: "使倾斜" })}\n${JSON.stringify({ type: "done" })}\n`,
  "tilted",
);
assert.equal(parsedSafe.result.phonetic, "/ˈtɪltɪd/", "the exact current-form IPA must survive parsing");
assert.equal(parsedSafe.result.phoneticFor, "tilted", "current-form ownership must remain explicit");

const parsedUnsafe = parseDictionaryStream(
  `${unsafeHead}\n${JSON.stringify({ type: "sense", partOfSpeech: "verb", meaning: "使倾斜" })}\n${JSON.stringify({ type: "done" })}\n`,
  "tilted",
);
assert.equal(parsedUnsafe.result.phonetic, "", "an ambiguous streamed IPA must stay hidden in the client model");

assert.equal(
  currentFormPhonetic({ word: "tilted", lemma: "tilt", phonetic: "/tɪlt/" }),
  "",
  "legacy data may not relabel a lemma IPA as the current word",
);
assert.equal(
  currentFormPhonetic({ word: "tilted", lemma: "tilt", phonetic: "/ˈtɪltɪd/", phoneticFor: "tilted" }),
  "/ˈtɪltɪd/",
  "owned current-form IPA must remain visible",
);

requireSource("components/BookDictionary.tsx", [
  "原型：{result.lemma}",
  "当前词音标",
  "<PronunciationButtons text={result.query}",
]);
requireSource("components/ExplanationPanel.tsx", [
  "原型：{streamOriginalForm}",
  "当前词音标：",
  "<PronunciationButtons text={selectedContext?.word",
]);
requireSource("lib/deepseek.ts", ["phoneticFor", "pronunciationTargetMatches"]);
requireSource("lib/deepseekDictionary.ts", ["phoneticFor", "pronunciationTargetMatches"]);
requireSource("lib/dictionarySpelling.ts", ["normalizePhoneticOwnership"]);
requireSource("lib/standaloneDictionaryCache.ts", ["standalone-dictionary-cache:v2", "schemaVersion: 2"]);
requireSource("lib/cache.ts", ["currentFormPhonetic"]);
requireSource("lib/vocabulary.ts", ["phoneticFor"]);
requireSource("lib/vocabularyMerge.ts", ["\"phoneticFor\""]);
requireSource("lib/csv.ts", ["currentFormPhonetic"]);
requireSource("lib/ankiTemplates.ts", ["currentFormPhonetic"]);
for (const path of [
  "components/AnkiPreviewModal.tsx",
  "components/VocabularyPanel.tsx",
  "components/HomeOptionMenu.tsx",
  "components/BookHome.tsx",
  "components/ArticleInput.tsx",
  "components/ReaderView.tsx",
]) {
  requireSource(path, ["currentFormPhonetic"]);
}
requireSource("app/api/dictionary-stream/route.ts", [
  "normalizeDictionaryStreamLine",
  "phoneticFor",
  "绝不能改成 lemma",
]);
requireSource("ops/mainland/deploy-release.sh", [
  "RELEASE_GUARD_VERSION=1",
  "context-reader-deploy.lock",
  "parent release mismatch",
]);
requireSource("scripts/new-task-worktree.ps1", ["git worktree add", 'codex/$TaskName']);

console.log("release contracts passed: release-lineage-v1, phonetic-current-form-v1");
