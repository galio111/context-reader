import type { ExplanationRequest } from "@/types/reader";

export const EXPLANATION_SENTENCE_CONTEXT_VERSION = 2 as const;

/** The routes already bound the JSON request body. Preserve the complete target
 * sentence: cropping it can remove the selected occurrence while leaving the
 * same word in background context, causing an unrelated sentence translation. */
export function sanitizeExplanationRequest(input: ExplanationRequest): ExplanationRequest {
  return {
    word: input.word.trim().slice(0, 500),
    sentence: input.sentence.trim(),
    previousSentence: (input.previousSentence ?? "").trim().slice(-220),
    nextSentence: (input.nextSentence ?? "").trim().slice(0, 220),
  };
}
