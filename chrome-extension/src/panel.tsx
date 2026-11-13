import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import { mergeStreamDisplayIntoExplanation, explanationFromCompletedStream, explanationAsStreamText } from "@/lib/explanationDisplay";
import type { WordContext, WordExplanation } from "@/types/reader";
import type { DictionaryResult } from "@/types/dictionary";
import "./panel.css";

const rpc = async (body: unknown) => { const r = await chrome.runtime.sendMessage(body); if (r?.error) throw new Error(r.error); return r; };
const proxy = async (operation: string, body: unknown) => rpc({ type: "proxy", operation, body });
// The shared panel keeps its normal API contract inside this extension-owned frame.
// Credentials stay in the service worker and never enter the host webpage.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const operations: Record<string, string> = { "/api/ask-sentence": "ask", "/api/pronunciation": "pronunciation" };
  if (!url.startsWith("/api/")) return nativeFetch(input, init);
  if (!operations[url]) return new Response(JSON.stringify({ error: "请到网站完成这项操作。" }), { status: 400, headers: { "Content-Type": "application/json" } });
  try {
    const result = await proxy(operations[url], JSON.parse(String(init?.body || "{}")));
    return result.binary ? new Response(Uint8Array.from(atob(result.binary), c => c.charCodeAt(0)), { headers: { "Content-Type": result.contentType || "audio/mpeg" } })
      : new Response(JSON.stringify(result.data), { headers: { "Content-Type": "application/json" } });
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "连接失败，请重试。" }), { status: 503, headers: { "Content-Type": "application/json" } }); }
};

