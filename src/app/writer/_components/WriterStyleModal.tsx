"use client";

import { WriterDialogModal } from "./WriterDialogModal";
import type { WriterStyleCard } from "../_hooks/useWriterReferenceDetails";

type WriterStyleModalProps = {
  activeTitle?: string;
  onClose: () => void;
  styleCards: WriterStyleCard[];
};

export function WriterStyleModal({ activeTitle, onClose, styleCards }: WriterStyleModalProps) {
  return (
    <WriterDialogModal labelledBy="writer-style-dialog-title" onClose={onClose}>
      <div className="modal-header">
        <h2 id="writer-style-dialog-title">{activeTitle || "风格卡"}</h2>
        <button className="btn" onClick={onClose} type="button">
          关闭
        </button>
      </div>
      <div className="modal-content writer-style-card-list">
        {styleCards.length ? styleCards.map((card, index) => (
          <section className="writer-style-card" key={card.key}>
            <header>
              <span>{styleCards.length > 1 ? `独立稿 ${index + 1}` : "当前风格"}</span>
              <div>
                <h3>{card.title}</h3>
                <p>{card.subtitle}</p>
              </div>
            </header>
            <div className="markdown-box">{card.style || "暂无风格卡"}</div>
          </section>
        )) : <div className="markdown-box">暂无风格卡</div>}
      </div>
    </WriterDialogModal>
  );
}
