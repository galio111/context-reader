/** The design document contains presentation data only, never selectors, URLs or executable CSS. */
export const UI_DESIGN_VERSION = 1 as const;
export const UI_DESIGN_MAX_TARGETS = 384;
export const UI_DESIGN_MAX_BYTES = 60 * 1024;
export const UI_MATERIALS = ["original", "matte", "frosted", "clear", "ceramic", "chrome", "brushed", "soft", "gel", "paper"] as const;
export const UI_FONTS = ["system", "serif", "mono"] as const;
export const UI_MOTIONS = ["none", "fade", "rise", "scale"] as const;

export interface UiVisualPatch {
  accent?: string;
  background?: string;
  textColor?: string;
  material?: typeof UI_MATERIALS[number];
  font?: typeof UI_FONTS[number];
  fontSize?: number;
  radius?: number;
  padding?: number;
  gap?: number;
  width?: number;
  maxWidth?: number;
  offsetX?: number;
  offsetY?: number;
  order?: number;
  opacity?: number;
  motion?: typeof UI_MOTIONS[number];
  motionDuration?: number;
  componentId?: string | null;
}

export type UiVisualField = keyof UiVisualPatch;
export interface UiTargetPatch extends UiVisualPatch { mobile?: UiVisualPatch }
export interface UiDesignRecipe { version: 1; targets: Record<string, UiTargetPatch> }
export interface UiDesignTargetRule {
  id: string;
  editable?: boolean;
  allowedFields?: readonly UiVisualField[];
  componentIds?: readonly string[];
}
export interface UiDesignState {
  version: 1;
  revision: number;
  publishedRevision: number;
  draft: UiDesignRecipe;
  published: UiDesignRecipe;
  previous: UiDesignRecipe | null;
  updatedAt: string | null;
  publishedAt: string | null;
}
export interface UiDesignPublicState {
  recipe: UiDesignRecipe;
  revision: number;
  updatedAt: string | null;
}
export type UiDesignMutation =
  | { action: "save"; expectedRevision: number; recipe: UiDesignRecipe }
  | { action: "publish" | "rollback"; expectedRevision: number };
export type UiDesignMutationResult = {
  status: "saved" | "published" | "rolled-back" | "unchanged" | "conflict" | "no-previous";
  state: UiDesignState;
};

export class UiDesignValidationError extends Error {
  constructor(message = "设计方案格式无效，请重新选择。") { super(message); this.name = "UiDesignValidationError"; }
}

export function emptyUiDesignRecipe(): UiDesignRecipe { return { version: 1, targets: {} }; }
export function emptyUiDesignState(): UiDesignState {
  return { version: 1, revision: 0, publishedRevision: 0, draft: emptyUiDesignRecipe(), published: emptyUiDesignRecipe(), previous: null, updatedAt: null, publishedAt: null };
}

export const UI_NUMBER_LIMITS = {
  fontSize: [10, 96], radius: [0, 80], padding: [0, 120], gap: [0, 120],
  width: [40, 1920], maxWidth: [160, 2400], offsetX: [-320, 320], offsetY: [-320, 320],
  order: [-100, 100], opacity: [0.35, 1], motionDuration: [0, 2000],
} as const;
const COLOR_FIELDS = new Set(["accent", "background", "textColor"]);
const ENUM_FIELDS: Record<string, readonly string[]> = { material: UI_MATERIALS, font: UI_FONTS, motion: UI_MOTIONS };
const VISUAL_FIELDS = new Set([...COLOR_FIELDS, ...Object.keys(ENUM_FIELDS), ...Object.keys(UI_NUMBER_LIMITS), "componentId"]);
const TARGET_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function allowedKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new UiDesignValidationError();
}
function boundedJson(value: unknown) {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { throw new UiDesignValidationError(); }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > UI_DESIGN_MAX_BYTES) throw new UiDesignValidationError("设计方案过大，请减少同时调整的元素。");
}

function validatePatch(input: unknown, rule: UiDesignTargetRule, mobile: boolean): UiTargetPatch {
  if (!record(input)) throw new UiDesignValidationError();
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (key === "mobile" && !mobile) { result.mobile = validatePatch(value, rule, true); continue; }
    if (!VISUAL_FIELDS.has(key) || rule.allowedFields && !rule.allowedFields.includes(key as UiVisualField)) throw new UiDesignValidationError("这个元素不支持所选调整。");
    if (COLOR_FIELDS.has(key)) {
      if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new UiDesignValidationError("请选择有效的颜色。");
      result[key] = value.toLowerCase();
    } else if (Object.hasOwn(ENUM_FIELDS, key)) {
      if (typeof value !== "string" || !ENUM_FIELDS[key].includes(value)) throw new UiDesignValidationError();
      result[key] = value;
    } else if (Object.hasOwn(UI_NUMBER_LIMITS, key)) {
      const [min, max] = UI_NUMBER_LIMITS[key as keyof typeof UI_NUMBER_LIMITS];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || key === "order" && !Number.isInteger(value)) throw new UiDesignValidationError("调整数值超出范围。");
      result[key] = Math.round(value * 1000) / 1000;
    } else if (key === "componentId") {
      if (value !== null && (typeof value !== "string" || value.length > 120 || !rule.componentIds?.includes(value))) throw new UiDesignValidationError("这个组件不适合当前元素。");
      result.componentId = value;
    }
  }
  return result as UiTargetPatch;
}

