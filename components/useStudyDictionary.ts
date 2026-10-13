"use client";
import { useEffect, useState } from "react";
import { useAccount } from "./AccountProvider";
import { ACCOUNT_DATA_CHANGED_EVENT, ACCOUNT_DATA_MERGED_EVENT, accountDataEventKinds } from "@/lib/accountEvents";
import { findStandaloneDictionaryCacheItem, recordStandaloneDictionaryCache } from "@/lib/standaloneDictionaryCache";
import { dictionaryHistoryOwner } from "@/lib/standaloneDictionaryHistory";
import { normalizeStandaloneDictionaryCacheItem } from "@/lib/dictionaryResultSnapshot";
import { getVocabularyEntry } from "@/lib/vocabularyRepository";
import { standaloneVocabularyQuery } from "@/lib/vocabularyLookupSync";
import type { VocabularyEntry } from "@/types/vocabulary";
import type { DictionaryResult } from "@/types/dictionary";

/** Reading a study card is always free. Only explicit dictionary actions generate. */
export function useStudyDictionary(entry: VocabularyEntry | undefined) {
  const {account,isOffline}=useAccount();
  const owner=account.profile?.userId;
  const [saved,setSaved]=useState<{owner:string;id:string;result:DictionaryResult|null;updatedAt:string}|null>(null);
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!entry||!owner||!standaloneVocabularyQuery(entry)){setLoading(false);return;}
    const controller=new AbortController();
    const read=()=>{
      if(controller.signal.aborted||dictionaryHistoryOwner()!==owner)return null;
      const local=getVocabularyEntry(entry.id);
      const current=local&&local.updatedAt>=entry.updatedAt?local:entry;
      const query=standaloneVocabularyQuery(current);
      const cached=query?findStandaloneDictionaryCacheItem(query):null;
      const embedded=current.dictionaryResult;
      const cacheWins=Boolean(cached&&(!embedded||cached.updatedAt>=(current.dictionaryUpdatedAt||current.updatedAt)));
      const result=cacheWins?cached!.result:embedded??null;
      const updatedAt=cacheWins?cached!.updatedAt:current.dictionaryUpdatedAt||current.updatedAt;
      setSaved(previous=>previous?.owner===owner&&previous.id===entry.id&&previous.updatedAt===updatedAt&&JSON.stringify(previous.result)===JSON.stringify(result)
        ?previous:{owner,id:entry.id,result,updatedAt});
      return result;
    };
    const changed=(event:Event)=>{
      const kinds=accountDataEventKinds(event);
      if(kinds.length&&!kinds.some(kind=>kind==="preferences"||kind==="vocabulary"))return;
      read();
    };
    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT,changed);
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT,changed);
    const existing=read();
    if(existing||isOffline||dictionaryHistoryOwner()!==owner)setLoading(false);
    else {
      const query=standaloneVocabularyQuery(entry)!;
      setLoading(true);
      void fetch(`/api/dictionary-history?query=${encodeURIComponent(query)}`,{
        headers:{"X-Context-Account":owner},signal:controller.signal,
      }).then(async response=>{
        if(!response.ok)return;
        const data=await response.json();
        if(controller.signal.aborted||dictionaryHistoryOwner()!==owner)return;
        const item=normalizeStandaloneDictionaryCacheItem({schemaVersion:2,query,result:data.dictionary,updatedAt:data.updatedAt});
        if(item){recordStandaloneDictionaryCache(item.result,{updatedAt:item.updatedAt});read();}
      }).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    }
    return()=>{
      controller.abort();
      window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT,changed);
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT,changed);
    };
  },[entry,owner,isOffline]);
  const result=saved&&saved.owner===owner&&saved.id===entry?.id?saved.result:null;
  return {result:entry&&standaloneVocabularyQuery(entry)?result??entry.dictionaryResult??null:null,loading,updatedAt:saved&&saved.owner===owner&&saved.id===entry?.id?saved.updatedAt:entry?.dictionaryUpdatedAt||entry?.updatedAt};
}
