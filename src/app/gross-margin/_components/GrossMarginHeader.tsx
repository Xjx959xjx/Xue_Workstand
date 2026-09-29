import { RefreshCw, Upload } from "lucide-react";
import type { GrossMarginWorkbenchController } from "../_hooks/useGrossMarginWorkbench";

type GrossMarginHeaderProps = Pick<
  GrossMarginWorkbenchController,
  "busy" | "configuredPriceCount" | "handleRefresh" | "library" | "openImportModal"
>;

export function GrossMarginHeader({
  busy,
  configuredPriceCount,
  handleRefresh,
  library,
  openImportModal
}: GrossMarginHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-title-group">
        <span className="page-title-eyebrow">ANALYTICS / 01</span>
        <div className="page-title-copy">
          <h1>让每一项数据都清晰</h1>
          <p className="subtle">输入、核对与计算，在一个工作区完成。</p>
          {library?.accountSourceWarning ? <p className="field-hint warning">{library.accountSourceWarning}</p> : null}
        </div>
      </div>
      <div className="page-header-meta">
        <span className="gross-source-meta">{configuredPriceCount} 个单价已填 · 账号源：{library?.accountSource === "wecom" ? "企业微信在线表" : "本地缓存"}{library?.accountSourceRefreshing ? " · 后台同步中" : ""}</span>
        <button className="btn ghost" disabled={busy === "refresh"} onClick={() => void handleRefresh()} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          {busy === "refresh" ? "刷新中" : "刷新"}
        </button>
        <button className="btn primary" onClick={openImportModal} type="button"><Upload aria-hidden="true" size={16} />导入模板</button>
      </div>
    </header>
  );
}
