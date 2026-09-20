"use client";

import { useMemo, useState } from "react";
import { Plus, Save, X } from "lucide-react";
import { ModalBackdrop } from "@/components/ModalBackdrop";
import type {
  GrossMarginPriceOption,
  GrossMarginPriceTable,
  GrossMarginPriceTableSaveItem,
  GrossMarginServiceKind
} from "@/lib/types";

type DraftPriceOption = {
  id: string;
  service: GrossMarginServiceKind;
  name: string;
  unitPrice: string;
  quantityUnit: string;
  minimumQuantity: string;
  note: string;
  active: boolean;
  updatedAt: string;
  isNew?: boolean;
};

const serviceOptions: Array<{ value: GrossMarginServiceKind; label: string }> = [
  { value: "play", label: "播放" },
  { value: "like", label: "点赞" },
  { value: "favorite", label: "收藏" },
  { value: "share", label: "转发/分享" },
  { value: "comment", label: "评论" },
  { value: "danmaku", label: "弹幕" },
  { value: "douPlus", label: "抖加" },
  { value: "coin", label: "投币" },
  { value: "blueLink", label: "蓝链点击" }
];

export function GrossMarginPriceTableEditorModal({
  busy,
  platformLabel,
  table,
  onClose,
  onSave
}: {
  busy: boolean;
  platformLabel: string;
  table: GrossMarginPriceTable;
  onClose: () => void;
  onSave: (items: GrossMarginPriceTableSaveItem[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<DraftPriceOption[]>(() => table.items.map(makeDraftRow));
  const [error, setError] = useState("");
  const activeCount = useMemo(() => rows.filter((row) => row.active).length, [rows]);
  const inactiveCount = rows.length - activeCount;

  function updateRow(rowId: string, patch: Partial<DraftPriceOption>) {
    setError("");
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setError("");
    setRows((current) => [
      ...current,
      {
        id: createDraftOptionId(table.platform),
        service: "play",
        name: "",
        unitPrice: "",
        quantityUnit: "万",
        minimumQuantity: "",
        note: "",
        active: true,
        updatedAt: new Date().toISOString(),
        isNew: true
      }
    ]);
  }

  function removeDraftRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
  }

  async function submit() {
    try {
      const items = normalizeDraftRows(rows);
      await onSave(items);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "单价表无法保存，请检查输入");
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        aria-labelledby="gross-price-editor-title"
        aria-modal="true"
        className="modal-panel gross-price-editor-modal"
        role="dialog"
        tabIndex={-1}
      >
        <header className="gross-price-editor-header">
          <div>
            <h2 id="gross-price-editor-title">{platformLabel}平台单价表</h2>
            <p className="subtle">
              {activeCount} 个启用，{inactiveCount} 个停用。停用项不会出现在新维护录入里。
            </p>
          </div>
          <button aria-label="关闭平台单价表编辑" className="btn icon-btn icon-only" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="gross-price-editor-toolbar">
          <button className="btn" onClick={addRow} type="button">
            <Plus aria-hidden="true" size={15} />
            新增类型
          </button>
        </div>

        <div className="gross-price-editor-table-wrap">
          <table className="gross-price-editor-table">
            <thead>
              <tr>
                <th>启用</th>
                <th>维护项</th>
                <th>类型名</th>
                <th>单价</th>
                <th>单位</th>
                <th>起量</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className={row.active ? "" : "inactive"} key={row.id}>
                  <td data-label="启用">
                    <label className="gross-price-editor-toggle">
                      <input
                        aria-label={`${row.name || "未命名类型"}是否启用`}
                        checked={row.active}
                        type="checkbox"
                        onChange={(event) => updateRow(row.id, { active: event.target.checked })}
                      />
                    </label>
                  </td>
                  <td data-label="维护项">
                    <select
                      aria-label="维护项"
                      value={row.service}
                      onChange={(event) => updateRow(row.id, { service: event.target.value as GrossMarginServiceKind })}
                    >
                      {serviceOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="类型名">
                    <input
                      aria-label="类型名"
                      value={row.name}
                      onChange={(event) => updateRow(row.id, { name: event.target.value })}
                      placeholder="例如 普通千川"
                    />
                  </td>
                  <td data-label="单价">
                    <input
                      aria-label="单价"
                      inputMode="decimal"
                      min={0}
                      type="number"
                      value={row.unitPrice}
                      onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })}
                      placeholder="0.00"
                    />
                  </td>
                  <td data-label="单位">
                    <input
                      aria-label="数量单位"
                      value={row.quantityUnit}
                      onChange={(event) => updateRow(row.id, { quantityUnit: event.target.value })}
                      placeholder="万/千/个"
                    />
                  </td>
                  <td data-label="起量">
                    <input
                      aria-label="起量"
                      inputMode="decimal"
                      min={0}
                      type="number"
                      value={row.minimumQuantity}
                      onChange={(event) => updateRow(row.id, { minimumQuantity: event.target.value })}
                      placeholder="可不填"
                    />
                  </td>
                  <td data-label="备注">
                    <input
                      aria-label="备注"
                      value={row.note}
                      onChange={(event) => updateRow(row.id, { note: event.target.value })}
                      placeholder="备注"
                    />
                  </td>
                  <td data-label="操作">
                    {row.isNew ? (
                      <button className="btn compact" onClick={() => removeDraftRow(row.id)} type="button">
                        移除草稿
                      </button>
                    ) : (
                      <span className="gross-price-editor-static">停用保留</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error ? (
          <p className="gross-price-editor-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="button-row gross-price-editor-actions">
          <button className="btn" disabled={busy} onClick={onClose} type="button">
            取消
          </button>
          <button aria-busy={busy} className="btn primary" disabled={busy} onClick={() => void submit()} type="button">
            <Save aria-hidden="true" size={15} />
            {busy ? "保存中" : "保存整体编辑"}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}

function makeDraftRow(item: GrossMarginPriceOption): DraftPriceOption {
  return {
    id: item.id,
    service: item.service,
    name: item.name,
    unitPrice: String(item.unitPrice),
    quantityUnit: item.quantityUnit,
    minimumQuantity: item.minimumQuantity ? String(item.minimumQuantity) : "",
    note: item.note || "",
    active: item.active !== false,
    updatedAt: item.updatedAt
  };
}

function normalizeDraftRows(rows: DraftPriceOption[]): GrossMarginPriceTableSaveItem[] {
  return rows.map((row, index) => {
    const name = row.name.trim();
    if (!name) throw new Error(`第 ${index + 1} 行缺少类型名`);
    const quantityUnit = row.quantityUnit.trim();
    if (!quantityUnit) throw new Error(`第 ${index + 1} 行缺少数量单位`);
    const unitPrice = Number(row.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`第 ${index + 1} 行单价格式不正确`);
    const minimumQuantity = row.minimumQuantity.trim() ? Number(row.minimumQuantity) : undefined;
    if (minimumQuantity !== undefined && (!Number.isFinite(minimumQuantity) || minimumQuantity <= 0)) {
      throw new Error(`第 ${index + 1} 行起量必须大于 0`);
    }

    return {
      id: row.id,
      service: row.service,
      name,
      unitPrice,
      quantityUnit,
      minimumQuantity: minimumQuantity ?? null,
      note: row.note.trim() || undefined,
      active: row.active
    };
  });
}

function createDraftOptionId(platform: GrossMarginPriceTable["platform"]) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}`;
  return `${platform}-custom-${suffix}`;
}
