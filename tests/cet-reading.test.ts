import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { mergeCetAttempt, normalizeCetAttempt } from "../lib/cetProgress";
import type { CetAttempt, CetPaper } from "../types/cet";
const attempt = (patch: Partial<CetAttempt> = {}): CetAttempt => ({
  id: "one",
  scope: "paper:cet4-2025-12-1",
  paperId: "cet4-2025-12-1",
  activeSection: "a",
  title: "Test",
  mode: "exam",
  answers: {},
  answerTimes: {},
  revealed: {},
  elapsedMs: 0,
  timerEpoch: "2026-09-22T00:00:00Z",
  timerParts: {},
  createdAt: "2026-09-22T00:00:00Z",
  updatedAt: "2026-09-22T00:00:00Z",
  ...patch,
});
test("two devices retain independent answers and do not count replayed timer segments twice", () => {
  const a = attempt({
    answers: { a: "A" },
    answerTimes: { a: "2026-09-22T01:00:00Z" },
    timerParts: { deviceA: 6000 },
  });
  const b = attempt({
    answers: { b: "C" },
    answerTimes: { b: "2026-09-22T02:00:00Z" },
    timerParts: { deviceB: 9000 },
  });
  const merged = mergeCetAttempt(a, b);
  assert.deepEqual(merged.answers, { a: "A", b: "C" });
  assert.equal(merged.elapsedMs, 15000);
  assert.deepEqual(mergeCetAttempt(merged, b), merged);
});
test("explicit reset defeats stale clock data while preserving answers", () => {
  const a = attempt({
    timerParts: { old: 30000 },
    answers: { q: "B" },
    answerTimes: { q: "2026-09-22T01:00:00Z" },
  });
  const reset = attempt({
    timerEpoch: "2026-09-22T02:00:00Z",
    updatedAt: "2026-09-22T02:00:00Z",
  });
  const result = mergeCetAttempt(reset, a);
  assert.equal(result.elapsedMs, 0);
  assert.equal(result.answers.q, "B");
});
test("newer answer wins, submission and early reveal survive delayed sync", () => {
  const a = attempt({
    answers: { q: "A" },
    answerTimes: { q: "2026-09-22T01:00:00Z" },
    finishedAt: "2026-09-22T02:00:00Z",
    revealed: { a: "2026-09-22T01:30:00Z" },
  });
  const b = attempt({
    answers: { q: "C" },
    answerTimes: { q: "2026-09-22T00:30:00Z" },
  });
  const result = mergeCetAttempt(a, b);
  assert.equal(result.answers.q, "A");
  assert.equal(result.finishedAt, a.finishedAt);
  assert.ok(result.revealed.a);
  assert.equal(normalizeCetAttempt({ ...a, timerParts: { x: -2 } }), null);
});
test("clearing an exam answer survives normalization and timestamp merging", () => {
  const a = attempt({
    answers: { q: "A" },
    answerTimes: { q: "2026-09-22T01:00:00Z" },
  });
  const b = attempt({
    answers: { q: "" },
    answerTimes: { q: "2026-09-22T02:00:00Z" },
  });
  const result = normalizeCetAttempt(mergeCetAttempt(a, b));
  assert.ok(result);
  assert.equal(result.answers.q, "");
  assert.equal(normalizeCetAttempt({ ...a, timerEpoch: "invalid" }), null);
});
test("catalogue ships complete reading papers with answers and explanations, excludes answerless batches", () => {
  const dir = new URL("../data/cet/", import.meta.url);
  const files = readdirSync(dir).filter((name) =>
    /^cet[46]-.*\.json$/.test(name),
  );
  assert.equal(files.length, 149);
  for (const name of files) {
    const p = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as CetPaper;
    assert.ok(!(p.level === 4 && p.year === 2026));
    assert.equal(p.sections.length, 4);
    const numbers = p.sections.flatMap((s) => s.questions.map((q) => q.number));
    assert.ok(numbers[0] === 26 || numbers[0] === 36, `${name} invalid source numbering`);
    assert.deepEqual(
      numbers,
      Array.from({ length: 30 }, (_, i) => i + numbers[0]),
    );
    for (const s of p.sections) {
      assert.ok(s.paragraphs.length);
      for (const q of s.questions) {
        assert.ok(
          q.options.some((o) => o.key === q.answer),
          `${name} Q${q.number} missing answer`,
        );
        assert.ok(
          q.explanation && q.explanation.length > 15,
          `${name} Q${q.number} missing explanation`,
        );
        assert.ok(
          !/Part\s*IV/i.test(q.explanation),
          `${name} Q${q.number} leaked translation section`,
        );
      }
      if (s.type === "cloze") {
        assert.equal(s.bank?.length, 15);
        assert.equal(new Set(s.questions.map((q) => q.answer)).size, 10);
        assert.equal(
          (s.paragraphs.join(" ").match(/\[\[\d+\]\]/g) || []).length,
          10,
        );
      } else if (s.type === "detail")
        for (const q of s.questions)
          assert.deepEqual(
            q.options.map((o) => o.key),
            ["A", "B", "C", "D"],
          );
    }
  }
});

