import type { AnkiCardMode } from "@/types/anki";
import type { VocabularyEntry } from "@/types/vocabulary";

export const DEFAULT_ANKI_ENDPOINT = "http://127.0.0.1:8765";
export const DEFAULT_ANKI_DECK = "English Reading Vocabulary";
export const CLOZE_MODEL_NAME = "Context Reader Cloze Context";
export const BASIC_MODEL_NAME = "Context Reader Basic CN-EN";

export const clozeFields = [
  "Word",
  "Lemma",
  "Phonetic",
  "PartOfSpeech",
  "ClozeSentence",
  "ContextCue",
  "BasicMeaning",
  "ContextMeaning",
  "SourceSentence",
  "SentenceTranslation",
  "UsageNote",
  "Collocation",
  "ExampleEnglish",
  "ExampleChinese",
  "Difficulty",
  "CreatedAt",
] as const;

export const basicFields = [
  "Word",
  "Lemma",
  "Phonetic",
  "PartOfSpeech",
  "BasicCue",
  "BasicMeaning",
  "ContextMeaning",
  "SourceSentence",
  "SentenceTranslation",
  "UsageNote",
  "Collocation",
  "ExampleEnglish",
  "ExampleChinese",
  "Difficulty",
  "CreatedAt",
] as const;

export const cardCss = `
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;
  font-size: 21px;
  line-height: 1.65;
  color: #111827;
  background: #ffffff;
  text-align: left;
  padding: 8px;
}
.sentence {
  color: #0f172a;
  font-size: 26px;
  font-weight: 700;
}
.context-cue,
.basic-cue {
  color: #1d4ed8;
  font-size: 24px;
  font-weight: 700;
}
.prompt {
  color: #374151;
  font-size: 20px;
  margin-bottom: 16px;
}
.word {
  color: #0f172a;
  font-size: 34px;
  font-weight: 800;
}
.meta {
  color: #475569;
  font-size: 18px;
  margin-top: 4px;
}
b {
  color: #111827;
}
hr {
  border: 0;
  border-top: 2px solid #cbd5e1;
  margin: 20px 0;
}
`;

export const clozeFrontTemplate = `<div class="card">
  <div class="sentence">{{ClozeSentence}}</div>
  <hr>
  <div class="context-cue">{{ContextCue}}</div>
</div>`;

export const clozeBackTemplate = `<div class="card">
  <div class="word">{{Word}}</div>

  <div class="meta">
    {{Lemma}} · {{Phonetic}} · {{PartOfSpeech}}
  </div>

  <hr>

  <div>
    <b>原句：</b><br>
    {{SourceSentence}}
  </div>

  <br>

  <div>
    <b>自然翻译：</b><br>
    {{SentenceTranslation}}
  </div>

  <br>

  <div>
    <b>语境含义：</b><br>
    {{ContextMeaning}}
  </div>

  <br>

  <div>
    <b>基础释义：</b><br>
    {{BasicMeaning}}
  </div>

  <br>

  <div>
    <b>用法说明：</b><br>
    {{UsageNote}}
  </div>

  <br>

  <div>
    <b>常见搭配：</b><br>
    {{Collocation}}
  </div>

  <br>

  <div>
    <b>补充例句：</b><br>
    {{ExampleEnglish}}<br>
    {{ExampleChinese}}
  </div>
</div>`;

export const basicFrontTemplate = `<div class="card">
  <div class="prompt">请写出对应的英文单词：</div>
  <div class="basic-cue">{{BasicCue}}</div>
</div>`;

export const basicBackTemplate = `<div class="card">
  <div class="word">{{Word}}</div>

  <div class="meta">
    {{Lemma}} · {{Phonetic}} · {{PartOfSpeech}}
  </div>

  <hr>

  <div>
    <b>基础释义：</b><br>
    {{BasicMeaning}}
  </div>

  <br>

  <div>
    <b>当前语境含义：</b><br>
    {{ContextMeaning}}
  </div>

  <br>

  <div>
    <b>原句：</b><br>
    {{SourceSentence}}
  </div>

  <br>

  <div>
    <b>自然翻译：</b><br>
    {{SentenceTranslation}}
  </div>

  <br>

  <div>
    <b>用法说明：</b><br>
    {{UsageNote}}
  </div>

  <br>

  <div>
    <b>常见搭配：</b><br>
    {{Collocation}}
  </div>

  <br>

  <div>
    <b>补充例句：</b><br>
    {{ExampleEnglish}}<br>
    {{ExampleChinese}}
  </div>
</div>`;

export function modelNameForMode(mode: AnkiCardMode): string {
  return mode === "cloze_context" ? CLOZE_MODEL_NAME : BASIC_MODEL_NAME;
}

export function fieldsForEntry(entry: VocabularyEntry): Record<string, string> {
  const common = {
    Word: entry.word,
    Lemma: entry.lemma,
    Phonetic: entry.phonetic,
    PartOfSpeech: entry.partOfSpeech,
    BasicMeaning: entry.basicMeaning,
    ContextMeaning: entry.contextMeaning,
    SourceSentence: entry.sourceSentence,
    SentenceTranslation: entry.sentenceTranslation,
    UsageNote: entry.usageNote,
    Collocation: entry.collocation,
    ExampleEnglish: entry.exampleEnglish,
    ExampleChinese: entry.exampleChinese,
    Difficulty: entry.difficulty,
    CreatedAt: entry.createdAt,
  };

  if (entry.anki.cardMode === "cloze_context") {
    return {
      ...common,
      ClozeSentence: entry.anki.clozeSentence,
      ContextCue: entry.anki.contextCue,
    };
  }

  return {
    ...common,
    BasicCue: entry.anki.basicCue || entry.basicMeaning,
  };
}

export function modelDefinition(mode: AnkiCardMode) {
  if (mode === "cloze_context") {
    return {
      modelName: CLOZE_MODEL_NAME,
      inOrderFields: [...clozeFields],
      css: cardCss,
      cardTemplates: [
        {
          Name: "Cloze Context",
          Front: clozeFrontTemplate,
          Back: clozeBackTemplate,
        },
      ],
    };
  }

  return {
    modelName: BASIC_MODEL_NAME,
    inOrderFields: [...basicFields],
    css: cardCss,
    cardTemplates: [
      {
        Name: "Basic CN-EN",
        Front: basicFrontTemplate,
        Back: basicBackTemplate,
      },
    ],
  };
}
