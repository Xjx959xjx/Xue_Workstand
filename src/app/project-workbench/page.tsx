"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useFeedback } from "@/components/FeedbackProvider";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { deleteCopySources, getCopySources, saveProjectStyle, transcribeCopySource, upsertProject } from "@/lib/client";
import { cachedGetProjectDetail, invalidateProjectDetail } from "@/lib/detail-cache";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import { extractSourceUrls } from "@/lib/source-extraction";
import type { CopySource, ProjectDetail, ProjectSummary } from "@/lib/types";
import { ProjectPickerModal } from "./_components/ProjectPickerModal";
import { CasePipelinePanel } from "./_components/CasePipelinePanel";
import { AccountPickerModal } from "./_components/AccountPickerModal";
import { CopySourcePreviewModal } from "./_components/CopySourcePreviewModal";
import { ProjectStylePanel } from "./_components/ProjectStylePanel";
import { SourceAddModal } from "./_components/SourceAddModal";
import type { LinkJob } from "./_components/project-workbench-utils";

type WorkbenchSnapshot = {
  projectId: string;
  name: string;
  description: string;
  sourceAccountIds: string[];
  sourceMaterialIds: string[];
  style: string;
};

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
  const [linkInput, setLinkInput] = useState("");
  const [linkAnalyzeVideo, setLinkAnalyzeVideo] = useState(true);
  const [jobs, setJobs] = useState<LinkJob[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [styleJobId, setStyleJobId] = useState("");
  const [handledJobIds, setHandledJobIds] = useState<string[]>([]);
  const [pickedInitialProject, setPickedInitialProject] = useState(false);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [projectDetailLoading, setProjectDetailLoading] = useState(false);
  const [projectDetailError, setProjectDetailError] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [sourceAddModalOpen, setSourceAddModalOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [previewSource, setPreviewSource] = useState<CopySource | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [fullCopySources, setFullCopySources] = useState<CopySource[] | null>(null);
  const [sourcePoolManage, setSourcePoolManage] = useState(false);
  const [managedSourceIds, setManagedSourceIds] = useState<string[]>([]);
  const [deleteSourcesConfirmOpen, setDeleteSourcesConfirmOpen] = useState(false);

  const projects = useMemo(() => library?.projects || [], [library?.projects]);
  const accounts = useMemo(() => library?.accounts || [], [library?.accounts]);
  const copySources = useMemo(() => fullCopySources || library?.copySources || [], [fullCopySources, library?.copySources]);
  const selectedProjectMeta = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const selectedProjectDetailId = selectedProjectMeta?.id || "";
  const selectedProjectUpdatedAt = selectedProjectMeta?.updatedAt || "";
  const selectedProject =
    projectDetail && (projectDetail.id === selectedProjectMeta?.id || projectDetail.id === selectedProjectId) ? projectDetail : null;
  const parsedLinks = useMemo(() => [...new Set(extractSourceUrls(linkInput))], [linkInput]);
  const projectSources = useMemo(
    () => sourceMaterialIds.map((sourceId) => copySources.find((source) => source.id === sourceId)).filter(Boolean) as CopySource[],
    [copySources, sourceMaterialIds]
  );
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => sourceAccountIds.includes(account.id)),
    [accounts, sourceAccountIds]
  );
  const activeStyleJob = useMemo(() => {
    const trackedJob = [...activeJobs, ...recentJobs].find((job) => job.id === styleJobId);
    if (trackedJob) return trackedJob;
    return activeJobs.find((job) => job.kind === "project-style" && job.inputSummary === projectName);
  }, [activeJobs, projectName, recentJobs, styleJobId]);
  const currentSnapshot = useMemo(
    () =>
      createSnapshot({
        projectId: selectedProject?.id || selectedProjectMeta?.id || selectedProjectId,
        name: projectName,
        description: projectDescription,
        sourceAccountIds,
        sourceMaterialIds,
        style: styleDraft
      }),
    [
      projectDescription,
      projectName,
      selectedProject?.id,
      selectedProjectId,
      selectedProjectMeta?.id,
      sourceAccountIds,
      sourceMaterialIds,
      styleDraft
    ]
  );
  const hasWorkspaceContent = Boolean(
    projectName.trim() || projectDescription.trim() || sourceAccountIds.length || sourceMaterialIds.length || styleDraft.trim()
  );
  const isDirty = savedSnapshot ? !snapshotsEqual(savedSnapshot, currentSnapshot) : hasWorkspaceContent;
  const canSaveProject = Boolean(projectName.trim()) && busy !== "save";
  const canSaveWorkspace = Boolean(projectName.trim() && isDirty) && busy !== "save" && busy !== "style";
  const canWrite = Boolean(selectedProjectMeta && !isDirty && busy !== "save" && busy !== "style");
  const writerHref = selectedProjectMeta
    ? `/writer?targetType=project&projectId=${encodeURIComponent(selectedProjectMeta.id)}`
    : "/writer?targetType=project";

  useEffect(() => {
    if (loading || pickedInitialProject || selectedProjectId || !projects.length) return;
    setPickedInitialProject(true);
    setSelectedProjectId(projects[0].id);
  }, [loading, pickedInitialProject, projects, selectedProjectId]);

  useEffect(() => {
    let ignore = false;
    if (loading) return;
    getCopySources()
      .then((result) => {
        if (!ignore) setFullCopySources(result.sources);
      })
      .catch((err) => {
        if (!ignore) setMessage(err instanceof Error ? err.message : "读取案例素材失败");
      });
    return () => {
      ignore = true;
    };
  }, [loading, library?.copySources.length]);

  useEffect(() => {
    let ignore = false;
    if (!selectedProjectDetailId) {
      setProjectDetail(null);
      setProjectDetailError("");
      setProjectDetailLoading(false);
      if (!selectedProjectId) {
        setProjectName("");
        setProjectDescription("");
        setSourceAccountIds([]);
        setSourceMaterialIds([]);
        setStyleDraft("");
        setSavedSnapshot(null);
      }
      return;
    }

    setProjectDetailLoading(true);
    setProjectDetailError("");
    cachedGetProjectDetail(selectedProjectDetailId, {
      includeStyle: true,
      version: selectedProjectUpdatedAt
    })
      .then((detail) => {
        if (ignore) return;
        setProjectDetail(detail);
        setProjectName(detail.name);
        setProjectDescription(detail.description || "");
        setSourceAccountIds(detail.sourceAccountIds);
        setSourceMaterialIds(detail.sourceMaterialIds || []);
        setStyleDraft(detail.style || "");
        setSavedSnapshot(
          createSnapshot({
            projectId: detail.id,
            name: detail.name,
            description: detail.description || "",
            sourceAccountIds: detail.sourceAccountIds,
            sourceMaterialIds: detail.sourceMaterialIds || [],
            style: detail.style || ""
          })
        );
      })
      .catch((err) => {
        if (ignore) return;
        setProjectDetail(null);
        setProjectDetailError(err instanceof Error ? err.message : "读取项目详情失败");
      })
      .finally(() => {
        if (!ignore) setProjectDetailLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedProjectDetailId, selectedProjectId, selectedProjectUpdatedAt]);

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
        invalidateProjectDetail(result.project.id);
        setSelectedProjectId(result.project.id);
        setProjectName(result.project.name);
        setProjectDescription(result.project.description || "");
        setSourceAccountIds(result.project.sourceAccountIds);
        setSourceMaterialIds(result.project.sourceMaterialIds || []);
        setProjectDetail(result.project);
        setStyleDraft(result.style);
        setSavedSnapshot(
          createSnapshot({
            projectId: result.project.id,
            name: result.project.name,
            description: result.project.description || "",
            sourceAccountIds: result.project.sourceAccountIds,
            sourceMaterialIds: result.project.sourceMaterialIds || [],
            style: result.style
          })
        );
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
    if (!message || isTaskProgressMessage(message)) return;
    notify({
      tone: message.includes("失败") || message.includes("先") ? "error" : "success",
      message
    });
  }, [message, notify]);

  function resetProjectForm() {
    setPickedInitialProject(true);
    setSelectedProjectId("");
    setProjectDetail(null);
    setProjectName("");
    setProjectDescription("");
    setSourceAccountIds([]);
    setSourceMaterialIds([]);
    setStyleDraft("");
    setSavedSnapshot(null);
    setMessage("");
  }

  function toggleAccount(accountId: string) {
    setSourceAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    );
  }

  function toggleManagedSource(sourceId: string) {
    setManagedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    );
  }

  function toggleSourcePoolManage() {
    setSourcePoolManage((current) => {
      if (current) setManagedSourceIds([]);
      return !current;
    });
  }

  async function saveProject(nextSourceIds = sourceMaterialIds) {
    if (!projectName.trim()) throw new Error("请先填写项目名");
    const project = await upsertProject({
      projectId: selectedProject?.id || selectedProjectMeta?.id,
      name: projectName,
      description: projectDescription,
      sourceAccountIds,
      sourceMaterialIds: nextSourceIds
    });
    invalidateProjectDetail(project.id);
    setSelectedProjectId(project.id);
    setProjectName(project.name);
    setProjectDescription(project.description || "");
    setSourceAccountIds(project.sourceAccountIds);
    setProjectDetail(project);
    setSourceMaterialIds(project.sourceMaterialIds || []);
    setSavedSnapshot(
      createSnapshot({
        projectId: project.id,
        name: project.name,
        description: project.description || "",
        sourceAccountIds: project.sourceAccountIds,
        sourceMaterialIds: project.sourceMaterialIds || [],
        style: project.style || ""
      })
    );
    await refresh();
    return project;
  }

  async function handleSaveProject() {
    if (!canSaveProject) return false;
    setBusy("save");
    setMessage("");
    try {
      await saveProject();
      setMessage("项目已保存。");
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存项目失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function handleSaveWorkspace() {
    if (!projectName.trim()) {
      setMessage("先填项目名。");
      setProjectModalOpen(true);
      return;
    }
    setBusy("save");
    setMessage("");
    try {
      const project = await saveProject();
      if (styleDraft !== (project.style || "")) {
        await saveProjectStyle(project.id, styleDraft);
        invalidateProjectDetail(project.id);
      }
      setProjectDetail({ ...project, style: styleDraft });
      setSavedSnapshot(
        createSnapshot({
          projectId: project.id,
          name: project.name,
          description: project.description || "",
          sourceAccountIds: project.sourceAccountIds,
          sourceMaterialIds: project.sourceMaterialIds || [],
          style: styleDraft
        })
      );
      await refresh();
      setMessage("已保存。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
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
    const createdSources: CopySource[] = [];
    let failed = 0;

    try {
      for (const url of parsedLinks) {
        setJobs((current) =>
          current.map((job) => (job.url === url ? { ...job, status: "running", message: linkAnalyzeVideo ? "正在转写并生成画面描述" : "正在转写" } : job))
        );
        try {
          const result = await transcribeCopySource({ url, analyzeVideo: linkAnalyzeVideo });
          createdIds.push(result.source.id);
          createdSources.push(result.source);
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
        setFullCopySources((current) => [...createdSources, ...(current || copySources)]);
        await saveProject(nextSourceIds);
        setLinkInput("");
      }
      if (createdIds.length && !failed) setSourceAddModalOpen(false);
      setMessage(`已加入 ${createdIds.length} 份案例素材${failed ? `，${failed} 条失败` : ""}。`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "添加案例素材失败");
    } finally {
      setBusy("");
    }
  }

  async function handleStartStyleJob() {
    if (busy === "style") return;
    if (!projectName.trim()) {
      setProjectModalOpen(true);
      setMessage("先填项目名。");
      return;
    }
    if (!sourceAccountIds.length && !sourceMaterialIds.length) {
      setMessage("先加案例或账号。");
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

  function handleSelectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setProjectModalOpen(false);
  }

  async function handleRefresh() {
    try {
      const [sourceResult] = await Promise.all([getCopySources(), refresh()]);
      setFullCopySources(sourceResult.sources);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "刷新失败");
    }
  }

  async function handleSaveProjectFromModal() {
    const saved = await handleSaveProject();
    if (saved) setProjectModalOpen(false);
  }

  function openSourceAddModal() {
    setJobs([]);
    setSourceAddModalOpen(true);
  }

  async function handleDeleteManagedSources() {
    if (!managedSourceIds.length) return;
    setBusy("delete-sources");
    setMessage("");
    try {
      const deleted = await deleteCopySources(managedSourceIds);
      const nextSourceIds = sourceMaterialIds.filter((id) => !deleted.deleted.includes(id));
      setSourceMaterialIds(nextSourceIds);
      setFullCopySources((current) => (current || copySources).filter((source) => !deleted.deleted.includes(source.id)));
      setPreviewSource((current) => (current && deleted.deleted.includes(current.id) ? null : current));
      if (selectedProject || selectedProjectMeta) {
        const nextProject = selectedProject
          ? { ...selectedProject, sourceMaterialIds: nextSourceIds, sourceMaterialCount: nextSourceIds.length }
          : null;
        if (nextProject) setProjectDetail(nextProject);
        setSavedSnapshot(
          createSnapshot({
            projectId: selectedProject?.id || selectedProjectMeta?.id || selectedProjectId,
            name: projectName,
            description: projectDescription,
            sourceAccountIds,
            sourceMaterialIds: nextSourceIds,
            style: styleDraft
          })
        );
      }
      setManagedSourceIds([]);
      setSourcePoolManage(false);
      setDeleteSourcesConfirmOpen(false);
      await refresh();
      setMessage(`已删除 ${deleted.deleted.length} 份素材。`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除素材失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page project-workbench-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Project Workbench</p>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              🗂️
            </span>
            <span>项目工作台</span>
          </h1>
          <p className="subtle">把案例素材和参考账号沉淀成项目风格卡。</p>
        </div>
        <div className="button-row">
          <button className="btn" disabled={loading} onClick={() => void handleRefresh()} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            {loading ? "读取中" : "刷新"}
          </button>
        </div>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {projectDetailError ? <div className="error" role="alert">{projectDetailError}</div> : null}
      {message ? <div className={message.includes("失败") || message.includes("先") ? "error" : "notice"}>{message}</div> : null}

      <section className="project-workbench-shell">
        <main className="project-workbench-canvas">
          <div className="project-workbench-grid">
            <CasePipelinePanel
              isDirty={isDirty}
              projectDescription={projectDescription}
              projectName={projectName}
              projectSources={projectSources}
              selectedAccounts={selectedAccounts}
              selectedProjectMeta={selectedProjectMeta}
              accounts={accounts}
              managedSourceIds={managedSourceIds}
              sourcePoolManage={sourcePoolManage}
              deletingSourcePool={busy === "delete-sources"}
              onDeleteSelectedPoolSources={() => setDeleteSourcesConfirmOpen(true)}
              onOpenAccountPicker={() => setAccountPickerOpen(true)}
              onOpenSourceAddModal={openSourceAddModal}
              onOpenProjectModal={() => setProjectModalOpen(true)}
              onOpenSourcePreview={setPreviewSource}
              onToggleManagedSource={toggleManagedSource}
              onToggleAccount={toggleAccount}
              onToggleSourcePoolManage={toggleSourcePoolManage}
            />

            <ProjectStylePanel
              activeStyleJob={activeStyleJob}
              busy={busy}
              canSaveWorkspace={canSaveWorkspace}
              canWrite={canWrite}
              isDirty={isDirty}
              projectDetailLoading={projectDetailLoading}
              selectedProjectMeta={selectedProjectMeta}
              styleDraft={styleDraft}
              writerHref={writerHref}
              onGenerateStyle={handleStartStyleJob}
              onSaveWorkspace={handleSaveWorkspace}
              onStyleDraftChange={setStyleDraft}
            />
          </div>
        </main>
      </section>

      {projectModalOpen ? (
        <ProjectPickerModal
          busy={busy}
          canSaveProject={canSaveProject}
          projectDescription={projectDescription}
          projectName={projectName}
          projects={projects}
          selectedProjectId={selectedProjectMeta?.id || ""}
          onClose={() => setProjectModalOpen(false)}
          onNewProject={resetProjectForm}
          onProjectDescriptionChange={setProjectDescription}
          onProjectNameChange={setProjectName}
          onSaveProject={handleSaveProjectFromModal}
          onSelectProject={handleSelectProject}
        />
      ) : null}

      {sourceAddModalOpen ? (
        <SourceAddModal
          busy={busy}
          jobs={jobs}
          linkAnalyzeVideo={linkAnalyzeVideo}
          linkInput={linkInput}
          parsedLinkCount={parsedLinks.length}
          onClose={() => setSourceAddModalOpen(false)}
          onLinkAnalyzeVideoChange={setLinkAnalyzeVideo}
          onLinkInputChange={setLinkInput}
          onTranscribeLinks={handleTranscribeLinks}
        />
      ) : null}

      {accountPickerOpen ? (
        <AccountPickerModal
          accounts={accounts}
          selectedAccountIds={sourceAccountIds}
          selectedAccounts={selectedAccounts}
          onClose={() => setAccountPickerOpen(false)}
          onToggleAccount={toggleAccount}
        />
      ) : null}

      {previewSource ? <CopySourcePreviewModal source={previewSource} onClose={() => setPreviewSource(null)} /> : null}

      {deleteSourcesConfirmOpen ? (
        <ConfirmDialog
          body={`将删除 ${managedSourceIds.length} 份素材，并从相关项目引用中移除。这个操作会删除本地素材文件。`}
          busy={busy === "delete-sources"}
          confirmLabel="删除素材"
          title="删除选中的素材？"
          onCancel={() => setDeleteSourcesConfirmOpen(false)}
          onConfirm={() => void handleDeleteManagedSources()}
        />
      ) : null}

    </div>
  );
}

function createSnapshot(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  return {
    projectId: snapshot.projectId,
    name: snapshot.name.trim(),
    description: snapshot.description.trim(),
    sourceAccountIds: [...snapshot.sourceAccountIds].sort(),
    sourceMaterialIds: [...snapshot.sourceMaterialIds].sort(),
    style: snapshot.style
  };
}

function snapshotsEqual(left: WorkbenchSnapshot, right: WorkbenchSnapshot) {
  return (
    left.projectId === right.projectId &&
    left.name === right.name &&
    left.description === right.description &&
    left.style === right.style &&
    left.sourceAccountIds.join("\n") === right.sourceAccountIds.join("\n") &&
    left.sourceMaterialIds.join("\n") === right.sourceMaterialIds.join("\n")
  );
}
