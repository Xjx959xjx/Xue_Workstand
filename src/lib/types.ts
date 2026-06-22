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
  avatarUrl?: string;
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

export type VideoHotlistTrend = {
  previousHotScore: number;
  currentHotScore: number;
  heatDelta: number;
  intervalHours: number;
  previousUpdatedAt: string;
  updatedAt: string;
};

export type VideoHotlistSurgeState = {
  heatDelta: number;
  heatPerHour: number;
  intervalHours: number;
  detectedAt: string;
  expiresAt: string;
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
  hotlistTrend?: VideoHotlistTrend;
  hotlistSurge?: VideoHotlistSurgeState;
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
    diagnostics?: {
      sourceBrief?: {
        summary: string;
        topic: string;
        subjects: string[];
        keyFacts: string[];
        audiencePersonas?: string[];
        viewerScenes: string[];
        discussionAngles: string[];
        skepticalAngles: string[];
        anchorTerms: string[];
      };
      entityGuard?: {
        allowedModels: string[];
        correctedTerms: {
          from: string;
          to: string;
          stage: "brief" | "relatedResearch" | "comment";
        }[];
      };
      relatedResearch?: {
        usedQueries: string[];
        failedQueries: string[];
        relatedVideoCount: number;
        relatedCommentCount: number;
        longCommentCount?: number;
        lengthBuckets?: {
          short: number;
          medium: number;
          long: number;
        };
        intentBuckets?: {
          reaction: number;
          question: number;
          price: number;
          comparison: number;
          skeptical: number;
          experience: number;
          follow: number;
          chatter: number;
        };
        themes: string[];
        phrases: string[];
        questions: string[];
        objections: string[];
        longCommentPatterns?: string[];
        chatterAngles?: string[];
        summaryError?: string;
      };
      research?: {
        originalCommentCount: number;
        originalCommentUsed: number;
        relatedCommentCount: number;
        relatedCommentUsed: number;
        relatedVideoCount: number;
        relatedLongCommentCount?: number;
        relatedIntentBuckets?: {
          reaction: number;
          question: number;
          price: number;
          comparison: number;
          skeptical: number;
          experience: number;
          follow: number;
          chatter: number;
        };
        usedQueries: string[];
        failedQueries: string[];
        skippedRelatedSearch: boolean;
        sourceCommentCount?: number;
        sourceAwemeId?: string;
        sourceTitle?: string;
        originalFetchError?: string;
      }[];
      generation?: {
        mode?: "keyword_local" | "model_batch";
        requestedCount: number;
        batchSize: number;
        batchCount: number;
        parsedCount: number;
        completedCount: number;
        supplementedCount: number;
        targetLongCommentCount?: number;
        lengthBuckets?: {
          short: number;
          medium: number;
          long: number;
        };
        targetIntentBuckets?: {
          reaction: number;
          question: number;
          price: number;
          comparison: number;
          skeptical: number;
          experience: number;
          follow: number;
          chatter: number;
        };
        intentBuckets?: {
          reaction: number;
          question: number;
          price: number;
          comparison: number;
          skeptical: number;
          experience: number;
          follow: number;
          chatter: number;
        };
        lowSignalRejectedCount?: number;
        syntheticRejectedCount?: number;
        nearDuplicateRejectedCount?: number;
        repeatedStyleRejectedCount?: number;
        entityCorrectedCount?: number;
        unsupportedEntityRejectedCount?: number;
        batches: {
          index: number;
          requestedCount: number;
          parsedCount: number;
          model: string;
          fallback: boolean;
          fallbackReason?: string;
        }[];
      };
    };
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
  supportDocLinks?: string;
  brief?: string;
  sourceDigest?: WriteSourceDigest;
  content: string;
  assets?: DraftAssets;
  createdAt: string;
  updatedAt: string;
};

