import type { VocabularyEntry } from "@/types/vocabulary";
import { currentFormPhonetic } from "@/lib/pronunciation";
import { normalizePartOfSpeechLabel, originalFormLabel } from "@/lib/displayLabels";
import { PronunciationButtons } from "./PronunciationButtons";
import { VocabularyLearningDetails } from "./VocabularyLearningDetails";
import { StudyIcon } from "./StudyIcon";
import styles from "./StudyPanel.module.css";

export function StudyWord({entry,onSource}: {entry:VocabularyEntry;onSource:(entry:VocabularyEntry)=>void}) {
  const standalone = !entry.sourceSentence.trim();
  const phonetic = currentFormPhonetic(entry);
  const lemma = originalFormLabel(entry.lemma,entry.word);
  return <>
    <div className={styles.wordHeading}><h2 lang="en">{entry.word}</h2>{!standalone&&<button className={styles.sourceLink} onClick={()=>onSource(entry)} aria-label={`查看 ${entry.word} 的原文`}>原文<StudyIcon name="external"/></button>}</div>
    <div className={styles.pronunciation}>{phonetic&&<span>{phonetic}</span>}<span>{normalizePartOfSpeechLabel(entry.partOfSpeech)}</span>{lemma.toLowerCase()!==entry.word.toLowerCase()&&<span>原型 {lemma}</span>}<PronunciationButtons text={entry.word}/></div>
    {standalone ? <dl className={styles.definitions}><div className={styles.mainMeaning}><dt>{entry.anki.cardMode==="basic_cn_to_en_dictionary"?"英文表达":"中文释义"}</dt><dd className={styles.dictionaryMeaning}>{entry.basicMeaning}</dd></div></dl> : <>
      <dl className={styles.definitions}><div className={styles.mainMeaning}><dt>{entry.word.trim().includes(" ")?"所选短语在本句中的含义":"所选词在本句中的含义"}</dt><dd>{entry.contextMeaning||entry.basicMeaning}</dd></div><div><dt>基础释义</dt><dd>{entry.basicMeaning}</dd></div>{entry.usageNote&&<div><dt>用法说明</dt><dd>{entry.usageNote}</dd></div>}</dl>
      <div className={styles.sentence}><p lang="en">{entry.sourceSentence}</p>{entry.sentenceTranslation&&<p>{entry.sentenceTranslation}</p>}</div>
    </>}
    {(entry.usageNote||entry.collocation||entry.exampleEnglish||entry.exampleChinese)&&<details className={styles.wordDetails}><summary>更多用法与例句 <StudyIcon name="arrow"/></summary>{standalone?<VocabularyLearningDetails entry={entry} variant="compact"/>:<div className={styles.moreDefinitions}>{entry.collocation&&<p><span>常见搭配</span>{entry.collocation}</p>}{entry.exampleEnglish&&<p lang="en">{entry.exampleEnglish}</p>}{entry.exampleChinese&&<p>{entry.exampleChinese}</p>}</div>}</details>}
  </>;
}
