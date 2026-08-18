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
import { formatPlatform } from "./_lib/gross-margin-workbench-model";

export default function GrossMarginPage() {
  const controller = useGrossMarginWorkbench();

  return (
    <div className="page gross-margin-page">
      <GrossMarginHeader {...controller} />

      <section className="panel three-pane gross-margin-workspace" aria-label="数据维护工作区">
        <GrossMarginPricePane {...controller} />
        <GrossMarginMaintenancePane {...controller} />
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
