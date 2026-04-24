import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SiteVisitTracker from "./components/SiteVisitTracker";
import KakaoFab from "./components/KakaoFab";
import { DEFAULT_APP_BAR_TITLE, getMetadataBase } from "@/lib/site-branding";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: DEFAULT_APP_BAR_TITLE,
  description: "부교재·모의고사 변형문제 등 교재 맞춤 주문",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    siteName: DEFAULT_APP_BAR_TITLE,
    type: "website",
    locale: "ko_KR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <main className="flex-1">
          <SiteVisitTracker />
          {children}
        </main>
        <KakaoFab />
      </body>
    </html>
  );
}
