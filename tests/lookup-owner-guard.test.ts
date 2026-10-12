import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { UsageIdentity } from "../lib/usageIdentity";

function compiled(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
test("lookup owner mismatch fails before any usage reservation, provider work or persistence", async () => {
  let identity: UsageIdentity = { ownerKey: "user:B", userId: "B", planId: "free", authenticated: true, suspended: false };
  let reservations = 0, providerCalls = 0, writes = 0;
  let identityFailure = false;
  const modules: Record<string, unknown> = {
    "./modelSettings": { setModelPlan: () => {} },
    "@/lib/usagePresentation": { quotaExhaustedMessage: () => "quota" },
    crypto: { randomUUID: () => "action" }, "next/server": {},
    "@/lib/accountStore": { reserveUsage: async () => { reservations++; return { allowed: true }; } },
    "@/lib/usageIdentity": { resolveUsageIdentity: async () => { if (identityFailure) throw Error("offline"); return identity; } },
  };
  const api = runInNewContext(compiled("../lib/usageGate.ts") + "\nexports",
    { exports: {}, console: { error: () => {} }, require: (key: string) => modules[key] }) as {
    gateUsage(request: Request, options: unknown): Promise<unknown>;
  };
  const run = async (owner?: string) => {
    await api.gateUsage(new Request("https://context-reader.com/api/dictionary-stream", {
      method: "POST", headers: owner ? { "X-Context-Account": owner } : {},
    }), { feature: "standalone_dictionary", metricKey: "lookup_generation", guestMetricKey: "guest_dictionary_lookup" });
    providerCalls++; writes++;
  };
  await assert.rejects(run("A"), (error: { status?: number; code?: string }) => error.status === 409 && error.code === "account_changed");
  await assert.rejects(run("guest"), (error: { status?: number }) => error.status === 409);
  assert.deepEqual([reservations, providerCalls, writes], [0, 0, 0]);
  await run("B"); assert.deepEqual([reservations, providerCalls, writes], [1, 1, 1]);
  identity = { ownerKey: "guest:G", guestId: "G", planId: "guest", authenticated: false, suspended: false };
  await assert.rejects(run("B"), (error: { status?: number }) => error.status === 409);
  await run("guest"); await run(); // Existing clients without a captured owner stay compatible.
  assert.deepEqual([reservations, providerCalls, writes], [3, 3, 3]);
  identityFailure = true;
  await assert.rejects(run("B"), (error: { status?: number }) => error.status === 503);
  assert.deepEqual([reservations, providerCalls, writes], [3, 3, 3]);
});

test("contextual structured and stream requests retain the captured owner across account changes", async () => {
  let owner = "A";
  const captured: string[] = [];
  const modules: Record<string, unknown> = {
    "@/lib/apiClient": { fetchJson: async (_url: string, init: RequestInit) => {
      captured.push(new Headers(init.headers).get("X-Context-Account")!);
      return { response: Response.json({}), data: { explanation: { anki: {} } } };
    } },
    "@/lib/explanationStreamProtocol": { EXPLANATION_STREAM_COMPLETE_MARKER: "<done>" },
    "@/lib/standaloneDictionaryHistory": { dictionaryHistoryOwner: () => owner },
  };
  const api = runInNewContext(compiled("../lib/contextExplanationClient.ts") + "\nexports", {
    exports: {}, TextDecoder, require: (key: string) => modules[key],
    fetch: async (_url: string, init: RequestInit) => {
      captured.push(new Headers(init.headers).get("X-Context-Account")!); return new Response("complete<done>");
    },
  }) as {
    requestContextExplanation(context: unknown, signal: AbortSignal, action: string, expectedOwner?: string): Promise<unknown>;
    requestContextExplanationStream(context: unknown, signal: AbortSignal, chunk: (text: string) => void, action: string, expectedOwner?: string): Promise<string>;
  };
  const signal = new AbortController().signal, context = { word: "bank", sentence: "A bank.", previousSentence: "", nextSentence: "" };
  await api.requestContextExplanationStream(context, signal, () => {}, "action", "A");
  owner = "B";
  await api.requestContextExplanation(context, signal, "action", "A");
  await api.requestContextExplanation(context, signal, "other");
  assert.deepEqual(captured, ["A", "A", "B"]);
});
