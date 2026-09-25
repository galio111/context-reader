"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import { useAccount } from "@/components/AccountProvider";
import { initializeLearningStorage, flushLearningStorage } from "@/lib/learningStorage";
import ClearableField from "@/components/ClearableField";
import { ACCOUNT_DATA_CHANGED_EVENT, ACCOUNT_DATA_MERGED_EVENT, accountDataEventKinds } from "@/lib/accountEvents";
import {
  describeApiFailure,
  describeCaughtRequestError,
  validateStandaloneDictionaryInput,
} from "@/lib/clientErrorReporting";
import { isCompleteDictionaryResult, parseDictionaryStream } from "@/lib/dictionaryStream";
import { normalizeDictionarySpelling } from "@/lib/dictionarySpelling";
import { notifyLookupCancellation } from "@/lib/lookupCancellationClient";
import {
  migrateStandaloneDictionarySessionCache,
  readStandaloneDictionaryCache,
  recordStandaloneDictionaryCache,
  STANDALONE_DICTIONARY_CACHE_KEY,
} from "@/lib/standaloneDictionaryCache";
import {
  beginDictionaryQuery, dictionaryHistoryOwner, type DictionaryQueryIntent,
  migrateStandaloneDictionarySessionHistory,
  normalizeStandaloneDictionaryQuery,
  readStandaloneDictionaryHistory,
  recordStandaloneDictionaryHistory,
  removeStandaloneDictionaryHistory,
  STANDALONE_DICTIONARY_HISTORY_KEY,
  type StandaloneDictionaryHistoryItem,
} from "@/lib/standaloneDictionaryHistory";
import type { DictionaryResult } from "@/types/dictionary";
import styles from "./BookDictionary.module.css";

const SESSION_KEY = "context-reader:standalone-dictionary:session:v3";
const examples = ["take in", "微妙", "落实"];

interface DictionarySession {
  owner?: string;
  historyVersion?: number;
  query: string;
  result: DictionaryResult | null;
  cache: Record<string, DictionaryResult>;
}

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

const partOfSpeechLabels: Record<string, string> = {
  noun: "名词",
  verb: "动词",
  adjective: "形容词",
  adverb: "副词",
  pronoun: "代词",
  preposition: "介词",
  conjunction: "连词",
  interjection: "感叹词",
  phrase: "短语",
};

function partOfSpeechGroupLabel(partOfSpeech: string): string {
  const normalized = partOfSpeech.trim().toLowerCase();
  const english = normalized.replace(/\s*\([^)]*\)\s*/g, "").split(/[·,/]/)[0]?.trim() || normalized;
  const chinese = partOfSpeechLabels[english];
  return chinese ? `${chinese} · ${english}` : partOfSpeech || "其他表达";
}

function groupSensesByPartOfSpeech(senses: DictionaryResult["senses"]) {
  const groups = new Map<string, DictionaryResult["senses"]>();
  for (const sense of senses) {
    const label = partOfSpeechGroupLabel(sense.partOfSpeech);
    groups.set(label, [...(groups.get(label) ?? []), sense]);
  }
  return Array.from(groups, ([label, groupedSenses]) => ({ label, senses: groupedSenses }));
}

function readSession(owner: string): DictionarySession {
  try {
    const raw = window.sessionStorage.getItem(`${SESSION_KEY}:${owner}`) ?? window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { query: "", result: null, cache: {} };
    const value = JSON.parse(raw) as Partial<DictionarySession>;
    if (value.owner !== owner) return { query: "", result: null, cache: {} };
    return {
      owner: value.owner, historyVersion: value.historyVersion,
      query: typeof value.query === "string" ? value.query : "",
      result: value.result && typeof value.result === "object"
        ? normalizeDictionarySpelling(value.result as DictionaryResult)
        : null,
      cache: value.cache && typeof value.cache === "object"
        ? Object.fromEntries(
          Object.entries(value.cache).map(([key, result]) => [
            key,
            normalizeDictionarySpelling(result as DictionaryResult, key),
          ]),
        )
        : {},
    };
  } catch {
    return { query: "", result: null, cache: {} };
  }
}

function writeSession(session: DictionarySession) {
  try {
    const owner = dictionaryHistoryOwner();
    window.sessionStorage.setItem(`${SESSION_KEY}:${owner}`, JSON.stringify({...session, owner, historyVersion: 1}));
  } catch {
    // Session persistence must never block lookup.
  }
}

