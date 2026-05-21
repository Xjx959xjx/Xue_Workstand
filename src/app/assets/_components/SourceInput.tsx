"use client";

type SourceInputProps = {
  value: string;
  onChange: (value: string) => void;
};

export function SourceInput({ value, onChange }: SourceInputProps) {
  return (
    <section className="detail-section engagement-source-panel">
      <label className="field">
        <span>链接或文案</span>
        <textarea
          className="engagement-textarea engagement-source-input"
          placeholder="粘贴视频链接或直接粘贴文案，链接会先转写，文案直接生成。"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="status-summary engagement-source-summary">
        <span>链接先转写</span>
        <span>文案直接生成</span>
      </div>
    </section>
  );
}
