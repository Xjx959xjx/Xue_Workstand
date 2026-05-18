export const platforms = ["bilibili", "douyin"] as const;

export type Platform = (typeof platforms)[number];

export const collectOrders = ["views", "likes", "favorites", "comments", "pubdate"] as const;

export type CollectOrder = (typeof collectOrders)[number];

export type TranscriptStatus =
  | "not_started"
  | "pending"
  | "transcribing"
  | "failed"
  | "completed";

export type Account = {
  id: string;
  slug: string;
  platform: Platform;
  name: string;
  uid: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastCollectedAt?: string;
};

export type VideoStats = {
  views: number;
  likes: number;
  comments: number;
  favorites: number;
  shares?: number;
};

export type Video = {
  id: string;
  platform: Platform;
  accountId: string;
  title: string;
  url: string;
  coverUrl?: string;
  publishedAt?: string;
  duration?: string | number;
  stats: VideoStats;
  hotScore: number;
  relativeViewRate: number;
  transcriptStatus: TranscriptStatus;
  transcriptPath?: string;
  transcriptSource?: "platform_subtitle" | "siliconflow" | "volcengine" | "manual";
  downloadUrl?: string;
  topComments?: string[];
  danmakuSamples?: string[];
  raw?: unknown;
  updatedAt: string;
};

export type DraftCommentAsset = {
  id: string;
  platform: Platform | "unknown";
  text: string;
};

export type DraftDanmakuAsset = {
  id: string;
  timeSec: number;
  text: string;
};

export type DraftCoverReference = {
  id: string;
  source: "account" | "upload";
  label: string;
  path?: string;
  url?: string;
  accountId?: string;
  accountName?: string;
  videoId?: string;
  videoTitle?: string;
  createdAt: string;
};

export type DraftCoverImage = {
  id: string;
  path: string;
  prompt: string;
  referenceIds: string[];
  model: string;
  size: string;
  quality: string;
  format: "jpeg" | "png" | "webp";
  createdAt: string;
};

export type DraftAssets = {
  comments?: {
    generatedAt: string;
    requestedCount: number;
    usedModel: string;
    fallback: boolean;
    fallbackReason?: string;
    items: DraftCommentAsset[];
  };
  danmaku?: {
    generatedAt: string;
    requestedCount: number;
    usedModel: string;
    fallback: boolean;
    fallbackReason?: string;
    items: DraftDanmakuAsset[];
  };
  cover?: {
    references: DraftCoverReference[];
    images: DraftCoverImage[];
    updatedAt: string;
  };
};

type DraftBase = {
  id: string;
  title: string;
  mode: "topic" | "rewrite";
  prompt: string;
  input?: string;
  content: string;
  assets?: DraftAssets;
  createdAt: string;
  updatedAt: string;
};

export type AccountDraft = DraftBase & {
  targetType?: "account";
  platform: Platform;
  accountId: string;
  accountName: string;
  styleRef: {
    platform: Platform;
    accountId: string;
    accountName: string;
    videoIds?: string[];
  };
};

export type ProjectDraft = DraftBase & {
  targetType: "project";
  projectId: string;
  projectName: string;
  styleRef: {
    projectId: string;
    projectName: string;
    sourceAccountIds?: string[];
    sourceMaterialIds?: string[];
  };
};

export type Draft = AccountDraft | ProjectDraft;

export type AccountDraftInput = Omit<AccountDraft, "id" | "createdAt" | "updatedAt">;

export type ProjectDraftInput = Omit<ProjectDraft, "id" | "createdAt" | "updatedAt">;

export type DraftInput = AccountDraftInput | ProjectDraftInput;

export type Project = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  sourceAccountIds: string[];
  sourceMaterialIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectSourceAccount = {
  id: string;
  name: string;
  platform: Platform;
  videoCount: number;
  transcriptCount: number;
};

export type AccountSummary = Account & {
  videoCount: number;
  transcriptCount: number;
  draftCount: number;
  style: string;
  videos: Video[];
  drafts: Draft[];
};

export type ProjectSummary = Project & {
  style: string;
  sourceAccounts: ProjectSourceAccount[];
  sourceMaterials: CopySource[];
  sourceMaterialCount: number;
};

export type CopySourceStatus = "completed" | "failed";

