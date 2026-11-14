interface TextEntry {
  node: Text;
  start: number;
  end: number;
}

interface Run {
  node: Text;
  left: number;
  right: number;
  y: number;
  height: number;
}

interface Line {
  runs: Run[];
  left: number;
  right: number;
  y: number;
  height: number;
}

const layouts = new WeakMap<HTMLElement, { lines: Line[]; byNode: Map<Node, Line> }>();

function pageLayout(layer: HTMLElement) {
  const existing = layouts.get(layer);
  if (existing) return existing;
  const runs: Run[] = [];
  const walker = layer.ownerDocument.createTreeWalker(layer, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.data.trim()) continue;
    const box = node.parentElement!.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    runs.push({ node, left: box.left, right: box.right, y: box.bottom, height: box.height });
  }
  const lines: Line[] = [];
  const byNode = new Map<Node, Line>();
  // A PDF's drawing order can interleave columns and place superscripts later.
  // Assemble visual runs first, retaining the identity of each selectable node.
  for (const run of runs.sort((a, b) => a.left - b.left || a.y - b.y)) {
    let closest: Line | undefined;
    let best = Infinity;
    for (const line of lines) {
      const height = Math.max(line.height, run.height);
      const dy = Math.abs(line.y - run.y);
      const dx = run.left - line.right;
      if (dy > height * .46 || dx > height * 1.15 || dx < -height * .55) continue;
      const score = dy + Math.abs(dx) * .25;
      if (score < best) { closest = line; best = score; }
    }
    if (!closest) {
      closest = { ...run, runs: [] };
      lines.push(closest);
    }
    closest.runs.push(run);
    closest.right = Math.max(closest.right, run.right);
    byNode.set(run.node, closest);
  }
  const layout = { lines, byNode };
  if (byNode.size) layouts.set(layer, layout);
  return layout;
}

function nextLine(lines: Line[], from: Line, direction: -1 | 1): Line | undefined {
  let nearest: Line | undefined;
  let best = Infinity;
  for (const candidate of lines) {
    const height = Math.max(candidate.height, from.height);
    const dy = (candidate.y - from.y) * direction;
    const indent = Math.abs(candidate.left - from.left);
    const overlap = Math.min(candidate.right, from.right) - Math.max(candidate.left, from.left);
    // Manuscript PDFs commonly use double spacing: their baseline advance is
    // about twice the text-layer glyph box height. Treat that as a line wrap,
    // while retaining overlap/alignment checks that keep columns separate.
    if (dy < height * .65 || dy > height * 2.65 || indent > height * 2.5
      || overlap < Math.min(8, height * .5) || Math.abs(candidate.height - from.height) > height * .3) continue;
    const score = dy + indent * .45;
    if (score < best) { nearest = candidate; best = score; }
  }
  return nearest;
}

/** Read only a coherent region around the exact native selection endpoints. */
export function pdfSelectionText(range: Range): { text: string; entries: TextEntry[] } | null {
  const layer = range.startContainer.parentElement?.closest<HTMLElement>(".textLayer");
  if (!layer || !layer.contains(range.endContainer)) return null;
  const { lines, byNode } = pageLayout(layer);
  const first = byNode.get(range.startContainer);
  const last = byNode.get(range.endContainer);
  if (!first || !last) return null;
  const region = [first];
  // Bound the work and stop at column gutters and visual paragraph breaks.
  for (let i = 0; i < 18; i++) {
    const next = nextLine(lines, region.at(-1)!, 1);
    if (!next) break;
    region.push(next);
  }
  if (!region.includes(last)) return null;
  for (let i = 0; i < 12; i++) {
    const previous = nextLine(lines, region[0], -1);
    if (!previous) break;
    region.unshift(previous);
  }
  let text = "";
  const entries: TextEntry[] = [];
  for (const line of region) {
    if (entries.length) text += "\n";
    let previous: Run | undefined;
    for (const run of line.runs) {
      if (previous && run.left - previous.right > Math.max(previous.height, run.height) * .1
        && !/\s$/.test(previous.node.data) && !/^\s/.test(run.node.data)) text += " ";
      entries.push({ node: run.node, start: text.length, end: text.length + run.node.length });
      text += run.node.data;
      previous = run;
    }
  }
  return { text, entries };
}
