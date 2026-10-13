import { createHash } from "node:crypto";
import { DEFAULT_STUDY_SETTINGS, newMemory } from "../../lib/studyScheduler";
import type { StudySnapshot } from "../../types/study";
import type { VocabularyEntry } from "../../types/vocabulary";
const now = new Date("2026-10-13T07:00:00Z");
export function transportFixture(count = 20): StudySnapshot {
  const entries = Array.from({ length: count }, (_, i) => {
    const text = Array.from({ length: 20 }, (_, j) => createHash("sha256").update(`${i}/${j}`).digest("hex")).join(" ");
    return { id: `entry-${i}`, word: `word${i}`, lemma: `word${i}`, phonetic: "ipa", phoneticFor: `word${i}`,
      partOfSpeech: "noun", basicMeaning: `meaning${i}`, contextMeaning: `context${i}`, sentenceTranslation: text,
      usageNote: text, collocation: text, exampleEnglish: text, exampleChinese: text, sourceSentence: text,
      previousSentence: text, nextSentence: text, difficulty: "medium", shouldAddToVocabulary: true,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      anki: { canMakeCloze: false, cardMode: "basic_en_to_cn", clozeSentence: "", contextCue: "", basicCue: "", frontPreview: text, backPreview: text },
    } as VocabularyEntry;
  });
  const cards = entries.map((entry, i) => ({ id: i.toString(16).padStart(40, "0"), entry_id: entry.id,
    mode: "basic_en_to_cn", memory: newMemory(now), version: i, suspended: false, anki_pending: false, created_at: now.toISOString() }));
  return { serverNow: now.toISOString(), settings: DEFAULT_STUDY_SETTINGS, cards, entries,
    today: { day: "2026-10-13", card_ids: cards.map(c => c.id), new_ids: cards.map(c => c.id), settings: DEFAULT_STUDY_SETTINGS, reward_points: 0, completed_at: null, new_completed: 0, streak: 0 },
    reviews: [], daily: [], policy: { rewardsEnabled: true, pointsPerNew: 1, dailyRewardCap: 10, rewardDays: 30, streakMinNew: 1, milestones: [], profileEnabled: false, profileCost: 0, minimumReadingMinutes: 1, minimumLookups: 1 },
    streak: { current: 0, best: 0, last_day: null }, rewards: [], claims: [], ankiPendingCount: 0 };
}

