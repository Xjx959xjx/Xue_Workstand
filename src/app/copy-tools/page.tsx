"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckSquare,
  ClipboardList,
  FolderPlus,
  LinkIcon,
  RefreshCw,
  Square,
  Trash2
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import {
  createProjectFromCopySources,
  deleteCopySources,
  transcribeCopySource
} from "@/lib/client";
import { CopySource } from "@/lib/types";

type LinkJob = {
  url: string;
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
  source?: CopySource;
};

export default function CopyToolsPage() {
  const { library, loading, error, refresh } = useLibrary();
  const [linksInput, setLinksInput] = useState("");
  const [jobs, setJobs] = useState<LinkJob[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const copySources = useMemo(() => library?.copySources || [], [library?.copySources]);
  const selectedSources = useMemo(
    () => copySources.filter((source) => selectedSourceIds.includes(source.id)),
    [copySources, selectedSourceIds]
  );
  const canTranscribe = Boolean(parseLinks(linksInput).length && !busy);
  const canCreateProject = Boolean(projectName.trim() && selectedSourceIds.length && busy !== "project");
  const messageIsError = message.includes("失败") || message.includes("错误") || message.includes("没有");

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    );
  }

  function toggleAllSources() {
    if (selectedSourceIds.length === copySources.length) {
      setSelectedSourceIds([]);
      return;
    }
    setSelectedSourceIds(copySources.map((source) => source.id));
  }

  async function handleTranscribeLinks() {
    const links = parseLinks(linksInput);
    if (!links.length) return;
    setBusy("transcribe");
    setMessage("");
    setJobs(links.map((url) => ({ url, status: "queued" })));

    let completed = 0;
    let failed = 0;
    const createdIds: string[] = [];

    try {
      for (const url of links) {
        setJobs((current) =>
          current.map((job) =>
            job.url === url ? { ...job, status: "running", message: "正在解析链接和转写音频" } : job
          )
        );
        try {
          const result = await transcribeCopySource({ url });
          completed += 1;
          createdIds.push(result.source.id);
          setJobs((current) =>
            current.map((job) =>
              job.url === url
                ? { ...job, status: "completed", message: "已保存", source: result.source }
                : job
            )
          );
        } catch (err) {
          failed += 1;
          setJobs((current) =>
            current.map((job) =>
              job.url === url
                ? {
                    ...job,
                    status: "failed",
                    message: err instanceof Error ? err.message : "链接转写失败"
                  }
                : job
            )
          );
        }
      }

      setSelectedSourceIds((current) => [...new Set([...createdIds, ...current])]);
      setLinksInput("");
      setMessage(`已完成 ${completed} 条链接转写${failed ? `，${failed} 条失败` : ""}。`);
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function handleCreateProject() {
    if (!canCreateProject) return;
    setBusy("project");
    setMessage("");
    try {
      const result = await createProjectFromCopySources({
        name: projectName,
        description: projectDescription,
        sourceMaterialIds: selectedSourceIds
      });
      setMessage(`项目「${result.project.name}」已创建，已关联 ${result.project.sourceMaterialCount} 份文案素材。`);
      setProjectName("");
      setProjectDescription("");
      setSelectedSourceIds([]);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "创建项目失败");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteSelected() {
    if (!selectedSourceIds.length) return;
    setBusy("delete");
    setMessage("");
    try {
      const result = await deleteCopySources(selectedSourceIds);
      setSelectedSourceIds([]);
      setDeleteConfirmOpen(false);
      setMessage(`已删除 ${result.deleted.length} 份文案素材。`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除文案素材失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page copy-tools-page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Copy Tools</p>
          <h1>文案工具</h1>
          <p className="subtle">粘贴 B站或抖音链接自动转写，沉淀成独立文案素材，再批量归入项目。</p>
        </div>
        <div className="button-row">
          <button className="btn" disabled={loading} onClick={refresh} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            {loading ? "读取中" : "刷新"}
          </button>
        </div>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? (
        <div aria-live={messageIsError ? "assertive" : "polite"} className={messageIsError ? "error" : "notice"} role={messageIsError ? "alert" : "status"}>
          {message}
        </div>
      ) : null}

      <section className="panel copy-tool-grid">
        <div className="copy-transcribe-pane">
          <div className="pane-header">
            <div>
              <h2>链接转写</h2>
              <p className="pane-subtitle">每行一个链接，会自动识别 B站 / 抖音。</p>
            </div>
            <span className="status-pill pending">不生成风格卡</span>
          </div>
          <div className="pane-body detail-stack">
            <div className="field">
              <label htmlFor="copy-links">视频链接</label>
              <textarea
                autoComplete="off"
                className="copy-links-textarea"
                id="copy-links"
                name="copyLinks"
                value={linksInput}
                onChange={(event) => setLinksInput(event.target.value)}
                placeholder="https://www.bilibili.com/video/BV...\nhttps://www.douyin.com/video/..."
              />
            </div>
            <div className="button-row copy-action-row">
              <span className="subtle">待处理 {parseLinks(linksInput).length} 条</span>
              <button className="btn primary" disabled={!canTranscribe} onClick={handleTranscribeLinks} type="button">
                <LinkIcon aria-hidden="true" size={16} />
                {busy === "transcribe" ? "转写中…" : "开始转写"}
              </button>
            </div>
            {jobs.length ? (
              <div className="copy-job-list" aria-live="polite">
                {jobs.map((job) => (
                  <div className={`copy-job-row ${job.status}`} key={job.url}>
                    <span className={`status-pill ${job.status === "completed" ? "done" : job.status === "failed" ? "failed" : "pending"}`}>
                      {formatJobStatus(job.status)}
                    </span>
                    <span className="copy-job-url">{job.url}</span>
                    <span className="copy-job-message">{job.source?.title || job.message}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="copy-project-pane">
          <div className="pane-header">
            <div>
              <h2>创建项目</h2>
              <p className="pane-subtitle">只保存选中的文案素材，不自动提炼项目风格。</p>
            </div>
            <span className="status-pill done">已选 {selectedSourceIds.length}</span>
          </div>
          <div className="pane-body detail-stack">
            <div className="project-form-grid copy-project-form">
              <div className="field">
                <label htmlFor="copy-project-name">项目名</label>
                <input
                  autoComplete="off"
                  id="copy-project-name"
                  name="copyProjectName"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="例如：竞品口播素材池"
                />
              </div>
              <div className="field">
                <label htmlFor="copy-project-description">项目说明</label>
                <input
                  autoComplete="off"
                  id="copy-project-description"
                  name="copyProjectDescription"
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  placeholder="素材用途、选题方向或写作需求"
                />
              </div>
            </div>
            <div className="copy-selected-preview">
              {selectedSources.length ? (
                selectedSources.slice(0, 4).map((source) => (
                  <span className="stat-pill" key={source.id}>{source.title}</span>
                ))
              ) : (
                <p className="subtle">从下方素材列表里勾选转写文案。</p>
              )}
              {selectedSources.length > 4 ? <span className="stat-pill">+{selectedSources.length - 4}</span> : null}
            </div>
            <div className="button-row copy-action-row">
              <button className="btn danger" disabled={!selectedSourceIds.length || busy === "delete"} onClick={() => setDeleteConfirmOpen(true)} type="button">
                <Trash2 aria-hidden="true" size={16} />
                删除素材
              </button>
              <button className="btn primary" disabled={!canCreateProject} onClick={handleCreateProject} type="button">
                <FolderPlus aria-hidden="true" size={16} />
                {busy === "project" ? "创建中…" : "创建项目"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel copy-source-panel">
        <div className="pane-header">
          <div>
            <h2>文案素材</h2>
            <p className="pane-subtitle">{copySources.length} 份已保存转写，独立于账号风格库。</p>
          </div>
          <button className="btn" disabled={!copySources.length} onClick={toggleAllSources} type="button">
            {selectedSourceIds.length === copySources.length && copySources.length ? (
              <CheckSquare aria-hidden="true" size={16} />
            ) : (
              <Square aria-hidden="true" size={16} />
            )}
            全选
          </button>
        </div>
        <div className="copy-source-list">
          {!copySources.length ? (
            <EmptyState title="还没有文案素材" body="先在上方粘贴视频链接，转写完成后会保存在这里。" />
          ) : null}
          {copySources.map((source) => {
            const selected = selectedSourceIds.includes(source.id);
            return (
              <article className={`copy-source-card ${selected ? "selected" : ""}`} key={source.id}>
                <label className="copy-source-check">
                  <input
                    checked={selected}
                    autoComplete="off"
                    name="copySourceIds"
                    onChange={() => toggleSource(source.id)}
                    type="checkbox"
                  />
                  <span aria-hidden="true" className={`check-dot ${selected ? "checked" : ""}`} />
                </label>
                <div className="copy-source-main">
                  <div className="copy-source-title-row">
                    <div>
                      <h3>{source.title}</h3>
                      <p className="subtle">{formatSourceMeta(source)}</p>
                    </div>
                    <div className="copy-source-actions">
                      <span className={`status-pill ${source.status === "completed" ? "done" : "failed"}`}>
                        {source.status === "completed" ? "已转写" : "失败"}
                      </span>
                      {source.projectIds?.length ? <span className="stat-pill">{source.projectIds.length} 个项目</span> : null}
                    </div>
                  </div>
                  <p className="copy-source-text">{source.transcript || source.error || "没有可显示的文稿。"}</p>
                  <div className="copy-source-footer">
                    <a className="text-link" href={source.resolvedUrl || source.url} rel="noreferrer" target="_blank">
                      打开原链接
                    </a>
                    {source.fallbackReason ? <span className="subtle">{source.fallbackReason}</span> : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {library?.projects.some((project) => project.sourceMaterialCount > 0) ? (
        <section className="panel copy-project-list-panel">
          <div className="pane-header">
            <div>
              <h2>文案项目</h2>
              <p className="pane-subtitle">这些项目已关联纯文案素材，可在后续写作台需求里继续接入。</p>
            </div>
            <Link className="btn" href="/projects">
              <ClipboardList aria-hidden="true" size={16} />
              查看项目库
            </Link>
          </div>
          <div className="copy-project-list">
            {library.projects
              .filter((project) => project.sourceMaterialCount > 0)
              .map((project) => (
                <Link className="copy-project-row" href="/projects" key={project.id}>
                  <strong>{project.name}</strong>
                  <span>{project.sourceMaterialCount} 份文案素材</span>
                </Link>
              ))}
          </div>
        </section>
      ) : null}

      {deleteConfirmOpen ? (
        <ConfirmDialog
          body={`会删除 ${selectedSourceIds.length} 份文案素材，并从已关联项目中移除引用。`}
          busy={busy === "delete"}
          confirmLabel="删除素材"
          title="确认删除文案素材？"
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={handleDeleteSelected}
        />
      ) : null}
    </div>
  );
}

function parseLinks(input: string) {
  return [
    ...new Set(
      input
        .split(/[\s\n\r]+/)
        .map((value) => value.trim())
        .filter((value) => /^https?:\/\//i.test(value))
    )
  ];
}

function formatJobStatus(status: LinkJob["status"]) {
  if (status === "queued") return "排队";
  if (status === "running") return "转写中";
  if (status === "completed") return "完成";
  return "失败";
}

function formatSourceMeta(source: CopySource) {
  const platform = source.platform === "unknown" ? "未知平台" : formatPlatform(source.platform);
  const sourceLabel =
    source.source === "platform_subtitle"
      ? "平台字幕"
      : source.source === "volcengine"
        ? "火山转写"
        : source.source === "metadata"
          ? "标题兜底"
          : "手动";
  return `${platform} · ${sourceLabel} · ${new Date(source.createdAt).toLocaleString("zh-CN")}`;
}
