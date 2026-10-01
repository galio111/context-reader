import test from "node:test";
import assert from "node:assert/strict";
import { readCetEditableParagraphs, writeCetEditableParagraphs, validateCetParagraphEdit } from "../lib/cetPaperFormatting";
import { JSDOM } from "jsdom";

test("paragraph repair can move breaks and remove a page number without changing fill-in blanks", () => {
  assert.equal(validateCetParagraphEdit(["The [[36]] first sentence. The second sentence 6·9."], ["The [[36]] first sentence.", "The second sentence."]), null);
  assert.equal(validateCetParagraphEdit(["The [[36]] first sentence."], ["The [[37]] first sentence."]), "填空编号不能改变。");
  assert.match(validateCetParagraphEdit(["A long source paragraph with a complete sentence."], ["A sentence."]) || "", /正文变动过大/);
});

test("editable passage round-trips empty paragraphs, soft breaks, spaces and protected blanks", () => {
  const document = new JSDOM().window.document;
  const root = document.createElement("div");
  const paragraphs = ["First  [[26]] sentence.\nSoft break.", "", "Final paragraph.", ""];
  writeCetEditableParagraphs(root, paragraphs);
  assert.deepEqual(readCetEditableParagraphs(root), paragraphs);
  assert.equal(root.querySelector("[data-cet-placeholder]")?.getAttribute("contenteditable"), "false");
  root.innerHTML = '<p>First<br>soft<br></p><p><br></p><div>Next&nbsp;paragraph</div>';
  assert.deepEqual(readCetEditableParagraphs(root), ["First\nsoft", "", "Next paragraph"]);
});