function App() {
  const [context, setContext] = useState<WordContext | null>(null), [nickname, setNickname] = useState("");
  const [explanation, setExplanation] = useState<WordExplanation | null>(null), [dictionary, setDictionary] = useState<DictionaryResult | null>(null);
  const [streamText, setStreamText] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState(false), [saving, setSaving] = useState(false);
  const task = useRef(0), activePort = useRef<any>(null);
  const applyPreferences = (p: Record<string, unknown>) => { document.documentElement.style.setProperty("--cr-ext-ink", String(p.text)); document.documentElement.style.setProperty("--cr-ext-accent", String(p.accent)); };
  async function lookup(ctx: WordContext, force = false) {
    const ticket = ++task.current; activePort.current?.disconnect(); setContext(ctx); setLoading(true); setError(""); setSaved(false); setSaving(false); setDictionary(null); setExplanation(null); setStreamText("");
    try {
      if (!ctx.sentence) {
        const result = await proxy("dictionary", { query: ctx.word });
        if (ticket !== task.current) return; setDictionary(result.data.dictionary); setLoading(false); return;
      }
      const key = `lookup:${JSON.stringify(ctx)}`;
      const session = await rpc({ type: "session", nonce: location.hash.slice(1) });
      const cacheKey = `${session.connectionId}:${key}`;
      // Session cache is isolated by the connection; account changes invalidate the nonce.
      if (!force) {
        const cache = sessionStorage.getItem(cacheKey);
        if (cache && ticket === task.current) { const hit = JSON.parse(cache); setExplanation(hit.explanation); setStreamText(hit.streamText); setLoading(false); return; }
      }
      let text = "", streamComplete = false;
      const streamRequest = new Promise<void>(resolve => {
        const port = chrome.runtime.connect({ name: "explanation-stream" }); activePort.current = port;
        let finished = false;
        const finish = () => { if (finished) return; finished = true; resolve(); };
        port.onMessage.addListener((message: { chunk?: string; done?: boolean; error?: string }) => {
          if (ticket !== task.current) { port.disconnect(); finish(); return; }
          if (message.chunk) { if (message.chunk.includes("\u001e")) streamComplete = true; text += message.chunk.replace(/\u001e/g, ""); setStreamText(text); }
          if (message.done || message.error) { finish(); port.disconnect(); }
        });
        port.onDisconnect.addListener(finish); port.postMessage({ context: ctx });
      });
      const structuredRequest = proxy("explain", ctx);
      const [structured] = await Promise.allSettled([structuredRequest, streamRequest]);
      if (ticket !== task.current) return;
      const base = structured.status === "fulfilled" ? structured.value.data.explanation as WordExplanation : streamComplete ? explanationFromCompletedStream(text, ctx) : null;
      if (!base) throw new Error(structured.status === "rejected" ? structured.reason.message : "解释未完整生成，请重试。");
      if (text && (!streamComplete || !explanationFromCompletedStream(text, ctx))) throw new Error("流式解释未完整生成，已保留显示内容，请重新生成后保存。");
      // Keep the progressive display authoritative, including when structured JSON finishes later.
      const completeText = streamComplete && explanationFromCompletedStream(text, ctx) ? text : explanationAsStreamText(base);
      const merged = mergeStreamDisplayIntoExplanation(base, completeText);
      setExplanation(merged); setStreamText(completeText); setLoading(false);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ explanation: merged, streamText: completeText })); } catch {}
    } catch (e) { if (ticket === task.current) { setError(e instanceof Error ? e.message : "查询失败，请重试。"); setLoading(false); } }
  }
  useEffect(() => {
    rpc({ type: "session", nonce: location.hash.slice(1) }).then(s => { setNickname(s.nickname); applyPreferences(s.preferences); lookup({ ...s.context, paragraphIndex: 0, tokenIndex: 0 }); }).catch(e => setError(e.message));
    const change = (changes: Record<string, { newValue: any }>) => { if (changes.preferences) applyPreferences(changes.preferences.newValue); if (changes.connection) { task.current++; activePort.current?.disconnect(); setLoading(false); setExplanation(null); setDictionary(null); setStreamText(""); setError("保存账号已变更，请重新划词。"); } };
    chrome.storage.onChanged.addListener(change);
    const keyboard = (e: KeyboardEvent) => { if (e.key === "Escape") parent.postMessage({ type: "cr-close-panel" }, "*"); };
    document.addEventListener("keydown", keyboard);
    return () => { task.current++; activePort.current?.disconnect(); chrome.storage.onChanged.removeListener(change); document.removeEventListener("keydown", keyboard); };
  }, []);
  async function save() {
    if (!context || saving || saved) return;
    const ticket = task.current; setSaving(true); setError("");
    try { await proxy("save", { context, ...(dictionary ? { dictionary } : { explanation }) }); if (ticket === task.current) setSaved(true); }
    catch (e) { if (ticket === task.current) setError(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { if (ticket === task.current) setSaving(false); }
  }
  return <><div className="target">保存到 <strong>{nickname || "尚未连接"}</strong><a href="https://context-reader.com/browser-extension" target="_blank" rel="noreferrer">更换账号</a></div>
    {error && <div role="alert" className="error">{error}<button onClick={() => context && lookup(context, true)}>重试查询</button></div>}
    {context?.sentence ? <div className="explanation"><ExplanationPanel explanation={explanation} streamText={streamText} streaming={loading} selectedContext={context} loading={loading} error="" isInVocabulary={saved} savingToVocabulary={saving} vocabularyMatchNotice={saving ? "正在保存到账号…" : saved ? "已保存到账号，网站生词本会同步显示。" : ""} onAddToVocabulary={save} onRegenerate={() => lookup(context, true)} /></div>
      : <div className="dictionary"><p className="hint">未取得完整原句，当前显示词典释义。</p>{loading && <p role="status">正在查询…</p>}{dictionary && <><h2>{dictionary.query}</h2><p>{dictionary.phonetic}</p><PronunciationButtons text={dictionary.query} />{dictionary.senses.map((sense, i) => <section key={i}><h3>{sense.partOfSpeech}</h3><p>{sense.meaning}</p><p>{sense.usageNote}</p><blockquote>{sense.exampleEnglish}<br />{sense.exampleChinese}</blockquote></section>)}<p>{dictionary.usageGuide}</p><button className="save" disabled={saved || saving || dictionary.inputStatus === "misspelled"} onClick={save}>{saved ? "已加入生词本" : saving ? "正在保存…" : "加入生词本"}</button></>}</div>}
    {context?.sentence && <details className="source"><summary>查看取到的原句</summary><p>{context.sentence}</p></details>}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
