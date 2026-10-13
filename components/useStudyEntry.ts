"use client";

import { useEffect, useState } from "react";
import { useAccount } from "./AccountProvider";
import { dictionaryHistoryOwner } from "@/lib/standaloneDictionaryHistory";
import { getVocabularyEntry } from "@/lib/vocabularyRepository";
import { isStudyEntrySummary } from "@/lib/studyTransport";
import type { VocabularyEntry } from "@/types/vocabulary";

// Small, account-keyed display cache. These reads never write vocabulary or FSRS.
const details = new Map<string, VocabularyEntry>();
const requests = new Map<string, Promise<VocabularyEntry>>();
function keyFor(owner: string, entry: VocabularyEntry) { return owner+":"+entry.id+":"+entry.updatedAt; }
function available(owner: string, entry: VocabularyEntry | undefined) {
  if (!entry) return undefined;
  if (!isStudyEntrySummary(entry)) return entry;
  if (dictionaryHistoryOwner() === owner) {
    const local = getVocabularyEntry(entry.id);
    if (local && local.updatedAt >= entry.updatedAt) return local;
  }
  return details.get(keyFor(owner, entry));
}
export function preloadStudyEntry(owner: string, entry: VocabularyEntry): Promise<VocabularyEntry> {
  const ready = available(owner, entry);
  if (ready) return Promise.resolve(ready);
  const key = keyFor(owner, entry), pending = requests.get(key);
  if (pending) return pending;
  const request = fetch("/api/study?entry="+encodeURIComponent(entry.id), {
    headers: { "X-Context-Account": owner }, cache: "no-store", signal: AbortSignal.timeout(15000),
  }).then(async response => {
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || "词条详情暂时无法读取，请重试。"), {status: response.status});
    if (!data.entry || data.entry.id !== entry.id || isStudyEntrySummary(data.entry)) throw new Error("词条详情暂时无法读取，请重试。");
    details.set(key, data.entry);
    while (details.size > 32) details.delete(details.keys().next().value!);
    return data.entry as VocabularyEntry;
  }).finally(() => { requests.delete(key); });
  requests.set(key, request);
  return request;
}

/** A list summary must never become a question, source link or complete answer. */
export function useStudyEntry(summary: VocabularyEntry | undefined) {
  const {account, isOffline} = useAccount();
  const owner = account.profile?.userId ?? "";
  const [loaded, setLoaded] = useState<{key:string;entry:VocabularyEntry} | null>(null);
  const [failure, setFailure] = useState<{key:string;message:string;missing:boolean} | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = summary ? keyFor(owner, summary) : "";
  const ready = available(owner, summary) ?? (loaded?.key === key ? loaded.entry : undefined);
  useEffect(() => {
    if (!owner || !summary || ready || isOffline) return;
    let cancelled = false;
    void preloadStudyEntry(owner, summary).then(entry => {
      if (!cancelled) { setLoaded({key,entry}); setFailure(null); }
    }).catch(error => {
      if (!cancelled) setFailure({key, message: error instanceof TypeError || error.name === "TimeoutError" ? "暂时无法连接，请重试读取词条。" : error.message, missing: error.status === 404});
    });
    return () => { cancelled = true; };
  }, [owner, key, summary, ready, isOffline, attempt]);
  return {entry:ready, error:failure?.key === key ? failure.message : "", missing:failure?.key === key && failure.missing,
    retry:() => { setFailure(null); setAttempt(value => value+1); }};
}
