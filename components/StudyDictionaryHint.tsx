import type { VocabularyEntry } from "@/types/vocabulary";
import { useStudyDictionary } from "./useStudyDictionary";
import { LoadingStatus } from "./LoadingStatus";
import styles from "./StudyPanel.module.css";

export function StudyDictionaryHint({entry,visible,onToggle}:{entry:VocabularyEntry;visible:boolean;onToggle:()=>void}) {
  const {result,loading}=useStudyDictionary(entry);
  const examples=result?.senses.map(s=>s.exampleEnglish).filter(Boolean)??(entry.exampleEnglish?[entry.exampleEnglish]:[]);
  return <div className={styles.exampleHint}>
    <button className={styles.cue} aria-label={visible?"收起例句提示":"英文例句提示"} aria-expanded={visible} onClick={onToggle}>{visible?"收起例句":"英文例句提示"} <kbd>空格</kbd></button>
    {visible&&(examples.length?<ol aria-label="英文例句提示" lang="en">{examples.map((example,index)=><li key={index}>{example}</li>)}</ol>:loading?<LoadingStatus>正在读取已保存的例句…</LoadingStatus>:<p className={styles.caption}>这个词还没有保存例句。</p>)}
  </div>;
}
