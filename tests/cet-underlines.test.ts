import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCetActivity, cetFinalize, mergeCetActivity } from "../lib/cetActivity";
import { addCetUnderlines, liveCetUnderlines, updateCetUnderline } from "../lib/cetUnderlines";
import { normalizeCetActivity } from "../lib/cetActivityStorage";
import type { CetPaper } from "../types/cet";

const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8")) as CetPaper;
const section = paper.sections[0];
const start = () => createCetActivity({paper,sectionId:section.id,purpose:"self_test",owner:"reader",now:"2026-09-28T00:00:00.000Z"});
const ids = () => { let count = 0; return () => `mark-${++count}`; };

test("overlapping recolor preserves the unselected segment and deleted marks stay deleted across merges", () => {
  const id = ids();
  const first = addCetUnderlines(start(),paper,[{sectionId:section.id,paragraphIndex:0,start:0,end:12}],"blue","2026-09-28T00:00:01.000Z",id);
  assert.equal(liveCetUnderlines(first.underlines).length,1);
  const second = addCetUnderlines(first,paper,[{sectionId:section.id,paragraphIndex:0,start:5,end:12}],"rose","2026-09-28T00:00:02.000Z",id);
  assert.deepEqual(liveCetUnderlines(second.underlines).map(mark => [mark.start,mark.end,mark.color]),[[0,5,"blue"],[5,12,"rose"]]);
  const rose = liveCetUnderlines(second.underlines).find(mark => mark.color === "rose")!;
  const removed = updateCetUnderline(second,rose.id,"remove","2026-09-28T00:00:03.000Z",id);
  const merged = mergeCetActivity(second,removed);
  assert.deepEqual(liveCetUnderlines(merged.underlines).map(mark => mark.color),["blue"]);
  assert.ok(normalizeCetActivity(merged));
});

test("submission freezes both underline offsets and marked passage text despite a later stale draft", () => {
  const id = ids();
  const first = addCetUnderlines(start(),paper,[{sectionId:section.id,paragraphIndex:0,start:0,end:12}],"teal","2026-09-28T00:00:01.000Z",id);
  const submitted = cetFinalize(first,paper,"manual_submit",undefined,"2026-09-28T00:01:00.000Z","final-1");
  assert.equal(submitted.finalizations["final-1"].underlines?.length,1);
  assert.deepEqual(submitted.finalizations["final-1"].underlinedParagraphs?.[section.id],section.paragraphs);
  assert.equal(updateCetUnderline(submitted,liveCetUnderlines(submitted.underlines)[0].id,"remove"),submitted);
  const lateDraft = addCetUnderlines(first,paper,[{sectionId:section.id,paragraphIndex:0,start:20,end:30}],"amber","2026-09-28T00:02:00.000Z",id);
  const merged = mergeCetActivity(submitted,lateDraft);
  assert.equal(merged.status,"submitted");
  assert.deepEqual(merged.finalizations["final-1"].underlines,submitted.finalizations["final-1"].underlines);
});

test("self-test question stem, option and word bank marks keep their own positions", () => {
  const id = ids();
  const question = section.questions[0];
  const ranges = [
    { sectionId: section.id, target: "stem" as const, questionNumber: question.number, paragraphIndex: 0, start: 0, end: Math.min(8, question.stem.length) },
    { sectionId: section.id, target: "option" as const, questionNumber: question.number, optionKey: question.options[0].key, paragraphIndex: 0, start: 0, end: Math.min(5, question.options[0].text.length) },
    { sectionId: section.id, target: "bank" as const, optionKey: section.bank![0].key, paragraphIndex: 0, start: 0, end: Math.min(5, section.bank![0].text.length) },
  ];
  const marked = addCetUnderlines(start(), paper, ranges, "blue", "2026-09-28T00:00:01.000Z", id);
  assert.deepEqual(liveCetUnderlines(marked.underlines).map(mark => mark.target), ["bank", "option", "stem"]);
  assert.ok(normalizeCetActivity(marked));
  const submitted = cetFinalize(marked, paper, "manual_submit", undefined, "2026-09-28T00:01:00.000Z", "final-2");
  assert.equal(submitted.finalizations["final-2"].underlines?.length, 3);
});
