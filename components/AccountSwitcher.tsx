"use client";
import { useState } from "react";
import { useAccount } from "./AccountProvider";
import { LoadingStatus } from "./LoadingStatus";

export function AccountSwitcher() {
  const { account, savedAccounts, switchAccount, removeAccount, openLogin, isOffline } = useAccount();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  const [full, setFull] = useState(false);
  async function run(id: string, remove: boolean) {
    if (busy) return;
    setBusy(id); setError("");
    try {
      if (remove) { await removeAccount(id); setRemoving(""); setFull(false); setBusy(""); }
      else await switchAccount(id);
    } catch (error) { setError(error instanceof Error ? error.message : "操作未完成，请重试。"); setBusy(""); }
  }
  if (account.localOnly || account.localDirect) return null;
  return <section className="mt-8 border-b border-black/10 pb-6" aria-labelledby="saved-accounts-heading" aria-busy={Boolean(busy)}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="saved-accounts-heading" className="text-lg font-semibold">已登录账号 <span className="ml-1 text-sm font-normal text-[#526370]">{savedAccounts.length} / 3</span></h2>
      <button type="button" disabled={Boolean(busy) || isOffline} onClick={() => {
        setError("");
        if (savedAccounts.length >= 3) { setFull(true); return; }
        openLogin("添加另一个账号，当前账号会保留登录。");
      }} className="min-h-11 rounded-full border border-black/20 px-4 text-sm font-semibold hover:bg-black/5 disabled:opacity-50">添加账号</button>
    </div>
    <ul className="mt-3 divide-y divide-black/10">
      {savedAccounts.map(item => {
        const active = item.userId === account.profile?.userId;
        return <li key={item.userId} className="py-2">
          <div className="flex items-center gap-3">
            <button type="button" disabled={active || Boolean(busy) || isOffline} onClick={() => void run(item.userId, false)} aria-current={active ? "true" : undefined} aria-label={`${active ? "当前账号" : "切换到"} ${item.nickname}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left hover:bg-black/5 disabled:cursor-default">
              <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e3edf4] font-semibold">{item.nickname.slice(0, 1)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{item.nickname}</span><span className="block text-xs text-[#526370]">{item.phone ? item.phone.replace(/^(\d{3})\d{4}/, "$1****") : "已保存登录"}</span></span>
              <span className="shrink-0 text-sm text-[#405d70]">{busy === item.userId ? <LoadingStatus>处理中</LoadingStatus> : active ? "当前" : "切换"}</span>
            </button>
            {!active && <button type="button" disabled={Boolean(busy) || isOffline} className="min-h-11 shrink-0 rounded-full px-3 text-sm text-[#735252] hover:bg-black/5 disabled:opacity-50" onClick={() => setRemoving(removing === item.userId ? "" : item.userId)}>移除</button>}
          </div>
          {removing === item.userId && <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-black/5 px-3 py-3 text-sm"><p className="flex-1">移除此设备上的登录？账号和云端数据会保留。</p><button type="button" disabled={Boolean(busy)} onClick={() => void run(item.userId, true)} className="min-h-11 rounded-full border border-black/20 px-4">移除账号</button><button type="button" disabled={Boolean(busy)} onClick={() => setRemoving("")} className="min-h-11 px-3">取消</button></div>}
        </li>;
      })}
    </ul>
    {full && <p role="status" className="mt-3 text-sm text-[#735252]">已登录三个账号。请先移除一个；若要移除当前账号，请先切换到另一个。</p>}
    {error && <p role="alert" className="mt-3 text-sm text-[#963f3f]">{error}</p>}
  </section>;
}
