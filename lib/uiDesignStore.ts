import "server-only";
import { accountFetch } from "@/lib/accountStore";
import { UI_DESIGN_TARGET_RULES } from "@/lib/uiDesignRegistry";
import {
  emptyUiDesignState, publicUiDesignState, validateUiDesignMutation, validateUiDesignState,
  type UiDesignMutationResult, type UiDesignTargetRule,
} from "@/lib/uiDesign";

export const UI_DESIGN_SETTINGS_KEY = "ui_design_v1";
type SettingsFetch = (path: string, init?: RequestInit) => Promise<unknown>;
const STATUSES: UiDesignMutationResult["status"][] = ["saved", "published", "rolled-back", "unchanged", "conflict", "no-previous"];

/** Injectable transport for isolated tests; production uses only the service-role server transport. */
export function createUiDesignStore(fetchSettings: SettingsFetch, targets: readonly UiDesignTargetRule[]) {
  const store = {
    async read() {
      const rows = await fetchSettings(`account_settings?key=eq.${UI_DESIGN_SETTINGS_KEY}&select=value&limit=1`);
      if (!Array.isArray(rows) || rows.length > 1) throw new Error("UI design storage response invalid");
      if (!rows.length) return emptyUiDesignState();
      return validateUiDesignState(rows[0]?.value, targets);
    },
    async mutate(input: unknown): Promise<UiDesignMutationResult> {
      const mutation = validateUiDesignMutation(input, targets);
      // Revalidate saved recipes against this release's allowlist before publishing.
      // The RPC still rechecks the revision under a row lock after this read.
      const current = await store.read();
      if (current.revision !== mutation.expectedRevision) return { status: "conflict", state: current };
      const result = await fetchSettings("rpc/mutate_ui_design_v1", {
        method: "POST",
        body: JSON.stringify({
          p_expected_revision: mutation.expectedRevision,
          p_action: mutation.action,
          p_recipe: mutation.action === "save" ? mutation.recipe : null,
        }),
      });
      if (!result || typeof result !== "object" || Array.isArray(result)
        || !STATUSES.includes((result as UiDesignMutationResult).status)) throw new Error("UI design mutation response invalid");
      const value = result as UiDesignMutationResult;
      return { status: value.status, state: validateUiDesignState(value.state, targets) };
    },
  };
  return store;
}

const store = createUiDesignStore(accountFetch, UI_DESIGN_TARGET_RULES);
export const readUiDesignState = () => store.read();
export const mutateUiDesign = (input: unknown) => store.mutate(input);
export const readPublishedUiDesign = async () => publicUiDesignState(await store.read());
