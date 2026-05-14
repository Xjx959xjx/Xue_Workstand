import fs from "fs";
import path from "path";
import process from "process";

const platforms = ["bilibili", "douyin"];
const root = path.resolve(process.cwd(), process.env.STYLE_LIBRARY_DIR || "style-library");
const issues = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    issues.push({
      type: "invalid-json",
      file,
      detail: error instanceof Error ? error.message : "JSON 读取失败"
    });
    return null;
  }
}

function exists(file) {
  return fs.existsSync(file);
}

function dirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function files(dir, extension) {
  try {
    return fs.readdirSync(dir).filter((file) => file.endsWith(extension));
  } catch {
    return [];
  }
}

function pushIssue(type, file, detail) {
  issues.push({ type, file, detail });
}

const accountIds = new Set();
const copySourceIds = new Set();

for (const platform of platforms) {
  for (const slug of dirs(path.join(root, platform))) {
    const base = path.join(root, platform, slug);
    const accountFile = path.join(base, "account.json");
    const account = readJson(accountFile);
    if (!account) continue;

    const expectedAccountId = `${platform}:${slug}`;
    accountIds.add(account.id);
    if (account.id !== expectedAccountId) {
      pushIssue("account-id-slug-mismatch", accountFile, `id=${account.id}, expected=${expectedAccountId}`);
    }

    const videoDir = path.join(base, "videos");
    const transcriptDir = path.join(base, "transcripts");
    const draftDir = path.join(base, "drafts");
    const videoIds = new Set(files(videoDir, ".json").map((file) => file.slice(0, -5)));

    for (const file of files(videoDir, ".json")) {
      const id = file.slice(0, -5);
      const videoFile = path.join(videoDir, file);
      const video = readJson(videoFile);
      if (!video) continue;

      const transcriptFile = path.join(transcriptDir, `${id}.txt`);
      const hasTranscript = exists(transcriptFile);

      if (video.id !== id) {
        pushIssue("video-id-filename-mismatch", videoFile, `id=${video.id}, file=${id}`);
      }
      if (video.accountId !== account.id) {
        pushIssue("video-account-mismatch", videoFile, `video.accountId=${video.accountId}, account=${account.id}`);
      }
      if (hasTranscript && video.transcriptStatus !== "completed") {
        pushIssue("transcript-file-status-mismatch", videoFile, `has transcript but status=${video.transcriptStatus}`);
      }
      if (!hasTranscript && video.transcriptStatus === "completed") {
        pushIssue("missing-transcript-file", videoFile, "status completed but txt missing");
      }
      if (video.transcriptPath && !exists(video.transcriptPath)) {
        pushIssue("stale-transcript-path", videoFile, video.transcriptPath);
      }
    }

    for (const file of files(transcriptDir, ".txt")) {
      const id = file.slice(0, -4);
      if (!videoIds.has(id)) {
        pushIssue("orphan-transcript", path.join(transcriptDir, file), "txt without video json");
      }
    }

    for (const file of files(draftDir, ".json")) {
      const draftFile = path.join(draftDir, file);
      const draft = readJson(draftFile);
      if (!draft) continue;

      if (draft.targetType === "project") {
        pushIssue("project-draft-in-account-dir", draftFile, draft.projectId);
      }
      if (draft.styleRef?.videoIds) {
        const missing = draft.styleRef.videoIds.filter((id) => !videoIds.has(id));
        if (missing.length) {
          pushIssue("draft-missing-video-ref", draftFile, missing.join(","));
        }
      }
    }
  }
}

for (const file of files(path.join(root, "copy-tools", "sources"), ".json")) {
  const sourceFile = path.join(root, "copy-tools", "sources", file);
  const source = readJson(sourceFile);
  if (!source) continue;

  const expectedSourceId = file.slice(0, -5);
  copySourceIds.add(source.id);
  if (source.id !== expectedSourceId) {
    pushIssue("copy-source-id-filename-mismatch", sourceFile, `id=${source.id}, file=${expectedSourceId}`);
  }

  const transcriptFile = path.join(root, "copy-tools", "sources", `${expectedSourceId}.txt`);
  if (!exists(transcriptFile)) {
    pushIssue("copy-source-missing-transcript", sourceFile, "json without txt");
  }
}

for (const slug of dirs(path.join(root, "projects"))) {
  const base = path.join(root, "projects", slug);
  const projectFile = path.join(base, "project.json");
  const project = readJson(projectFile);
  if (!project) continue;

  const expectedProjectId = `project:${slug}`;
  if (project.id !== expectedProjectId) {
    pushIssue("project-id-slug-mismatch", projectFile, `id=${project.id}, expected=${expectedProjectId}`);
  }

  const missingAccounts = (project.sourceAccountIds || []).filter((id) => !accountIds.has(id));
  if (missingAccounts.length) {
    pushIssue("project-missing-account-ref", projectFile, missingAccounts.join(","));
  }

  const missingCopySources = (project.sourceMaterialIds || []).filter((id) => !copySourceIds.has(id));
  if (missingCopySources.length) {
    pushIssue("project-missing-copy-source-ref", projectFile, missingCopySources.join(","));
  }

  for (const file of files(path.join(base, "drafts"), ".json")) {
    const draftFile = path.join(base, "drafts", file);
    const draft = readJson(draftFile);
    if (!draft) continue;

    if (draft.targetType !== "project") {
      pushIssue("account-draft-in-project-dir", draftFile, draft.accountId);
    }
    if (draft.styleRef?.sourceAccountIds) {
      const missing = draft.styleRef.sourceAccountIds.filter((id) => !accountIds.has(id));
      if (missing.length) {
        pushIssue("project-draft-missing-account-ref", draftFile, missing.join(","));
      }
    }
    if (draft.styleRef?.sourceMaterialIds) {
      const missing = draft.styleRef.sourceMaterialIds.filter((id) => !copySourceIds.has(id));
      if (missing.length) {
        pushIssue("project-draft-missing-copy-source-ref", draftFile, missing.join(","));
      }
    }
  }
}

const counts = issues.reduce((acc, issue) => {
  acc[issue.type] = (acc[issue.type] || 0) + 1;
  return acc;
}, {});

console.log(
  JSON.stringify(
    {
      root,
      issueCount: issues.length,
      counts,
      issues
    },
    null,
    2
  )
);

if (issues.length) {
  process.exitCode = 1;
}
