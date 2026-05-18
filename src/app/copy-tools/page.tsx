"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import {
  CheckSquare,
  ClipboardList,
  FileText,
  FolderPlus,
  LinkIcon,
  RefreshCw,
  Square,
  Trash2
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import {
  createProjectFromCopySources,
  deleteCopySources,
  transcribeCopySource
} from "@/lib/client";
import { extractSourceUrls } from "@/lib/source-extraction";
import { CopySource } from "@/lib/types";

type LinkJob = {
  url: string;
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
  source?: CopySource;
};

const COPY_SOURCE_PAGE_SIZE = 25;
type CopySourcePlatformFilter = "all" | CopySource["platform"];
type CopySourceStatusFilter = "all" | CopySource["status"];
type CopySourceProjectFilter = "all" | "linked" | "unlinked";

export default function CopyToolsPage() {
  const { library, loading, error, refresh } = useLibrary();
  const { notify } = useFeedback();
  const [linksInput, setLinksInput] = useState("");
  const [jobs, setJobs] = useState<LinkJob[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourcePlatformFilter, setSourcePlatformFilter] = useState<CopySourcePlatformFilter>("all");
  const [sourceStatusFilter, setSourceStatusFilter] = useState<CopySourceStatusFilter>("all");
  const [sourceProjectFilter, setSourceProjectFilter] = useState<CopySourceProjectFilter>("all");
  const [sourcePage, setSourcePage] = useState(1);
  const [previewSourceId, setPreviewSourceId] = useState("");

  const copySources = useMemo(() => library?.copySources || [], [library?.copySources]);
  const filteredCopySources = useMemo(() => {
    const keyword = sourceSearch.trim().toLowerCase();
    return copySources.filter((source) => {
      const matchesKeyword = keyword
        ? `${source.title} ${source.transcript} ${source.error || ""} ${source.url}`.toLowerCase().includes(keyword)
        : true;
      const matchesPlatform = sourcePlatformFilter === "all" || source.platform === sourcePlatformFilter;
      const matchesStatus = sourceStatusFilter === "all" || source.status === sourceStatusFilter;
      const hasProject = Boolean(source.projectIds?.length);
      const matchesProject =
        sourceProjectFilter === "all" ||
        (sourceProjectFilter === "linked" ? hasProject : !hasProject);
      return matchesKeyword && matchesPlatform && matchesStatus && matchesProject;
    });
  }, [copySources, sourcePlatformFilter, sourceProjectFilter, sourceSearch, sourceStatusFilter]);
  const sourcePageCount = Math.max(1, Math.ceil(filteredCopySources.length / COPY_SOURCE_PAGE_SIZE));
  const normalizedSourcePage = Math.min(sourcePage, sourcePageCount);
  const pagedCopySources = useMemo(() => {
    const start = (normalizedSourcePage - 1) * COPY_SOURCE_PAGE_SIZE;
    return filteredCopySources.slice(start, start + COPY_SOURCE_PAGE_SIZE);
  }, [filteredCopySources, normalizedSourcePage]);
  const selectedSources = useMemo(
    () => copySources.filter((source) => selectedSourceIds.includes(source.id)),
    [copySources, selectedSourceIds]
  );
  const previewSource = useMemo(
    () => copySources.find((source) => source.id === previewSourceId),
    [copySources, previewSourceId]
  );
  const pagedSourceIds = pagedCopySources.map((source) => source.id);
  const allPagedSourcesSelected = Boolean(
    pagedSourceIds.length && pagedSourceIds.every((sourceId) => selectedSourceIds.includes(sourceId))
  );
  const sourcePageStart = filteredCopySources.length
    ? (normalizedSourcePage - 1) * COPY_SOURCE_PAGE_SIZE + 1
    : 0;
  const sourcePageEnd = Math.min(normalizedSourcePage * COPY_SOURCE_PAGE_SIZE, filteredCopySources.length);
  const hasSourceFilters = Boolean(
    sourceSearch.trim() ||
      sourcePlatformFilter !== "all" ||
      sourceStatusFilter !== "all" ||
      sourceProjectFilter !== "all"
  );
  const parsedLinkCount = parseLinks(linksInput).length;
  const canTranscribe = Boolean(parsedLinkCount && !busy);
  const canCreateProject = Boolean(projectName.trim() && selectedSourceIds.length && busy !== "project");
  const messageIsError = message.includes("失败") || message.includes("错误") || message.includes("没有");

  useEffect(() => {
    if (!message) return;
    notify({ tone: messageIsError ? "error" : "success", message });
  }, [message, messageIsError, notify]);

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    );
  }

  useEffect(() => {
    setSourcePage(1);
  }, [sourcePlatformFilter, sourceProjectFilter, sourceSearch, sourceStatusFilter]);

  useEffect(() => {
    if (sourcePage > sourcePageCount) setSourcePage(sourcePageCount);
  }, [sourcePage, sourcePageCount]);

  function toggleAllPagedSources() {
    if (!pagedSourceIds.length) return;
    if (allPagedSourcesSelected) {
      setSelectedSourceIds((current) => current.filter((sourceId) => !pagedSourceIds.includes(sourceId)));
      return;
    }
    setSelectedSourceIds((current) => [...new Set([...current, ...pagedSourceIds])]);
  }

  function clearSourceFilters() {
    setSourceSearch("");
    setSourcePlatformFilter("all");
    setSourceStatusFilter("all");
    setSourceProjectFilter("all");
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
      <section className="panel copy-workflow-panel">
        <div className="copy-workflow-header">
          <div>
            <h2>文案素材处理</h2>
            <p className="pane-subtitle">先转写链接，保存后在下方勾选素材，再归入项目。</p>
          </div>
          <div className="copy-workflow-metrics" aria-label="文案工具状态">
            <span className="stat-pill">待处理 {parsedLinkCount}</span>
            <span className="stat-pill">{copySources.length} 份素材</span>
            <span className="status-pill done">已选 {selectedSourceIds.length}</span>
          </div>
        </div>
        <div className="copy-workflow-body">
          <div className="copy-intake-card">
            <div className="copy-card-heading">
              <div>
                <h3>链接转写</h3>
                <p className="pane-subtitle">每行一个 B站或抖音链接。</p>
              </div>
              <span className="status-pill pending">仅保存文案</span>
            </div>
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
            <div className="copy-card-footer">
              <span className="subtle">识别到 {parsedLinkCount} 条链接</span>
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

          <aside className="copy-project-card">
            <div className="copy-card-heading">
              <div>
                <h3>归入项目</h3>
                <p className="pane-subtitle">使用下方已勾选的文案素材。</p>
              </div>
              <span className="status-pill done">已选 {selectedSourceIds.length}</span>
            </div>
            <div className="copy-project-form">
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
                <p className="subtle">先从下方素材列表勾选。</p>
              )}
              {selectedSources.length > 4 ? <span className="stat-pill">+{selectedSources.length - 4}</span> : null}
            </div>
            <div className="copy-card-footer">
              <button className="btn primary" disabled={!canCreateProject} onClick={handleCreateProject} type="button">
                <FolderPlus aria-hidden="true" size={16} />
                {busy === "project" ? "创建中…" : "创建项目"}
              </button>
            </div>
          </aside>
        </div>
      </section>

      <section className="panel copy-source-panel">
        <div className="pane-header">
          <div>
            <h2>文案素材</h2>
            <p className="pane-subtitle">显示 {sourcePageStart}-{sourcePageEnd} / 共 {filteredCopySources.length} 条，已选 {selectedSourceIds.length} 条。</p>
          </div>
          <div className="copy-source-header-actions">
            <button className="btn danger" disabled={!selectedSourceIds.length || busy === "delete"} onClick={() => setDeleteConfirmOpen(true)} type="button">
              <Trash2 aria-hidden="true" size={16} />
              删除素材
            </button>
            <button className="btn" disabled={!pagedSourceIds.length} onClick={toggleAllPagedSources} type="button">
              {allPagedSourcesSelected ? (
                <CheckSquare aria-hidden="true" size={16} />
              ) : (
                <Square aria-hidden="true" size={16} />
              )}
              全选当前页
            </button>
          </div>
        </div>
        <div className="copy-source-toolbar">
          <label className="field">
            <span>搜索素材</span>
            <input
              autoComplete="off"
              className="copy-source-search"
              value={sourceSearch}
              onChange={(event) => setSourceSearch(event.target.value)}
              placeholder="标题、链接或文稿关键词"
            />
          </label>
          <label className="field">
            <span>平台</span>
            <select value={sourcePlatformFilter} onChange={(event) => setSourcePlatformFilter(event.target.value as CopySourcePlatformFilter)}>
              <option value="all">全部平台</option>
              <option value="bilibili">B站</option>
              <option value="douyin">抖音</option>
              <option value="unknown">未知平台</option>
            </select>
          </label>
          <label className="field">
            <span>状态</span>
            <select value={sourceStatusFilter} onChange={(event) => setSourceStatusFilter(event.target.value as CopySourceStatusFilter)}>
              <option value="all">全部状态</option>
              <option value="completed">已转写</option>
              <option value="failed">失败</option>
            </select>
          </label>
          <label className="field">
            <span>项目</span>
            <select value={sourceProjectFilter} onChange={(event) => setSourceProjectFilter(event.target.value as CopySourceProjectFilter)}>
              <option value="all">全部素材</option>
              <option value="linked">已归入项目</option>
              <option value="unlinked">未归入项目</option>
            </select>
          </label>
          {hasSourceFilters ? (
            <button className="btn" onClick={clearSourceFilters} type="button">
              清空筛选
            </button>
          ) : null}
        </div>
        <div className="copy-source-list">
          {!copySources.length ? (
            <EmptyState title="还没有文案素材" body="先在上方粘贴视频链接，转写完成后会保存在这里。" />
          ) : null}
          {copySources.length && !filteredCopySources.length ? (
            <EmptyState title="没有匹配素材" body="调整关键词或清空筛选后再试。" />
          ) : null}
          {pagedCopySources.map((source) => {
            const selected = selectedSourceIds.includes(source.id);
            const sourceDraftText = source.transcript || source.error || "没有可显示的文稿。";
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
                  </div>
                  <p className="copy-source-text">{sourceDraftText}</p>
                </div>
                <div className="copy-source-actions">
                  <div className="copy-source-status-stack">
                    <span className={`status-pill ${source.status === "completed" ? "done" : "failed"}`}>
                      {source.status === "completed" ? "已转写" : "失败"}
                    </span>
                    {source.projectIds?.length ? <span className="stat-pill">{source.projectIds.length} 个项目</span> : <span className="stat-pill">未归入项目</span>}
                  </div>
                  <div className="copy-source-footer">
                    <button
                      className="btn compact"
                      onClick={() => setPreviewSourceId(source.id)}
                      type="button"
                    >
                      <FileText aria-hidden="true" size={15} />
                      查看稿
                    </button>
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
        {filteredCopySources.length > COPY_SOURCE_PAGE_SIZE ? (
          <div className="copy-source-pagination">
            <span className="subtle">
              第 {normalizedSourcePage} / {sourcePageCount} 页
            </span>
            <div className="button-row">
              <button className="btn" disabled={normalizedSourcePage <= 1} onClick={() => setSourcePage((current) => Math.max(1, current - 1))} type="button">
                上一页
              </button>
              <button className="btn" disabled={normalizedSourcePage >= sourcePageCount} onClick={() => setSourcePage((current) => Math.min(sourcePageCount, current + 1))} type="button">
                下一页
              </button>
            </div>
          </div>
        ) : null}
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

      {previewSource ? (
        <CopySourcePreviewModal source={previewSource} onClose={() => setPreviewSourceId("")} />
      ) : null}
    </div>
  );
}

function parseLinks(input: string) {
  return [...new Set(extractSourceUrls(input))];
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

function CopySourcePreviewModal({ source, onClose }: { source: CopySource; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sourceDraftText = source.transcript || source.error || "没有可显示的文稿。";

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <div
        aria-labelledby="copy-source-preview-title"
        aria-modal="true"
        className="modal-panel copy-source-preview-modal"
        onKeyDown={(event) => handlePreviewDialogKeyDown(event, onClose)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 id="copy-source-preview-title">查看稿</h2>
            <p className="pane-subtitle">{source.title}</p>
          </div>
          <div className="button-row">
            <a className="btn" href={source.resolvedUrl || source.url} rel="noreferrer" target="_blank">
              打开原链接
            </a>
            <button className="btn" onClick={onClose} type="button">
              关闭
            </button>
          </div>
        </div>
        <div className="copy-source-preview-body">
          <div className="stat-row">
            <span className={`status-pill ${source.status === "completed" ? "done" : "failed"}`}>
              {source.status === "completed" ? "已转写" : "失败"}
            </span>
            <span className="stat-pill">{formatSourceMeta(source)}</span>
            {source.projectIds?.length ? <span className="stat-pill">{source.projectIds.length} 个项目</span> : <span className="stat-pill">未归入项目</span>}
          </div>
          {source.fallbackReason ? <p className="subtle">{source.fallbackReason}</p> : null}
          <article className="copy-source-preview-text">{sourceDraftText}</article>
        </div>
      </div>
    </div>
  );
}

function handlePreviewDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );

  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (document.activeElement === event.currentTarget) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
