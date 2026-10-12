import type { Metadata } from "next";
import DialogProvider from "@/components/DialogProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rewiter 리위터 — 핵심만 하이라이트",
  description: "PDF를 올리면 원문은 그대로 두고 핵심 문장과 그림에만 하이라이트를 칩니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&family=Noto+Serif+KR:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
