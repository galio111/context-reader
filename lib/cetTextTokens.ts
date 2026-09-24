import { tokenizeArticle } from "./tokenizer";
/** Explicit source offsets distinguish repeated words and fragments after cloze gaps. */
export function cetTextTokens(text: string, groupId: string, contextText = text, contextOffset = 0) {
  const source = tokenizeArticle(contextText).flatMap(p => p.tokens);
  const byStart = new Map(source.filter(t=>t.type==='word').map(t=>[t.start,t]));
  return tokenizeArticle(text).flatMap(p=>p.tokens).map(t=>{
    const original=byStart.get(t.start+contextOffset);
    return {...t, id:`${groupId}:${t.id}`, start:original?.start ?? t.start, end:original?.end ?? t.end,
      tokenIndex:original?.tokenIndex ?? t.tokenIndex, sentence:original?.sentence || t.sentence,
      previousSentence:original?.previousSentence || t.previousSentence, nextSentence:original?.nextSentence || t.nextSentence};
  });
}