test("full-archive coverage separates missing answers from incomplete reading order", () => {
  const dir = new URL("../data/cet/", import.meta.url);
  const coverage = JSON.parse(readFileSync(new URL("coverage.json", dir), "utf8"));
  const catalogue = JSON.parse(readFileSync(new URL("catalog.json", dir), "utf8")) as CetPaper[];
  assert.deepEqual([...new Set(catalogue.map((p) => p.year))].sort(), Array.from({ length: 14 }, (_, i) => 2013 + i));
  for (const id of [...coverage.missingAnswers, ...coverage.incompleteReadingOrder, ...Object.keys(coverage.sharedReading)])
    assert.ok(!catalogue.some((p) => p.id === id), id);
  for (const id of Object.values(coverage.sharedReading))
    assert.ok(catalogue.some((p) => p.id === id));
  for (const p of catalogue)
    for (const s of p.sections) {
      assert.ok(!("paragraphs" in s));
      for (const q of (s as unknown as { questions: Array<Record<string, unknown>> }).questions)
        assert.deepEqual(Object.keys(q), ["number"]);
    }
  const read = (id: string) => JSON.parse(readFileSync(new URL(`${id}.json`, dir), "utf8")) as CetPaper;
  assert.equal(read("cet4-2024-12-3").sections[3].questions[4].answer, "A");
  assert.equal(read("cet6-2024-12-1").sections[0].questions[9].answer, "M");
  assert.match(read("cet6-2023-12-1").sections[1].paragraphs[0], /2% of/);
  for (const p of catalogue.filter((p) => p.year < 2025)) {
    const paper = read(p.id);
    for (const s of paper.sections) {
      assert.ok(!/[#*]|EXDVEIST|ASGEANRIUER/.test(s.paragraphs.join(" ")), p.id);
      if (s.type === "matching")
        assert.deepEqual(s.paragraphs.map((t) => t[0]), [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].slice(0, s.paragraphs.length));
      for (const q of s.questions)
        assert.ok(!/解析册|结构框图|参考译文|网站上一篇标题/.test(q.explanation || ""), `${p.id} Q${q.number}`);
    }
  }
});

test("archive expansion preserves existing papers and ships only paired, bounded reading data", () => {
  const dir = new URL("../data/cet/", import.meta.url);
  const audit = JSON.parse(readFileSync(new URL("archive-audit.json", dir), "utf8"));
  const manifest = JSON.parse(readFileSync(new URL("source-manifest.json", dir), "utf8"));
  const sources = new Set(manifest.files.map((file: { path: string }) => file.path));
  assert.equal(Object.keys(audit.existingPaperSha256).length, 53);
  assert.equal(audit.addedPapers.length, 96);
  for (const [name, expected] of Object.entries(audit.existingPaperSha256))
    assert.equal(createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex"), expected, name);
  const fingerprints = new Set<string>();
  for (const added of audit.addedPapers) {
    const bytes = readFileSync(new URL(`${added.id}.json`, dir));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), added.sha256);
    assert.ok(bytes.length < 100_000, `${added.id}: unbounded paper payload`);
    assert.doesNotMatch(bytes.toString("utf8"), /第\s*\d+\s*页\s*共\s*\d+\s*页/, `${added.id}: source page footer`);
    const paper = JSON.parse(bytes.toString("utf8")) as CetPaper;
    for (const url of [paper.source, paper.answerSource!])
      assert.ok(sources.has(decodeURIComponent(url.split(`/${audit.revision}/`)[1])), url);
    const fingerprint = paper.sections.map(section => section.paragraphs.join(" ").replace(/[^a-z]/gi, "").toLowerCase()).join("|");
    assert.ok(!fingerprints.has(fingerprint), `${added.id}: duplicate full reading paper`);
    fingerprints.add(fingerprint);
  }
  const read = (id: string) => JSON.parse(readFileSync(new URL(`${id}.json`, dir), "utf8")) as CetPaper;
  const answer = (id: string, number: number) => read(id).sections.flatMap(section => section.questions).find(q => q.number === number)?.answer;
  assert.equal(answer("cet4-2014-12-1", 46), "F");
  assert.equal(answer("cet4-2015-12-2", 46), "D");
  assert.equal(answer("cet6-2020-09-1", 26), "L");
  assert.equal(answer("cet6-2019-06-3", 34), "H");
  assert.equal(read("cet6-2020-09-2").sections[0].bank?.find(word => word.key === "N")?.text, "stereotypes");
});
