import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  assert.equal(files.length, 15);
  for (const name of files) {
    const p = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as CetPaper;
    assert.ok(!(p.level === 4 && p.year === 2026));
    assert.equal(p.sections.length, 4);
    const numbers = p.sections.flatMap((s) => s.questions.map((q) => q.number));
    assert.deepEqual(
      numbers,
      Array.from({ length: 30 }, (_, i) => i + 26),
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
