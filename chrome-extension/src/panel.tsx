import { ExtensionQuestion } from "./question";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import { LoadingStatus } from "@/components/LoadingStatus";
import { finishExtensionLookup } from "./lookupResult";
import { EXPLANATION_STREAM_COMPLETE_MARKER } from "@/lib/explanationStreamProtocol";
import type { WordContext, WordExplanation } from "@/types/reader";
import type { DictionaryResult } from "@/types/dictionary";
import { extensionSelectionMode } from "@/lib/browserExtensionSelection";
import "./panel.css";

const rpc = async (body: unknown) => { const r = await chrome.runtime.sendMessage(body); if (r?.error) throw new Error(r.error); return r; };
const proxy = async (operation: string, body: unknown, actionId?: string) => rpc({ type: "proxy", operation, body, actionId });
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
  const [context, setContext] = useState<WordContext | null>(null);
  const [translation, setTranslation] = useState("");
  const [explanation, setExplanation] = useState<WordExplanation | null>(null), [dictionary, setDictionary] = useState<DictionaryResult | null>(null);
  const [streamText, setStreamText] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState(false), [saving, setSaving] = useState(false);
  const [retrySave, setRetrySave] = useState(false);
  const task = useRef(0), activePort = useRef<any>(null);
  const applyPreferences = (p: Record<string, unknown>) => { document.documentElement.style.setProperty("--cr-ext-ink", String(p.text)); document.documentElement.style.setProperty("--cr-ext-accent", String(p.accent)); };
  async function lookup(ctx: WordContext, force = false) {
    const ticket = ++task.current; activePort.current?.disconnect(); setContext(ctx); setLoading(true); setError(""); setRetrySave(false); setSaved(false); setSaving(false); setDictionary(null); setExplanation(null); setStreamText(""); setTranslation("");
    try {
      if (extensionSelectionMode(ctx.word) === "translation") {
        const result = await proxy("translate", { text: ctx.word, sentence: ctx.sentence, previousSentence: ctx.previousSentence, nextSentence: ctx.nextSentence });
        if (ticket !== task.current) return;
        const text = result.data.translations?.find((item: { id: string; translation: string }) => item.id === "extension-selection")?.translation;
        if (!text?.trim()) throw new Error("未取得完整译文，请重试。");
        setTranslation(text); setLoading(false); return;
      }
      if (!ctx.sentence) {
        const result = await proxy("dictionary", { query: ctx.word });
        if (ticket !== task.current) return; setDictionary(result.data.dictionary); setLoading(false); return;
      }
      const key = `lookup:${JSON.stringify(ctx)}`;
      const session = await rpc({ type: "session", nonce: location.hash.slice(1) });
      if (ticket !== task.current) return;
      const cacheKey = `v2:${session.connectionId}:${key}`;
      // Session cache is isolated by the connection; account changes invalidate the nonce.
      if (!force) {
        try {
          const hit = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
          const cached = hit && typeof hit.streamText === "string" && finishExtensionLookup(ctx, hit.explanation, hit.streamText, true);
          if (cached) { setExplanation(cached.explanation); setStreamText(cached.streamText); setLoading(false); return; }
        } catch { /* Cache storage is optional inside embedded frames. */ }
      }
      const actionId = crypto.randomUUID();
      let text = "", streamComplete = false;
      const streamRequest = new Promise<void>(resolve => {
        const port = chrome.runtime.connect({ name: "explanation-stream" }); activePort.current = port;
        let finished = false;
        const finish = () => { if (finished) return; finished = true; resolve(); };
        port.onMessage.addListener((message: { chunk?: string; done?: boolean; error?: string }) => {
          if (ticket !== task.current) { port.disconnect(); finish(); return; }
          if (message.chunk) {
            streamComplete ||= message.chunk.endsWith(EXPLANATION_STREAM_COMPLETE_MARKER);
            text += message.chunk.replaceAll(EXPLANATION_STREAM_COMPLETE_MARKER, "");
            setStreamText(text);
          }
          if (message.done || message.error) { finish(); port.disconnect(); }
        });
        port.onDisconnect.addListener(finish); port.postMessage({ context: ctx, actionId });
      });
      const structuredRequest = proxy("explain", ctx, actionId);
      const [structured] = await Promise.allSettled([structuredRequest, streamRequest]);
      if (ticket !== task.current) return;
      const result = finishExtensionLookup(ctx, structured.status === "fulfilled" ? structured.value?.data?.explanation : null, text, streamComplete);
      if (!result) throw new Error(structured.status === "rejected" && structured.reason instanceof Error ? structured.reason.message : "未取得完整释义，请重试查询。");
      setExplanation(result.explanation); setStreamText(result.streamText); setLoading(false);
      try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch {}
    } catch (e) { if (ticket === task.current) { setStreamText(""); setError(e instanceof Error ? e.message : "查询失败，请重试。"); setLoading(false); } }
  }
  useEffect(() => {
    rpc({ type: "session", nonce: location.hash.slice(1) }).then(s => { applyPreferences(s.preferences); lookup({ ...s.context, paragraphIndex: 0, tokenIndex: 0 }); }).catch(e => setError(e.message));
    const change = (changes: Record<string, { newValue: any }>) => { if (changes.preferences) applyPreferences(changes.preferences.newValue); if (changes.connection) { setContext(null); task.current++; activePort.current?.disconnect(); setLoading(false); setExplanation(null); setDictionary(null); setStreamText(""); setTranslation(""); setError("保存账号已变更，请重新划词。"); } };
    chrome.storage.onChanged.addListener(change);
    const keyboard = (e: KeyboardEvent) => { if (e.key === "Escape") parent.postMessage({ type: "cr-close-panel" }, "*"); };
    document.addEventListener("keydown", keyboard);
    return () => { task.current++; activePort.current?.disconnect(); chrome.storage.onChanged.removeListener(change); document.removeEventListener("keydown", keyboard); };
  }, []);
  async function save() {
    if (!context || saving || saved) return;
    const ticket = task.current; setSaving(true); setError("");
    try {
      if (extensionSelectionMode(context.word) === "translation") {
        if (!translation) return;
        await proxy("save-sentence", { original: context.word, translation });
      } else {
        await proxy("save", { context, ...(dictionary ? { dictionary } : { explanation }) });
      }
      if (ticket === task.current) setSaved(true);
    }
    catch (e) { if (ticket === task.current) { setRetrySave(true); setError(e instanceof Error ? e.message : "保存失败，请重试。"); } }
    finally { if (ticket === task.current) setSaving(false); }
  }
  const translating = Boolean(context && extensionSelectionMode(context.word) === "translation");
  return <>
    {error && <div role="alert" className="error">{error}{context && <button onClick={() => retrySave ? save() : lookup(context, true)}>{retrySave ? "重试保存" : "重试查询"}</button>}</div>}
    {translating ? <section className="sentence-translation" aria-label="句子翻译"><header><h2>句子翻译</h2><button className="regenerate" aria-label="重新翻译所选内容" disabled={loading} onClick={() => context && lookup(context, true)}>↻</button></header>{loading ? <LoadingStatus>正在翻译所选内容…</LoadingStatus> : translation && <p className="translation-result">{translation}</p>}<details className="translation-original"><summary>所选原文</summary><p>{context?.word}</p></details>{translation && <div className="sentence-actions"><button type="button" className="copy-translation" disabled={saving || saved} onClick={save}>{saved ? "已收藏到好句" : saving ? "正在收藏…" : "收藏到好句"}</button><button className="copy-translation" onClick={async () => { try { await navigator.clipboard.writeText(translation); } catch { setError("复制失败，请检查浏览器剪贴板权限。"); } }}>复制译文</button></div>}</section>
      : context?.sentence ? <div className="explanation"><ExplanationPanel hideQuestion explanation={explanation} streamText={streamText} streaming={loading} selectedContext={context} loading={loading} error="" isInVocabulary={saved} savingToVocabulary={saving} vocabularyMatchNotice={saving ? "正在保存…" : saved ? "已加入生词本。" : ""} onAddToVocabulary={save} onRegenerate={() => lookup(context, true)} /></div>
      : <div className="dictionary"><p className="hint">未取得完整原句，当前显示词典释义。</p>{loading && <p role="status">正在查询…</p>}{dictionary && <><h2>{dictionary.query}</h2><p>{dictionary.phonetic}</p><PronunciationButtons text={dictionary.query} />{dictionary.senses.map((sense, i) => <section key={i}><h3>{sense.partOfSpeech}</h3><p>{sense.meaning}</p><p>{sense.usageNote}</p><blockquote>{sense.exampleEnglish}<br />{sense.exampleChinese}</blockquote></section>)}<p>{dictionary.usageGuide}</p><button className="save" disabled={saved || saving || dictionary.inputStatus === "misspelled"} onClick={save}>{saved ? "已加入生词本" : saving ? "正在保存…" : "加入生词本"}</button></>}</div>}
    {context && <ExtensionQuestion key={`${context.word}\n${context.sentence}`} context={context} />}
    {!translating && context?.sentence && <details className="source"><summary>查看取到的原句</summary><p>{context.sentence}</p></details>}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
