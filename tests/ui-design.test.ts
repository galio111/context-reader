import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUiDesignMutation, emptyUiDesignRecipe, emptyUiDesignState, publicUiDesignState,
  UiDesignValidationError, validateUiDesignMutation, validateUiDesignRecipe, validateUiDesignState,
  UI_NUMBER_LIMITS, type UiDesignRecipe, type UiDesignTargetRule,
} from "../lib/uiDesign";
import { createUiDesignStore } from "../lib/uiDesignStore";

const rules: UiDesignTargetRule[] = [
  { id: "reader.primary", componentIds: ["c-material-shimmer-button", "c-material-specular-button"] },
  { id: "reader.page", allowedFields: ["background", "padding", "gap", "offsetX", "offsetY"] },
  { id: "admin.delete", editable: false },
];
const recipe = (patch: unknown) => ({ version: 1, targets: { "reader.primary": patch } });
const sample = validateUiDesignRecipe(recipe({ accent: "#DFE0EF", radius: 20, material: "frosted", mobile: { fontSize: 14, offsetY: -20 }, componentId: "c-material-shimmer-button" }), rules);

test("design recipe retains safe values, canonicalizes colors/order and isolates the mobile breakpoint", () => {
  assert.deepEqual(sample, { version: 1, targets: { "reader.primary": { accent: "#dfe0ef", componentId: "c-material-shimmer-button", material: "frosted", mobile: { fontSize: 14, offsetY: -20 }, radius: 20 } } });
  assert.deepEqual(validateUiDesignRecipe(recipe({ mobile: {} }), rules), emptyUiDesignRecipe());
  const reordered = recipe({ radius: 20, mobile: { offsetY: -20, fontSize: 14 }, material: "frosted", componentId: "c-material-shimmer-button", accent: "#dfe0ef" });
  assert.equal(JSON.stringify(validateUiDesignRecipe(reordered, rules)), JSON.stringify(sample));
});

