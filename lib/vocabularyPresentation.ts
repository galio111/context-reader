import type { VocabularyEntry } from "@/types/vocabulary";

export interface StandaloneVocabularyPresentation {
  usagePoints: string[];
  synonymPoints: string[];
  wordFamilyPoints: string[];
  mistakePoints: string[];
  memoryPoints: string[];
  collocationPoints: string[];
}

const SECTION_LABELS = [
  "用法辨析",
  "用法提示",
  "近义词辨析",
  "词族",
  "易错点",
  "记忆提示",
] as const;

type SectionLabel = (typeof SECTION_LABELS)[number];

function splitPoints(value: string): string[] {
  return value
    .replace(/([。！？])/g, "$1\n")
    .split(/\r?\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function labelledSection(line: string): { label: SectionLabel; value: string } | null {
  for (const label of SECTION_LABELS) {
    const match = line.match(new RegExp(`^${label}\\s*[：:]\\s*(.*)$`, "u"));
    if (match) return { label, value: match[1] ?? "" };
  }
  return null;
}

export function standaloneVocabularyPresentation(entry: VocabularyEntry): StandaloneVocabularyPresentation {
  const presentation: StandaloneVocabularyPresentation = {
    usagePoints: [],
    synonymPoints: [],
    wordFamilyPoints: [],
    mistakePoints: [],
    memoryPoints: [],
    collocationPoints: splitPoints(entry.collocation),
  };

  entry.usageNote
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const section = labelledSection(line);
      if (!section) {
        presentation.usagePoints.push(...splitPoints(line));
        return;
      }
      const points = splitPoints(section.value);
      if (section.label === "近义词辨析") presentation.synonymPoints.push(...points);
      else if (section.label === "词族") presentation.wordFamilyPoints.push(...points);
      else if (section.label === "易错点") presentation.mistakePoints.push(...points);
      else if (section.label === "记忆提示") presentation.memoryPoints.push(...points);
      else presentation.usagePoints.push(...points);
    });

  return presentation;
}

export function hasStandaloneVocabularyDetails(entry: VocabularyEntry): boolean {
  const detail = standaloneVocabularyPresentation(entry);
  return Boolean(
    detail.usagePoints.length
    || detail.synonymPoints.length
    || detail.wordFamilyPoints.length
    || detail.mistakePoints.length
    || detail.memoryPoints.length
    || detail.collocationPoints.length
    || entry.exampleEnglish
    || entry.exampleChinese,
  );
}
