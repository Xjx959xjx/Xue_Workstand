"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { deleteProjects, saveProjectStyle, streamGenerateProjectStyle, upsertProject } from "@/lib/client";

export default function ProjectsPage() {
  const { library, loading, error, refresh } = useLibrary();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectAccountIds, setProjectAccountIds] = useState<string[]>([]);
  const [projectStyleDraft, setProjectStyleDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [projectStyleProgress, setProjectStyleProgress] = useState(0);
  const [projectStyleStage, setProjectStyleStage] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [projectManageMode, setProjectManageMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const selectedProject = useMemo(() => {
    return library?.projects.find((project) => project.id === selectedProjectId) || null;
  }, [library?.projects, selectedProjectId]);

  const filteredAccounts = useMemo(() => {
    const keyword = accountFilter.trim().toLowerCase();
    const accounts = library?.accounts || [];
    if (!keyword) return accounts;
    return accounts.filter((account) => {
      const haystack = `${account.name} ${formatPlatform(account.platform)} ${account.uid}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [accountFilter, library?.accounts]);

  useEffect(() => {
    if (!selectedProject) return;
    setProjectName(selectedProject.name);
    setProjectDescription(selectedProject.description || "");
    setProjectAccountIds(selectedProject.sourceAccountIds);
    setProjectStyleDraft(selectedProject.style);
  }, [selectedProject]);

  const messageIsError = message.includes("失败") || message.includes("没有");

  function toggleProjectAccount(accountId: string) {
    setProjectAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    );
  }

  function toggleManagedProject(projectId: string) {
    setSelectedProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]
    );
  }

  async function handleDeleteSelectedProjects() {
    if (!selectedProjectIds.length) return;
    setBusy("project-delete");
    setMessage("");
    try {
      const result = await deleteProjects(selectedProjectIds);
      if (selectedProject && selectedProjectIds.includes(selectedProject.id)) {
        setSelectedProjectId("");
        setProjectName("");
        setProjectDescription("");
        setProjectAccountIds([]);
        setProjectStyleDraft("");
      }
      setSelectedProjectIds([]);
      setProjectManageMode(false);
      setDeleteConfirmOpen(false);
      setMessage(`已删除 ${result.deleted.length} 个项目。`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除项目失败");
    } finally {
      setBusy("");
    }
  }

  async function handleSaveProject() {
    if (!projectName.trim()) return;
    setBusy("project-save");
    setMessage("");
    try {
      const project = await upsertProject({
        projectId: selectedProject?.id,
        name: projectName,
        description: projectDescription,
        sourceAccountIds: projectAccountIds
      });
      setSelectedProjectId(project.id);
      setProjectStyleDraft(project.style);
      setMessage("项目已保存。");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存项目失败");
    } finally {
      setBusy("");
    }
  }

  async function handleGenerateProjectStyle() {
    if (!projectName.trim()) return;
    setBusy("project-style");
    setMessage("");
    setProjectStyleProgress(8);
    setProjectStyleStage("准备保存项目配置");
    try {
      await streamGenerateProjectStyle({
        projectId: selectedProject?.id,
        name: projectName,
        description: projectDescription,
        sourceAccountIds: projectAccountIds
      }, {
        onStage(stage) {
          setProjectStyleProgress(stage.progress || 0);
          setProjectStyleStage(stage.message);
        },
        onResult(result) {
          setProjectStyleProgress(100);
          setProjectStyleStage("项目风格卡已更新");
          setSelectedProjectId(result.project.id);
          setProjectName(result.project.name);
          setProjectDescription(result.project.description || "");
          setProjectAccountIds(result.project.sourceAccountIds);
          setProjectStyleDraft(result.style);
          setMessage(
            result.fallback
              ? `已降级生成项目风格卡：${result.fallbackReason || "模型没有返回可用内容，已用本地模板生成，可继续编辑。"}`
              : "项目风格卡已自动更新。"
          );
        }
      });
      await refresh();
    } catch (err) {
      setProjectStyleProgress(100);
      setProjectStyleStage("生成失败，请查看提示");
      setMessage(err instanceof Error ? err.message : "自动总结项目风格失败");
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setProjectStyleProgress(0);
        setProjectStyleStage("");
      }, 900);
    }
  }

  async function handleSaveProjectStyle() {
    if (!selectedProject || !projectStyleDraft.trim()) return;
    setBusy("project-style-save");
    setMessage("");
    try {
      await saveProjectStyle(selectedProject.id, projectStyleDraft);
      setMessage("项目风格卡已保存。");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存项目风格失败");
    } finally {
      setBusy("");
    }
  }

  if (!loading && !library?.accounts.length && !library?.projects.length) {
    return (
      <div className="page projects-page">
        <header className="page-header workbench-header">
          <div>
            <p className="eyebrow">Projects</p>
            <h1>项目库</h1>
            <p className="subtle">项目可以来自参考账号，也可以来自文案工具里的纯转写素材。</p>
          </div>
          <button className="btn" onClick={refresh} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            刷新
          </button>
        </header>
        <EmptyState title="还没有项目" body="可以先采集账号创建风格项目，也可以去文案工具转写链接后批量创建纯文案项目。" action={{ href: "/copy-tools", label: "去文案工具" }} />
      </div>
    );
  }

  return (
    <div className="page projects-page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>项目库</h1>
          <p className="subtle">把多个账号组合成项目风格卡，用在更稳定的选题和文案生成里。</p>
        </div>
        <div className="button-row">
          <button className="btn" onClick={refresh} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            刷新
          </button>
        </div>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? (
        <div aria-live={messageIsError ? "assertive" : "polite"} className={messageIsError ? "error" : "notice"} role={messageIsError ? "alert" : "status"}>
          {message}
        </div>
      ) : null}

      <section className="panel project-workspace">
        <div className={`project-sidebar ${projectManageMode ? "selection-mode" : ""}`}>
          <div className="pane-header">
            <h2>项目</h2>
            <div className="account-manage-actions">
              {!projectManageMode ? (
                <button
                  className="btn icon-btn"
                  aria-label="新建项目"
                  onClick={() => {
                    setSelectedProjectId("");
                    setProjectName("");
                    setProjectDescription("");
                    setProjectAccountIds([]);
                    setProjectStyleDraft("");
                  }}
                  type="button"
                >
                  新建
                </button>
              ) : null}
              <button
                className={`btn icon-btn ${projectManageMode ? "primary" : ""}`}
                aria-label={projectManageMode ? "完成项目管理" : "管理项目"}
                onClick={() => {
                  setProjectManageMode((current) => !current);
                  setSelectedProjectIds([]);
                }}
                title="管理项目"
                type="button"
              >
                {projectManageMode ? "完成" : "管理"}
              </button>
            </div>
          </div>
          {projectManageMode ? (
            <div className="selection-toolbar" role="toolbar" aria-label="项目批量操作">
              <div className="selection-copy">
                <strong>项目选择</strong>
                <span>已选 {selectedProjectIds.length} 个</span>
              </div>
              <button
                className="btn danger"
                disabled={!selectedProjectIds.length || busy === "project-delete"}
                onClick={() => setDeleteConfirmOpen(true)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
                删除项目
              </button>
            </div>
          ) : null}
          <div className="pane-body">
            <div className="status-summary">
              <span>{library?.projects.length || 0} 个项目</span>
              <span>{library?.accounts.length || 0} 个账号可用</span>
              <span>{library?.copySources.length || 0} 份文案素材</span>
            </div>
            {!library?.projects.length ? <p className="subtle">项目可以绑定参考账号，也可以从文案工具归档纯文案素材。</p> : null}
            {library?.projects.map((project) => (
              <button
                className={`list-button account-list-button ${selectedProject?.id === project.id ? "active" : ""} ${
                  projectManageMode && selectedProjectIds.includes(project.id) ? "checked" : ""
                }`}
                aria-current={!projectManageMode && selectedProject?.id === project.id ? "true" : undefined}
                aria-pressed={projectManageMode ? selectedProjectIds.includes(project.id) : undefined}
                key={project.id}
                onClick={() => {
                  if (projectManageMode) {
                    toggleManagedProject(project.id);
                    return;
                  }
                  setSelectedProjectId(project.id);
                }}
                type="button"
              >
                {projectManageMode ? (
                  <span className={`check-dot ${selectedProjectIds.includes(project.id) ? "checked" : ""}`} aria-hidden="true" />
                ) : null}
                <span>
                  <span className="list-title">{project.name}</span>
                  <span className="list-meta">
                    {project.sourceAccounts.length} 个参考账号
                    {project.sourceMaterialCount ? ` · ${project.sourceMaterialCount} 份文案素材` : ""}
                  </span>
                </span>
                <span className="status-pill done">项目</span>
              </button>
            ))}
          </div>
        </div>

        <div className="project-editor">
          <div className="pane-header">
            <h2>{selectedProject ? selectedProject.name : "新项目"}</h2>
            <div className="button-row">
              <button className="btn" disabled={!projectName || busy === "project-save"} onClick={handleSaveProject} type="button">
                <Save aria-hidden="true" size={16} />
                保存项目
              </button>
              <button
                className="btn primary"
                disabled={!projectName || busy === "project-style"}
                onClick={handleGenerateProjectStyle}
                type="button"
              >
                <Sparkles aria-hidden="true" size={16} />
                {busy === "project-style" ? "总结中…" : "自动总结项目风格"}
              </button>
            </div>
          </div>
          {busy === "project-style" ? (
            <div className="project-progress" role="status" aria-live="polite">
              <div className="project-progress-copy">
                <span>{projectStyleStage || "正在总结项目风格"}</span>
                <strong>{projectStyleProgress}%</strong>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${projectStyleProgress}%` }} />
              </div>
            </div>
          ) : null}
          <div className="pane-body detail-stack">
            <div className="project-form-grid">
              <div className="field">
                <label htmlFor="project-name">项目名</label>
                <input
                  autoComplete="off"
                  id="project-name"
                  name="projectName"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="例如：AI科普矩阵…"
                />
              </div>
              <div className="field">
                <label htmlFor="project-description">项目说明</label>
                <input
                  autoComplete="off"
                  id="project-description"
                  name="projectDescription"
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  placeholder="内容方向、目标人群、账号矩阵定位…"
                />
              </div>
            </div>

            <div>
              <div className="account-filter-head">
                <div>
                  <h3>参考账号</h3>
                  <p className="subtle">
                    已选 {projectAccountIds.length} 个 · 显示 {filteredAccounts.length} / {library?.accounts.length || 0}
                  </p>
                </div>
                <input
                  aria-label="筛选参考账号"
                  autoComplete="off"
                  className="account-filter-input"
                  name="accountFilter"
                  value={accountFilter}
                  onChange={(event) => setAccountFilter(event.target.value)}
                  placeholder="搜索账号名、平台或 UID…"
                />
              </div>
              <div className="account-check-grid filter-mode">
                {filteredAccounts.map((account) => (
                  <label className="check-card" key={account.id}>
                    <input
                      checked={projectAccountIds.includes(account.id)}
                      autoComplete="off"
                      name="sourceAccountIds"
                      onChange={() => toggleProjectAccount(account.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{account.name}</strong>
                      <small>
                        {formatPlatform(account.platform)} · {account.transcriptCount} 份转写
                      </small>
                    </span>
                  </label>
                ))}
                {!filteredAccounts.length ? (
                  <p className="subtle">
                    {library?.accounts.length ? "没有匹配的账号。" : "暂无账号。纯文案项目可以先不选择参考账号。"}
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <div className="button-row section-title-row">
                <h3>项目风格卡</h3>
                <button
                  className="btn"
                  disabled={!selectedProject || busy === "project-style-save"}
                  onClick={handleSaveProjectStyle}
                  type="button"
                >
                  <Save aria-hidden="true" size={16} />
                  保存风格卡
                </button>
              </div>
              <textarea
                aria-label="项目风格卡"
                autoComplete="off"
                className="project-style-textarea"
                name="projectStyle"
                value={projectStyleDraft}
                onChange={(event) => setProjectStyleDraft(event.target.value)}
                placeholder="自动总结后会写入 style-library/projects/项目名/style.md，也可以在这里手动编辑…"
              />
            </div>

            {selectedProject?.sourceMaterials.length ? (
              <div>
                <div className="button-row section-title-row">
                  <h3>文案素材</h3>
                  <span className="status-pill done">{selectedProject.sourceMaterials.length} 份</span>
                </div>
                <div className="copy-project-list">
                  {selectedProject.sourceMaterials.map((source) => (
                    <a className="copy-project-row" href={source.resolvedUrl || source.url} key={source.id} rel="noreferrer" target="_blank">
                      <strong>{source.title}</strong>
                      <span>{source.platform === "unknown" ? "未知平台" : formatPlatform(source.platform)}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      {deleteConfirmOpen ? (
        <ConfirmDialog
          body={`会删除 ${selectedProjectIds.length} 个项目的风格卡和项目草稿。`}
          busy={busy === "project-delete"}
          confirmLabel="删除项目"
          title="确认删除项目？"
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={handleDeleteSelectedProjects}
        />
      ) : null}
    </div>
  );
}
