import type { PDFPageProxy } from "pdfjs-dist";

interface Glyph { unicode: string; fontChar: string }
interface PaintedGlyph { text: string; x: number; y: number; width: number; height: number }

/** Record only this page's canvas text calls. No global canvas/prototype changes.
 * PDF embedded fonts often map glyphs to private-use characters; their Unicode
 * mapping comes from the operator list, not from measuring a substitute font.
 */
export async function recordPdfGlyphs(page: PDFPageProxy, ctx: CanvasRenderingContext2D, ratio: number,
  ops: { setFont: number; save: number; restore: number }) {
  const operators = await page.getOperatorList();
  const fonts = new Map<string, Map<string, string>>();
  let font = "";
  const stack: string[] = [];
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i], args = operators.argsArray[i];
    if (op === ops.save) stack.push(font);
    else if (op === ops.restore) font = stack.pop() ?? font;
    else if (op === ops.setFont) font = args[0];
    if (!font || !Array.isArray(args?.[0])) continue;
    let map = fonts.get(font);
    if (!map) fonts.set(font, map = new Map());
    for (const glyph of args[0] as Glyph[]) {
      if (glyph?.unicode && glyph.fontChar) map.set(glyph.fontChar, glyph.unicode.normalize("NFKC"));
    }
  }
  const glyphs: PaintedGlyph[] = [];
  const fill = ctx.fillText, stroke = ctx.strokeText;
  const capture = (value: string, x: number, y: number) => {
    const entry = [...fonts].find(([name]) => ctx.font.includes(`"${name}"`) || ctx.font.includes(`${name},`));
    const text = entry?.[1].get(value);
    if (!text) return;
    const m = ctx.getTransform(), size = Number(ctx.font.match(/([\d.]+)px/)?.[1]);
    // Rotated/vertical text keeps PDF.js's standard layer. Horizontal text is
    // the reading surface; actual glyph positions include TJ/word spacing.
    if (!size || Math.abs(m.b) > .01 || Math.abs(m.c) > .01 || m.a <= 0 || m.d <= 0) return;
    const point = m.transformPoint({ x, y });
    const g = { text, x: point.x / ratio, y: point.y / ratio,
      width: ctx.measureText(value).width * m.a / ratio, height: size * m.d / ratio };
    const previous = glyphs.at(-1);
    if (!previous || previous.text !== text || Math.abs(previous.x - g.x) > .01 || Math.abs(previous.y - g.y) > .01) glyphs.push(g);
  };
  ctx.fillText = function(value, x, y, maxWidth) { capture(value, x, y); fill.call(this, value, x, y, maxWidth); };
  ctx.strokeText = function(value, x, y, maxWidth) { capture(value, x, y); stroke.call(this, value, x, y, maxWidth); };
  return { glyphs, restore() { ctx.fillText = fill; ctx.strokeText = stroke; } };
}

/** Replace each matching text run with character boxes at the painted positions.
 * Keep PDF.js reading order and retain its fallback for unsupported glyph paths.
 */
export function alignPdfTextLayer(layer: HTMLElement, glyphs: PaintedGlyph[], scale: number,
  items: { str: string; transform: number[]; width: number; height: number }[], pageHeight: number) {
  const spans = [...layer.querySelectorAll<HTMLSpanElement>("span")].filter(s => s.textContent);
  const measure = document.createElement("canvas").getContext("2d")!;
  items = items.filter(item => item.str);
  let aligned = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i], item = items[i];
    if (!item || span.textContent !== item.str || !item.str.trim()) continue;
    const x = item.transform[4] * scale, y = pageHeight - item.transform[5] * scale;
    const candidates = glyphs.filter(g => Math.abs(g.y - y) < Math.max(1, g.height * .15)
      && g.x >= x - .5 && g.x < x + item.width * scale + .5).sort((a,b) => a.x - b.x);
    if (!candidates.length) continue;
    const expected = item.str.normalize("NFKC");
    if (candidates.map(g => g.text).join("").replace(/\s/g, "") !== expected.replace(/\s/g, "")) continue;
    const line = document.createElement("span");
    line.dataset.pdfLine = String(i); line.className = "pdfGlyphLine";
    let previous: PaintedGlyph | undefined;
    for (const glyph of candidates) {
      if (previous && !/\s$/.test(previous.text) && !/^\s/.test(glyph.text)
        && glyph.x - previous.x - previous.width > glyph.height * .12) {
        const gap = document.createElement("span"); gap.textContent = " "; gap.className = "pdfGlyph";
        gap.style.cssText = `left:${previous.x + previous.width}px;top:${glyph.y - glyph.height * .8}px;font:normal ${glyph.height}px/1 Arial;width:${glyph.x - previous.x - previous.width}px;`;
        line.append(gap);
      }
      const node = document.createElement("span"); node.className = "pdfGlyph"; node.textContent = glyph.text;
      measure.font = `${glyph.height}px Arial`;
      const naturalWidth = measure.measureText(glyph.text).width || 1;
      node.style.cssText = `left:${glyph.x}px;top:${glyph.y - glyph.height * .8}px;font:normal ${glyph.height}px/1 Arial;transform:scaleX(${glyph.width / naturalWidth});`;
      line.append(node); previous = glyph;
    }
    span.replaceWith(line); aligned++;
  }
  layer.dataset.alignedRuns = String(aligned);
  layer.dataset.paintedGlyphs = String(glyphs.length);
}
