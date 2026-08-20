const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g;

export function articleEnglishWords(text: string): string[] {
  return text.match(ENGLISH_WORD_PATTERN) ?? [];
}

export function countArticleEnglishWords(text: string): number {
  return articleEnglishWords(text).length;
}