test("design documents reject executable strings, selectors, arbitrary URLs, metadata and unknown targets", () => {
  const invalid = [
    recipe({ background: "url(https://attacker.test/pixel)" }), recipe({ accent: "red;display:none" }),
    recipe({ accent: "#fff" }), recipe({ font: "url(evil)" }), recipe({ selector: "body" }),
    recipe({ css: "button{display:none}" }), recipe({ onClick: "alert(1)" }), recipe({ display: "none" }),
    recipe({ componentId: "https://untrusted.test/x.js" }), recipe({ componentId: "c-material-unknown" }),
    { ...sample, userId: "private-id" }, { version: 2, targets: {} }, { version: 1, targets: [] },
    { version: 1, targets: { "unknown": {} } }, { version: 1, targets: { "admin.delete": { opacity: .5 } } },
    { version: 1, targets: { "reader.page": { font: "serif" } } },
    recipe({ mobile: { mobile: { radius: 2 } } }), recipe({ mobile: null }),
    JSON.parse('{"version":1,"targets":{"__proto__":{"polluted":true}}}'),
    recipe(JSON.parse('{"__proto__":{"polluted":true}}')), recipe(new Date()), null, [],
  ];
  for (const value of invalid) assert.throws(() => validateUiDesignRecipe(value, rules), UiDesignValidationError, JSON.stringify(value));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("all numeric adjustments are finite and bounded; arrays/strings are never coerced", () => {
  for (const [key, [min, max]] of Object.entries(UI_NUMBER_LIMITS)) {
    for (const value of [min - 1, max + 1, NaN, Infinity, "20", null, [], true]) {
      assert.throws(() => validateUiDesignRecipe(recipe({ [key]: value }), rules), UiDesignValidationError, `${key}: ${String(value)}`);
    }
    assert.equal(validateUiDesignRecipe(recipe({ [key]: min }), rules).targets["reader.primary"][key as keyof typeof UI_NUMBER_LIMITS], min);
    assert.equal(validateUiDesignRecipe(recipe({ [key]: max }), rules).targets["reader.primary"][key as keyof typeof UI_NUMBER_LIMITS], max);
  }
  assert.throws(() => validateUiDesignRecipe(recipe({ order: 1.5 }), rules), UiDesignValidationError);
  assert.throws(() => validateUiDesignRecipe({ version: 1, targets: Object.fromEntries(Array.from({ length: 385 }, (_, i) => [`t-${i}`, {}])) }, rules), UiDesignValidationError);
  assert.throws(() => validateUiDesignRecipe(recipe({ font: "x".repeat(65_536) }), rules), UiDesignValidationError);
});

test("publish cannot include an unsaved client recipe, and mutation revisions are explicit safe integers", () => {
  for (const input of [
    { action: "publish", expectedRevision: 0, recipe: sample }, { action: "save", expectedRevision: 0 },
    { action: "delete", expectedRevision: 0 }, { action: "rollback", expectedRevision: "0" },
    { action: "save", expectedRevision: -1, recipe: sample }, { action: "publish", expectedRevision: 1.3 },
    { action: "publish", expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.throws(() => validateUiDesignMutation(input, rules), UiDesignValidationError);
  assert.deepEqual(validateUiDesignMutation({ action: "save", expectedRevision: 0, recipe: sample }, rules), { action: "save", expectedRevision: 0, recipe: sample });
});

test("save remains private, publish applies only saved draft, rollback preserves draft, retries do not publish twice", () => {
  const now = "2026-10-13T04:30:00.000Z";
  let state = emptyUiDesignState();
  assert.equal(applyUiDesignMutation(state, { action: "rollback", expectedRevision: 0 }, now).status, "no-previous");
  state = applyUiDesignMutation(state, { action: "save", expectedRevision: 0, recipe: sample }, now).state;
  assert.equal(state.revision, 1);
  assert.deepEqual(publicUiDesignState(state), { recipe: emptyUiDesignRecipe(), revision: 0, updatedAt: null });
  assert.equal(applyUiDesignMutation(state, { action: "save", expectedRevision: 1, recipe: sample }, now).status, "unchanged");
  state = applyUiDesignMutation(state, { action: "publish", expectedRevision: 1 }, now).state;
  assert.equal(state.revision, 2);
  assert.deepEqual(publicUiDesignState(state), { recipe: sample, revision: 2, updatedAt: now });
  assert.equal(applyUiDesignMutation(state, { action: "publish", expectedRevision: 1 }, now).status, "conflict");
  assert.equal(applyUiDesignMutation(state, { action: "publish", expectedRevision: 2 }, now).status, "unchanged");
  state = applyUiDesignMutation(state, { action: "rollback", expectedRevision: 2 }, now).state;
  assert.deepEqual(state.published, emptyUiDesignRecipe());
  assert.deepEqual(state.previous, sample);
  assert.deepEqual(state.draft, sample, "rollback must not discard unfinished editing");
  assert.equal(state.revision, 3);
  assert.equal(applyUiDesignMutation(state, { action: "rollback", expectedRevision: 2 }, now).status, "conflict");
  assert.deepEqual(validateUiDesignState(state, rules), state);
  assert.throws(() => validateUiDesignState({ ...state, accessToken: "secret" }, rules), UiDesignValidationError);
  assert.throws(() => validateUiDesignState({ ...state, publishedRevision: 5 }, rules), UiDesignValidationError);
});

test("store validates before transport and uses only the fixed service RPC and settings key", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  let state = emptyUiDesignState();
  const store = createUiDesignStore(async (path, init) => {
    requests.push({ path, init });
    if (!init) return state.revision ? [{ value: structuredClone(state) }] : [];
    assert.equal(path, "rpc/mutate_ui_design_v1");
    assert.equal(init.method, "POST");
    const body = JSON.parse(String(init.body));
    const mutation = validateUiDesignMutation({ action: body.p_action, expectedRevision: body.p_expected_revision, ...(body.p_action === "save" ? { recipe: body.p_recipe } : {}) }, rules);
    const result = applyUiDesignMutation(state, mutation, "2026-10-13T04:30:00.000Z");
    state = result.state;
    return structuredClone(result);
  }, rules);
  await assert.rejects(store.mutate({ action: "save", expectedRevision: 0, recipe: recipe({ background: "url(x)" }) }), UiDesignValidationError);
  assert.equal(requests.length, 0);
  const saved = await store.mutate({ action: "save", expectedRevision: 0, recipe: sample });
  assert.equal(saved.status, "saved");
  assert.equal(requests[0].path, "account_settings?key=eq.ui_design_v1&select=value&limit=1");
  const published = await store.mutate({ action: "publish", expectedRevision: 1 });
  assert.equal(published.status, "published");
  assert.equal(JSON.parse(String(requests.at(-1)?.init?.body)).p_recipe, null);
  assert.deepEqual(await store.read(), state);
});

test("competing clients cannot overwrite one another and transport failures do not become successful defaults", async () => {
  let state = emptyUiDesignState();
  let rpcCalls = 0;
  const store = createUiDesignStore(async (_path, init) => {
    if (!init) return [{ value: structuredClone(state) }];
    rpcCalls++;
    const body = JSON.parse(String(init.body));
    // The fake RPC models the database's locked compare-and-swap after both clients read revision 0.
    await Promise.resolve();
    const result = applyUiDesignMutation(state, { action: "save", expectedRevision: body.p_expected_revision, recipe: body.p_recipe }, "2026-10-13T04:30:00.000Z");
    state = result.state;
    return structuredClone(result);
  }, rules);
  const other: UiDesignRecipe = { version: 1, targets: { "reader.primary": { radius: 8 } } };
  const results = await Promise.all([store.mutate({ action: "save", expectedRevision: 0, recipe: sample }), store.mutate({ action: "save", expectedRevision: 0, recipe: other })]);
  assert.deepEqual(results.map(value => value.status).sort(), ["conflict", "saved"]);
  assert.equal(rpcCalls, 2);
  assert.equal(state.revision, 1);
  const failed = createUiDesignStore(async () => { throw new Error("database unavailable"); }, rules);
  await assert.rejects(failed.read(), /database unavailable/);
  await assert.rejects(failed.mutate({ action: "save", expectedRevision: 0, recipe: sample }), /database unavailable/);
  const malformed = createUiDesignStore(async () => [{ value: { ...emptyUiDesignState(), draft: recipe({ url: "evil" }) } }], rules);
  await assert.rejects(malformed.mutate({ action: "publish", expectedRevision: 0 }), UiDesignValidationError);
});
