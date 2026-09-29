export function validateCetParagraphEdit(original: string[], edited: string[]): string | null {
  const oldText = original.join(" ");
  const newText = edited.join(" ");
  const oldPlaceholders = oldText.match(/\[\[\d+\]\]/g) || [];
  const newPlaceholders = newText.match(/\[\[\d+\]\]/g) || [];
  if (oldPlaceholders.join("|") !== newPlaceholders.join("|")) return "填空编号不能改变。";
  const oldLength = oldText.replace(/\s/g, "").length;
  const newLength = newText.replace(/\s/g, "").length;
  if (oldLength && (newLength < oldLength * .85 || newLength > oldLength * 1.15)) {
    return "正文变动过大，请分次检查并保存，避免误删原文。";
  }
  return null;
}
