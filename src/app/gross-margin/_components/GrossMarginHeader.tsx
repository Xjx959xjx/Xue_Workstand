import { Calculator, RefreshCw } from "lucide-react";
import type { GrossMarginWorkbenchController } from "../_hooks/useGrossMarginWorkbench";

type GrossMarginHeaderProps = Pick<
  GrossMarginWorkbenchController,
  "busy" | "configuredPriceCount" | "handleRefresh" | "library"
>;

export function GrossMarginHeader({
  busy,
  configuredPriceCount,
  handleRefresh,
  library
}: GrossMarginHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-title-group">
        <span className="page-title-eyebrow">维护配置台</span>
        <div className="page-title-row">
          <span className="page-title-mark" aria-hidden="true">
            <Calculator size={20} strokeWidth={2.1} />
          </span>
          <div className="page-title-copy">
            <h1>数据维护</h1>
            <p className="subtle">单价、数量、毛利。</p>
            {library?.accountSourceWarning ? <p className="field-hint warning">{library.accountSourceWarning}</p> : null}
          </div>
        </div>
      </div>
      <div className="page-header-meta">
        <span className="stat-pill">2 个平台</span>
        <span className="stat-pill">{configuredPriceCount} 个单价已填</span>
        <span className="stat-pill">
          账号源：{library?.accountSource === "wecom" ? "企业微信在线表" : "本地缓存"}
          {library?.accountSourceRefreshing ? " · 后台同步中" : ""}
        </span>
        <button className="btn ghost" disabled={busy === "refresh"} onClick={() => void handleRefresh()} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          {busy === "refresh" ? "刷新中" : "刷新"}
        </button>
      </div>
    </header>
  );
}
