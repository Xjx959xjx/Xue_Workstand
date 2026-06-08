import type { Metadata } from "next";
import { AppProviders } from "@/components/AppProviders";
import { AppModeGuard } from "@/components/AppModeGuard";
import { AppNav } from "@/components/AppNav";
import { getAppMode } from "@/lib/app-mode";
import "./globals.css";

export function generateMetadata(): Metadata {
  const appMode = getAppMode();
  return {
    title: appMode === "gross-margin" ? "数据维护监控" : "账号风格库",
    description: appMode === "gross-margin" ? "本地数据维护与监控工作台" : "本地账号风格库与文案工作台",
    icons: {
      icon: "/favicon.svg"
    }
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appMode = getAppMode();

  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <AppProviders appMode={appMode}>
          <AppModeGuard appMode={appMode} />
          <div className="app-shell">
            <AppNav appMode={appMode} />
            <main className="main-content" id="main-content">
              {children}
            </main>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
