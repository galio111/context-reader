import type { UiDesignTargetRule } from "./uiDesign";

// The UI integration replaces this initial safe surface with the reviewed inventory.
// IDs and component compatibility remain a build-time allowlist, never request data.
export const UI_DESIGN_TARGET_RULES: readonly UiDesignTargetRule[] = [
  { id: "site-background", editable: true, allowedFields: ["background", "accent"] },
];
