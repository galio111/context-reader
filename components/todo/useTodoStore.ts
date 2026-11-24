"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {Snapshot, TodoData} from "./planner-model";

export type Change = (current: TodoData) => TodoData;
export function useTodoStore() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const current = useRef<Snapshot | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const active = useRef(true);
  const expiry = useRef(false);
  const accept = useCallback((value: Snapshot) => {
    if (active.current && !expiry.current && (!current.current || value.revision >= current.current.revision)) {
      current.current = value;
      setSnapshot(value);
    }
  }, []);
  const check = useCallback((response: Response) => {
    if (response.status === 401 || response.status === 403) {
      expiry.current = true;
      current.current = null;
      setSnapshot(null);
      throw Error("登录状态已改变。请重新打开私人待办。");
    }
    if (!response.ok) throw Error("暂时无法连接待办服务，请稍后重试。");
  }, []);
  const read = useCallback(async () => {
    const response = await fetch("/api/todo", {cache: "no-store"});
    check(response);
    const data: Snapshot = await response.json();
    accept(data);
    return data;
  }, [accept, check]);
  const refresh = useCallback(async () => {
    try {await read(); if (active.current) setError("")}
    catch (e) {if (active.current) setError(e instanceof TypeError ? "网络暂时不可用，待办还保存在服务器。" : (e as Error).message)}
  }, [read]);
  useEffect(() => {
    active.current = true;
    void refresh();
    const visible = () => {if (document.visibilityState === "visible") void refresh()};
    const restored = (e: PageTransitionEvent) => {if (e.persisted) location.reload()};
    const timer = window.setInterval(visible, 60000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", restored);
    return () => {active.current = false; clearInterval(timer); document.removeEventListener("visibilitychange",visible); window.removeEventListener("pageshow",restored)};
  }, [refresh]);
  const mutate = useCallback((change: Change) => {
    const run = async () => {
      if (!current.current || expiry.current) throw Error("请重新打开私人待办。");
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = current.current;
        if (!before) throw Error("请重新打开私人待办。");
        const state = change(before.state);
        if (state === before.state) return;
        const response = await fetch("/api/todo", {method:"PUT", cache:"no-store", headers:{"Content-Type":"application/json"}, body:JSON.stringify({revision:before.revision,state})});
        if (response.status === 409) { await read(); continue }
        if (response.status === 400 || response.status === 413) throw Error("保存失败，请检查任务内容、收件邮箱和设置值。");
        check(response);
        accept(await response.json());
        setError("");
        return;
      }
      throw Error("另一个设备刚刚更新了清单，请重试本次修改。");
    };
    const result = queue.current.then(run,run).catch(e => {
      throw e instanceof TypeError ? Error("网络暂时不可用，请在恢复连接后重试。") : e;
    });
    queue.current = result.catch(() => {});
    return result;
  }, [read, check, accept]);
  return {snapshot, current, error, refresh, mutate};
}
