"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountProvider } from "./AccountProvider";
import { StudyHost } from "./StudyHost";
import { PwaRegistration } from "./PwaRegistration";
export function AppProviders({children}:{children:ReactNode}) {
  const path=usePathname();
  if(path.startsWith("/admin/experience")||path.startsWith("/admin/ui-studio"))return <>{children}</>;
  return <><AccountProvider>{children}<StudyHost/></AccountProvider><PwaRegistration/></>;
}
