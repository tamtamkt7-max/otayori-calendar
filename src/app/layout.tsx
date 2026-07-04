import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { GoogleAnalytics } from '@next/third-parties/google';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // ▼ タイトル・説明文 (PM確定仕様 2026-07-04)
  title: "おたよりカレンダー | プリントを撮るだけ自動登録",
  description: "園や学校のプリントをパシャッと撮るだけ！AIが予定や持ち物を自動でカレンダーに登録し、家族で共有できる神アプリです。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "おたよりカレンダー",
  },
  openGraph: {
    title: "おたよりカレンダー | プリントを撮るだけ自動登録",
    description: "園や学校のプリントをパシャッと撮るだけ！AIが予定や持ち物を自動でカレンダーに登録し、家族で共有できる神アプリです。",
    url: "https://otayori-calendar.vercel.app",
    siteName: "おたよりカレンダー",
    images: [
      {
        url: "https://otayori-calendar.vercel.app/api/og",
        width: 1200,
        height: 630,
        alt: "おたよりカレンダー - AIプリントスケジュール管理",
      },
    ],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "おたよりカレンダー | プリントを撮るだけ自動登録",
    description: "園や学校のプリントをパシャッと撮るだけ！AIが予定や持ち物を自動でカレンダーに登録し、家族で共有できる神アプリです。",
    images: ["https://otayori-calendar.vercel.app/api/og"],
  },
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const adsenseClientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const isProd = process.env.NODE_ENV === 'production';

  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {isProd && adsenseClientId && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClientId}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        {gaId && <GoogleAnalytics gaId={gaId} />}
      </body>
    </html>
  );
}
