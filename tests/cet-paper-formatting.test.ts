import test from "node:test";
import assert from "node:assert/strict";
import { validateCetParagraphEdit } from "../lib/cetPaperFormatting";

test("paragraph repair can move breaks and remove a page number without changing fill-in blanks", () => {
  assert.equal(validateCetParagraphEdit(["The [[36]] first sentence. The second sentence 6·9."], ["The [[36]] first sentence.", "The second sentence."]), null);
  assert.equal(validateCetParagraphEdit(["The [[36]] first sentence."], ["The [[37]] first sentence."]), "填空编号不能改变。");
  assert.match(validateCetParagraphEdit(["A long source paragraph with a complete sentence."], ["A sentence."]) || "", /正文变动过大/);
});
