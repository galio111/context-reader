import "server-only";
import { createHash } from "node:crypto";
import { accountFetch } from "@/lib/accountStore";
import { DEFAULT_STUDY_SETTINGS, newMemory, shanghaiDay } from "@/lib/studyScheduler";
import type { StudyCard, StudyDay, StudyPolicy, StudyReview, StudySettings, StudySnapshot } from "@/types/study";
import type { VocabularyEntry } from "@/types/vocabulary";

export async function studyRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return accountFetch<T>("rpc/study_" + name, { method: "POST", body: JSON.stringify(args) });
}
export async function studyRows<T>(table: string, userId: string, select = "*", extra = "", maxRows = 50000): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; offset < maxRows; offset += 500) {
    const rows = await accountFetch<T[]>(table + "?user_id=eq." + encodeURIComponent(userId) + "&select=" + select + extra + "&limit=500&offset=" + offset);
    all.push(...rows);
    if (rows.length < 500) return all;
  }
  throw new Error("Study collection exceeds supported page bound");
}
export async function getStudySettings(userId: string): Promise<StudySettings> {
  const rows = await accountFetch<Array<{ settings: Partial<StudySettings> }>>("study_settings?user_id=eq." + encodeURIComponent(userId) + "&select=settings&limit=1");
  return { ...DEFAULT_STUDY_SETTINGS, ...rows[0]?.settings };
}
export async function getStudyPolicy(): Promise<StudyPolicy> {
  const rows = await accountFetch<Array<{ policy: StudyPolicy }>>("study_policy?id=eq.true&select=policy");
  if (!rows[0]) throw new Error("Study policy unavailable");
  return rows[0].policy;
}
// Project JSON fields in PostgreSQL: discarding dictionaryResult after fetching
// every saved dictionary still makes each answer scale with the entire library.
const STUDY_ENTRY_FIELDS: Array<Exclude<keyof VocabularyEntry, "dictionaryResult">> = [
  "id", "word", "lemma", "phonetic", "phoneticFor", "partOfSpeech", "basicMeaning", "contextMeaning",
  "sentenceTranslation", "usageNote", "collocation", "exampleEnglish", "exampleChinese", "sourceSentence",
  "previousSentence", "nextSentence", "sourceArticle", "difficulty", "shouldAddToVocabulary", "createdAt",
  "updatedAt", "anki", "dictionaryUpdatedAt", "explanationUpdatedAt",
];
export const STUDY_ENTRY_SELECT = "object_key," + STUDY_ENTRY_FIELDS.map(field => `${field}:payload->${field}`).join(",");
export async function getStudyEntries(userId: string): Promise<VocabularyEntry[]> {
  const rows = await studyRows<VocabularyEntry & { object_key: string }>("user_data_objects", userId, STUDY_ENTRY_SELECT, "&kind=eq.vocabulary&deleted_at=is.null&order=object_key.asc");
  return rows.filter(r => r.id === r.object_key && typeof r.word === "string" && r.anki)
    .map(({ object_key, ...entry }) => { void object_key; return entry; });
}
export async function reconcileStudyCards(userId: string): Promise<void> {
  const [entries, cards] = await Promise.all([getStudyEntries(userId), studyRows<StudyCard>("study_cards", userId, "*", "&order=id.asc")]);
  const existing = new Map(cards.map(c => [c.entry_id, c]));
  const now = new Date();
  const fresh = entries.filter(e => !existing.has(e.id)).map(e => ({
    user_id: userId, id: createHash("sha256").update(e.id).digest("hex").slice(0, 40),
    entry_id: e.id, mode: e.anki.cardMode, memory: newMemory(now), anki_pending: Boolean(e.anki.ankiNoteId),
    reward_key:createHash("sha256").update(e.word.normalize("NFKC").toLowerCase().trim().replace(/\s+/g," ")).digest("hex"),
  }));
  for (let offset = 0; offset < fresh.length; offset += 100) {
    await accountFetch("study_cards?on_conflict=user_id,id", { method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(fresh.slice(offset, offset + 100)) });
  }
  const active = new Set(entries.map(e => e.id));
  const imported = new Map(entries.map(e => [e.id, Boolean(e.anki.ankiNoteId)]));
  for (const card of cards) {
    const suspended = !active.has(card.entry_id);
    const ankiPending = imported.get(card.entry_id) ?? card.anki_pending;
    if (card.suspended === suspended && card.anki_pending === ankiPending) continue;
    await accountFetch("study_cards?user_id=eq." + encodeURIComponent(userId) + "&id=eq." + encodeURIComponent(card.id),
      { method: "PATCH", body: JSON.stringify({ suspended, anki_pending: ankiPending }) });
  }
}
export async function getStudySnapshot(userId: string): Promise<StudySnapshot> {
  const now = new Date();
  const [settings, cards, entries, today, reviews, daily, policy, streakRows, rewards, claims] = await Promise.all([
    getStudySettings(userId), studyRows<StudyCard>("study_cards", userId, "id,entry_id,mode,memory,version,suspended,anki_pending,created_at", "&order=id.asc"),
    getStudyEntries(userId),
    accountFetch<StudyDay[]>("study_days?user_id=eq." + encodeURIComponent(userId) + "&day=eq." + shanghaiDay(now) + "&select=*&limit=1"),
    accountFetch<StudyReview[]>("study_reviews?user_id=eq." + encodeURIComponent(userId) + "&select=id,card_id,answer,rating,reviewed_at,active_ms,undone,previous,next&order=reviewed_at.desc&limit=20"),
    studyRpc<StudySnapshot["daily"]>("daily_stats_v3", { p_user: userId }), getStudyPolicy(),
    studyRows<{current:number;best:number;last_day:string|null}>("study_streaks",userId,"current,best,last_day"),
    studyRows<StudySnapshot["rewards"][number]>("study_rewards",userId,"milestone,points,plan,months,earned_at,activated_at,ends_at","&order=milestone.asc"),
    studyRows<StudySnapshot["claims"][number]>("study_claims",userId,"id,day,milestone,points,claimed_points,plan,months,earned_at,claimed_at","&order=earned_at.desc"),
  ]);
  const ids = new Set(entries.map(e => e.id));
  const active=cards.filter(c=>ids.has(c.entry_id)&&!c.suspended);
  const visible=active.filter(c=>!c.anki_pending||settings.includeAnki);
  const visibleIds=new Set(visible.map(c=>c.entry_id));
  return { serverNow: now.toISOString(), settings, cards: visible, ankiPendingCount:active.filter(c=>c.anki_pending).length,
    // Full dictionaries remain in synced vocabulary/cache objects. Read one saved
    // result when opening a card instead of repeating every dictionary per answer.
    entries:entries.filter(e=>visibleIds.has(e.id)).map(entry=>({...entry,dictionaryResult:undefined})), today: today[0] ?? null, reviews, daily, policy,
    streak:streakRows[0]??{current:0,best:0,last_day:null},rewards,claims };
}
export async function saveStudySettings(userId: string, settings: StudySettings) {
  await accountFetch("study_settings?on_conflict=user_id", { method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, settings, updated_at: new Date().toISOString() }) });
}
