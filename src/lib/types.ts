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
  publishedAt?: string;
  duration?: string | number;
  stats: VideoStats;
  hotScore: number;
  relativeViewRate: number;
  transcriptStatus: TranscriptStatus;
  transcriptPath?: string;
  transcriptSource?: "platform_subtitle" | "siliconflow" | "manual";
  downloadUrl?: string;
  topComments?: string[];
  raw?: unknown;
  updatedAt: string;
};

type DraftBase = {
  id: string;
  title: string;
  mode: "topic" | "rewrite";
  prompt: string;
  input?: string;
  content: string;
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
};

export type LibraryState = {
  root: string;
  accounts: AccountSummary[];
  projects: ProjectSummary[];
  drafts: Draft[];
  recentAccounts: AccountSummary[];
  recentProjects: ProjectSummary[];
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
