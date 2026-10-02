import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { readCetUnderlineSelection, cetUnderlineMenuPosition } from "../lib/cetUnderlineSelection";
import { cetTranslationBlocks } from "../lib/cetTranslationBlocks";
import { createCetActivity, cetFinalize } from "../lib/cetActivity";
import type { CetPaper } from "../types/cet";

const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8")) as CetPaper;

test("selection ending beyond the passage clips to marked text and excludes surrounding UI", () => {
  const dom = new JSDOM('<body><div id="passages"><p data-cet-paragraph="0"><span data-cet-part-start="0">A long sentence.</span></p><p data-cet-paragraph="1"><span data-cet-part-start="0">Another sentence.</span></p></div><button>Submit</button></body>');
  Object.defineProperty(globalThis, "Range", { configurable: true, value: dom.window.Range });
  const section = { ...paper.sections[0], paragraphs: ["A long sentence.", "Another sentence."] };
  const root = dom.window.document.getElementById("passages")!;
  const range = dom.window.document.createRange();
  range.setStart(root.querySelector("span")!.firstChild!, 2);
  range.setEndAfter(root);
  assert.deepEqual(readCetUnderlineSelection(root, range, {...paper, sections:[section]}, section.id).map(({paragraphIndex,start,end})=>({paragraphIndex,start,end})), [
    { paragraphIndex:0, start:2, end:16 }, { paragraphIndex:1, start:0, end:17 },
  ]);
  range.selectNodeContents(dom.window.document.querySelector("button")!);
  assert.equal(readCetUnderlineSelection(root, range, {...paper, sections:[section]}, section.id).length, 0);
  dom.window.close();
});

test("long selections anchor to a visible end and keep their menu inside narrow and desktop viewports", () => {
  const rects = [
    {left:100,right:900,top:-150,bottom:-120,width:800,height:30},
    {left:100,right:900,top:40,bottom:70,width:800,height:30},
    {left:100,right:980,top:760,bottom:790,width:880,height:30},
  ];
  assert.deepEqual(cetUnderlineMenuPosition(rects,1000,800),{left:700,top:702});
  assert.deepEqual(cetUnderlineMenuPosition(rects,1000,800,true),{left:100,top:78});
  const narrow = cetUnderlineMenuPosition(rects,320,800)!;
  assert.ok(narrow.left>=8 && narrow.left+280<=312);
  assert.equal(cetUnderlineMenuPosition([rects[0]],1000,800),null);
});

test("translation includes current passage, question stems and each option without answer explanations", () => {
  const section = paper.sections.find(section => section.type === "detail")!;
  const blocks = cetTranslationBlocks(section,["Edited passage"]);
  assert.equal(blocks[0].text,"Edited passage");
  assert.equal(new Set(blocks.map(block=>block.id)).size,blocks.length);
  for(const question of section.questions) {
    assert.ok(blocks.some(block=>block.text===`${question.number}. ${question.stem}`));
    for(const option of question.options) assert.ok(blocks.some(block=>block.text===`${option.key}. ${option.text}`));
    assert.ok(!blocks.some(block=>block.text===question.explanation));
  }
});

test("cloze word bank is translated once, while historic question text uses the submission snapshot", () => {
  const cloze = paper.sections[0];
  const blocks = cetTranslationBlocks(cloze,cloze.paragraphs);
  for(const option of cloze.bank!) assert.equal(blocks.filter(block=>block.text===`${option.key}. ${option.text}`).length,1);
  const section = paper.sections.find(section=>section.type==="detail")!;
  const activity = createCetActivity({paper,sectionId:section.id,purpose:"self_test",owner:"test"});
  const finalized = cetFinalize(activity,paper,"manual_submit",undefined,undefined,"test-final");
  const frozen = finalized.finalizations["test-final"];
  const changed = {...section,questions:section.questions.map(question=>({...question,stem:"New question",options:[]}))};
  const historical = cetTranslationBlocks(changed,section.paragraphs,frozen);
  assert.ok(historical.some(block=>block.text===`${section.questions[0].number}. ${section.questions[0].stem}`));
  assert.ok(!historical.some(block=>block.text.includes("New question")));
});
