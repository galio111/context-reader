export const FEATURE_ORBIT_AUTOPLAY_MS = 6_000;
export const FEATURE_ORBIT_GESTURE_THRESHOLD_PX = 10;

export type FeatureOrbitGestureIntent = "pending" | "horizontal" | "vertical";

export function classifyFeatureOrbitGesture(
  deltaX: number,
  deltaY: number,
  threshold = FEATURE_ORBIT_GESTURE_THRESHOLD_PX,
): FeatureOrbitGestureIntent {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) return "pending";
  return Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
}
