import type { VocabularyEntry } from "./vocabulary";

export type StudyAnswer = "forgot" | "unsure_wrong" | "unsure_right" | "remembered";
export interface StudyMemory {
  due: string; stability: number; difficulty: number; elapsed_days: number;
  scheduled_days: number; reps: number; lapses: number; state: number;
  learning_steps: number; last_review?: string;
}
export interface StudyCard {
  id: string; entry_id: string; mode: string; memory: StudyMemory; version: number;
  suspended: boolean; anki_pending: boolean; created_at: string;
}
export interface StudySettings {
  /** Retained for old plan snapshots; new plans do not cap new words. */
  newPerDay?: number; reviewsPerDay: number; retention: number;
  forgotMinutes?: number; unsureMinutes?: number;
  pausedUntil: string | null; reminders: boolean; includeAnki: boolean;
}
export interface StudyReview {
  id: string; card_id: string; answer: StudyAnswer; rating: number; reviewed_at: string;
  active_ms: number; undone: boolean; previous: StudyMemory; next: StudyMemory;
}
export interface StudyDay {
  day: string; card_ids: string[]; new_ids: string[]; settings: StudySettings;
  reward_points: number; completed_at: string | null; new_completed: number; streak: number;
}
export interface StudyMilestone { days:number; points:number; plan:"basic"|"plus"|"max"|null; months:number; }
export interface StudyReward { milestone:number; points:number; plan:string|null; months:number; earned_at:string; activated_at:string|null; ends_at:string|null; }
export interface StudyClaim { id:string; day:string|null; milestone:number|null; points:number; claimed_points:number; plan:string|null; months:number; earned_at:string; claimed_at:string|null; }
export interface StudyPolicy {
  rewardsEnabled: boolean; pointsPerNew: number; dailyRewardCap: number; rewardDays: number;
  streakMinNew:number; milestones:StudyMilestone[];
  profileEnabled: boolean; profileCost: number; minimumReadingMinutes: number; minimumLookups: number;
}
export interface StudySnapshot {
  ankiPendingCount?:number;
  serverNow: string; settings: StudySettings; cards: StudyCard[]; entries: VocabularyEntry[];
  today: StudyDay | null; reviews: StudyReview[];
  daily: Array<{ day: string; cards: number; new_cards?:number; review_cards?:number; active_ms: number; successes: number; reviews: number }>;
  policy: StudyPolicy;
  streak: { current:number; best:number; last_day:string|null }; rewards:StudyReward[];
  claims:StudyClaim[];
}
