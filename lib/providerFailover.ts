import {resolveModelRoute,modelCredentials,modelBody} from './modelSettings';
import {recordModelHealth} from './modelHealth';
import type {ModelFeature} from './modelCatalog';
// Server-only transport. A provider change never creates a second user action.
const circuits = new Map<string,number>();
export function resetProviderCircuitForTests() { circuits.clear(); }
export function providerName(model: string): string { return /^glm-/i.test(model) ? "zhipu" : /^mimo-/i.test(model) ? "mimo" : /jev/i.test(model) ? "jev" : "deepseek"; }
export function responseModel(response: Response, original: string): string {
  return response.headers.get("x-context-model") || original;
}

export async function fetchWithProviderFailover(url: string, init: RequestInit, feature:ModelFeature="lookup"): Promise<Response> {
  const body = JSON.parse(String(init.body));
  const route=await resolveModelRoute(feature);
  const fallbackKey=route.fallback?modelCredentials(route.fallback).key:'';
  const enabled=!!route.fallback&&!!fallbackKey;
  const originalModel=route.primary;
  const primaryMs=Number(process.env.AI_PRIMARY_WAIT_MS)||6000;
  const backupMs=20000;
  const models=enabled&&(circuits.get(originalModel)||0)>Date.now()?[true]:enabled?[false,true]:[false];
  for (const backup of models) {
    init.signal?.throwIfAborted();
    const model = backup ? route.fallback! : originalModel;
    const credentials=modelCredentials(model);const started=Date.now();let observedStatus=0;
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("Provider produced no content", "TimeoutError")), backup ? backupMs : enabled ? primaryMs : 25_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cleanup = () => { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); };
    try {
      const headers = new Headers(init.headers);
      headers.set("Content-Type", "application/json");
      if(!credentials.key)throw Error('model_unconfigured');
      headers.set("Authorization", `Bearer ${credentials.key}`);
      const response=await fetch(credentials.url,{...init,headers,body:JSON.stringify(modelBody(model,body)),signal:controller.signal});
      if(!response.ok){observedStatus=response.status;await recordModelHealth(model,response.status,Date.now()-started);}
      if (!response.ok) {
        // Input/policy failures must not be bypassed by another supplier.
        if (!backup && enabled && ([401, 402, 408, 429].includes(response.status) || response.status >= 500)) {
          void response.body?.cancel();
          throw new Error(`Provider HTTP ${response.status}`);
        }
        cleanup();
        return response;
      }
      const outputHeaders = new Headers(response.headers);
      outputHeaders.set("x-context-model", model);
      if (!body.stream) {
        const text = await response.text();
        const completion = JSON.parse(text);
        if (!completion.choices?.[0]?.message?.content?.trim() || completion.error) throw new Error("Empty provider completion");
        await recordModelHealth(model,200,Date.now()-started);
        cleanup();
        return new Response(text, { status: response.status, headers: outputHeaders });
      }
      if (!response.body) throw new Error("Missing provider stream");
      reader = response.body.getReader();
      const prefix: Uint8Array[] = [];
      const decoder = new TextDecoder();
      let pending = "";
      let bytes = 0;
      let content = false;
      // HTTP headers, keepalives and reasoning tokens are not visible progress.
      while (!content) {
        const next = await reader.read();
        if (next.done) throw new Error("Empty provider stream");
        prefix.push(next.value);
        bytes += next.value.length;
        if (bytes > 256_000) throw new Error("Provider preamble too large");
        pending += decoder.decode(next.value, { stream: true });
        const lines = pending.split("\n"); pending = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const value = line.slice(5).trim();
          if (!value || value === "[DONE]") continue;
          let event;
          try { event = JSON.parse(value); } catch { throw new Error("Invalid provider event"); }
          if (event.error) throw new Error("Provider stream error");
          if (event.choices?.[0]?.delta?.content?.trim()) content = true;
        }
      }
      await recordModelHealth(model,200,Date.now()-started);
      clearTimeout(timer);
      const activeReader = reader;
      return new Response(new ReadableStream<Uint8Array>({
        start(output) { for (const chunk of prefix) output.enqueue(chunk); },
        async pull(output) {
          try {
            const next = await activeReader.read();
            if (next.done) { cleanup(); output.close(); }
            else output.enqueue(next.value);
          } catch (error) {
            if (!backup && !init.signal?.aborted) circuits.set(originalModel,Date.now()+30_000);
            await recordModelHealth(model,0,Date.now()-started);cleanup(); output.error(error);
          }
        },
        cancel(reason) { controller.abort(); cleanup(); return activeReader.cancel(reason); },
      }), { status: response.status, headers: outputHeaders });
    } catch (error) {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      cleanup();
      init.signal?.throwIfAborted();
      if(!observedStatus)await recordModelHealth(model,0,Date.now()-started);
      if (backup || !enabled) throw error;
      circuits.set(originalModel,Date.now()+30_000);
      console.warn("[provider-failover] Switching configured provider", { model: originalModel, reason: error instanceof Error ? error.name : "provider_failure" });
    }
  }
  throw new Error("Provider unavailable");
}
