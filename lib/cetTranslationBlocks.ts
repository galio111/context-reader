import type { CetFinalization, CetSection } from "../types/cet";
import type { ArticleTranslationBlock } from "../types/reader";

/** Translation has a wider scope than the passage saved as an article. */
export function cetTranslationBlocks(section: CetSection, paragraphs: string[], result?: CetFinalization): ArticleTranslationBlock[] {
  const frozen = result?.questions.filter(question => question.sectionId === section.id);
  const questions = frozen?.length ? frozen : section.questions;
  const bank = section.bank?.length && frozen?.length ? frozen[0].options : section.bank;
  const blocks: ArticleTranslationBlock[] = paragraphs.map((text, index) => ({
    id: `${section.id}-${index}`, type: "paragraph", text,
  }));
  if (bank?.length) {
    blocks.push({ id: `${section.id}-bank-heading`, type: "subheading", text: "选词词库" });
    for (const option of bank) blocks.push({ id: `${section.id}-bank-${option.key}`, type: "paragraph", text: `${option.key}. ${option.text}` });
  }
  if (questions.length) blocks.push({ id: `${section.id}-questions-heading`, type: "subheading", text: "题目与选项" });
  for (const question of questions) {
    blocks.push({ id: `${section.id}-question-${question.number}`, type: "paragraph", text: `${question.number}. ${question.stem}` });
    // Cloze options are already represented once in the shared word bank.
    if (!bank?.length) for (const option of question.options) {
      blocks.push({ id: `${section.id}-question-${question.number}-${option.key}`, type: "paragraph", text: `${option.key}. ${option.text}` });
    }
  }
  return blocks.filter(block => block.text.trim());
}
