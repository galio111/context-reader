import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeArticle, hasClickableWords } from "../lib/tokenizer";
import { LATIN_PHRASE_PATTERN } from "../lib/latinWords";
import { validateStandaloneDictionaryInput } from "../lib/clientErrorReporting";
import { isValidPronunciationText } from "../lib/pronunciation";

test("accented words retain original text and offsets across selection, lookup and speech", () => {
  for (const term of ["Céline", "coup d’état", "naïve", "cafe\u0301", "São", "dʼétat"]) {
    const text = `Before ${term} after.`;
    const words = tokenizeArticle(text)[0].tokens.filter(token => token.type === "word");
    assert.equal(words.slice(1, -1).map(token => token.value).join(" "), term);
    for (const word of words) assert.equal(text.slice(word.start, word.end), word.value);
    assert.equal(hasClickableWords(term), true);
    assert.equal(LATIN_PHRASE_PATTERN.test(term), true);
    assert.equal(validateStandaloneDictionaryInput(term), "");
    assert.equal(isValidPronunciationText(term), true);
  }
});
test("lookup still rejects sentences, digits, mixed languages and isolated marks", () => {
  for (const term of ["hello1", "中文é", "hello!", "\u0301", "one two three four five six seven eight nine"]) {
    assert.notEqual(validateStandaloneDictionaryInput(term), "");
    assert.equal(isValidPronunciationText(term), false);
  }
});
