import type { CetActivityStatus, CetPurpose } from "@/types/cet";

export type CetSubmitCommand = "passage_submit" | "submit_all" | "manual_submit";

/** Fixed answer scope, never the cross-paper navigation trail. */
export function cetSubmitPolicy(input: {
  purpose: CetPurpose;
  status: CetActivityStatus;
  sectionId?: string;
  sectionIds: string[];
  activeSectionId: string;
  finalized: boolean;
  mismatch: boolean;
}) {
  const { sectionIds, sectionId, activeSectionId, purpose, status, finalized } = input;
  const invalid = input.mismatch || !sectionIds.length || new Set(sectionIds).size !== sectionIds.length
    || !sectionIds.includes(activeSectionId)
    || Boolean(sectionId && (sectionIds.length !== 1 || sectionIds[0] !== sectionId));
  const single = Boolean(sectionId) || sectionIds.length === 1;
  const practice = purpose === "practice";
  const command: CetSubmitCommand = practice ? single ? "passage_submit" : "submit_all" : "manual_submit";
  const questions: CetSubmitCommand[] = [];
  if (!invalid && status === "in_progress") {
    if (practice && !finalized) questions.push("passage_submit");
    if (activeSectionId === sectionIds.at(-1)) {
      if (practice && !single) questions.push("submit_all");
      if (!practice) questions.push("manual_submit");
    }
  }
  return {
    questions,
    toolbar: {
      command,
      label: !practice ? "提交自测" : status === "ended" ? "练习已结束"
        : single ? (finalized || status === "submitted" ? "本篇已提交" : "提交本篇")
          : status === "submitted" ? "全部已提交" : "提交全部",
      disabled: invalid || (status !== "in_progress" && !(status === "paused" && !practice)) || (practice && single && finalized),
    },
  };
}
