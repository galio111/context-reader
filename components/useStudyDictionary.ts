"use client";
import { useEffect, useState } from "react";
import { useAccount } from "./AccountProvider";
import { findStandaloneDictionaryCache } from "@/lib/standaloneDictionaryCache";
import { normalizeStandaloneDictionaryCacheItem } from "@/lib/dictionaryResultSnapshot";
import type { VocabularyEntry } from "@/types/vocabulary";
import type { DictionaryResult } from "@/types/dictionary";

/** Only saved results: a missing hint must never generate or charge for a lookup. */
export function useStudyDictionary(entry: VocabularyEntry | undefined) {
  const {account,isOffline}=useAccount();
  const owner=account.profile?.userId;
  const id=entry?.id, word=entry?.word, embedded=entry?.dictionaryResult;
  const standalone=Boolean(entry&&!entry.sourceSentence.trim());
  const [saved,setSaved]=useState<{owner:string;id:string;result:DictionaryResult}|null>(null);
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!id||!word||!standalone||embedded||!owner){setLoading(false);return;}
    try {
      const cached=findStandaloneDictionaryCache(word);
      if(cached){setSaved({owner,id,result:cached});setLoading(false);return;}
    }catch{ /* Durable local storage may still be opening. */ }
    if(isOffline){setLoading(false);return;}
    const controller=new AbortController();setLoading(true);
    void fetch(`/api/dictionary-history?query=${encodeURIComponent(word)}`,{
      headers:{"X-Context-Account":owner},signal:controller.signal,
    }).then(async response=>{
      if(!response.ok)return;
      const data=await response.json();
      const item=normalizeStandaloneDictionaryCacheItem({schemaVersion:2,query:word,result:data.dictionary,updatedAt:new Date().toISOString()});
      if(item&&!controller.signal.aborted)setSaved({owner,id,result:item.result});
    }).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[id,word,embedded,standalone,owner,isOffline]);
  return {result:standalone?(entry?.dictionaryResult??(saved?.owner===owner&&saved?.id===entry?.id?saved?.result:null)):null,loading};
}