export type WriteSourceDigest = {
  resolvedSourceText?: string;
  materialCount: number;
  linkCount: number;
  textMaterialCount: number;
  onlyLinkCount: number;
  supportDocProvided?: boolean;
  webResearchEnabled?: boolean;
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

export type VideoListItem = Omit<Video, "raw" | "hotlistTrend" | "hotlistSurge">;

export type AccountListItem = Account & {
  videoCount: number;
  transcriptCount: number;
  draftCount: number;
};

export type AccountSummary = Account & {
  videoCount: number;
  transcriptCount: number;
  draftCount: number;
  style: string;
  videos: Video[];
  drafts: Draft[];
};

export type AccountDetail = Omit<AccountSummary, "videos" | "style"> & {
  style?: string;
  videos: VideoListItem[];
};

export type ProjectListItem = Project & {
  sourceAccounts: ProjectSourceAccount[];
  sourceMaterialCount: number;
};

export type ProjectSummary = Project & {
  style: string;
  sourceAccounts: ProjectSourceAccount[];
  sourceMaterials: CopySource[];
  sourceMaterialCount: number;
};

export type ProjectDetail = Omit<ProjectSummary, "style"> & {
  style?: string;
};

export type CopySourceStatus = "completed" | "failed";

export type CopySourceMaterialAnalysis = {
  mode: "multimodal" | "textual";
  status: "completed" | "skipped" | "failed";
  summary: string;
  visualNotes?: string;
  structureNotes?: string;
  titleNotes?: string;
  frameCount?: number;
  fallbackReason?: string;
  error?: string;
  generatedAt: string;
};

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
  materialAnalysis?: CopySourceMaterialAnalysis;
  projectIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type EngagementSourceType = "draft" | "text" | "url";

export type EngagementRecord = {
  id: string;
  sourceType: EngagementSourceType;
  title: string;
  sourceAccountName?: string;
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

export type GrossMarginTier = {
  id: string;
  name: string;
  originalPrice: number;
  maintenanceCost: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type GrossMarginCategory = {
  id: string;
  name: string;
  description?: string;
  tiers: GrossMarginTier[];
  createdAt: string;
  updatedAt: string;
};

export type GrossMarginServiceKind =
  | "play"
  | "like"
  | "douPlus"
  | "coin"
  | "comment"
  | "share"
  | "favorite"
  | "danmaku"
  | "blueLink";

export type GrossMarginPriceOption = {
  id: string;
  service: GrossMarginServiceKind;
  name: string;
  unitPrice: number;
  quantityUnit: string;
  minimumQuantity?: number;
  note?: string;
  active?: boolean;
  updatedAt: string;
};

export type GrossMarginPriceTable = {
  platform: Extract<Platform, "bilibili" | "douyin">;
  items: GrossMarginPriceOption[];
  updatedAt: string;
};

export type GrossMarginPriceTableSaveItem = Pick<
  GrossMarginPriceOption,
  "id" | "service" | "name" | "unitPrice" | "quantityUnit" | "note" | "active"
> & {
  minimumQuantity?: number | null;
};

export type GrossMarginAccountPrice = {
  platform: GrossMarginPriceTable["platform"];
  name: string;
  defaultPrice: number;
  priceLabel: string;
  secondaryPrice?: number;
  secondaryPriceLabel?: string;
  douyinId?: string;
  cooperationCode?: string;
  bilibiliUid?: string;
  homepage?: string;
};

export type GrossMarginReviewTemplate = {
  platform: GrossMarginPriceTable["platform"];
  content: string;
  defaultContent: string;
  customized: boolean;
  updatedAt: string;
};

export type GrossMarginCalculationLine = {
  service: GrossMarginServiceKind;
  label: string;
  optionId: string;
  optionName: string;
  quantity: number;
  unitPrice: number;
  quantityUnit: string;
  total: number;
};

export type GrossMarginMonitorStatus = "pending" | "completed" | "partial" | "failed";

export type GrossMarginMonitorMetric = {
  service: GrossMarginServiceKind;
  label: string;
  target: number;
  current?: number;
  difference: number;
  differencePercent: number;
  highRisk: boolean;
  manualOnly?: boolean;
};

export type GrossMarginMonitorPlaySample = {
  value: number;
  capturedAt: string;
  source: "refresh" | "manual";
};

export type GrossMarginMonitorRecord = {
  id: string;
  platform: GrossMarginPriceTable["platform"];
  accountName: string;
  projectId?: string;
  projectName?: string;
  videoUrl: string;
  videoKey: string;
  title?: string;
  publishedAt?: string;
  sourceText: string;
  targetStats: Partial<Record<GrossMarginServiceKind, number>>;
  currentStats?: Partial<Record<GrossMarginServiceKind, number>>;
  previousStats?: Partial<Record<GrossMarginServiceKind, number>>;
  playSamples?: GrossMarginMonitorPlaySample[];
  metrics: GrossMarginMonitorMetric[];
  maxDifferencePercent: number;
  highRisk: boolean;
  status: GrossMarginMonitorStatus;
  warnings: string[];
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type GrossMarginLibrary = {
  root: string;
  tables: GrossMarginPriceTable[];
  templates: GrossMarginReviewTemplate[];
  accounts: GrossMarginAccountPrice[];
  monitorRecords: GrossMarginMonitorRecord[];
  monitorProjects: Array<{
    id: string;
    name: string;
    count: number;
    updatedAt: string;
  }>;
};

export type GrossMarginCalculationInput = {
  platform: GrossMarginPriceTable["platform"];
  originalPrice: number;
  discountPrice: number;
  lines: GrossMarginCalculationLine[];
};

export type GrossMarginCalculationResult = {
  originalPrice: number;
  discountPrice: number;
  maintenanceCost: number;
  grossProfit: number;
  grossMarginRate: number;
  discountRate: number;
  lines: GrossMarginCalculationLine[];
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

export type LibraryOverview = {
  root: string;
  accounts: AccountListItem[];
  projects: ProjectListItem[];
  copySources: CopySource[];
  engagementRecords: EngagementRecord[];
  drafts: Draft[];
  recentAccounts: AccountListItem[];
  recentProjects: ProjectListItem[];
  recentCopySources: CopySource[];
  recentEngagementRecords: EngagementRecord[];
  recentDrafts: Draft[];
};

export type LibraryOverviewResponse = Omit<
  LibraryOverview,
  "recentAccounts" | "recentProjects" | "recentCopySources" | "recentEngagementRecords" | "recentDrafts"
>;

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

export type DouyinHotlistAccount = Pick<
  Account,
  "id" | "slug" | "platform" | "name" | "uid" | "sourceUrl" | "avatarUrl" | "createdAt" | "updatedAt" | "lastCollectedAt"
> & {
  videoCount: number;
  recentVideoCount: number;
};

export type DouyinHotlistItem = {
  rank: number;
  account: Pick<Account, "id" | "name" | "uid" | "avatarUrl">;
  video: VideoListItem;
  heatScore: number;
  ageHours?: number;
  tags: string[];
  signal: string;
  surge?: DouyinHotlistSurgeHighlight;
};

export type DouyinHotlistSurgeHighlight = {
  label: string;
  reason: string;
  heatDelta: number;
  heatPerHour: number;
  intervalHours: number;
};

export type DouyinHotlistSummary = {
  windowKey: string;
  windowLabel: string;
  windowDays: number;
  windowHours?: number;
  fromDate: string;
  toDate: string;
  accountCount: number;
  staleAccountIds: string[];
  totalVideoCount: number;
  recentVideoCount: number;
  lastRefreshedAt?: string;
};

export type DouyinHotlistResponse = {
  root: string;
  accounts: DouyinHotlistAccount[];
  items: DouyinHotlistItem[];
  summary: DouyinHotlistSummary;
};

export type DouyinHotlistRefreshAccountResult = {
  accountId: string;
  name: string;
  status: "completed" | "failed";
  rawCount?: number;
  savedCount?: number;
  error?: string;
  mode?: "batch" | "single";
  retried?: boolean;
  retryReason?: string;
};

export type DouyinHotlistRefreshResult = DouyinHotlistResponse & {
  refresh: {
    requested: number;
    completed: number;
    failed: number;
    limit: number;
    accounts: DouyinHotlistRefreshAccountResult[];
  };
};

export type WriteResult = {
  content: string;
  brief?: string;
  research?: string;
  sourceDigest?: WriteSourceDigest;
  draft?: Draft;
  usedModel: string;
  fallback: boolean;
  fallbackReason?: string;
};

export type WriteBriefResult = {
  brief: string;
  research?: string;
  sourceDigest: WriteSourceDigest;
  targetTitle: string;
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

export type JobStatus = "queued" | "running" | "completed" | "failed" | "interrupted" | "cancelled";

export type JobResultRef = {
  id?: string;
  href: string;
  label: string;
};

export type JobEvent = {
  at: string;
  status: JobStatus;
  stage?: string;
  message: string;
  progress: number;
};

export type JobScope = {
  targetType?: "account" | "project" | "draft" | "url" | "text";
  platform?: Platform;
  accountId?: string;
  projectId?: string;
  videoId?: string;
  draftId?: string;
  sourceKey?: string;
};

export type JobRecord = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  inputSummary?: string;
  scope?: JobScope;
  stage?: string;
  message: string;
  progress: number;
  href?: string;
  partialText?: string;
  resultRef?: JobResultRef;
  result?: unknown;
  events?: JobEvent[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type JobListItem = Omit<JobRecord, "partialText" | "result"> & {
  hasPartialText?: boolean;
  hasResult?: boolean;
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
        supportDocLinks?: string;
        brief?: string;
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
