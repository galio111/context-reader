import type { CetActivity, CetAttempt } from "@/types/cet";

export type CetHistoryStatus = "all" | "submitted" | "unsubmitted";
export const cetHistoryStatusOptions = [
  { key: "all", text: "全部记录" },
  { key: "submitted", text: "已提交" },
  { key: "unsubmitted", text: "未提交" },
];

export function cetHistorySummary(record: CetActivity | CetAttempt) {
  const modern = "finalizations" in record;
  const submitted = modern ? record.status === "submitted" : Boolean(record.finishedAt);
  const at = modern ? record.submittedAt || record.endedAt || record.updatedAt : record.finishedAt || record.updatedAt;
  const date = new Date(at);
  const time = Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }) : "时间未知";
  let score = "未提交";
  if (modern) {
    const finals = Object.values(record.finalizations).filter(f => f.reason !== "ended_for_study");
    const scopes = new Set(finals.map(f => f.sectionId || "$test"));
    if (scopes.size !== finals.length) score = "多份答卷，查看成绩";
    else if (finals.length) {
      const correct = finals.reduce((sum, f) => sum + f.correct, 0);
      const total = finals.reduce((sum, f) => sum + f.scoreable, 0);
      score = total ? `${submitted ? "" : "已提交部分 · "}答对 ${correct}/${total} 题` : "暂无可计分结果";
    } else if (record.status === "ended") score = "未完成";
    else if (submitted) score = "暂无成绩";
  } else if (submitted) score = "查看答卷";
  return { submitted, at, time, score };
}

export function matchesCetHistoryStatus(record: CetActivity | CetAttempt, status: CetHistoryStatus) {
  const submitted = "finalizations" in record ? record.status === "submitted" : Boolean(record.finishedAt);
  return status === "all" || submitted === (status === "submitted");
}
