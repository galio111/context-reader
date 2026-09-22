"use client";
import { useEffect, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { readCetAttempts } from "@/lib/cetProgress";
import { initializeLearningStorage } from "@/lib/learningStorage";
import {
  ACCOUNT_DATA_MERGED_EVENT,
  ACCOUNT_DATA_CHANGED_EVENT,
} from "@/lib/accountEvents";
import type { CetAttempt, CetPaper } from "@/types/cet";
import "./cet.css";
export interface CetEntry {
  paperId: string;
  sectionId?: string;
  attemptId?: string;
}
export function CetLibrary({
  onOpen,
  compact = false,
}: {
  onOpen: (entry: CetEntry) => void;
  compact?: boolean;
}) {
  const { account, openLogin } = useAccount();
  const [level, setLevel] = useState<4 | 6>(4),
    [view, setView] = useState<"paper" | "type">("paper"),
    [type, setType] = useState("cloze"),
    [year, setYear] = useState("recent"),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [years, setYears] = useState<number[]>([]),
    [papers, setPapers] = useState<CetPaper[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [history, setHistory] = useState<CetAttempt[]>([]),
    [historyLimit, setHistoryLimit] = useState(30),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/cet?level=${level}&page=${page}&year=${year}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!cancelled) {
          setPapers(d.papers);
          setTotal(d.total);
          setYears(d.years);
        }
      })
      .catch(() => {
        if (!cancelled) setError("试卷暂时未能加载，请重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [level, account.authenticated, page, year, retry]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (live)
        setHistory(
          readCetAttempts().sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          ),
        );
    };
    void initializeLearningStorage().then(refresh);
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refresh);
    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, refresh);
    return () => {
      live = false;
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refresh);
      window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT, refresh);
    };
  }, [account.profile?.userId]);
  const filtered = papers.filter(
      (p) => year === "recent" || String(p.year) === year,
    ),
    rows =
      view === "paper"
        ? filtered.map((p) => ({ paper: p, section: undefined }))
        : filtered.flatMap((p) =>
            p.sections
              .filter((s) => s.type === type)
              .map((section) => ({ paper: p, section })),
          ),
    visible = account.authenticated ? rows : rows.slice(0, 6);
  return (
    <div className={`cet-library ${compact ? "cet-library-compact" : ""}`}>
      <div className="cet-library-controls">
        <div>
          {([4, 6] as const).map((n) => (
            <button
              key={n}
              aria-pressed={level === n}
              onClick={() => {
                setLevel(n);
                setPage(0);
              }}
            >
              {n === 4 ? "四级" : "六级"}
            </button>
          ))}
        </div>
        <div>
          <button
            aria-pressed={view === "paper"}
            onClick={() => setView("paper")}
          >
            按试卷
          </button>
          <button
            aria-pressed={view === "type"}
            onClick={() => setView("type")}
          >
            按题型
          </button>
        </div>
      </div>
      <div className="cet-filter-line">
        {view === "type" && (
          <select
            aria-label="选择题型"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="cloze">选词填空</option>
            <option value="matching">长篇匹配</option>
            <option value="detail">仔细阅读</option>
          </select>
        )}
        {account.authenticated && (
          <select
            aria-label="选择年份"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setPage(0);
            }}
          >
            <option value="recent">最近年份</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        )}
      </div>
      <div
        className={`cet-library-layout ${!account.authenticated || compact ? "cet-library-wide" : ""}`}
      >
        <div>
          {loading ? (
            <p role="status">正在读取试卷…</p>
          ) : error ? (
            <p role="alert">
              {error}
              <button onClick={() => setRetry((n) => n + 1)}>重试</button>
            </p>
          ) : (
            visible.map(({ paper: p, section: s }) => (
              <button
                className="cet-resource-row"
                key={s?.id || p.id}
                onClick={() => onOpen({ paperId: p.id, sectionId: s?.id })}
              >
                <span className="cet-cover" aria-hidden="true">
                  <small>CET {p.level}</small>
                  <strong>{p.year}</strong>
                  <span>
                    {p.month} 月 · {p.set}
                  </span>
                </span>
                <span className="cet-resource-copy">
                  <small>
                    {p.year} 年 {p.month} 月 · 第 {p.set} 套
                  </small>
                  <strong>
                    {s ? s.title : `大学英语${p.level === 4 ? "四" : "六"}级`}
                  </strong>
                  <span>
                    {s
                      ? `${s.questions[0]?.number}–${s.questions.at(-1)?.number} 题`
                      : "选词填空 · 长篇匹配 · 仔细阅读"}
                  </span>
                </span>
                <span className="cet-row-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))
          )}
          {account.authenticated && total > 12 && (
            <div className="cet-library-pagination">
              <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span>
                {page + 1} / {Math.ceil(total / 12)}
              </span>
              <button
                disabled={(page + 1) * 12 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}
          {!account.authenticated && (
            <div className="cet-login-note">
              <span>
                游客可阅读本级别的 6 {view === "paper" ? "套试卷" : "篇阅读"}
                。登录后查看已导入的完整题库，近十年资源将陆续补齐。
              </span>
              <button
                onClick={() =>
                  openLogin("登录后查看完整真题库，并同步答题进度。")
                }
              >
                登录查看更多 ↗
              </button>
            </div>
          )}
        </div>
        {account.authenticated && !compact && (
          <aside className="cet-recent">
            <h3>最近练习</h3>
            <div
              className="cet-recent-list"
              tabIndex={0}
              aria-label="最近练习，可滚动"
            >
              {history.length ? (
                history.slice(0, historyLimit).map((h) => (
                  <button
                    key={h.id}
                    onClick={() =>
                      onOpen({
                        paperId: h.paperId,
                        sectionId: h.sectionId,
                        attemptId: h.id,
                      })
                    }
                  >
                    <small>
                      {h.sectionId ? "单篇" : "整卷"} ·{" "}
                      {h.finishedAt ? "已交卷" : "继续练习"}
                    </small>
                    <strong>{h.title}</strong>
                    <span>
                      {Object.values(h.answers).filter(Boolean).length} 题 ·{" "}
                      {Math.floor(h.elapsedMs / 60000)} 分钟
                    </span>
                  </button>
                ))
              ) : (
                <p>开始练习后，进度会保存在这里。</p>
              )}
              {history.length > historyLimit && (
                <button onClick={() => setHistoryLimit((n) => n + 30)}>
                  加载更多记录
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
