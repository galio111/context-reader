"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountProvider } from "./AccountProvider";
import { StudyHost } from "./StudyHost";
import { PwaRegistration } from "./PwaRegistration";
import { FocusModality } from "./FocusModality";
export function AppProviders({children}:{children:ReactNode}) {
  const path=usePathname();
  if(path.startsWith("/admin/experience")||path.startsWith("/admin/ui-studio"))return <><FocusModality/>{children}</>;
  return <><FocusModality/><AccountProvider>{children}<StudyHost/></AccountProvider><PwaRegistration/></>;
}