interface BookDictionaryProps {
  embedded?: boolean;
  compact?: boolean;
  panel?: boolean;
  offline?: boolean;
  active?: boolean;
  onBack?: () => void;
  onAddToVocabulary?: (result: DictionaryResult) => void;
  isInVocabulary?: (result: DictionaryResult) => boolean;
}

function RelatedLookupButton({ query, label, disabled, onLookup }: {
  query: string;
  label: string;
  disabled: boolean;
  onLookup: (query: string) => void;
}) {
  return (
    <button type="button" className={styles.synonymLookup} aria-label={`查询${label} ${query}`} title={`查询 ${query}`} disabled={disabled} onClick={() => onLookup(query)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </svg>
    </button>
  );
}

function DictionaryResultContent({
  result,
  streaming,
  onUseSuggestion,
}: {
  result: DictionaryResult;
  streaming: boolean;
  onUseSuggestion: (query: string) => void;
}) {
  if (result.inputStatus === "misspelled") {
    return (
      <article className={styles.correction} aria-live="polite">
        <span>可能拼写有误</span>
        <h3>{result.query}</h3>
        <p>这个拼写没有被当作有效词条保存。你可能想查：</p>
        <button type="button" disabled={streaming} onClick={() => onUseSuggestion(result.suggestedQuery)}>
          {streaming ? "正在确认拼写…" : <>改查 <strong>{result.suggestedQuery}</strong></>}
        </button>
      </article>
    );
  }

  if (result.direction === "cn_to_en") {
    const senseGroups = groupSensesByPartOfSpeech(result.senses);
    return (
      <article className={`${styles.result} ${styles.chineseResult} ${streaming ? styles.streamingResult : ""}`} aria-live="polite">
        <header>
          <div>
            <h3>{result.query}</h3>
            <p>{result.senses.length > 1 ? `${result.senses.length} 种常用英文表达` : "常用英文表达"}</p>
          </div>
        </header>

        {senseGroups.length > 0 && (
          <div className={styles.translationGroups}>
            {senseGroups.map((group) => (
              <section className={styles.translationGroup} key={group.label}>
                <header>
                  <h4>{group.label}</h4>
                  <span>{group.senses.length} 种表达</span>
                </header>
                <ol className={styles.translations}>
            {group.senses.map((sense, index) => (
              <li key={`${sense.meaning}-${index}`}>
                <div className={styles.translationHead}>
                  <div>
                    <h4 className={styles.relatedHeading}><span>{sense.meaning}</span><RelatedLookupButton query={sense.meaning} label="英文表达" disabled={streaming} onLookup={onUseSuggestion} /></h4>
                    <p>{[sense.partOfSpeech, sense.register].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className={styles.pronunciation}>
                    {(sense.phonetic || (index === 0 && result.phonetic)) && (
                      <span>{sense.phonetic || result.phonetic}</span>
                    )}
                    <PronunciationButtons text={sense.meaning} preload />
                  </div>
                </div>
                {sense.usageNote && <p className={styles.translationUsage}>{sense.usageNote}</p>}
                {sense.exampleEnglish && (
                  <blockquote>
                    <span>{sense.exampleEnglish}</span>
                    {sense.exampleChinese && <em>{sense.exampleChinese}</em>}
                  </blockquote>
                )}
              </li>
            ))}
                </ol>
              </section>
            ))}
          </div>
        )}

        {result.usageGuide && (
          <section className={styles.choiceGuide}>
            <h4>怎么选</h4>
            <p>{result.usageGuide}</p>
          </section>
        )}

        {result.commonMistakes.length > 0 && (
          <section className={styles.translationMistakes}>
            <h4>容易混淆</h4>
            {result.commonMistakes.map((item) => <p key={item}>{item}</p>)}
          </section>
        )}

        {streaming && <div className={styles.streamTail} role="status"><i aria-hidden="true" />正在补充英文表达</div>}
      </article>
    );
  }

  return (
    <article className={`${styles.result} ${streaming ? styles.streamingResult : ""}`} aria-live="polite">
      <header>
        <div>
          <h3>{result.query}</h3>
          {result.inputStatus === "ambiguous"
            ? <p>这个拼写对应多个词头，以下义项会同时保留。</p>
            : result.lemma !== result.query && <p>原型：{result.lemma}</p>}
        </div>
        <div className={styles.pronunciation}>
          {result.phonetic && (
            <span><small>当前词音标</small>{result.phonetic}</span>
          )}
          {result.query && <PronunciationButtons text={result.query} preload />}
        </div>
      </header>

      {result.senses.length > 0 && (
        <ol className={styles.senses}>
          {result.senses.map((sense, index) => (
            <li key={`${sense.partOfSpeech}-${sense.meaning}-${index}`}>
              {(sense.headword || sense.headwordNote) && (
                <div className={styles.senseOrigin}>
                  {sense.headword && <b>{sense.headword}</b>}
                  {sense.headwordNote && <span>{sense.headwordNote}</span>}
                </div>
              )}
              <div><strong>{sense.partOfSpeech}</strong><small>{sense.register}</small></div>
              <p>{sense.meaning}</p>
              {sense.exampleEnglish && <blockquote><span>{sense.exampleEnglish}</span><em>{sense.exampleChinese}</em></blockquote>}
            </li>
          ))}
        </ol>
      )}

      {result.verbForms && (
        <section className={styles.verbForms}>
          <h4>动词变形</h4>
          <dl>
            <div><dt>过去式</dt><dd>{result.verbForms.pastTense}</dd></div>
            <div><dt>过去分词</dt><dd>{result.verbForms.pastParticiple}</dd></div>
            <div><dt>现在分词</dt><dd>{result.verbForms.presentParticiple}</dd></div>
          </dl>
        </section>
      )}

      {result.usageGuide && <section className={styles.usage}><h4>用法辨析</h4><p>{result.usageGuide}</p></section>}

      {result.collocations.length > 0 && (
        <section className={styles.details}>
          <h4>常见搭配</h4>
          <ul>{result.collocations.map((item) => <li key={item.phrase}><strong className={styles.relatedHeading}><span>{item.phrase}</span><RelatedLookupButton query={item.phrase} label="搭配" disabled={streaming} onLookup={onUseSuggestion} /></strong><span>{item.meaning}</span>{item.exampleEnglish && <em>{item.exampleEnglish}</em>}</li>)}</ul>
        </section>
      )}

      {(result.synonyms.length > 0 || result.wordFamily.length > 0) && (
        <div className={styles.twoColumns}>
          {result.synonyms.length > 0 && <section><h4>近义词差别</h4>{result.synonyms.map((item) => (
            <p key={item.word}>
              <strong className={styles.relatedHeading}>
                <span>{item.word}</span>
                <RelatedLookupButton query={item.word} label="近义词" disabled={streaming} onLookup={onUseSuggestion} />
              </strong>
              {item.difference}
            </p>
          ))}</section>}
          {result.wordFamily.length > 0 && <section><h4>词族</h4>{result.wordFamily.map((item) => <p key={`${item.word}-${item.partOfSpeech}`}><strong className={styles.relatedHeading}><span>{item.word}</span><RelatedLookupButton query={item.word} label="词族" disabled={streaming} onLookup={onUseSuggestion} /></strong>{item.partOfSpeech} · {item.meaning}</p>)}</section>}
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
  active = true,
  onBack,
  onAddToVocabulary,
  isInVocabulary,
}: BookDictionaryProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [streamText, setStreamText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingHistorySave, setPendingHistorySave] = useState(false);
  const [history, setHistory] = useState<StandaloneDictionaryHistoryItem[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(2);
  const dictionaryId = useId();
  const headingId = `${dictionaryId}-heading`;
  const inputId = `${dictionaryId}-query`;
  const historyListId = `${dictionaryId}-history-list`;
  const historyMatchesId = `${dictionaryId}-history-matches`;
  const historyMatchesRef = useRef<HTMLDivElement | null>(null);
  const historyPrefix = normalizeStandaloneDictionaryQuery(query);
  const historyMatches = useMemo(() => historyPrefix
    ? history.filter((item) => item.normalizedQuery.startsWith(historyPrefix))
    : [], [history, historyPrefix]);
  const showHistoryMatches = historySearchOpen && Boolean(historyPrefix) && !loading;
  const selectedHistoryIndex = activeHistoryIndex < historyMatches.length ? activeHistoryIndex : -1;
  useEffect(() => {
    if (showHistoryMatches && selectedHistoryIndex >= 0) {
      historyMatchesRef.current?.children[selectedHistoryIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [showHistoryMatches, selectedHistoryIndex]);
  const accountState = useAccount();
  const accountOwner = accountState.account.profile?.userId ?? accountState.localAccount?.userId ?? "guest";
  const ownerRef = useRef("");
  const cacheRef = useRef<Record<string, DictionaryResult>>({});
  const abortRef = useRef<AbortController | null>(null);
  const activeActionIdRef = useRef("");
  const historyRowRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const progressive = useMemo(
    () => parseDictionaryStream(streamText, query.trim().replace(/\s+/g, " ")),
    [query, streamText],
  );
  const abortActiveDictionaryRequest = useCallback(() => {
    const controller = abortRef.current;
    controller?.abort();
    notifyLookupCancellation(activeActionIdRef.current);
    if (abortRef.current === controller) {
      abortRef.current = null;
      activeActionIdRef.current = "";
    }
  }, []);

  useEffect(() => {
    if (accountState.loading) return;
    let cancelled = false;
    abortActiveDictionaryRequest();
    setPendingHistorySave(false); setLoading(false); setQuery(""); setResult(null); setStreamText(""); setHistory([]); cacheRef.current = {};
    void (async () => {
      await initializeLearningStorage();
      const owner = dictionaryHistoryOwner();
      if (cancelled) return;
      ownerRef.current = owner;
      const session = readSession(owner);
      const legacy = Object.values(session.cache).map(cached=>normalizeDictionarySpelling(cached))
        .filter(cached=>cached.inputStatus !== "misspelled");
      const migratedCache = migrateStandaloneDictionarySessionCache(legacy);
      const history = session.historyVersion === 1 ? readStandaloneDictionaryHistory()
        : await migrateStandaloneDictionarySessionHistory(legacy.map(c=>c.query), session.owner);
      if (cancelled || owner !== dictionaryHistoryOwner()) return;
      cacheRef.current = {...Object.fromEntries(migratedCache.map(item=>[item.normalizedQuery,item.result])),...session.cache};
      setQuery(session.query); setResult(session.result); setHistory(history);
    })().catch(()=>{if(!cancelled)setError("历史记录暂未可靠保存，请稍后重试；原数据已保留。");});
    return ()=>{cancelled = true; abortActiveDictionaryRequest();};
  }, [accountState.loading, accountOwner, abortActiveDictionaryRequest]);

  useEffect(() => () => abortActiveDictionaryRequest(), [abortActiveDictionaryRequest]);

  useEffect(() => {
    if (!active) abortActiveDictionaryRequest();
  }, [active, abortActiveDictionaryRequest]);

  useEffect(() => {
    const list = historyListRef.current;
    if (!list || !historyExpanded) return;
    const isolateListWheel = (event: globalThis.WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollHeight <= list.clientHeight) return;
      event.preventDefault();
      event.stopPropagation();
      list.scrollTop += event.deltaY;
    };
    list.addEventListener("wheel", isolateListWheel, { passive: false });
    return () => list.removeEventListener("wheel", isolateListWheel);
  }, [historyExpanded]);

  useEffect(() => {
    if (history.length <= visibleHistoryCount) setHistoryExpanded(false);
  }, [history.length, visibleHistoryCount]);

  useEffect(() => {
    const row = historyRowRef.current;
    if (!row) return;
    const updateVisibleCount = () => {
      const rowWidth = row.getBoundingClientRect().width;
      setVisibleHistoryCount(panel ? (rowWidth >= 390 ? 5 : 4) : (rowWidth >= 390 ? 3 : 2));
    };
    updateVisibleCount();
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(row);
    return () => observer.disconnect();
  }, [history.length, panel]);

  useEffect(() => {
    const refreshAccountDictionaryData = (event: Event) => {
      const kinds = accountDataEventKinds(event);
      if (kinds.length > 0 && !kinds.includes("preferences")) return;
      if (
        event instanceof StorageEvent
        && event.key
        && event.key !== STANDALONE_DICTIONARY_HISTORY_KEY
        && event.key !== STANDALONE_DICTIONARY_CACHE_KEY
      ) return;
      if (ownerRef.current !== dictionaryHistoryOwner()) return;
      setHistory(readStandaloneDictionaryHistory());
      cacheRef.current = {
        ...cacheRef.current,
        ...Object.fromEntries(
          readStandaloneDictionaryCache().map((item) => [item.normalizedQuery, item.result]),
        ),
      };
    };
    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, refreshAccountDictionaryData);
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshAccountDictionaryData);
    window.addEventListener("storage", refreshAccountDictionaryData);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT, refreshAccountDictionaryData);
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshAccountDictionaryData);
      window.removeEventListener("storage", refreshAccountDictionaryData);
    };
  }, []);

  function rememberLookup(nextQuery: string, intent: DictionaryQueryIntent) {
    if (intent.owner !== dictionaryHistoryOwner()) return;
    try {
      setHistory(recordStandaloneDictionaryHistory(nextQuery, intent));
      void flushLearningStorage().catch(()=>setError("查询成功，但历史尚未可靠保存，请稍后重试。"));
    } catch { setError("查询成功，但历史尚未可靠保存，请稍后重试。"); }
  }

  async function lookup(nextQuery = query, options: { force?: boolean } = {}) {
    const normalized = nextQuery.trim().replace(/\s+/g, " ");
    if (!normalized || loading || accountState.loading || ownerRef.current !== dictionaryHistoryOwner()) return;
    setHistorySearchOpen(false);
    setActiveHistoryIndex(-1);
    setQuery(normalized);
    setError("");
    setStreamText("");
    const validationError = validateStandaloneDictionaryInput(normalized);
    if (validationError) {
      setResult(null);
      setError(validationError);
      return;
    }
    const intent = beginDictionaryQuery(normalized);
    const cached = options.force ? null : cacheRef.current[cacheKey(normalized)] ?? null;
    if (cached) {
      setResult(cached);
      writeSession({ query: normalized, result: cached, cache: cacheRef.current });
      if (cached.inputStatus === "misspelled") {
        void deleteHistory(normalized);
      } else {
        recordStandaloneDictionaryCache(cached);
        rememberLookup(normalized, intent);
      }
      return;
    }
    if (offline) {
      setError("当前离线，这个查询还没有缓存。联网后可生成新的双向词典解释。");
      return;
    }

    abortActiveDictionaryRequest();
    const controller = new AbortController();
    const actionId = crypto.randomUUID();
    abortRef.current = controller;
    activeActionIdRef.current = actionId;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/dictionary-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-context-action-id": actionId },
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
      let historyRecorded = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted || intent.owner !== dictionaryHistoryOwner()) return;
        current += decoder.decode(value, { stream: true });
        setStreamText(current);
        if (!historyRecorded) {
          const partial = parseDictionaryStream(current, normalized);
          if (partial.result.inputStatus !== "misspelled" && partial.result.senses.length > 0) {
            rememberLookup(normalized, intent);
            historyRecorded = true;
          }
        }
      }
      current += decoder.decode();
      setStreamText(current);
      if (controller.signal.aborted || intent.owner !== dictionaryHistoryOwner()) return;
      const parsed = parseDictionaryStream(current, normalized);
      if (!isCompleteDictionaryResult(parsed)) {
        setError("词典结果没有完整生成，请重新查询。");
        return;
      }
      const dictionary = parsed.result;
      setResult(dictionary);
      cacheRef.current = Object.fromEntries([
        ...Object.entries(cacheRef.current),
        [cacheKey(dictionary.query), dictionary],
      ].slice(-80));
      writeSession({ query: normalized, result: dictionary, cache: cacheRef.current });
      if (dictionary.inputStatus === "misspelled") {
        void deleteHistory(normalized);
      } else {
        recordStandaloneDictionaryCache(dictionary);
        if (!historyRecorded) rememberLookup(normalized, intent);
      }
    } catch (lookupError) {
      if (controller.signal.aborted || intent.owner !== dictionaryHistoryOwner()) return;
      setError(await describeCaughtRequestError(lookupError, {
        operation: "standalone_dictionary_lookup",
        endpoint: "/api/dictionary-stream",
        fallbackMessage: "词典查询失败，请稍后重试。",
        metadata: { query: normalized },
      }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        activeActionIdRef.current = "";
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void lookup();
  }

  function selectHistory(queryToLookup: string) {
    setHistoryExpanded(false);
    void lookup(queryToLookup);
  }

  async function deleteHistory(queryToDelete: string) {
    const owner = dictionaryHistoryOwner();
    try {
      const pending = removeStandaloneDictionaryHistory(queryToDelete);
      setHistory(readStandaloneDictionaryHistory());
      const next = await pending;
      if (owner === dictionaryHistoryOwner()) setPendingHistorySave(false);
      if (owner === dictionaryHistoryOwner()) setHistory(next);
    } catch {
      if (owner === dictionaryHistoryOwner()) {setPendingHistorySave(true); setError("删除尚未可靠保存，记录已暂时隐藏；请重试保存，勿清理浏览器数据。");}
    }
  }

  return (
    <section className={`${styles.dictionary} ${embedded ? styles.embedded : ""} ${compact ? styles.compact : ""} ${panel ? styles.panel : ""}`} aria-labelledby={headingId}>
      <div className={styles.headingPage}>
        <div className={styles.pageTopline}>
          <span className={styles.pageLabel}>Dictionary · 03</span>
          {onBack && <button type="button" className={styles.backButton} onClick={onBack}>返回阅读工作台</button>}
        </div>
        <p className={styles.kicker}>独立深度词典</p>
        <h2 id={headingId}>{panel ? "查一个词或短语" : "没有原句，也可以把一个词查透"}</h2>
        {panel && <p className={styles.panelIntro}>中文看英文表达，英文看中文释义。</p>}

        <form className={styles.search} onSubmit={submit} data-pointer-quiet>
          <label htmlFor={inputId}>{panel ? "输入中文或英文" : "中文或英文单词、短语"}</label>
          <div>
            <ClearableField
              className={styles.searchField}
              value={query}
              onClear={() => { setQuery(""); setError(""); setActiveHistoryIndex(-1); }}
              label="清空查词内容"
            >
              <input
                id={inputId}
                value={query}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showHistoryMatches && historyMatches.length > 0}
                aria-controls={showHistoryMatches && historyMatches.length > 0 ? historyMatchesId : undefined}
                aria-activedescendant={showHistoryMatches && selectedHistoryIndex >= 0 ? `${historyMatchesId}-${selectedHistoryIndex}` : undefined}
                onFocus={() => setHistorySearchOpen(true)}
                onBlur={() => { setHistorySearchOpen(false); setActiveHistoryIndex(-1); }}
                onChange={(event) => { setQuery(event.target.value); setHistorySearchOpen(true); setActiveHistoryIndex(-1); if (error) setError(""); }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    if (showHistoryMatches) { event.preventDefault(); event.stopPropagation(); }
                    setHistorySearchOpen(false);
                    setActiveHistoryIndex(-1);
                  } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && historyMatches.length > 0 && !loading) {
                    event.preventDefault();
                    setHistorySearchOpen(true);
                    setActiveHistoryIndex(event.key === "ArrowDown"
                      ? (selectedHistoryIndex + 1) % historyMatches.length
                      : (selectedHistoryIndex <= 0 ? historyMatches.length - 1 : selectedHistoryIndex - 1));
                  } else if (event.key === "Enter" && showHistoryMatches && selectedHistoryIndex >= 0) {
                    event.preventDefault();
                    selectHistory(historyMatches[selectedHistoryIndex].query);
                  }
                }}
                placeholder="例如 take in 或 微妙"
                autoComplete="off"
                maxLength={80}
              />
            </ClearableField>
            <button type="submit" disabled={!query.trim() || loading}>{loading ? "正在查询…" : "深度查询"}</button>
          </div>
        </form>

        {showHistoryMatches && (
          <section className={styles.historyMatches} aria-label="历史词检索">
            <p role="status">{historyMatches.length ? `历史匹配 · ${historyMatches.length}` : "没有以此开头的历史词，可直接深度查询。"}</p>
            {historyMatches.length > 0 && (
              <div ref={historyMatchesRef} id={historyMatchesId} role="listbox" aria-label="匹配的历史词" data-local-scroll-surface>
                {historyMatches.map((item, index) => (
                  <button key={item.normalizedQuery} id={`${historyMatchesId}-${index}`} type="button" role="option" aria-selected={selectedHistoryIndex === index} tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectHistory(item.query)}>
                    <span>{item.query}</span><span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {history.length > 0 ? (
          <div className={styles.historyBlock}>
            <div
              ref={historyRowRef}
              className={`${styles.history} ${history.length > visibleHistoryCount ? styles.historyHasMore : ""}`}
              aria-label="历史查词"
            >
              <span className={styles.historyLabel}>历史查词</span>
              <div className={styles.historyRecent}>
                {history.slice(0, visibleHistoryCount).map((item) => (
                  <span className={styles.historyRecentItem} key={item.normalizedQuery}><button
                    type="button"
                    title={`查询 ${item.query}`}
                    aria-current={result && cacheKey(result.query) === item.normalizedQuery ? "true" : undefined}
                    onClick={() => selectHistory(item.query)}
                  >
                    {item.query}
                  </button><button type="button" className={styles.historyRecentDelete} aria-label={`删除“${item.query}”的历史记录`} onClick={()=>void deleteHistory(item.query)}>×</button></span>
                ))}
              </div>
              {history.length > visibleHistoryCount && (
                <button
                  type="button"
                  className={styles.historyMore}
                  aria-expanded={historyExpanded}
                  aria-controls={historyListId}
                  onClick={() => setHistoryExpanded((current) => !current)}
                >
                  更多 {history.length - visibleHistoryCount}
                  <span aria-hidden="true">{historyExpanded ? "▴" : "▾"}</span>
                </button>
              )}
            </div>
            {historyExpanded && (
              <div
                ref={historyListRef}
                id={historyListId}
                className={styles.historyList}
                data-local-scroll-surface
                aria-label="更多历史查词"
            >
              {history.slice(visibleHistoryCount).map((item) => (
                <div className={styles.historyListItem} key={item.normalizedQuery}>
                  <button
                    type="button"
                    className={styles.historyQuery}
                    aria-current={result && cacheKey(result.query) === item.normalizedQuery ? "true" : undefined}
                    onClick={() => selectHistory(item.query)}
                  >
                    <span>{item.query}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.historyDelete}
                    aria-label={`删除“${item.query}”的历史记录`}
                    title={`删除“${item.query}”`}
                    onClick={() => deleteHistory(item.query)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
            </div>
            )}
          </div>
        ) : (
          <div className={styles.examples} aria-label="查询示例">
            <span>试试：</span>
            {examples.map((example) => (
              <button key={example} type="button" onClick={() => void lookup(example)}>{example}</button>
            ))}
          </div>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pendingHistorySave && <button type="button" onClick={() => {
          const owner = dictionaryHistoryOwner();
          void flushLearningStorage().then(()=>{if(owner===dictionaryHistoryOwner()){setPendingHistorySave(false);setError("");}})
            .catch(()=>setError("删除仍未可靠保存，请稍后再次重试。"));
        }}>重试保存历史</button>}
      </div>

      <div className={styles.resultPage} data-pointer-quiet>
        {(loading || result) && (
          <div className={styles.resultToolbar}>
            <span>{loading ? "正在生成完整词条" : result?.inputStatus === "misspelled" ? "请确认正确拼写" : "词条已生成"}</span>
            <div className={styles.resultActions}>
            {result?.inputStatus !== "misspelled" && (
              <button
                type="button"
                className={styles.regenerateButton}
                disabled={loading || offline || !result}
                aria-label="重新生成当前词条"
                title={offline ? "联网后可重新生成" : "重新生成，不使用缓存"}
                onClick={() => result && void lookup(result.query, { force: true })}
              >
                <span aria-hidden="true">↻</span>
              </button>
            )}
            {onAddToVocabulary && result?.inputStatus !== "misspelled" && (
              <button
                type="button"
                disabled={!result || Boolean(result && isInVocabulary?.(result))}
                onClick={() => result && onAddToVocabulary(result)}
              >
                {result && isInVocabulary?.(result) ? "已加入生词本" : "加入生词本"}
              </button>
            )}
            </div>
          </div>
        )}
        {result ? (
          <DictionaryResultContent result={result} streaming={false} onUseSuggestion={(suggestion) => void lookup(suggestion)} />
        ) : loading && progressive.eventCount > 0 ? (
          <DictionaryResultContent result={progressive.result} streaming onUseSuggestion={(suggestion) => void lookup(suggestion)} />
        ) : loading ? (
          <div className={styles.streamStarting}><i /><span>正在连接词典…</span></div>
        ) : (
          <div className={styles.empty}>
            <span aria-hidden="true">Aa</span>
            <h3>这页会写下完整查询结果</h3>
            <p>输入英文查看中文释义；输入中文查看可用的英文表达、例句和选词区别。</p>
          </div>
        )}
      </div>
    </section>
  );
}
