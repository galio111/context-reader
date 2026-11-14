interface Viewport {
  width: number;
  height: number;
  scale: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/** Keep native PDF advances/baselines beside their exact selectable nodes.
 * CSS font boxes may overlap or change after an embedded font loads. */
export function retainPdfSelectionGeometry(
  container: HTMLElement,
  textLayer: { textDivs: HTMLElement[] },
  content: { items: unknown[] },
  viewport: Viewport,
): void {
  container.dataset.pdfViewport = `${viewport.width},${viewport.height}`;
  let index = 0;
  for (const value of content.items) {
    const item = value as { str?: string; transform?: number[]; width?: number; height?: number };
    if (typeof item.str !== "string") continue;
    const div = textLayer.textDivs[index++];
    if (!div || !item.transform || !item.width || !item.height) continue;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const [right, nextY] = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5]);
    if (Math.abs(nextY - y) > .5) continue;
    div.dataset.pdfRun = [Math.min(x, right), y, Math.abs(right - x), Math.abs(item.height * viewport.scale)].join(",");
  }
}
