import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/components/AppProviders";
import "./globals.css";
import {publishedDesignState} from '@/lib/uiDesignPublished';
import {compileUiDesign} from '@/lib/uiDesignRuntime';
import {UiDesignPublicRuntime} from '@/components/UiDesignPublicRuntime';

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
export const dynamic='force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const published=await publishedDesignState(),design=published.recipe;
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <style data-ui-design="initial">{compileUiDesign(design)}</style>
        <script
          dangerouslySetInnerHTML={{
            __html: "try{const p=JSON.parse(localStorage.getItem('context-reader-home-ui-v1')||'null');if(p?.theme==='night'){document.documentElement.dataset.contextTheme='night';document.documentElement.style.colorScheme='dark'}}catch{}",
          }}
        />
      </head>
      <body>
        <UiDesignPublicRuntime initial={design} initialRevision={published.revision}/>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
