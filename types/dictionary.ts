export interface DictionarySense {
  partOfSpeech: string;
  meaning: string;
  register: string;
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

export interface DictionaryResult {
  query: string;
  lemma: string;
  phonetic: string;
  senses: DictionarySense[];
  usageGuide: string;
  collocations: DictionaryCollocation[];
  wordFamily: DictionaryWordFamilyItem[];
  synonyms: DictionarySynonym[];
  commonMistakes: string[];
  memoryTip: string;
}
