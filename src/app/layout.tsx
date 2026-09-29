import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/components/AppProviders";
import { AppModeGuard } from "@/components/AppModeGuard";
import { AppNav } from "@/components/AppNav";
import { MobileAppChrome } from "@/components/MobileAppChrome";
import { UnsavedNavigationGuard } from "@/components/UnsavedChangesGuard";
import { getAppMode } from "@/lib/app-mode";
import "./globals.css";

const skinBootstrapScript = `
  try {
    if (window.localStorage.getItem("content-workbench-skin") === "shinigami") {
      document.documentElement.dataset.skin = "shinigami";
    }
  } catch (_) {
    // 本地偏好不可用时继续使用默认皮肤。
  }
`;

export function generateMetadata(): Metadata {
  const appMode = getAppMode();
  return {
    title: appMode === "gross-margin" ? "数据维护监控" : "内容工作台",
    description: appMode === "gross-margin" ? "本地数据维护与监控工作台" : "发现灵感、整理资料与创作内容",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: appMode === "gross-margin" ? "数据维护" : "内容工作台"
    },
    icons: {
      icon: "/favicon.svg",
      apple: "/apple-icon"
    }
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f6f5"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appMode = getAppMode();
  const buildId = process.env.APP_BUILD_ID || "dev-0.1.0";

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: skinBootstrapScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <AppProviders appMode={appMode} buildId={buildId}>
          <UnsavedNavigationGuard />
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
