"use client";

import { useEffect, useMemo, useState } from "react";
import { ACCOUNT_DATA_CHANGED_EVENT, ACCOUNT_DATA_MERGED_EVENT, accountDataEventKinds } from "@/lib/accountEvents";
import { getVocabularyEntry } from "@/lib/vocabularyRepository";
import { dictionaryHistoryOwner } from "@/lib/standaloneDictionaryHistory";
import type { VocabularyEntry } from "@/types/vocabulary";

/** Content can change while a question is open; its scheduling snapshot must not. */
export function useStudyVocabularyEntries(entries: VocabularyEntry[] | undefined, owner: string) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = (event: Event) => {
      const kinds = accountDataEventKinds(event);
      if (dictionaryHistoryOwner() !== owner || (kinds.length && !kinds.includes("vocabulary"))) return;
      setRevision(value => value + 1);
    };
    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, changed);
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, changed);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT, changed);
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, changed);
    };
  }, [owner]);
  return useMemo(() => {
    if (!entries || dictionaryHistoryOwner() !== owner) return entries ?? [];
    return entries.map(entry => {
      const local = getVocabularyEntry(entry.id);
      if (!local || local.updatedAt < entry.updatedAt) return entry;
      // The full dictionary is read only for the visible card, not copied into every snapshot.
      return { ...local, dictionaryResult: undefined };
    });
  }, [entries, owner, revision]);
}
