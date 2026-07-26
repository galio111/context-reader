import { standaloneVocabularyPresentation } from "@/lib/vocabularyPresentation";
import type { VocabularyEntry } from "@/types/vocabulary";
import styles from "./VocabularyLearningDetails.module.css";

function splitLead(value: string): { lead: string; detail: string } {
  const bracket = value.search(/[（(]/);
  if (bracket > 0) {
    return {
      lead: value.slice(0, bracket).trim(),
      detail: value.slice(bracket).replace(/^[（(]\s*|\s*[）)]$/g, "").trim(),
    };
  }
  const colon = value.search(/[：:]/);
  if (colon > 0 && colon < 28) {
    return {
      lead: value.slice(0, colon).trim(),
      detail: value.slice(colon + 1).trim(),
    };
  }
  return { lead: "", detail: value };
}

function Points({ values, synonyms = false }: { values: string[]; synonyms?: boolean }) {
  return (
    <ul className={`${styles.points} ${synonyms ? styles.synonyms : ""}`}>
      {values.map((value, index) => {
        const { lead, detail } = synonyms ? splitLead(value) : { lead: "", detail: value };
        return (
          <li key={`${value}-${index}`}>
            {lead && <strong>{lead}</strong>}
            <span>{detail}</span>
          </li>
        );
      })}
    </ul>
  );
}
export function VocabularyLearningDetails({
  entry,
  variant = "default",
}: {
  entry: VocabularyEntry;
  variant?: "default" | "compact" | "anki";
}) {
  const detail = standaloneVocabularyPresentation(entry);
  return (
    <div className={`${styles.details} ${variant === "compact" ? styles.compact : ""} ${variant === "anki" ? styles.anki : ""}`}>
      {detail.usagePoints.length > 0 && (
        <section className={styles.section}>
          <h4>用法提示</h4>
          <Points values={detail.usagePoints} />
        </section>
      )}
      {detail.collocationPoints.length > 0 && (
        <section className={styles.section}>
          <h4>常见搭配</h4>
          <Points values={detail.collocationPoints} />
        </section>
      )}
      {detail.synonymPoints.length > 0 && (
        <section className={styles.section}>
          <h4>近义词辨析</h4>
          <Points values={detail.synonymPoints} synonyms />
        </section>
      )}
      {detail.wordFamilyPoints.length > 0 && (
        <section className={styles.section}>
          <h4>词族</h4>
          <Points values={detail.wordFamilyPoints} synonyms />
        </section>
      )}
      {(entry.exampleEnglish || entry.exampleChinese) && (
        <section className={styles.section}>
          <h4>例句</h4>
          <blockquote className={styles.example}>
            {entry.exampleEnglish && <p>{entry.exampleEnglish}</p>}
            {entry.exampleChinese && <p>{entry.exampleChinese}</p>}
          </blockquote>
        </section>
      )}
      {detail.mistakePoints.length > 0 && (
        <section className={`${styles.section} ${styles.mistakes}`}>
          <h4>易错点</h4>
          <Points values={detail.mistakePoints} />
        </section>
      )}
      {detail.memoryPoints.length > 0 && (
        <section className={styles.section}>
          <h4>记忆提示</h4>
          <Points values={detail.memoryPoints} />
        </section>
      )}
    </div>
  );
}