export type CopySource = {
  id: string;
  title: string;
  platform: Platform | "unknown";
  url: string;
  resolvedUrl?: string;
  transcript: string;
  transcriptPath: string;
  source: "platform_subtitle" | "volcengine" | "metadata" | "manual";
  status: CopySourceStatus;
  error?: string;
  fallback?: boolean;
  fallbackReason?: string;
  projectIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type EngagementSourceType = "draft" | "text" | "url";

export type EngagementRecord = {
  id: string;
  sourceType: EngagementSourceType;
  title: string;
  sourceUrl?: string;
  resolvedUrl?: string;
  platform: Platform | "unknown";
  draftId?: string;
  sourceText: string;
  options: {
    includeComments: boolean;
    commentCount: number;
    includeDanmaku: boolean;
    danmakuCount: number;
  };
  comments?: NonNullable<DraftAssets["comments"]>;
  danmaku?: NonNullable<DraftAssets["danmaku"]>;
  fallback: boolean;
  fallbackReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type LibraryState = {
  root: string;
  accounts: AccountSummary[];
  projects: ProjectSummary[];
  copySources: CopySource[];
  engagementRecords: EngagementRecord[];
  drafts: Draft[];
  recentAccounts: AccountSummary[];
  recentProjects: ProjectSummary[];
  recentCopySources: CopySource[];
  recentEngagementRecords: EngagementRecord[];
  recentDrafts: Draft[];
};

export type CollectResult = {
  account: AccountSummary;
  videos: Video[];
  command: string;
  rawCount: number;
  filteredCount: number;
  dateFilter?: {
    applied: boolean;
    fromDate?: string;
    toDate?: string;
    rawCount: number;
    matchedCount: number;
    filteredOutCount: number;
    missingDateCount: number;
    earliestPublishedAt?: string;
    latestPublishedAt?: string;
  };
};

export type WriteResult = {
  content: string;
  research?: string;
  draft?: Draft;
  usedModel: string;
  fallback: boolean;
  fallbackReason?: string;
};

export type BatchTranscribeResult = {
  account: AccountSummary;
  requested: number;
  completed: number;
  skipped: number;
  failed: number;
  timings?: Array<{
    stage: string;
    ms: number;
  }>;
  style?: string;
  styleUpdated?: boolean;
  styleError?: string;
  fallback?: boolean;
  fallbackReason?: string;
  usedModel?: string;
  results: Array<{
    videoId: string;
    title: string;
    status: "completed" | "skipped" | "failed";
    source?: Video["transcriptSource"] | string;
    error?: string;
    timings?: Array<{
      stage: string;
      ms: number;
    }>;
  }>;
};

export const jobKinds = [
  "write-copy",
  "account-style",
  "project-style",
  "transcribe-video",
  "batch-transcribe",
  "engagement"
] as const;

export type JobKind = (typeof jobKinds)[number];

export type JobStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export type JobResultRef = {
  id?: string;
  href: string;
  label: string;
};

export type JobRecord = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  inputSummary?: string;
  stage?: string;
  message: string;
  progress: number;
  href?: string;
  partialText?: string;
  resultRef?: JobResultRef;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type JobStartInput =
  | {
      kind: "write-copy";
      title?: string;
      inputSummary?: string;
      href?: string;
      input: {
        targetType?: "account" | "project";
        platform?: Platform;
        accountId?: string;
        projectId?: string;
        mode: Draft["mode"];
        prompt: string;
        sourceText?: string;
        save?: boolean;
        useWebResearch?: boolean;
      };
    }
  | {
      kind: "account-style";
      title?: string;
      inputSummary?: string;
      href?: string;
      input: {
        platform: Platform;
        accountId: string;
      };
    }
  | {
      kind: "project-style";
      title?: string;
      inputSummary?: string;
      href?: string;
      input: {
        projectId?: string;
        name: string;
        description?: string;
        sourceAccountIds: string[];
        sourceMaterialIds?: string[];
      };
    }
  | {
      kind: "transcribe-video";
      title?: string;
      inputSummary?: string;
      href?: string;
      input: {
        platform: Platform;
        accountId: string;
        videoId: string;
        mediaPath?: string;
        mediaUrl?: string;
        allowRemoteDownload?: boolean;
      };
    }
  | {
      kind: "batch-transcribe";
      title?: string;
      inputSummary?: string;
      href?: string;
      input: {
        platform: Platform;
        accountId: string;
        limit: number | "all";
        updateStyle?: boolean;
      };
    }
  | {
      kind: "engagement";
      title?: string;
      inputSummary?: string;
      href?: string;
      input:
        | {
            sourceType: "draft";
            draftId: string;
            includeComments: boolean;
            commentCount: number;
            includeDanmaku: boolean;
            danmakuCount: number;
          }
        | {
            sourceType: "text";
            title?: string;
            text: string;
            includeComments: boolean;
            commentCount: number;
            includeDanmaku: boolean;
            danmakuCount: number;
          }
        | {
            sourceType: "url";
            url: string;
            includeComments: boolean;
            commentCount: number;
            includeDanmaku: boolean;
            danmakuCount: number;
          };
    };
