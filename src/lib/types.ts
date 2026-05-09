export const platforms = ["bilibili", "douyin"] as const;

export type Platform = (typeof platforms)[number];

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

export type Draft = {
  id: string;
  platform: Platform;
  accountId: string;
  accountName: string;
  title: string;
  mode: "topic" | "rewrite";
  prompt: string;
  input?: string;
  content: string;
  styleRef: {
    platform: Platform;
    accountId: string;
    accountName: string;
    videoIds?: string[];
  };
  createdAt: string;
  updatedAt: string;
};

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
  draft?: Draft;
  usedModel: string;
  fallback: boolean;
};

export type BatchTranscribeResult = {
  account: AccountSummary;
  requested: number;
  completed: number;
  skipped: number;
  failed: number;
  style?: string;
  styleUpdated?: boolean;
  styleError?: string;
  fallback?: boolean;
  usedModel?: string;
  results: Array<{
    videoId: string;
    title: string;
    status: "completed" | "skipped" | "failed";
    source?: Video["transcriptSource"] | string;
    error?: string;
  }>;
};
