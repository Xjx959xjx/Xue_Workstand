"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  LinkIcon,
  Plus,
  RefreshCw,
  Save,
  Sparkles
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { saveProjectStyle, transcribeCopySource, upsertProject } from "@/lib/client";
import { extractSourceUrls } from "@/lib/source-extraction";
import { CopySource, ProjectSummary } from "@/lib/types";

type LinkJob = {
  url: string;
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
};

const EMPTY_STYLE = "项目风格卡会保存在这里。先加入案例素材，再总结开头方式、结构节奏、常用话术和仿写禁忌。";

export default function ProjectWorkbenchPage() {
  const { library, loading, error, refresh } = useLibrary();
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [sourceAccountIds, setSourceAccountIds] = useState<string[]>([]);
  const [sourceMaterialIds, setSourceMaterialIds] = useState<string[]>([]);
  const [styleDraft, setStyleDraft] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [jobs, setJobs] = useState<LinkJob[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [styleJobId, setStyleJobId] = useState("");
  const [handledJobIds, setHandledJobIds] = useState<string[]>([]);
  const [pickedInitialProject, setPickedInitialProject] = useState(false);

  const projects = useMemo(() => library?.projects || [], [library?.projects]);
  const accounts = useMemo(() => library?.accounts || [], [library?.accounts]);
  const copySources = useMemo(() => library?.copySources || [], [library?.copySources]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const parsedLinks = useMemo(() => [...new Set(extractSourceUrls(linkInput))], [linkInput]);
  const projectSources = useMemo(
    () => sourceMaterialIds.map((sourceId) => copySources.find((source) => source.id === sourceId)).filter(Boolean) as CopySource[],
    [copySources, sourceMaterialIds]
  );
  const filteredSources = useMemo(() => {
    const keyword = sourceSearch.trim().toLowerCase();
    return copySources.filter((source) => {
      if (!keyword) return true;
      return `${source.title} ${source.url} ${source.transcript}`.toLowerCase().includes(keyword);
    });
  }, [copySources, sourceSearch]);
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => sourceAccountIds.includes(account.id)),
    [accounts, sourceAccountIds]
  );
  const activeStyleJob = useMemo(
    () => [...activeJobs, ...recentJobs].find((job) => job.id === styleJobId || (job.kind === "project-style" && job.inputSummary === projectName)),
    [activeJobs, projectName, recentJobs, styleJobId]
  );
  const canSaveProject = Boolean(projectName.trim()) && busy !== "save";
  const canGenerateStyle = Boolean(projectName.trim() && sourceAccountIds.length) && busy !== "style";
  const hasProjectShell = Boolean(selectedProject || projectName.trim());
  const hasCases = sourceMaterialIds.length > 0;
  const hasStyle = Boolean(styleDraft.trim());
  const writerHref = selectedProject
    ? `/writer?targetType=project&projectId=${encodeURIComponent(selectedProject.id)}`
    : "/writer?targetType=project";

  useEffect(() => {
    if (loading || pickedInitialProject || selectedProjectId || !projects.length) return;
    setPickedInitialProject(true);
    setSelectedProjectId(projects[0].id);
  }, [loading, pickedInitialProject, projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProject && selectedProjectId) return;
    if (selectedProject) {
      setProjectName(selectedProject.name);
      setProjectDescription(selectedProject.description || "");
      setSourceAccountIds(selectedProject.sourceAccountIds);
      setSourceMaterialIds(selectedProject.sourceMaterialIds || []);
      setStyleDraft(selectedProject.style || "");
      return;
    }

    if (!selectedProjectId) {
      setProjectName("");
      setProjectDescription("");
      setSourceAccountIds([]);
      setSourceMaterialIds([]);
      setStyleDraft("");
    }
  }, [selectedProject, selectedProjectId]);

  useEffect(() => {
    if (!activeStyleJob) return;
    setStyleJobId(activeStyleJob.id);
    if (activeStyleJob.partialText) setStyleDraft(activeStyleJob.partialText);
    if (activeStyleJob.status === "running" || activeStyleJob.status === "queued") {
      setBusy("style");
      return;
    }
    if (handledJobIds.includes(activeStyleJob.id)) return;
    setHandledJobIds((current) => [...current, activeStyleJob.id]);
    setBusy("");
    if (activeStyleJob.status === "completed") {
      const result = activeStyleJob.result as ({ project: ProjectSummary; style: string; fallback?: boolean; fallbackReason?: string }) | undefined;
      if (result) {
        setSelectedProjectId(result.project.id);
        setStyleDraft(result.style);
        setMessage(result.fallback ? result.fallbackReason || "已用本地模板生成项目风格卡。" : "项目风格卡已更新。");
      } else {
        setMessage("项目风格卡已更新。");
      }
      void refresh();
    }
    if (activeStyleJob.status === "failed") {
      setMessage(activeStyleJob.error || "项目风格卡生成失败。");
    }
  }, [activeStyleJob, handledJobIds, refresh]);

  useEffect(() => {
    if (!message || isBackgroundStartMessage(message)) return;
    notify({
      tone: message.includes("失败") || message.includes("请先") ? "error" : "success",
      message
    });
  }, [message, notify]);

  function resetProjectForm() {
    setPickedInitialProject(true);
    setSelectedProjectId("");
    setProjectName("");
    setProjectDescription("");
    setSourceAccountIds([]);
    setSourceMaterialIds([]);
    setStyleDraft("");
    setMessage("");
  }

  function toggleSource(sourceId: string) {
    setSourceMaterialIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    );
  }

  function toggleAccount(accountId: string) {
    setSourceAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    );
  }

  async function saveProject(nextSourceIds = sourceMaterialIds) {
    if (!projectName.trim()) throw new Error("请先填写项目名");
    const project = await upsertProject({
      projectId: selectedProject?.id,
      name: projectName,
      description: projectDescription,
      sourceAccountIds,
      sourceMaterialIds: nextSourceIds
    });
    setSelectedProjectId(project.id);
    setSourceMaterialIds(project.sourceMaterialIds || []);
    await refresh();
    return project;
  }

  async function handleSaveProject() {
    if (!canSaveProject) return;
    setBusy("save");
    setMessage("");
    try {
      await saveProject();
      setMessage("项目已保存。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存项目失败");
    } finally {
      setBusy("");
    }
  }

  async function handleSaveStyle() {
    if (!selectedProject) {
      setMessage("请先保存项目，再保存风格卡。");
      return;
    }
    setBusy("style-save");
    setMessage("");
    try {
      await saveProjectStyle(selectedProject.id, styleDraft);
      setMessage("项目风格卡已保存。");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存风格卡失败");
    } finally {
      setBusy("");
    }
  }

  async function handleTranscribeLinks() {
    if (!parsedLinks.length) return;
    setBusy("links");
    setMessage("");
    setJobs(parsedLinks.map((url) => ({ url, status: "queued" })));
    const createdIds: string[] = [];
    let failed = 0;

    try {
      for (const url of parsedLinks) {
        setJobs((current) => current.map((job) => (job.url === url ? { ...job, status: "running", message: "正在转写" } : job)));
        try {
          const result = await transcribeCopySource({ url });
          createdIds.push(result.source.id);
          setJobs((current) => current.map((job) => (job.url === url ? { ...job, status: "completed", message: result.source.title } : job)));
        } catch (err) {
          failed += 1;
          setJobs((current) =>
            current.map((job) => (job.url === url ? { ...job, status: "failed", message: err instanceof Error ? err.message : "转写失败" } : job))
          );
        }
      }

      const nextSourceIds = [...new Set([...sourceMaterialIds, ...createdIds])];
      setSourceMaterialIds(nextSourceIds);
      if (createdIds.length) {
        await saveProject(nextSourceIds);
        setLinkInput("");
      }
      setMessage(`已加入 ${createdIds.length} 份案例素材${failed ? `，${failed} 条失败` : ""}。`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "添加案例素材失败");
    } finally {
      setBusy("");
    }
  }

  async function handleStartStyleJob() {
    if (!canGenerateStyle) {
      setMessage(sourceMaterialIds.length ? "纯案例素材生成会在下一步接通；当前原型请先选择至少一个参考账号。" : "请先加入案例素材或参考账号。");
      return;
    }
    setBusy("style");
    setMessage("");
    try {
      const project = await saveProject();
      const job = await startTask({
        kind: "project-style",
        title: "生成项目风格卡",
        inputSummary: project.name,
        href: "/project-workbench",
        input: {
          projectId: project.id,
          name: project.name,
          description: project.description,
          sourceAccountIds: project.sourceAccountIds,
          sourceMaterialIds: project.sourceMaterialIds || []
        }
      });
      setStyleJobId(job.id);
      setMessage("项目风格卡已在后台开始生成。");
    } catch (err) {
      setBusy("");
      setMessage(err instanceof Error ? err.message : "启动项目风格生成失败");
    }
  }

  if (!loading && !projects.length && !copySources.length && !accounts.length) {
    return (
      <div className="page project-workbench-page">
        <WorkbenchHeader loading={loading} onRefresh={refresh} />
        <EmptyState title="还没有项目素材" body="先建一个项目，再把案例链接转写进来，项目风格卡会成为写作台的仿写引用。" action={{ href: "/", label: "去采集账号" }} />
      </div>
    );
  }

  return (
    <div className="page project-workbench-page">
      <WorkbenchHeader loading={loading} onRefresh={refresh} />
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className={message.includes("失败") || message.includes("请先") ? "error" : "notice"}>{message}</div> : null}

      <section className="project-workbench-shell">
        <aside className="project-workbench-sidebar">
          <div className="project-rail-header">
            <div>
              <h2>项目</h2>
              <p>{projects.length} 个风格包</p>
            </div>
            <button className="btn icon-btn project-rail-new" onClick={resetProjectForm} type="button" title="新建项目">
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="project-workbench-projects">
            {projects.map((project) => (
              <button
                className={`project-workbench-project ${selectedProject?.id === project.id ? "active" : ""}`}
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                type="button"
              >
                <strong>{project.name}</strong>
                <span>
                  {project.sourceMaterialCount} 份案例 · {project.sourceAccounts.length} 个账号
                </span>
              </button>
            ))}
            {!projects.length ? <p className="subtle">还没有项目。右侧填写项目名后保存。</p> : null}
          </div>
        </aside>

        <main className="project-workbench-canvas">
          <section className="project-command-panel">
            <div className="project-command-head">
              <div className="project-command-copy">
                <p className="eyebrow">Current Project</p>
                <h2>{selectedProject ? selectedProject.name : projectName.trim() || "新项目"}</h2>
                <p>{projectDescription || "先把项目、案例、参考账号收成一份风格卡，再进入写作台。"}</p>
              </div>
              <div className="project-command-actions">
                <button className="btn" disabled={!canSaveProject} onClick={handleSaveProject} type="button">
                  <Save aria-hidden="true" size={16} />
                  {busy === "save" ? "保存中" : "保存项目"}
                </button>
                <Link className={`btn primary ${selectedProject ? "" : "disabled"}`} href={writerHref} aria-disabled={!selectedProject}>
                  去写作台仿写
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </div>
            </div>

            <div className="project-command-body">
              <div className="project-command-form">
                <label className="field">
                  <span>项目名</span>
                  <input autoComplete="off" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例如：青椒说案例仿写" />
                </label>
                <label className="field">
                  <span>项目说明</span>
                  <input autoComplete="off" value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="写作方向、受众或这批案例的用途" />
                </label>
              </div>
              <div className="project-quick-stats" aria-label="项目状态">
                <div>
                  <strong>{selectedProject ? "已保存" : "待保存"}</strong>
                  <span>项目状态</span>
                </div>
                <div>
                  <strong>{sourceMaterialIds.length}</strong>
                  <span>案例素材</span>
                </div>
                <div>
                  <strong>{sourceAccountIds.length}</strong>
                  <span>参考账号</span>
                </div>
                <div>
                  <strong>{styleDraft.trim() ? `${styleDraft.trim().length}` : "0"}</strong>
                  <span>风格字数</span>
                </div>
              </div>
            </div>

            <div className="project-flow-strip" aria-label="项目工作流">
              <FlowStep done={hasProjectShell} label="项目" meta={selectedProject ? "已保存" : "待保存"} />
              <FlowStep done={hasCases} label="案例" meta={`${sourceMaterialIds.length} 份`} />
              <FlowStep done={hasStyle} label="风格" meta={hasStyle ? "可编辑" : "待总结"} />
              <FlowStep done={Boolean(selectedProject)} label="写作" meta="跳转使用" />
            </div>
          </section>

          <div className="project-workbench-grid">
            <div className="project-workbench-primary">
              <section className="project-workbench-section case-pipeline-panel">
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">Step 1</p>
                    <h2>案例流水线</h2>
                    <p className="pane-subtitle">链接转写和素材勾选都会进入当前项目。</p>
                  </div>
                  <span className="status-pill pending">素材库 {copySources.length}</span>
                </div>
                <div className="case-workflow-body">
                  <div className="case-intake-column">
                    <label className="case-intake-box">
                      <span>视频链接</span>
                      <textarea
                        autoComplete="off"
                        className="project-workbench-linkbox"
                        value={linkInput}
                        onChange={(event) => setLinkInput(event.target.value)}
                        placeholder="每行一个 B站 / 抖音链接"
                      />
                    </label>
                    <div className="case-intake-actions">
                      <span className="status-pill pending">识别到 {parsedLinks.length} 条</span>
                      <button className="btn primary" disabled={!parsedLinks.length || busy === "links"} onClick={handleTranscribeLinks} type="button">
                        <LinkIcon aria-hidden="true" size={16} />
                        {busy === "links" ? "转写中" : "转写并加入"}
                      </button>
                    </div>
                    {jobs.length ? (
                      <div className="project-workbench-job-list">
                        {jobs.map((job) => (
                          <div className={`project-workbench-job ${job.status}`} key={job.url}>
                            <span className={`status-pill ${job.status === "completed" ? "done" : job.status === "failed" ? "failed" : "pending"}`}>{formatJob(job.status)}</span>
                            <span>{job.message || job.url}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="project-case-board">
                    <div className="case-board-head">
                      <h3>当前案例</h3>
                      <span>{projectSources.length} / {copySources.length}</span>
                    </div>
                    <div className="project-workbench-source-list">
                      {projectSources.map((source) => (
                        <SourceRow key={source.id} source={source} selected onToggle={() => toggleSource(source.id)} />
                      ))}
                      {!projectSources.length ? <div className="project-workbench-empty">建议先放入 3 到 8 个代表案例。</div> : null}
                    </div>
                  </div>
                </div>
              </section>

              <section className="project-workbench-section style-zone">
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">Step 2</p>
                    <h2>项目风格卡</h2>
                    <p className="pane-subtitle">写作台会读取这里的风格作为批量仿写依据。</p>
                  </div>
                  <div className="button-row">
                    <button className="btn" disabled={!selectedProject || busy === "style-save"} onClick={handleSaveStyle} type="button">
                      <Save aria-hidden="true" size={16} />
                      保存风格卡
                    </button>
                    <button className="btn primary" disabled={busy === "style"} onClick={handleStartStyleJob} type="button">
                      <Sparkles aria-hidden="true" size={16} />
                      {busy === "style" ? "生成中" : "自动总结"}
                    </button>
                  </div>
                </div>
                {activeStyleJob && (activeStyleJob.status === "running" || activeStyleJob.status === "queued") ? (
                  <div className="project-progress" role="status" aria-live="polite">
                    <div className="project-progress-copy">
                      <span>{activeStyleJob.message}</span>
                      <strong>{activeStyleJob.progress}%</strong>
                    </div>
                    <div className="progress-track" aria-hidden="true">
                      <div className="progress-fill" style={{ width: `${activeStyleJob.progress}%` }} />
                    </div>
                  </div>
                ) : null}
                <textarea
                  aria-label="项目风格卡"
                  autoComplete="off"
                  className="project-workbench-style"
                  value={styleDraft}
                  onChange={(event) => setStyleDraft(event.target.value)}
                  placeholder={EMPTY_STYLE}
                />
              </section>
            </div>

            <aside className="project-reference-dock">
              <section className="project-workbench-tool">
                <div>
                  <h2>已有素材</h2>
                  <p className="pane-subtitle">从历史案例里勾选加入当前项目。</p>
                </div>
                <input autoComplete="off" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="搜索标题、链接或文稿" />
                <div className="project-workbench-pick-list">
                  {filteredSources.slice(0, 7).map((source) => (
                    <SourceRow key={source.id} source={source} selected={sourceMaterialIds.includes(source.id)} compact onToggle={() => toggleSource(source.id)} />
                  ))}
                  {!filteredSources.length ? <p className="subtle">没有匹配的素材。</p> : null}
                </div>
              </section>

              <section className="project-workbench-tool">
                <div>
                  <h2>参考账号</h2>
                  <p className="pane-subtitle">可选，用于补充账号长期风格。</p>
                </div>
                <div className="project-workbench-account-list">
                  {accounts.slice(0, 8).map((account) => (
                    <label className="check-card compact" key={account.id}>
                      <input checked={sourceAccountIds.includes(account.id)} onChange={() => toggleAccount(account.id)} type="checkbox" />
                      <span>
                        <strong>{account.name}</strong>
                        <small>
                          {formatPlatform(account.platform)} · {account.transcriptCount} 份转写
                        </small>
                      </span>
                    </label>
                  ))}
                  {!accounts.length ? <p className="subtle">暂无账号，可先只使用案例素材。</p> : null}
                </div>
                {selectedAccounts.length ? (
                  <div className="project-workbench-chip-row">
                    {selectedAccounts.map((account) => (
                      <span className="stat-pill" key={account.id}>{account.name}</span>
                    ))}
                  </div>
                ) : null}
              </section>
            </aside>
          </div>
        </main>
      </section>
    </div>
  );
}

function FlowStep({ done, label, meta }: { done: boolean; label: string; meta: string }) {
  return (
    <div className={`project-flow-step ${done ? "done" : ""}`}>
      <span className="project-flow-dot">
        {done ? <CheckCircle2 aria-hidden="true" size={14} /> : null}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{meta}</small>
      </span>
    </div>
  );
}

function isBackgroundStartMessage(message: string) {
  return message.includes("已在后台开始");
}

function WorkbenchHeader({ loading, onRefresh }: { loading: boolean; onRefresh: () => Promise<void> }) {
  return (
    <header className="page-header workbench-header">
      <div>
        <p className="eyebrow">Project Workbench</p>
        <h1>项目工作台</h1>
        <p className="subtle">把案例链接、历史素材、参考账号和项目风格卡放到一条写作流水线里。</p>
      </div>
      <button className="btn" disabled={loading} onClick={onRefresh} type="button">
        <RefreshCw aria-hidden="true" size={16} />
        {loading ? "读取中" : "刷新"}
      </button>
    </header>
  );
}

function SourceRow({
  compact,
  selected,
  source,
  onToggle
}: {
  compact?: boolean;
  selected: boolean;
  source: CopySource;
  onToggle: () => void;
}) {
  return (
    <button className={`project-workbench-source ${selected ? "selected" : ""} ${compact ? "compact" : ""}`} onClick={onToggle} type="button">
      <span className="project-workbench-source-icon">
        <FileText aria-hidden="true" size={15} />
      </span>
      <span>
        <strong>{source.title}</strong>
        <small>
          {source.platform === "unknown" ? "未知平台" : formatPlatform(source.platform)} · {source.transcript.length} 字
        </small>
      </span>
      <span className={`status-pill ${selected ? "done" : ""}`}>{selected ? "已加入" : "加入"}</span>
    </button>
  );
}

function formatJob(status: LinkJob["status"]) {
  if (status === "queued") return "排队";
  if (status === "running") return "转写";
  if (status === "completed") return "完成";
  return "失败";
}
