import type { CetActivity } from "@/types/cet";

/** Count canonical submissions only; conflicted/unfinished attempts do not masquerade as accuracy. */
export function cetLearningSummary(activities: CetActivity[]) {
  const seen = new Set<string>();
  let correct = 0, scoreable = 0, submissions = 0, excluded = 0;
  for (const activity of activities) {
    const finals = Object.values(activity.finalizations);
    const groups = new Map<string, typeof finals>();
    for (const final of finals) {
      if (final.reason === "ended_for_study") continue;
      const key = final.sectionId || "paper";
      groups.set(key, [...(groups.get(key) || []), final]);
    }
    // A whole-paper submission subsumes passage-level results from that same activity.
    const selected = groups.has("paper") ? [groups.get("paper")!] : [...groups.values()];
    for (const rows of selected) {
      const unique = [...new Map(rows.map(row => [row.id, row])).values()];
      if (unique.length !== 1) { excluded++; continue; }
      const row = unique[0];
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      // The frozen submission is authoritative. Blank questions and questions
      // without a reliable answer key must not lower personal accuracy.
      const answered = (row.questions ?? []).filter(question =>
        question.answer && question.options.some(option => option.key === question.answer)
        && row.answers?.[question.key]?.trim(),
      );
      if (!answered.length) continue;
      correct += answered.filter(question => row.answers[question.key] === question.answer).length;
      scoreable += answered.length;
      submissions++;
    }
  }
  return { correct, scoreable, submissions, excluded };
}
