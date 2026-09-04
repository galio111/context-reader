export type GuestCoverSnapTarget = "cover" | "recommendations";

interface GuestCoverTouchGesture {
  deltaX: number;
  deltaY: number;
  viewportHeight: number;
  startedInHandoff: boolean;
  startedNearRecommendations: boolean;
}

export function guestCoverTouchSnapTarget({
  deltaX,
  deltaY,
  viewportHeight,
  startedInHandoff,
  startedNearRecommendations,
}: GuestCoverTouchGesture): GuestCoverSnapTarget | null {
  const minimumTravel = Math.min(48, Math.max(24, viewportHeight * 0.035));
  if (Math.abs(deltaY) < minimumTravel || Math.abs(deltaY) <= Math.abs(deltaX) * 1.15) {
    return null;
  }
  if (deltaY < 0 && startedInHandoff) return "recommendations";
  if (deltaY > 0 && (startedInHandoff || startedNearRecommendations)) return "cover";
  return null;
}
