import type { StudyReviewReceipt, StudySnapshot } from "@/types/study";

/** Merge server-confirmed fields only, fencing delayed snapshots and duplicates. */
export function applyStudyReviewReceipt(snapshot: StudySnapshot, receipt: StudyReviewReceipt): StudySnapshot {
  const known=snapshot.cards.find(c=>c.id===receipt.card.id);
  const cards=known&&known.version>receipt.card.version?snapshot.cards:snapshot.cards.map(c=>c.id===receipt.card.id?receipt.card:c);
  const reviews=snapshot.reviews.some(r=>r.id===receipt.review.id)?snapshot.reviews:
    [receipt.review,...snapshot.reviews].sort((a,b)=>Date.parse(b.reviewed_at)-Date.parse(a.reviewed_at));
  const daily=receipt.todayStats&&Date.parse(snapshot.serverNow)<=Date.parse(receipt.serverNow)
    ? [...snapshot.daily.filter(d=>d.day!==receipt.todayStats!.day),receipt.todayStats].sort((a,b)=>a.day.localeCompare(b.day)) : snapshot.daily;
  return {...snapshot,cards,reviews,daily};
}
