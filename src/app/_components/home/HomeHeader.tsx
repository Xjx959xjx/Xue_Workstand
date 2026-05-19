"use client";

import { RefreshCw } from "lucide-react";

type HomeHeaderProps = {
  loading: boolean;
  onRefresh: () => Promise<void>;
};

export function HomeHeader({ loading, onRefresh }: HomeHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">Local Workbench</p>
        <h1 className="title-with-emoji">
          <span aria-hidden="true" className="title-emoji">
            🧭
          </span>
          <span>工作台总览</span>
        </h1>
        <p className="subtle">采集、转写、风格沉淀和写作都在本地流转，结果会落到 style-library。</p>
      </div>
      <div className="button-row">
        <button className="btn" disabled={loading} onClick={onRefresh} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          {loading ? "正在读取" : "刷新数据"}
        </button>
      </div>
    </header>
  );
}
