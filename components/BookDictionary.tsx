"use client";

import { useState, type FormEvent } from "react";
import type { DictionaryResult } from "@/types/dictionary";
import styles from "./BookDictionary.module.css";

const CACHE_KEY = "context-reader:standalone-dictionary:v1";
const examples = ["take in", "subtle", "carry out"];

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCached(query: string): DictionaryResult | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const cache = raw ? JSON.parse(raw) as Record<string, DictionaryResult> : {};
    return cache[cacheKey(query)] ?? null;
  } catch {
    return null;
  }
}

function setCached(result: DictionaryResult) {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const cache = raw ? JSON.parse(raw) as Record<string, DictionaryResult> : {};
    cache[cacheKey(result.query)] = result;
    const entries = Object.entries(cache).slice(-80);
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A full browser cache should never block a dictionary result from being shown.
  }
}

export function BookDictionary() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function lookup(nextQuery = query) {
    const normalized = nextQuery.trim().replace(/\s+/g, " ");
    if (!normalized || loading) return;
    setQuery(normalized);
    setError("");
    const cached = getCached(normalized);
    if (cached) {
      setResult(cached);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: normalized }),
      });
      const data = await response.json() as { dictionary?: DictionaryResult; error?: string };
      if (!response.ok || !data.dictionary) throw new Error(data.error || "词典查询失败，请稍后重试。");
      setResult(data.dictionary);
      setCached(data.dictionary);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "词典查询失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void lookup();
  }

  return (
    <section className={styles.dictionary} aria-labelledby="book-dictionary-heading">
      <div className={styles.headingPage}>
        <span className={styles.pageLabel}>Dictionary · 03</span>
        <p className={styles.kicker}>独立深度词典</p>
        <h2 id="book-dictionary-heading">没有原句，也可以把一个词查透。</h2>
        <p className={styles.intro}>这里负责单独查词和短语。文章里的划词仍优先解释当前语境，两种入口不会混在一起。</p>

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
        {loading ? (
          <div className={styles.skeleton} aria-label="正在生成词典解释">
            <i /><i /><i /><i /><i />
          </div>
        ) : result ? (
          <article className={styles.result} aria-live="polite">
            <header>
              <div><h3>{result.query}</h3><p>{result.lemma !== result.query ? result.lemma : ""}</p></div>
              {result.phonetic && <span>{result.phonetic}</span>}
            </header>

            <ol className={styles.senses}>
              {result.senses.map((sense, index) => (
                <li key={`${sense.partOfSpeech}-${index}`}>
                  <div><strong>{sense.partOfSpeech}</strong><small>{sense.register}</small></div>
                  <p>{sense.meaning}</p>
                  {sense.exampleEnglish && <blockquote><span>{sense.exampleEnglish}</span><em>{sense.exampleChinese}</em></blockquote>}
                </li>
              ))}
            </ol>

            <section className={styles.usage}>
              <h4>用法辨析</h4>
              <p>{result.usageGuide}</p>
            </section>

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
          </article>
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
