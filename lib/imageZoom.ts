export interface ImageZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ImageZoomPoint {
  x: number;
  y: number;
}

export function cursorAnchoredImageZoom(
  current: ImageZoomTransform,
  nextScale: number,
  point: ImageZoomPoint,
): ImageZoomTransform {
  const safeScale = current.scale > 0 ? current.scale : 1;
  const sourceX = (point.x - current.x) / safeScale;
  const sourceY = (point.y - current.y) / safeScale;
  return {
    scale: nextScale,
    x: point.x - sourceX * nextScale,
    y: point.y - sourceY * nextScale,
  };
}

export function interpolateImageZoom(
  current: ImageZoomTransform,
  target: ImageZoomTransform,
  amount: number,
): ImageZoomTransform {
  const progress = Math.min(1, Math.max(0, amount));
  return {
    scale: current.scale + (target.scale - current.scale) * progress,
    x: current.x + (target.x - current.x) * progress,
    y: current.y + (target.y - current.y) * progress,
  };
}
