"use client";

import { GrossMarginBulkMonitorModal } from "./_components/GrossMarginBulkMonitorModal";
import { GrossMarginHeader } from "./_components/GrossMarginHeader";
import { GrossMarginImportModal } from "./_components/GrossMarginImportModal";
import { GrossMarginMaintenancePane } from "./_components/GrossMarginMaintenancePane";
import { GrossMarginPricePane } from "./_components/GrossMarginPricePane";
import { GrossMarginPriceTableEditorModal } from "./_components/GrossMarginPriceTableEditorModal";
import { GrossMarginResultPane } from "./_components/GrossMarginResultPane";
import { GrossMarginTemplateModal } from "./_components/GrossMarginTemplateModal";
import { useGrossMarginWorkbench } from "./_hooks/useGrossMarginWorkbench";
import { formatMoney, formatPercent, formatPlatform, PLATFORM_OPTIONS } from "./_lib/gross-margin-workbench-model";

export default function GrossMarginPage() {
  const controller = useGrossMarginWorkbench();

  return (
    <div className="page gross-margin-page" data-unsaved-changes={controller.priceDirty ? "true" : undefined}>
      <GrossMarginHeader {...controller} />

      <section className="gross-margin-workspace" aria-label="数据维护工作区">
        <div className="gross-margin-main">
          <div className="gross-platform-switch" role="group" aria-label="本次维护平台">
            <span>选择平台</span>
            <div className="source-tabs gross-platform-tabs">
              {PLATFORM_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={controller.platform === option.value} className={controller.platform === option.value ? "active" : ""} onClick={() => controller.handlePlatformChange(option.value)}>{option.label}</button>)}
            </div>
          </div>
          <div className="gross-margin-metrics" aria-label="当前测算概览">
            <div><span>折前价格</span><strong>{formatMoney(controller.calculation.originalPrice)}</strong></div>
            <div><span>维护成本</span><strong>{formatMoney(controller.calculation.maintenanceCost)}</strong></div>
            <div><span>当前毛利率</span><strong>{formatPercent(controller.calculation.grossMarginRate)}</strong></div>
          </div>
          <details className="gross-price-disclosure"><summary><span>平台单价表</span><small>查看与编辑默认单价</small></summary><GrossMarginPricePane {...controller} /></details>
          <GrossMarginMaintenancePane {...controller} />
        </div>
        <GrossMarginResultPane {...controller} />
      </section>

      {controller.importModalOpen ? (
        <GrossMarginImportModal
          initialPlatform={controller.platform}
          onClose={controller.closeImportModal}
          onImport={controller.handleImportTemplate}
        />
      ) : null}
      {controller.templateModalOpen ? (
        <GrossMarginTemplateModal
          busy={controller.busy === "template"}
          platformLabel={formatPlatform(controller.platform)}
          previewValues={controller.reviewTemplateValues}
          template={controller.reviewTemplate}
          onClose={controller.closeTemplateModal}
          onSave={controller.handleSaveReviewTemplate}
          onReset={controller.handleResetReviewTemplate}
        />
      ) : null}
      {controller.priceEditorOpen && controller.table ? (
        <GrossMarginPriceTableEditorModal
          busy={controller.busy === "price-editor"}
          platformLabel={formatPlatform(controller.table.platform)}
          table={controller.table}
          onClose={controller.closePriceEditor}
          onSave={controller.handleSaveFullPriceTable}
        />
      ) : null}
      {controller.bulkMonitorModalOpen ? (
        <GrossMarginBulkMonitorModal
          busy={controller.busy === "bulk-monitor"}
          onClose={controller.closeBulkMonitorModal}
          onSubmit={controller.handleBulkMonitorSubmit}
        />
      ) : null}
    </div>
  );
}
