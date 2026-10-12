"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { AccountSessionState } from "@/types/account";
import { installExperiencePreview } from "@/lib/experiencePreview";
import { StudyHost } from "./StudyHost";
import { AccountProvider } from "./AccountProvider";
import { LoadingStatus } from "./LoadingStatus";
export function ExperiencePreview({account,children}:{account:AccountSessionState;children:ReactNode}) {
  const [ready,setReady]=useState(false);
  useEffect(()=>{const restore=installExperiencePreview(account);setReady(true);return restore;},[account]);
  return ready?<AccountProvider>{children}<StudyHost/></AccountProvider>:<LoadingStatus>正在准备体验预览…</LoadingStatus>;
}
