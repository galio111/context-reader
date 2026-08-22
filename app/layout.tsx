import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "@/components/PwaRegistration";
import { AccountProvider } from "@/components/AccountProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Context Reader",
  description: "Read English articles and explain words in context.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "try{const p=JSON.parse(localStorage.getItem('context-reader-home-ui-v1')||'null');if(p?.theme==='night'){document.documentElement.dataset.contextTheme='night';document.documentElement.style.colorScheme='dark'}}catch{}",
          }}
        />
      </head>
      <body>
        <AccountProvider>{children}</AccountProvider>
        <PwaRegistration />
      </body>
    </html>
  );
}
