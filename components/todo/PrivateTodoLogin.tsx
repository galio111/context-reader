"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

export function PrivateTodoLogin({ access }: { access: "guest" | "denied" | "unavailable" }) {
  const [message, setMessage] = useState(access === "denied" ? "当前账号没有访问权限，请登录站主账号。" :
    access === "unavailable" ? "暂时无法核实访问权限，请稍后重试。" : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (access !== "guest") return;
    const controller = new AbortController();
    // HEAD can renew an expired access cookie, including on a direct bookmark visit.
    fetch("/api/todo", { method: "HEAD", cache: "no-store", signal: controller.signal })
      .then(r => { if (r.status === 204) location.replace("/todo"); })
      .catch(() => {});
    return () => controller.abort();
  }, [access]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/auth/phone-login", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: data.get("phone"), pin: data.get("pin") }),
      });
      if (!result.ok) {
        setMessage(result.status === 429 ? "登录尝试过于频繁，请稍后再试。" : "登录失败，请检查手机号和密码。");
        return;
      }
      const check = await fetch("/api/todo", { method: "HEAD", cache: "no-store" });
      if (check.status === 204) location.replace("/todo");
      else setMessage(check.status === 403 ? "此账号没有私人待办权限。" : "暂时无法核实访问权限，请重试。");
    } catch {
      setMessage("网络连接失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto mt-20 w-full max-w-md px-5 text-slate-900">
      <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm text-slate-600">Context Reader</p><h1 className="mt-2 text-3xl font-semibold">私人待办</h1>
        <p className="my-4 text-sm text-slate-600">用站主账号的手机号和密码打开清单。</p>
        <form onSubmit={login} className="grid gap-4">
          <label className="grid gap-1 text-sm">手机号<input className="rounded-lg border border-slate-300 p-3" name="phone" type="tel" autoComplete="username" required /></label>
          <label className="grid gap-1 text-sm">密码<input className="rounded-lg border border-slate-300 p-3" name="pin" type="password" autoComplete="current-password" required /></label>
          <button type="submit" disabled={busy} className="rounded-lg bg-slate-800 px-4 py-3 font-medium text-white">{busy ? "正在登录…" : "登录并打开待办"}</button>
        </form>
        {message && <p role="status" className="mt-4 text-sm text-slate-700">{message}</p>}
        <Link href="/" prefetch={false} className="mt-5 inline-block text-sm underline">返回网站</Link>
      </section>
    </main>
  );
}
