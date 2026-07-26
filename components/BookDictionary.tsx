"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import {
  describeApiFailure,
  describeCaughtRequestError,
  describeClientFailure,
  validateStandaloneDictionaryInput,
} from "@/lib/clientErrorReporting";
import { isCompleteDictionaryResult, parseDictionaryStream } from "@/lib/dictionaryStream";
import type { DictionaryResult } from "@/types/dictionary";
import styles from "./BookDictionary.module.css";

const SESSION_KEY = "context-reader:standalone-dictionary:session:v2";
const examples = ["take in", "subtle", "carry out"];

interface DictionarySession {
  query: string;
  result: DictionaryResult | null;
  cache: Record<string, DictionaryResult>;
}

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function readSession(): DictionarySession {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { query: "", result: null, cache: {} };
    const value = JSON.parse(raw) as Partial<DictionarySession>;
    return {
      query: typeof value.query === "string" ? value.query : "",
      result: value.result && typeof value.result === "object" ? value.result : null,
      cache: value.cache && typeof value.cache === "object" ? value.cache : {},
    };
  } catch {
    return { query: "", result: null, cache: {} };
  }
}

function writeSession(session: DictionarySession) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Session persistence must never block lookup.
  }
}

interface BookDictionaryProps {
  embedded?: boolean;
  compact?: boolean;
  panel?: boolean;
  offline?: boolean;
  onBack?: () => void;
  onAddToVocabulary?: (result: DictionaryResult) => void;
  isInVocabulary?: (result: DictionaryResult) => boolean;
}

function DictionaryResultContent({ result, streaming }: { result: DictionaryResult; streaming: boolean }) {
  return (
    <article className={`${styles.result} ${streaming ? styles.streamingResult : ""}`} aria-live="polite">
      <header>
        <div><h3>{result.query}</h3><p>{result.lemma !== result.query ? result.lemma : ""}</p></div>
        <div className={styles.pronunciation}>
          {result.phonetic && <span>{result.phonetic}</span>}
          {result.query && <PronunciationButtons text={result.query} />}
        </div>
      </header>

      {result.senses.length > 0 && (
        <ol className={styles.senses}>
          {result.senses.map((sense, index) => (
            <li key={`${sense.partOfSpeech}-${sense.meaning}-${index}`}>
              <div><strong>{sense.partOfSpeech}</strong><small>{sense.register}</small></div>
              <p>{sense.meaning}</p>
              {sense.exampleEnglish && <blockquote><span>{sense.exampleEnglish}</span><em>{sense.exampleChinese}</em></blockquote>}
            </li>
          ))}
        </ol>
      )}

      {result.usageGuide && <section className={styles.usage}><h4>用法辨析</h4><p>{result.usageGuide}</p></section>}

      {result.collocations.length > 0 && (
        <section className={styles.details}>
          <h4>常见搭配</h4>
          <ul>{result.collocations.map((item) => <li key={item.phrase}><strong>{item.phrase}</strong><span>{item.meaning}</span>{item.exampleEnglish && <em>{item.exampleEnglish}</em>}</li>)}</ul>
        </section>
      )}

      {(result.synonyms.length > 0 || result.wordFamily.length > 0) && (
        <div className={styles.twoColumns}>
          {result.synonyms.length > 0 && <section><h4>近义词差别</h4>{result.synonyms.map((item) => <p key={item.word}><strong>{item.word}</strong>{item.difference}</p>)}</section>}
          {result.wordFamily.length > 0 && <section><h4>词族</h4>{result.wordFamily.map((item) => <p key={`${item.word}-${item.partOfSpeech}`}><strong>{item.word}</strong>{item.partOfSpeech} · {item.meaning}</p>)}</section>}
        </div>
      )}

      {(result.commonMistakes.length > 0 || result.memoryTip) && (
        <footer>
          {result.commonMistakes.length > 0 && <div><h4>易错点</h4>{result.commonMistakes.map((item) => <p key={item}>{item}</p>)}</div>}
          {result.memoryTip && <div><h4>记忆提示</h4><p>{result.memoryTip}</p></div>}
        </footer>
      )}

      {streaming && <div className={styles.streamTail} role="status"><i aria-hidden="true" />正在继续生成词条</div>}
    </article>
  );
}

