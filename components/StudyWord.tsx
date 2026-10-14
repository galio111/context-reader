import type { VocabularyEntry } from "@/types/vocabulary";
import { currentFormPhonetic } from "@/lib/pronunciation";
import { normalizePartOfSpeechLabel, originalFormLabel } from "@/lib/displayLabels";
import { PronunciationButtons } from "./PronunciationButtons";
import { VocabularyLearningDetails } from "./VocabularyLearningDetails";
import { StudySpellingResult } from "./StudySpelling";
import { StudyIcon } from "./StudyIcon";
import { BookDictionary } from "./BookDictionary";
import { useAccount } from "./AccountProvider";
import { useStudyDictionary } from "./useStudyDictionary";
import { useStudyEntry } from "./useStudyEntry";
import { LoadingStatus } from "./LoadingStatus";
import styles from "./StudyPanel.module.css";

type StudyWordProps={entry:VocabularyEntry;spelling?:string;onSource:(entry:VocabularyEntry)=>void;onLookup:(query:string)=>void};
export function StudyWord(props:StudyWordProps) {
  const {entry,error,retry}=useStudyEntry(props.entry);
  if(!entry)return error?<div role="alert"><p>{error}</p><button onClick={retry}>重试读取</button></div>:<LoadingStatus>正在读取这个词…</LoadingStatus>;
  return <StudyWordDetails {...props} entry={entry}/>;
}
function StudyWordDetails({entry,onSource,onLookup,spelling}:StudyWordProps) {
  const {isOffline}=useAccount();
  const {result,updatedAt}=useStudyDictionary(entry);
  const standalone = !entry.sourceSentence.trim();
  const phonetic = currentFormPhonetic(entry);
  const lemma = originalFormLabel(entry.lemma,entry.word);
  if(standalone && result)return <BookDictionary key={entry.id} embedded compact panel detailResult={result} detailUpdatedAt={updatedAt} offline={isOffline} preload={false} onRelatedLookup={onLookup} onAddToVocabulary={()=>{}} isInVocabulary={()=>true}/>;
  return <>
    {!standalone&&<div className={styles.contextSentence}><p lang="en"><StudySpellingResult sentence={entry.sourceSentence} word={entry.word} typed={spelling}/></p>{entry.sentenceTranslation&&<p>{entry.sentenceTranslation}</p>}</div>}
    <div className={styles.wordHeading}><h2 lang="en">{entry.word}</h2>{!standalone&&<button className={styles.sourceLink} onClick={()=>onSource(entry)} aria-label={`查看 ${entry.word} 的原文`}>原文<StudyIcon name="external"/></button>}</div>
    <div className={styles.pronunciation}>{phonetic&&<span>{phonetic}</span>}<span>{normalizePartOfSpeechLabel(entry.partOfSpeech)}</span>{lemma.toLowerCase()!==entry.word.toLowerCase()&&<span>原型 {lemma}</span>}<PronunciationButtons text={entry.word}/></div>
    {standalone ? <dl className={styles.definitions}><div className={styles.mainMeaning}><dt>{entry.anki.cardMode==="basic_cn_to_en_dictionary"?"英文表达":"中文释义"}</dt><dd className={styles.dictionaryMeaning}>{entry.basicMeaning}</dd></div></dl> : <>
      <dl className={styles.definitions}><div className={styles.mainMeaning}><dt>{entry.word.trim().includes(" ")?"所选短语在本句中的含义":"所选词在本句中的含义"}</dt><dd>{entry.contextMeaning||entry.basicMeaning}</dd></div><div><dt>基础释义</dt><dd>{entry.basicMeaning}</dd></div>{entry.usageNote&&<div><dt>用法说明</dt><dd>{entry.usageNote}</dd></div>}</dl>
    </>}
    {standalone ? <VocabularyLearningDetails entry={entry} variant="compact"/> : <div className={styles.learningSections}>
      {entry.collocation&&<section><h3>常见搭配</h3><ul>{entry.collocation.split(/[；;\n]+/).map(value=>value.trim()).filter(Boolean).map((value,index)=><li key={index}>{value}</li>)}</ul></section>}
      {(entry.exampleEnglish||entry.exampleChinese)&&<section><h3>新例句</h3>{entry.exampleEnglish&&<p lang="en">{entry.exampleEnglish}</p>}{entry.exampleChinese&&<p className={styles.exampleTranslation}>{entry.exampleChinese}</p>}</section>}
    </div>}

  </>;
}
