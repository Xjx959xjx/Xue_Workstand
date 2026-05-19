"use client";

import { ExternalLink } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";

type DraftFeishuModalProps = {
  result: {
    title: string;
    url: string;
  };
  onClose: () => void;
};

export function DraftFeishuModal({ result, onClose }: DraftFeishuModalProps) {
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (isBackdropEvent(event)) onClose();
      }}
    >
      <div aria-labelledby="draft-feishu-dialog-title" aria-modal="true" className="modal-panel feishu-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <h2 id="draft-feishu-dialog-title">飞书文档已创建</h2>
          <button className="btn" onClick={onClose} type="button">
            关闭
          </button>
        </div>
        <div className="feishu-success-card">
          <p>{result.title}</p>
          <a className="btn primary" href={result.url} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={16} />
            打开飞书文档
          </a>
        </div>
      </div>
    </div>
  );
}
