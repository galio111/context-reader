export interface DictionarySense {
  headword?: string;
  headwordNote?: string;
  partOfSpeech: string;
  meaning: string;
  phonetic: string;
  register: string;
  usageNote: string;
  exampleEnglish: string;
  exampleChinese: string;
}

export interface DictionaryCollocation {
  phrase: string;
  meaning: string;
  exampleEnglish: string;
}

export interface DictionaryWordFamilyItem {
  word: string;
  partOfSpeech: string;
  meaning: string;
}

export interface DictionarySynonym {
  word: string;
  difference: string;
}

export interface DictionaryVerbForms {
  pastTense: string;
  pastParticiple: string;
  presentParticiple: string;
}

export type DictionaryInputStatus = "valid" | "inflection" | "ambiguous" | "misspelled";
export type DictionaryDirection = "en_to_cn" | "cn_to_en";

export interface DictionaryResult {
  query: string;
  lemma: string;
  phonetic: string;
  phoneticFor?: string;
  direction: DictionaryDirection;
  inputStatus: DictionaryInputStatus;
  suggestedQuery: string;
  senses: DictionarySense[];
  verbForms: DictionaryVerbForms | null;
  usageGuide: string;
  collocations: DictionaryCollocation[];
  wordFamily: DictionaryWordFamilyItem[];
  synonyms: DictionarySynonym[];
  commonMistakes: string[];
  memoryTip: string;
}
