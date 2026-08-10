import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/components/AppProviders";
import { AppModeGuard } from "@/components/AppModeGuard";
import { AppNav } from "@/components/AppNav";
import { MobileAppChrome } from "@/components/MobileAppChrome";
import { getAppMode } from "@/lib/app-mode";
import "./globals.css";

export function generateMetadata(): Metadata {
  const appMode = getAppMode();
  return {
    title: appMode === "gross-margin" ? "数据维护监控" : "账号风格库",
    description: appMode === "gross-margin" ? "本地数据维护与监控工作台" : "本地账号风格库与文案工作台",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: appMode === "gross-margin" ? "数据维护" : "风格库"
    },
    icons: {
      icon: "/favicon.svg"
    }
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f2f4f7"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appMode = getAppMode();
  const buildId = process.env.APP_BUILD_ID || "dev-0.1.0";

  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <AppProviders appMode={appMode} buildId={buildId}>
          <AppModeGuard appMode={appMode} />
          <div className="app-shell">
            <AppNav appMode={appMode} />
            <MobileAppChrome appMode={appMode} />
            <main className="main-content" id="main-content">
              {children}
            </main>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
