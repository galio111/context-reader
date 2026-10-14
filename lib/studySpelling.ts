import { buildContextCloze } from "./ankiData";

export type SpellingPart = { kind: "equal" | "change"; typed: string; expected: string };
export function spellingText(value: string): string {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, "-").trim().replace(/\s+/g, " ");
}

/** Keep the actual sentence form, including capitalization and punctuation. */
export function spellingSentence(sentence: string, word: string) {
  const cloze = buildContextCloze(sentence, word);
  let firstDifference = 0;
  while (firstDifference < cloze.length && sentence[firstDifference] === cloze[firstDifference]) firstDifference++;
  const index = cloze.indexOf("________", firstDifference);
  if (index < 0) return null;
  const before = cloze.slice(0, index), after = cloze.slice(index + 8);
  return { before, after, expected: sentence.slice(before.length, sentence.length - after.length) };
}

/** Minimum edits, then group isolated accidental matches inside an erroneous run.
 * Two consecutive matching letters or a word boundary form a reliable anchor.
 * Limits bound both memory and rendering for pasted input. */
export function checkSpelling(typed: string, expected: string): SpellingPart[] {
  if (spellingText(expected).length > 256) return [{ kind: "change", typed: spellingText(typed), expected: spellingText(expected) }];
  const a = Array.from(spellingText(typed).slice(0, 256));
  const b = Array.from(spellingText(expected).slice(0, 256));
  const same = (i: number, j: number) => a[i].toLowerCase() === b[j].toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length; i >= 0; i--) for (let j = b.length; j >= 0; j--) {
    if (i === a.length) dp[i][j] = b.length - j;
    else if (j === b.length) dp[i][j] = a.length - i;
    else dp[i][j] = same(i, j) ? dp[i + 1][j + 1] : 1 + Math.min(dp[i + 1][j + 1], dp[i + 1][j], dp[i][j + 1]);
  }
  const parts: SpellingPart[] = [];
  const push = (kind: SpellingPart["kind"], typed: string, expected: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) { last.typed += typed; last.expected += expected; }
    else parts.push({ kind, typed, expected });
  };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(i, j)) push("equal", a[i++], b[j++]);
    else if (i < a.length && j < b.length && dp[i][j] === 1 + dp[i + 1][j + 1]) push("change", a[i++], b[j++]);
    else if (i < a.length && dp[i][j] === 1 + dp[i + 1][j]) push("change", a[i++], "");
    else push("change", "", b[j++]);
  }
  for (let k = 1; k < parts.length - 1; k++) {
    const part = parts[k];
    if (part.kind === "equal" && part.expected.length === 1 && /[a-z]/i.test(part.expected)
      && parts[k - 1].kind === "change" && parts[k + 1].kind === "change") {
      const left = parts[k - 1], right = parts[k + 1];
      left.typed += part.typed + right.typed;
      left.expected += part.expected + right.expected;
      parts.splice(k, 2); k--;
    }
  }
  return parts;
}
