import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.setAttribute('data-context-theme','day');document.documentElement.style.colorScheme='light';" }} />
      {children}
    </>
  );
}
