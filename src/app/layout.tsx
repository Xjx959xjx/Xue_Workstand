import type { Metadata } from "next";
import { AppProviders } from "@/components/AppProviders";
import { AppNav } from "@/components/AppNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "账号风格库",
  description: "本地账号风格库与文案工作台",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <div className="app-shell">
          <AppNav />
          <main className="main-content" id="main-content">
            <AppProviders>{children}</AppProviders>
          </main>
        </div>
      </body>
    </html>
  );
}
