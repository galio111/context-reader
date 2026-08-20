/**
 * Commercial surfaces stay hidden while Context Reader is a free personal-site beta.
 * Re-enable only after the owner explicitly approves the paid-service launch, then rebuild.
 */
export const PUBLIC_COMMERCIAL_UI_ENABLED =
  process.env.NEXT_PUBLIC_COMMERCIAL_UI === "enabled";

export const PUBLIC_USAGE_DETAILS_ENABLED =
  process.env.NEXT_PUBLIC_USAGE_DETAILS_UI === "enabled";
