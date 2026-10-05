import type { VocabularyEntry } from "@/types/vocabulary";
export const OPEN_STUDY_EVENT = "context-reader-open-study";
export const STUDY_SOURCE_EVENT = "context-reader-study-source";
export const STUDY_SOURCE_RESULT_EVENT = "context-reader-study-source-result";
export const STUDY_VIEW_EVENT = "context-reader-study-view";
export function openStudy() { window.dispatchEvent(new Event(OPEN_STUDY_EVENT)); }
export function openStudySource(entry: VocabularyEntry) { window.dispatchEvent(new CustomEvent(STUDY_SOURCE_EVENT, { detail: entry })); }
