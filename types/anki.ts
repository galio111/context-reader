export type AnkiCardMode = "cloze_context" | "basic_cn_to_en";

export interface AnkiCardInfo {
  canMakeCloze: boolean;
  cardMode: AnkiCardMode;
  clozeSentence: string;
  contextCue: string;
  basicCue: string;
  frontPreview: string;
  backPreview: string;
  ankiNoteId?: number | null;
  ankiImportedAt?: string | null;
}

export interface AnkiSettings {
  endpoint: string;
  deckName: string;
}

export interface AnkiAddNoteRequest {
  endpoint?: string;
  deckName?: string;
  entry: import("./vocabulary").VocabularyEntry;
}

export interface AnkiAddNoteResponse {
  ankiNoteId: number;
}