/** Strict and canonical: unknown fields/targets are errors; object insertion order is irrelevant. */
export function validateUiDesignRecipe(input: unknown, targets: readonly UiDesignTargetRule[]): UiDesignRecipe {
  boundedJson(input);
  if (!record(input) || input.version !== 1 || !record(input.targets)) throw new UiDesignValidationError();
  allowedKeys(input, ["version", "targets"]);
  const keys = Object.keys(input.targets).sort();
  if (keys.length > UI_DESIGN_MAX_TARGETS) throw new UiDesignValidationError("设计方案包含过多元素。");
  const rules = new Map(targets.map(target => [target.id, target]));
  const output: UiDesignRecipe = emptyUiDesignRecipe();
  for (const key of keys) {
    const rule = rules.get(key);
    if (key.length > 100 || !TARGET_ID.test(key) || !rule || rule.editable === false) throw new UiDesignValidationError("方案包含当前不可调整的元素。");
    const patch = validatePatch(input.targets[key], rule, false);
    if (patch.mobile && !Object.keys(patch.mobile).length) delete patch.mobile;
    if (Object.keys(patch).length) output.targets[key] = patch;
  }
  return output;
}

function revision(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is string | null { return value === null || typeof value === "string" && value.length <= 35 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }

export function validateUiDesignMutation(input: unknown, targets: readonly UiDesignTargetRule[]): UiDesignMutation {
  if (!record(input) || !revision(input.expectedRevision)) throw new UiDesignValidationError();
  if (input.action === "save") {
    allowedKeys(input, ["action", "expectedRevision", "recipe"]);
    return { action: "save", expectedRevision: input.expectedRevision, recipe: validateUiDesignRecipe(input.recipe, targets) };
  }
  if (input.action === "publish" || input.action === "rollback") {
    allowedKeys(input, ["action", "expectedRevision"]);
    return { action: input.action, expectedRevision: input.expectedRevision };
  }
  throw new UiDesignValidationError();
}

export function validateUiDesignState(input: unknown, targets: readonly UiDesignTargetRule[]): UiDesignState {
  if (!record(input) || input.version !== 1 || !revision(input.revision) || !revision(input.publishedRevision)
    || input.publishedRevision > input.revision || !timestamp(input.updatedAt) || !timestamp(input.publishedAt)) throw new UiDesignValidationError();
  allowedKeys(input, ["version", "revision", "publishedRevision", "draft", "published", "previous", "updatedAt", "publishedAt"]);
  return {
    version: 1, revision: input.revision, publishedRevision: input.publishedRevision,
    draft: validateUiDesignRecipe(input.draft, targets), published: validateUiDesignRecipe(input.published, targets),
    previous: input.previous === null ? null : validateUiDesignRecipe(input.previous, targets),
    updatedAt: input.updatedAt, publishedAt: input.publishedAt,
  };
}

/** Projection is deliberately explicit: no saved draft or rollback history reaches public visitors. */
export function publicUiDesignState(state: UiDesignState): UiDesignPublicState {
  return { recipe: state.published, revision: state.publishedRevision, updatedAt: state.publishedAt };
}

/** Pure reference model for editor comparisons and tests; the database performs the atomic transition. */
export function applyUiDesignMutation(state: UiDesignState, change: UiDesignMutation, now: string): UiDesignMutationResult {
  if (state.revision !== change.expectedRevision) return { status: "conflict", state };
  if (change.action === "rollback" && !state.previous) return { status: "no-previous", state };
  const recipe = change.action === "save" ? change.recipe : change.action === "publish" ? state.draft : state.previous!;
  const current = change.action === "save" ? state.draft : state.published;
  if (JSON.stringify(current) === JSON.stringify(recipe)) return { status: "unchanged", state };
  const nextRevision = state.revision + 1;
  if (!Number.isSafeInteger(nextRevision)) throw new UiDesignValidationError();
  if (change.action === "save") return { status: "saved", state: { ...state, revision: nextRevision, draft: recipe, updatedAt: now } };
  return { status: change.action === "publish" ? "published" : "rolled-back", state: {
    ...state, revision: nextRevision, publishedRevision: nextRevision, published: recipe,
    previous: state.published, updatedAt: now, publishedAt: now,
  } };
}
