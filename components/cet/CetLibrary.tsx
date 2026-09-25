"use client";
import { useEffect, useRef, useState } from "react";
import { readCetLibraryView, writeCetLibraryView, type CetLibraryView } from "@/lib/cetLibraryView";
import { useAccount } from "@/components/AccountProvider";
import { readCetAttempts } from "@/lib/cetProgress";
import { readCetActivities } from "@/lib/cetActivityStorage";
import { cetHistoryLabel } from "@/lib/cetActivity";
import { getLearningStorage, initializeLearningStorage } from "@/lib/learningStorage";
import {
  ACCOUNT_DATA_MERGED_EVENT,
  ACCOUNT_DATA_CHANGED_EVENT,
} from "@/lib/accountEvents";
import type { CetActivity, CetAttempt, CetPaper } from "@/types/cet";
import "./cet.css";
import { loadCetCatalogue } from "@/lib/cetCatalogueLoader";
import { CetSelect } from "./CetSelect";
export interface CetEntry {
  paperId: string;
  sectionId?: string;
  attemptId?: string;
  preparedPaper?: CetPaper;
  preparedOwner?: string;
}
export function CetLibrary({
  onOpen,
  compact = false,
}: {
  onOpen: (entry: CetEntry) => void;
  compact?: boolean;
}) {
  const { account, openLogin } = useAccount();
  const [initialView] = useState(readCetLibraryView);
  const [level, setLevel] = useState<4 | 6>(initialView.level),
    [view, setView] = useState<"paper" | "type">(initialView.view),
    [type, setType] = useState<CetLibraryView["type"]>(initialView.type),
    [year, setYear] = useState(initialView.year),
    [total, setTotal] = useState(0),
    [years, setYears] = useState<number[]>([]),
    [papers, setPapers] = useState<CetPaper[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [history, setHistory] = useState<CetActivity[]>([]),
    [legacyHistory, setLegacyHistory] = useState<CetAttempt[]>([]),
    [historyLimit, setHistoryLimit] = useState(30),
    [retry, setRetry] = useState(0);
  const [historyPurpose, setHistoryPurpose] = useState<"" | "practice" | "self_test">("");
  const catalogue = useRef<{key:string;papers:CetPaper[]}>({key:"",papers:[]});
  useEffect(() => { writeCetLibraryView({ level, view, type, year, page:0 }); }, [level, view, type, year]);
  useEffect(() => {
    const controller = new AbortController();
    const key = `${level}:${account.authenticated}:${year}`;
    if(catalogue.current.key !== key){catalogue.current={key,papers:[]};setPapers([]);setTotal(0);}
    setLoading(true);setError("");
    void loadCetCatalogue({ signal:controller.signal, initial:catalogue.current.papers,
      fetchPage:async page=>{
        const response=await fetch(`/api/cet?level=${level}&page=${page}&year=${account.authenticated ? year : "recent"}`,{signal:controller.signal});
        const data=await response.json();if(!response.ok)throw Error(data.error || "目录加载失败");return data;
      },
      onBatch:batch=>{
        if(controller.signal.aborted || catalogue.current.key!==key)return;
        if(account.authenticated && year!=="recent" && !batch.years.map(String).includes(year)){controller.abort();setYear("recent");return;}
        catalogue.current.papers=batch.papers;setPapers(batch.papers);setTotal(batch.total);setYears(batch.years);
      }
    }).catch(()=>{if(!controller.signal.aborted)setError(catalogue.current.papers.length ? "后续目录加载失败，重试" : "试卷暂时未能加载，请重试。");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  }, [level, account.authenticated, year, retry]);
  useEffect(() => {
    let live = true;
    setHistory([]); setLegacyHistory([]);
    const refresh = () => {
      if (live) {
        const owner = getLearningStorage().getItem("context-reader:local-account-owner:v1") || "guest";
        const records = readCetActivities().filter(record => record.owner === owner);
        setHistory(records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        const migrated = new Set(records.map((a) => a.sourceAttemptId).filter(Boolean));
        setLegacyHistory(readCetAttempts().filter((a) => !migrated.has(a.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
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
      (p) => !account.authenticated || year === "recent" || String(p.year) === year,
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
  const filteredHistory = history.filter((h) => (!historyPurpose || h.purpose === historyPurpose));
  const filteredLegacy = legacyHistory.filter((h) => (!historyPurpose || (h.mode === "exam" ? "self_test" : "practice") === historyPurpose));
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
                setYear("recent");
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
          <CetSelect label="选择题型" value={type} onChange={value=>setType(value as CetLibraryView["type"])} options={[{key:"cloze",text:"选词填空"},{key:"matching",text:"长篇匹配"},{key:"detail",text:"仔细阅读"}]} />
        )}
        {account.authenticated && (
          <CetSelect label="选择年份" value={year} onChange={value=>{setYear(value);}} options={[{key:"recent",text:"最近年份"}, ...years.map(y=>({key:String(y),text:String(y)}))]} />
        )}
      </div>
      <div
        className={`cet-library-layout ${!account.authenticated || compact || !history.length && !legacyHistory.length ? "cet-library-wide" : ""}`}
      >
        <div className="cet-resource-grid">
          {loading && !visible.length ? (
            <p role="status">正在读取试卷…</p>
          ) : error && !visible.length ? (
            <p role="alert">
              {error}
              <button onClick={() => setRetry((n) => n + 1)}>重试</button>
            </p>
          ) : !visible.length ? <p className="cet-empty">当前筛选没有阅读材料。<button onClick={()=>{setYear("recent");}}>重置筛选</button></p> : (
            visible.map(({ paper: p, section: s }) => (
              <button
                className="cet-resource-row"
                key={s?.id || p.id}
                onClick={() => onOpen({ paperId: p.id, sectionId: s?.id })}
              >
                <span className="cet-cover" data-tone={Array.from(p.id).reduce((n,c)=>n+c.charCodeAt(0),0)%5} aria-hidden="true">
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
          {visible.length > 0 && <div className="cet-catalogue-status" role={error ? "alert" : "status"}>{error ? <>{error}<button onClick={()=>setRetry(n=>n+1)}>重试</button></> : loading ? "正在读取后续目录…" : `已显示本筛选全部 ${visible.length} ${view === "paper" ? "套" : "篇"}`}<span className="sr-only">已取得 {papers.length}/{total} 套目录</span></div>}
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
            <CetSelect label="练习历史目标" value={historyPurpose} onChange={value=>{setHistoryPurpose(value as typeof historyPurpose);setHistoryLimit(30);}} options={[{key:"",text:"练习与自测"},{key:"practice",text:"阅读练习"},{key:"self_test",text:"自测"}]} />
            <div
              className="cet-recent-list"
              tabIndex={0}
              aria-label="最近练习，可滚动"
            >
              {filteredHistory.length || filteredLegacy.length ? (
                filteredHistory.slice(0, historyLimit).map((h) => (
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
                      {h.sectionId ? "单篇" : "整卷"} · {h.purpose === "practice" ? "阅读练习" : `自测 · ${h.timerMode === "countup" ? "正计时" : "倒计时"}`}
                    </small>
                    <strong>{h.title}</strong>
                    <span>
                      {cetHistoryLabel(h)} · {Object.values(h.answers).filter((answer) => answer.value).length} 题 · {new Date(h.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                  </button>
                ))
              ) : (
                <p>开始练习后，进度会保存在这里。</p>
              )}
              {filteredLegacy.slice(0, Math.max(0, historyLimit - filteredHistory.length)).map((h) => <button key={`legacy-${h.id}`} onClick={() => onOpen({ paperId: h.paperId, sectionId: h.sectionId, attemptId: h.id })}><small>{h.sectionId ? "单篇" : "整卷"} · 旧版{Object.values(h.answers).some(Boolean) || h.finishedAt ? "记录" : "空白记录"}</small><strong>{h.title}</strong><span>{h.finishedAt ? "回看旧答卷" : "继续旧进度"} · {Object.values(h.answers).filter(Boolean).length} 题</span></button>)}
              {filteredHistory.length + filteredLegacy.length > historyLimit && (
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
