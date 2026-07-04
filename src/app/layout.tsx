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
  title: "おたよりカレンダー - プリントを撮るだけ！AIが予定を自動登録",
  description: "保護者必須アプリ。園・学校のおたよりを撮影するだけでAIが解析し、家族カレンダーに自動登録。Googleカレンダー・iPhoneカレンダーとも常時同期。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "おたよりカレンダー",
  },
  openGraph: {
    title: "おたよりカレンダー - プリントを撮るだけ！AIが予定を自動登録",
    description: "保護者必須アプリ。園・学校のおたよりを撮影するだけでAIが解析し、家族カレンダーに自動登録。Googleカレンダー・iPhoneカレンダーとも常時同期。",
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
    title: "おたよりカレンダー - プリントを撮るだけ！AIが予定を自動登録",
    description: "保護者必須アプリ。園・学校のおたよりを撮影するだけでAIが自動でカレンダー登録。家族全員と共有できます。",
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
