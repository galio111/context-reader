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

/** Browser block boundaries become paragraphs; explicit BRs remain soft breaks. */
export function readCetEditableParagraphs(root: HTMLElement): string[] {
  const paragraphs: string[] = [];
  let text = "";
  const flush = () => { paragraphs.push(text.replace(/\u00a0/g, " ")); text = ""; };
  function visit(node: Node) {
    if (node.nodeType === 3) { text += node.textContent || ""; return; }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element.dataset.cetPlaceholder) { text += element.dataset.cetPlaceholder; return; }
    if (element.tagName === "BR") { text += "\n"; return; }
    const block = ["P", "DIV", "LI"].includes(element.tagName);
    if (block && text) flush();
    Array.from(element.childNodes).forEach(visit);
    if (block) {
      if (element.lastChild?.nodeName === "BR") text = text.replace(/\n$/, "");
      flush();
    }
  }
  Array.from(root.childNodes).forEach(visit);
  if (text || !paragraphs.length) flush();
  return paragraphs;
}

export function writeCetEditableParagraphs(root: HTMLElement, paragraphs: string[]) {
  const document = root.ownerDocument;
  root.replaceChildren(...paragraphs.map(text => {
    const paragraph = document.createElement("p");
    for (const part of text.split(/(\[\[\d+\]\])/g)) {
      if (/^\[\[\d+\]\]$/.test(part)) {
        const blank = document.createElement("span");
        blank.className = "cet-gap cet-editable-gap";
        blank.setAttribute("contenteditable", "false");
        blank.dataset.cetPlaceholder = part;
        blank.textContent = part.slice(2, -2);
        paragraph.append(blank);
      } else paragraph.append(document.createTextNode(part));
    }
    if (!text) paragraph.append(document.createElement("br"));
    return paragraph;
  }));
}