export function BookDictionary({
  embedded = false,
  compact = false,
  panel = false,
  offline = false,
  onBack,
  onAddToVocabulary,
  isInVocabulary,
}: BookDictionaryProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [streamText, setStreamText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const cacheRef = useRef<Record<string, DictionaryResult>>({});
  const abortRef = useRef<AbortController | null>(null);
  const progressive = useMemo(
    () => parseDictionaryStream(streamText, query.trim().replace(/\s+/g, " ")),
    [query, streamText],
  );

  useEffect(() => {
    const session = readSession();
    cacheRef.current = session.cache;
    setQuery(session.query);
    setResult(session.result);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function lookup(nextQuery = query) {
    const normalized = nextQuery.trim().replace(/\s+/g, " ");
    if (!normalized || loading) return;
    setQuery(normalized);
    setError("");
    setStreamText("");
    const validationError = validateStandaloneDictionaryInput(normalized);
    if (validationError) {
      setResult(null);
      setError(validationError);
      return;
    }
    const cached = cacheRef.current[cacheKey(normalized)] ?? null;
    if (cached) {
      setResult(cached);
      writeSession({ query: normalized, result: cached, cache: cacheRef.current });
      return;
    }
    if (offline) {
      setError("当前离线，这个词还没有缓存。联网后可生成新的词典解释。");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/dictionary-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-context-action-id": crypto.randomUUID() },
        body: JSON.stringify({ query: normalized }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        setError(await describeApiFailure(response, data, {
          operation: "standalone_dictionary_lookup",
          endpoint: "/api/dictionary-stream",
          fallbackMessage: "词典查询失败，请稍后重试。",
          metadata: { query: normalized },
        }));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let current = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        current += decoder.decode(value, { stream: true });
        setStreamText(current);
      }
      current += decoder.decode();
      setStreamText(current);
      if (controller.signal.aborted) return;
      const parsed = parseDictionaryStream(current, normalized);
      if (!isCompleteDictionaryResult(parsed)) {
        setError(await describeClientFailure("Dictionary stream ended without a complete result.", {
          operation: "standalone_dictionary_parse",
          endpoint: "/api/dictionary-stream",
          fallbackMessage: "词典结果未完整生成。",
          metadata: { query: normalized, responseCharacters: current.length },
        }));
        return;
      }
      const dictionary = parsed.result;
      setResult(dictionary);
      cacheRef.current = Object.fromEntries([
        ...Object.entries(cacheRef.current),
        [cacheKey(dictionary.query), dictionary],
      ].slice(-80));
      writeSession({ query: normalized, result: dictionary, cache: cacheRef.current });
    } catch (lookupError) {
      if (controller.signal.aborted) return;
      setError(await describeCaughtRequestError(lookupError, {
        operation: "standalone_dictionary_lookup",
        endpoint: "/api/dictionary-stream",
        fallbackMessage: "词典查询失败，请稍后重试。",
        metadata: { query: normalized },
      }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void lookup();
  }

  return (
    <section className={`${styles.dictionary} ${embedded ? styles.embedded : ""} ${compact ? styles.compact : ""} ${panel ? styles.panel : ""}`} aria-labelledby="book-dictionary-heading">
      <div className={styles.headingPage}>
        <div className={styles.pageTopline}>
          <span className={styles.pageLabel}>Dictionary · 03</span>
          {onBack && <button type="button" className={styles.backButton} onClick={onBack}>返回阅读工作台</button>}
        </div>
        <p className={styles.kicker}>独立深度词典</p>
        <h2 id="book-dictionary-heading">没有原句，也可以把一个词查透</h2>

        <form className={styles.search} onSubmit={submit} data-pointer-quiet>
          <label htmlFor="standalone-dictionary-query">英文单词或短语</label>
          <div>
            <input
              id="standalone-dictionary-query"
              value={query}
              onChange={(event) => { setQuery(event.target.value); if (error) setError(""); }}
              placeholder="例如 take in"
              autoComplete="off"
              maxLength={80}
            />
            <button type="submit" disabled={!query.trim() || loading}>{loading ? "正在查询…" : "深度查询"}</button>
          </div>
        </form>

        <div className={styles.examples} aria-label="查询示例">
          <span>试试：</span>
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => void lookup(example)}>{example}</button>
          ))}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>

      <div className={styles.resultPage} data-pointer-quiet>
        {(loading || result) && (
          <div className={styles.resultToolbar}>
            <span>{loading ? "正在生成完整词条" : "词条已生成"}</span>
            {onAddToVocabulary && (
              <button
                type="button"
                disabled={!result || Boolean(result && isInVocabulary?.(result))}
                onClick={() => result && onAddToVocabulary(result)}
              >
                {result && isInVocabulary?.(result) ? "已加入生词本" : "加入生词本"}
              </button>
            )}
          </div>
        )}
        {result ? (
          <DictionaryResultContent result={result} streaming={false} />
        ) : loading && progressive.eventCount > 0 ? (
          <DictionaryResultContent result={progressive.result} streaming />
        ) : loading ? (
          <div className={styles.streamStarting}><i /><span>正在连接词典…</span></div>
        ) : (
          <div className={styles.empty}>
            <span aria-hidden="true">Aa</span>
            <h3>这页会写下完整词典结果</h3>
            <p>义项、音标、用法差别、搭配、词族、近义词和常见错误会一起出现。</p>
          </div>
        )}
      </div>
    </section>
  );
}
