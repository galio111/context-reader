import {
  explanationAsStreamText, explanationFromCompletedStream, mergeStreamDisplayIntoExplanation, parseExplanationStream,
} from "@/lib/explanationDisplay";
import { pronunciationTargetMatches } from "@/lib/pronunciation";
import type { WordContext, WordExplanation } from "@/types/reader";

type Selection = Pick<WordContext, "word" | "sentence">;

function hasStructuredResult(value: unknown, word: string): value is WordExplanation {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<WordExplanation>;
  return e.word === word && Boolean(e.anki && typeof e.anki === "object") && typeof e.lemma === "string" && typeof e.phonetic === "string" &&
    [e.partOfSpeech, e.difficulty, e.exampleEnglish, e.basicMeaning, e.contextMeaning,
      e.sentenceTranslation, e.usageNote, e.collocation, e.exampleChinese].every(v => typeof v === "string" && v.trim());
}

export function finishExtensionLookup(context: Selection, structured: unknown, streamText: string, markedComplete: boolean) {
  const streamed = markedComplete && explanationFromCompletedStream(streamText, context, true);
  const base = hasStructuredResult(structured, context.word) ? structured : null;
  if (streamed) {
    const explanation = mergeStreamDisplayIntoExplanation(base || streamed, streamText);
    return { explanation, streamText: !streamed.phonetic && explanation.phonetic ? explanationAsStreamText(explanation) : streamText };
  }
  if (!base) return null;

  // The next field heading closes the preceding one. At interruption the last
  // section may end halfway through a word, even if its value is nonempty.
  const fields = new Map(parseExplanationStream(streamText).slice(0, -1).map(s => [s.label, s.value]));
  for (const label of ["基础释义", "当前语境含义", "当前句子翻译", "用法说明", "例句中文翻译"]) {
    if (!/[\u3400-\u9fff]/u.test(fields.get(label) || "")) fields.delete(label);
  }
  if (!pronunciationTargetMatches(fields.get("当前词音标归属") || "", context.word) || !fields.get("当前词音标")) {
    fields.delete("当前词音标");
    fields.delete("当前词音标归属");
  }
  const completed = parseExplanationStream(explanationAsStreamText(base))
    .map(s => `${s.label}：${fields.get(s.label) || s.value}`).join("\n");
  return { explanation: mergeStreamDisplayIntoExplanation(base, completed), streamText: completed };
}
