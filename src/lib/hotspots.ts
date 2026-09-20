import { mapWithConcurrency } from "./concurrency";
import path from "path";
import { getDouyinHotlist } from "./douyin-hotlist";
import { libraryRoot } from "./storage/core";
import { readJsonFile, writeJsonFile } from "./storage/fs";
import type {
  DouyinHotlistItem,
  HotspotBoard,
  HotspotEvent,
  HotspotMonitorType,
  HotspotRadarRefreshResult,
  HotspotRadarResponse,
  HotspotScout,
  HotspotSignal,
  HotspotSourceType,
  HotspotStatus
} from "./types";
import { clampText, nowIso, shortHash } from "./utils";

type SourceKind = "rss" | "html-links" | "steam-news" | "news-rss" | "video-hotlist";

type HotspotSourceConfig = {
  id: string;
  board: HotspotBoard;
  name: string;
  type: HotspotSourceType;
  kind: SourceKind;
  scope: string;
  cadence: string;
  labels: string[];
  url?: string;
  query?: string;
  steamAppId?: number;
  limit: number;
};

type CollectedSource = {
  config: HotspotSourceConfig;
  status: "completed" | "failed";
  signals: HotspotSignal[];
  error?: string;
  checkedAt: string;
};

type RawSignalInput = {
  title: string;
  url?: string;
  publishedAt?: string;
  summary?: string;
  heatHint?: number;
  tags?: string[];
};

type HotspotMonitorProfile = {
  type: HotspotMonitorType;
  label: string;
  shortLabel: string;
  description: string;
  triggerMode: string;
  thresholdHint: string;
  defaultActionWindow: string;
  scopeLabels: string[];
};

const MONITOR_PROFILES: Record<HotspotMonitorType, HotspotMonitorProfile> = {
  operations: {
    type: "operations",
    label: "突发运营类",
    shortLabel: "突发运营",
    description: "停服、封号、BUG、回档、维权、侵权等影响全体玩家的运营事故。",
    triggerMode: "事故词 + 头部游戏命中 + 社区/视频扩散",
    thresholdHint: "P0：头部游戏 + 事故词；P1：次重点游戏 + 多源扩散",
    defaultActionWindow: "15 分钟内核验",
    scopeLabels: ["头部游戏", "运营事故", "玩家维权"]
  },
  official: {
    type: "official",
    label: "官方官宣类",
    shortLabel: "官方官宣",
    description: "版号、定档、公测、大版本、IP 联动、发布会、政策和公司战略。",
    triggerMode: "官方/权威媒体信号 + 重点新品或固定发布会节点",
    thresholdHint: "P1：官方源或权威源命中；P2：媒体爆料待二次确认",
    defaultActionWindow: "2 小时内跟进",
    scopeLabels: ["待上线新品", "发布会节点", "行业政策"]
  },
  esports: {
    type: "esports",
    label: "赛事电竞类",
    shortLabel: "赛事电竞",
    description: "顶级赛事、爆冷对局、赛事丑闻、明星选手转会/退役/高光。",
    triggerMode: "赛事节点 + 选手/战队命中 + 赛果或讨论增速",
    thresholdHint: "P1：顶级赛事/明星选手；P2：次级赛事持续扩散",
    defaultActionWindow: "赛后 30 分钟内切入",
    scopeLabels: ["顶级赛事", "明星选手", "战队节奏"]
  },
  breakout: {
    type: "breakout",
    label: "娱乐破圈类",
    shortLabel: "娱乐破圈",
    description: "游戏影视动画、跨界联动、二创梗传播、小众内容出圈。",
    triggerMode: "数据增速 + 多平台蔓延 + 破圈关键词",
    thresholdHint: "P1：短时间起量并跨平台；P2：单平台高热先观察",
    defaultActionWindow: "1 小时内判断能否跟",
    scopeLabels: ["影视动画", "游戏梗", "跨界联动"]
  }
};

const OPERATIONS_SCOPE_TERMS = [
  "王者荣耀",
  "和平精英",
  "三角洲行动",
  "逆战：未来",
  "逆水寒手游",
  "梦幻西游",
  "蛋仔派对",
  "燕云十六声",
  "第五人格",
  "永劫无间",
  "原神",
  "崩坏：星穹铁道",
  "绝区零",
  "鸣潮",
  "战双帕弥什",
  "恋与深空",
  "无限暖暖",
  "少女前线",
  "晶核",
  "以闪亮之名",
  "万国觉醒",
  "剑与远征"
];

const OFFICIAL_SCOPE_TERMS = [
  "版号",
  "归环",
  "怪物猎人：旅人",
  "彩虹六号：攻势",
  "穿越火线：虹",
  "穿越火线：潜伏",
  "异人之下",
  "失控进化",
  "湮灭之潮",
  "无限大",
  "遗忘之海",
  "命运：群星",
  "逆水寒：新世界",
  "崩坏：因缘精灵",
  "星布谷地",
  "雨雾之都",
  "源初之结",
  "代号 NAMI",
  "代号湍流",
  "SPARK",
  "网易 520",
  "Nintendo Direct",
  "Xbox Games Showcase",
  "Gamescom",
  "TGS",
  "TGA",
  "ChinaJoy",
  "Bilibili World"
];

const ESPORTS_SCOPE_TERMS = [
  "LPL",
  "S赛",
  "MSI",
  "LCK",
  "Major",
  "IEM",
  "CAC",
  "TI国际邀请赛",
  "VCT",
  "KPL",
  "PEL",
  "PCL",
  "CFS",
  "CFPL",
  "NBPL",
  "电竞世界杯",
  "Faker",
  "Chovy",
  "Zeus",
  "Keria",
  "Uzi",
  "Xiaohu",
  "Scout",
  "Bin",
  "JackeyLove",
  "Rookie",
  "ZywOo",
  "m0NESY",
  "donk",
  "NiKo",
  "ZmjjKK",
  "TenZ",
  "Yatoro",
  "昊天",
  "梦泪",
  "一诺",
  "清融",
  "花海",
  "妖刀"
];

const BREAKOUT_SCOPE_TERMS = [
  "荣耀之章",
  "DNF",
  "地下城与勇士",
  "纸嫁衣",
  "街头霸王",
  "生化危机",
  "塞尔达传说",
  "艾尔登法环",
  "索尼克 4",
  "动画",
  "电影",
  "影视化",
  "二创",
  "联动",
  "出圈"
];

const MONITOR_SCOPE_TERMS: Record<HotspotMonitorType, string[]> = {
  operations: OPERATIONS_SCOPE_TERMS,
  official: OFFICIAL_SCOPE_TERMS,
  esports: ESPORTS_SCOPE_TERMS,
  breakout: BREAKOUT_SCOPE_TERMS
};

const OPERATIONS_NEWS_QUERY = "王者荣耀 OR 和平精英 OR 三角洲行动 OR 逆水寒手游 OR 原神 OR 永劫无间 停服 OR 封号 OR BUG OR 维权 OR 回档";
const OFFICIAL_NEWS_QUERY = "版号 OR 归环 OR 怪物猎人旅人 OR 彩虹六号攻势 OR 无限大 OR 命运群星 OR SPARK腾讯游戏发布会 OR 网易520";
const BREAKOUT_NEWS_QUERY = "王者荣耀 动画 OR DNF 动画 OR 纸嫁衣 动画 OR 游戏 改编 电影 OR 游戏梗 出圈 OR 游戏 二创";
const GAME_FOCUS_NEWS_QUERY = "王者荣耀 OR 和平精英 OR 三角洲行动 OR 逆水寒手游 OR 蛋仔派对 OR 燕云十六声 OR 第五人格 OR 永劫无间 OR 原神 OR 绝区零 OR 鸣潮";

const FIRST_WAVE_SOURCES: HotspotSourceConfig[] = [
  {
    id: "video-hotlist",
    board: "game",
    name: "视频热榜快照",
    type: "video",
    kind: "video-hotlist",
    scope: "抖音 / B站 对标账号",
    cadence: "30 分钟",
    labels: ["抖音", "B站", "对标账号"],
    limit: 10
  },
  {
    id: "google-operations-cn",
    board: "game",
    name: "Google News · 突发运营",
    type: "news",
    kind: "news-rss",
    scope: "头部游戏 / 停服封号 / BUG 维权",
    cadence: "20 分钟",
    labels: ["Google News", "突发运营", "头部游戏"],
    query: OPERATIONS_NEWS_QUERY,
    url: googleNewsUrl(OPERATIONS_NEWS_QUERY, "zh-CN", "CN", "CN:zh-Hans"),
    limit: 12
  },
  {
    id: "gcores-rss",
    board: "game",
    name: "机核 RSS",
    type: "news",
    kind: "rss",
    scope: "游戏深度 / 行业动态",
    cadence: "60 分钟",
    labels: ["RSS", "游戏媒体"],
    url: "https://www.gcores.com/rss",
    limit: 12
  },
  {
    id: "gamersky-news",
    board: "game",
    name: "游民星空",
    type: "news",
    kind: "html-links",
    scope: "游戏新闻 / 舆情",
    cadence: "60 分钟",
    labels: ["公开页面", "游戏新闻"],
    url: "https://www.gamersky.com/news/",
    limit: 12
  },
  {
    id: "3dm-news",
    board: "game",
    name: "3DM 新闻",
    type: "news",
    kind: "html-links",
    scope: "游戏新闻 / 版本动态",
    cadence: "60 分钟",
    labels: ["公开页面", "游戏新闻"],
    url: "https://www.3dmgame.com/news/",
    limit: 12
  },
  {
    id: "steam-cs2",
    board: "game",
    name: "Steam 官方 · CS2",
    type: "official",
    kind: "steam-news",
    scope: "官方公告 / 更新日志",
    cadence: "60 分钟",
    labels: ["Steam", "官方 API"],
    steamAppId: 730,
    limit: 5
  },
  {
    id: "steam-dota2",
    board: "game",
    name: "Steam 官方 · Dota 2",
    type: "official",
    kind: "steam-news",
    scope: "官方公告 / 更新日志",
    cadence: "60 分钟",
    labels: ["Steam", "官方 API"],
    steamAppId: 570,
    limit: 5
  },
  {
    id: "google-official-games-cn",
    board: "game",
    name: "Google News · 官宣新品",
    type: "news",
    kind: "news-rss",
    scope: "版号 / 新游 / 发布会 / 定档测试",
    cadence: "45 分钟",
    labels: ["Google News", "官方官宣", "新品"],
    query: OFFICIAL_NEWS_QUERY,
    url: googleNewsUrl(OFFICIAL_NEWS_QUERY, "zh-CN", "CN", "CN:zh-Hans"),
    limit: 12
  },
  {
    id: "google-game-cn",
    board: "game",
    name: "Google News · 游戏中文",
    type: "news",
    kind: "news-rss",
    scope: "中文关键词新闻",
    cadence: "60 分钟",
    labels: ["Google News", "关键词"],
    query: GAME_FOCUS_NEWS_QUERY,
    url: googleNewsUrl(GAME_FOCUS_NEWS_QUERY, "zh-CN", "CN", "CN:zh-Hans"),
    limit: 12
  },
  {
    id: "google-game-en",
    board: "game",
    name: "Google News · 游戏海外",
    type: "news",
    kind: "news-rss",
    scope: "海外游戏关键词新闻",
    cadence: "60 分钟",
    labels: ["Google News", "海外"],
    query: "gaming news OR steam OR playstation OR xbox",
    url: googleNewsUrl("gaming news OR steam OR playstation OR xbox", "en-US", "US", "US:en"),
    limit: 12
  },
  {
    id: "bing-game-cn",
    board: "game",
    name: "Bing News · 游戏中文",
    type: "news",
    kind: "news-rss",
    scope: "中文新闻补充",
    cadence: "60 分钟",
    labels: ["Bing News", "关键词"],
    query: GAME_FOCUS_NEWS_QUERY,
    url: bingNewsUrl(GAME_FOCUS_NEWS_QUERY),
    limit: 10
  },
  {
    id: "bing-game-en",
    board: "game",
    name: "Bing News · 游戏海外",
    type: "news",
    kind: "news-rss",
    scope: "海外游戏新闻补充",
    cadence: "60 分钟",
    labels: ["Bing News", "海外"],
    query: "gaming news steam playstation xbox",
    url: bingNewsUrl("gaming news steam playstation xbox"),
    limit: 10
  },
  {
    id: "google-game-breakout-cn",
    board: "entertainment",
    name: "Google News · 游戏破圈",
    type: "news",
    kind: "news-rss",
    scope: "游戏影视化 / 二创梗 / 跨界传播",
    cadence: "45 分钟",
    labels: ["Google News", "娱乐破圈", "游戏IP"],
    query: BREAKOUT_NEWS_QUERY,
    url: googleNewsUrl(BREAKOUT_NEWS_QUERY, "zh-CN", "CN", "CN:zh-Hans"),
    limit: 12
  },
  {
    id: "google-entertainment-cn",
    board: "entertainment",
    name: "Google News · 娱乐中文",
    type: "news",
    kind: "news-rss",
    scope: "影视 / 明星 / 综艺 / 演出",
    cadence: "60 分钟",
    labels: ["Google News", "娱乐"],
    query: "电影 OR 电视剧 OR 综艺 OR 明星 OR 演唱会 OR 票房",
    url: googleNewsUrl("电影 OR 电视剧 OR 综艺 OR 明星 OR 演唱会 OR 票房", "zh-CN", "CN", "CN:zh-Hans"),
    limit: 12
  },
  {
    id: "bing-entertainment-cn",
    board: "entertainment",
    name: "Bing News · 娱乐中文",
    type: "news",
    kind: "news-rss",
    scope: "中文娱乐新闻补充",
    cadence: "60 分钟",
    labels: ["Bing News", "娱乐"],
    query: "电影 电视剧 综艺 明星 演唱会 票房",
    url: bingNewsUrl("电影 电视剧 综艺 明星 演唱会 票房"),
    limit: 10
  },
  {
    id: "google-entertainment-en",
    board: "entertainment",
    name: "Google News · 娱乐海外",
    type: "news",
    kind: "news-rss",
    scope: "海外影视 / 音乐 / 名人",
    cadence: "60 分钟",
    labels: ["Google News", "Entertainment"],
    query: "movie OR music OR celebrity OR box office",
    url: googleNewsUrl("movie OR music OR celebrity OR box office", "en-US", "US", "US:en"),
    limit: 12
  },
  {
    id: "variety-rss",
    board: "entertainment",
    name: "Variety RSS",
    type: "news",
    kind: "rss",
    scope: "海外影视娱乐",
    cadence: "60 分钟",
    labels: ["RSS", "海外娱乐"],
    url: "https://variety.com/feed/",
    limit: 12
  },
  {
    id: "deadline-rss",
    board: "entertainment",
    name: "Deadline RSS",
    type: "news",
    kind: "rss",
    scope: "海外影视行业",
    cadence: "60 分钟",
    labels: ["RSS", "海外娱乐"],
    url: "https://deadline.com/feed/",
    limit: 12
  },
  {
    id: "google-esports-cn",
    board: "esports",
    name: "Google News · 赛事中文",
    type: "news",
    kind: "news-rss",
    scope: "电竞赛事 / 赛程赛果",
    cadence: "45 分钟",
    labels: ["Google News", "电竞"],
    query: "电竞 OR VCT OR LPL OR KPL OR IEM OR Major",
    url: googleNewsUrl("电竞 OR VCT OR LPL OR KPL OR IEM OR Major", "zh-CN", "CN", "CN:zh-Hans"),
    limit: 12
  },
  {
    id: "bing-esports-cn",
    board: "esports",
    name: "Bing News · 赛事中文",
    type: "news",
    kind: "news-rss",
    scope: "中文电竞新闻补充",
    cadence: "45 分钟",
    labels: ["Bing News", "电竞"],
    query: "电竞 VCT LPL KPL IEM Major",
    url: bingNewsUrl("电竞 VCT LPL KPL IEM Major"),
    limit: 10
  },
  {
    id: "google-esports-en",
    board: "esports",
    name: "Google News · 赛事海外",
    type: "news",
    kind: "news-rss",
    scope: "海外电竞赛事",
    cadence: "45 分钟",
    labels: ["Google News", "Esports"],
    query: "valorant esports OR cs2 esports OR dota 2 esports OR league of legends esports",
    url: googleNewsUrl("valorant esports OR cs2 esports OR dota 2 esports OR league of legends esports", "en-US", "US", "US:en"),
    limit: 12
  },
  {
    id: "hltv-rss",
    board: "esports",
    name: "HLTV RSS",
    type: "news",
    kind: "rss",
    scope: "CS2 赛事 / 选手动态",
    cadence: "45 分钟",
    labels: ["RSS", "CS2"],
    url: "https://www.hltv.org/rss/news",
    limit: 12
  },
  {
    id: "openai-news-rss",
    board: "ai",
    name: "OpenAI News RSS",
    type: "official",
    kind: "rss",
    scope: "OpenAI 官方新闻",
    cadence: "60 分钟",
    labels: ["OpenAI", "官方"],
    url: "https://openai.com/news/rss.xml",
    limit: 10
  },
  {
    id: "google-ai-cn",
    board: "ai",
    name: "Google News · AI 中文",
    type: "news",
    kind: "news-rss",
    scope: "中文 AI / 大模型新闻",
    cadence: "60 分钟",
    labels: ["Google News", "AI"],
    query: "AI OR 人工智能 OR 大模型 OR ChatGPT OR Sora OR Claude OR Gemini",
    url: googleNewsUrl("AI OR 人工智能 OR 大模型 OR ChatGPT OR Sora OR Claude OR Gemini", "zh-CN", "CN", "CN:zh-Hans"),
    limit: 12
  },
  {
    id: "bing-ai-cn",
    board: "ai",
    name: "Bing News · AI 中文",
    type: "news",
    kind: "news-rss",
    scope: "中文 AI 新闻补充",
    cadence: "60 分钟",
    labels: ["Bing News", "AI"],
    query: "AI 人工智能 大模型 ChatGPT Sora Claude Gemini",
    url: bingNewsUrl("AI 人工智能 大模型 ChatGPT Sora Claude Gemini"),
    limit: 10
  },
  {
    id: "google-ai-en",
    board: "ai",
    name: "Google News · AI 海外",
    type: "news",
    kind: "news-rss",
    scope: "海外 AI / 模型新闻",
    cadence: "60 分钟",
    labels: ["Google News", "AI"],
    query: "OpenAI OR ChatGPT OR Sora OR Anthropic OR Claude OR Gemini AI",
    url: googleNewsUrl("OpenAI OR ChatGPT OR Sora OR Anthropic OR Claude OR Gemini AI", "en-US", "US", "US:en"),
    limit: 12
  },
  {
    id: "techcrunch-ai-rss",
    board: "ai",
    name: "TechCrunch AI RSS",
    type: "news",
    kind: "rss",
    scope: "海外 AI 创业 / 产品",
    cadence: "60 分钟",
    labels: ["RSS", "AI"],
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    limit: 10
  }
];

const REQUEST_TIMEOUT_MS = 9_000;
const MAX_CONCURRENCY = 6;
const SNAPSHOT_CACHE_DIR = "hotspots";
const SNAPSHOT_CACHE_FILE = "radar-snapshot.json";
const USER_AGENT = "Mozilla/5.0 HotspotRadar/0.1 (+local-workbench)";
const ESPORTS_CONTEXT_PATTERN = /电竞|电子竞技|\besports?\b|e-sports|\bvct\b|\biem\b|\blpl\b|\blck\b|\bkpl\b|\bmsi\b|\bpgl\b|\bblast\b|hltv|the international|电竞世界杯|esports world cup|league of legends|英雄联盟|王者荣耀|无畏契约|valorant|counter-?strike|\bcs2\b|\bdota\b|\bpubg\b|绝地求生/i;

function googleNewsUrl(query: string, language: string, region: string, edition: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(region)}&ceid=${encodeURIComponent(edition)}`;
}

function bingNewsUrl(query: string) {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
}

let cachedSnapshot: HotspotRadarRefreshResult | null = null;
let activeRefreshPromise: Promise<HotspotRadarRefreshResult> | null = null;

type HotspotRefreshOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number; sourceName: string; failed: boolean }) => void | Promise<void>;
};

export async function getHotspotRadar(options: { refresh?: boolean } & HotspotRefreshOptions = {}): Promise<HotspotRadarRefreshResult> {
  if (options.refresh) {
    return refreshHotspotRadar({ signal: options.signal });
  }

  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const persistedSnapshot = await readHotspotRadarSnapshot();
  if (persistedSnapshot) {
    cachedSnapshot = persistedSnapshot;
    return persistedSnapshot;
  }

  return buildEmptyHotspotRadarSnapshot();
}

export async function refreshHotspotRadar(options: HotspotRefreshOptions = {}) {
  if (activeRefreshPromise) return activeRefreshPromise;

  const promise = refreshHotspotRadarUnlocked(options).then(async (snapshot) => {
    await writeHotspotRadarSnapshot(snapshot);
    cachedSnapshot = snapshot;
    return snapshot;
  });
  activeRefreshPromise = promise;
  try {
    return await promise;
  } finally {
    if (activeRefreshPromise === promise) activeRefreshPromise = null;
  }
}

function hotspotSnapshotPath() {
  return path.join(libraryRoot(), SNAPSHOT_CACHE_DIR, SNAPSHOT_CACHE_FILE);
}

async function readHotspotRadarSnapshot() {
  const snapshot = await readJsonFile<HotspotRadarRefreshResult>(hotspotSnapshotPath());
  if (!snapshot) return null;
  if (!isHotspotRadarSnapshot(snapshot)) {
    throw new Error("热点雷达快照格式不正确，请刷新信号重新生成。");
  }
  return snapshot;
}

async function writeHotspotRadarSnapshot(snapshot: HotspotRadarRefreshResult) {
  await writeJsonFile(hotspotSnapshotPath(), snapshot);
}

function isHotspotRadarSnapshot(snapshot: HotspotRadarRefreshResult) {
  return (
    Boolean(snapshot)
    && typeof snapshot.generatedAt === "string"
    && Array.isArray(snapshot.scouts)
    && Array.isArray(snapshot.signals)
    && Array.isArray(snapshot.hotspots)
    && Boolean(snapshot.summary)
    && typeof snapshot.summary === "object"
  );
}

function buildEmptyHotspotRadarSnapshot(): HotspotRadarRefreshResult {
  return {
    generatedAt: "",
    scouts: FIRST_WAVE_SOURCES.map(toPausedScout),
    signals: [],
    hotspots: [],
    summary: {
      sourceCount: FIRST_WAVE_SOURCES.length,
      completedSourceCount: 0,
      failedSourceCount: 0,
      signalCount: 0,
      hotspotCount: 0,
      readyCount: 0,
      averageScore: 0,
      boardStats: buildEmptyBoardStats(),
      generatedAt: ""
    },
    refresh: {
      requested: 0,
      completed: 0,
      failed: 0,
      sources: []
    }
  };
}

function toPausedScout(config: HotspotSourceConfig): HotspotScout {
  return {
    id: config.id,
    board: config.board,
    name: config.name,
    scope: config.scope,
    cadence: config.cadence,
    sources: config.labels,
    status: "paused",
    coverage: 0,
    itemCount: 0
  };
}

function buildEmptyBoardStats() {
  const boards: HotspotBoard[] = ["entertainment", "game", "esports", "ai"];
  return boards.map((board) => {
    const sourceCount = FIRST_WAVE_SOURCES.filter((source) => source.board === board).length;
    return {
      board,
      sourceCount,
      completedSourceCount: 0,
      failedSourceCount: 0,
      signalCount: 0,
      hotspotCount: 0,
      readyCount: 0,
      averageScore: 0,
      topScore: 0
    };
  });
}

async function refreshHotspotRadarUnlocked(options: HotspotRefreshOptions) {
  let progressCompleted = 0;
  const collected = await mapWithConcurrency(FIRST_WAVE_SOURCES, MAX_CONCURRENCY, async (source) => {
    const result = await collectSource(source, options.signal);
    progressCompleted += 1;
    await options.onProgress?.({
      completed: progressCompleted,
      total: FIRST_WAVE_SOURCES.length,
      sourceName: source.name,
      failed: result.status !== "completed"
    });
    return result;
  });
  const signals = dedupeSignals(collected.flatMap((source) => source.signals))
    .sort((left, right) => right.heat - left.heat || compareIsoDesc(left.publishedAt || left.capturedAt, right.publishedAt || right.capturedAt))
    .slice(0, 140);
  const hotspots = limitHotspotsByBoard(buildHotspotEvents(signals), 12);
  const generatedAt = nowIso();
  const scouts = collected.map(toScout);
  const completed = collected.filter((source) => source.status === "completed").length;
  const failed = collected.length - completed;
  const readyCount = hotspots.filter((hotspot) => hotspot.status === "ready").length;
  const boardStats = buildBoardStats({ collected, signals, hotspots });
  const response: HotspotRadarRefreshResult = {
    generatedAt,
    scouts,
    signals,
    hotspots,
    summary: {
      sourceCount: collected.length,
      completedSourceCount: completed,
      failedSourceCount: failed,
      signalCount: signals.length,
      hotspotCount: hotspots.length,
      readyCount,
      averageScore: hotspots.length ? Math.round(hotspots.reduce((sum, hotspot) => sum + hotspot.score, 0) / hotspots.length) : 0,
      boardStats,
      generatedAt
    },
    refresh: {
      requested: collected.length,
      completed,
      failed,
      sources: collected.map((source) => ({
        id: source.config.id,
        board: source.config.board,
        name: source.config.name,
        status: source.status,
        itemCount: source.signals.length,
        error: source.error
      }))
    }
  };
  return response;
}

async function collectSource(config: HotspotSourceConfig, signal?: AbortSignal): Promise<CollectedSource> {
  const checkedAt = nowIso();
  try {
    let rawItems: RawSignalInput[] = [];
    if (config.kind === "video-hotlist") rawItems = await collectVideoHotlistItems(config);
    if (config.kind === "steam-news") rawItems = await collectSteamNewsItems(config, signal);
    if (config.kind === "rss" || config.kind === "news-rss") rawItems = await collectRssItems(config, signal);
    if (config.kind === "html-links") rawItems = await collectHtmlLinkItems(config, signal);

    const signals = rawItems
      .map((item, index) => buildSignal(config, item, index, checkedAt))
      .filter(shouldKeepSignal)
      .slice(0, config.limit);

    return { config, status: "completed", signals, checkedAt };
  } catch (error) {
    return {
      config,
      status: "failed",
      signals: [],
      checkedAt,
      error: error instanceof Error ? error.message : `${config.name} 采集失败`
    };
  }
}

async function collectVideoHotlistItems(config: HotspotSourceConfig) {
  const snapshot = await getDouyinHotlist({ windowKey: "24h" }).catch(() => null);
  if (!snapshot) return [];
  return snapshot.items.slice(0, config.limit).map((item: DouyinHotlistItem) => ({
    title: item.video.title,
    url: item.video.url,
    publishedAt: item.video.publishedAt,
    summary: `${item.account.name} · ${item.signal}`,
    heatHint: normalizeHeat(item.heatScore, 100_000),
    tags: [item.account.platform === "bilibili" ? "B站" : "抖音", ...item.tags].slice(0, 5)
  }));
}

async function collectSteamNewsItems(config: HotspotSourceConfig, signal?: AbortSignal) {
  if (!config.steamAppId) throw new Error(`${config.name} 缺少 Steam App ID。`);
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${config.steamAppId}&count=${config.limit}`;
  const json = await fetchJson<{
    appnews?: {
      newsitems?: Array<{
        title?: string;
        url?: string;
        date?: number;
        contents?: string;
      }>;
    };
  }>(url, signal);

  return (json.appnews?.newsitems || []).map((item) => ({
    title: item.title || "",
    url: item.url,
    publishedAt: item.date ? new Date(item.date * 1000).toISOString() : undefined,
    summary: item.contents ? clampText(stripHtml(item.contents), 160) : undefined,
    heatHint: 82,
    tags: ["Steam", "官方"]
  }));
}

async function collectRssItems(config: HotspotSourceConfig, signal?: AbortSignal) {
  if (!config.url) throw new Error(`${config.name} 缺少 RSS 地址。`);
  const xml = await fetchText(config.url, signal);
  const items = parseRssItems(xml).slice(0, config.limit);
  if (!items.length) throw new Error(`${config.name} 没有解析到 RSS 条目。`);
  return items.map((item) => ({
    title: item.title,
    url: item.link,
    publishedAt: item.publishedAt,
    summary: item.description,
    heatHint: config.kind === "news-rss" ? 68 : 62,
    tags: config.labels
  }));
}

async function collectHtmlLinkItems(config: HotspotSourceConfig, signal?: AbortSignal) {
  if (!config.url) throw new Error(`${config.name} 缺少页面地址。`);
  const html = await fetchText(config.url, signal);
  const items = parseHtmlLinks(html, config.url).slice(0, config.limit);
  if (!items.length) throw new Error(`${config.name} 没有解析到新闻链接。`);
  return items.map((item, index) => ({
    ...item,
    heatHint: Math.max(54, 74 - index * 2),
    tags: config.labels
  }));
}

function buildSignal(config: HotspotSourceConfig, item: RawSignalInput, index: number, capturedAt: string): HotspotSignal {
  const title = cleanText(item.title);
  const board = inferBoard(title, config);
  const game = inferSubject(title, board);
  const category = inferCategory(title);
  const publishedAt = normalizePublishedAt(item.publishedAt);
  const heat = clampScore((item.heatHint || sourceBaseHeat(config.type)) + freshnessBonus(publishedAt) + keywordBonus(title) - index);
  const tags = normalizeTags([boardLabel(board), game, category, ...config.labels, ...(item.tags || [])]).slice(0, 6);

  return {
    id: `signal:${config.id}:${shortHash(`${title}:${item.url || ""}`)}`,
    sourceId: config.id,
    sourceName: config.name,
    sourceType: config.type,
    board,
    title,
    url: item.url,
    game,
    category,
    capturedAt,
    publishedAt,
    heat,
    trend: describeSignalTrend(heat, publishedAt),
    tags,
    summary: item.summary ? cleanText(item.summary) : undefined
  };
}

function shouldKeepSignal(signal: HotspotSignal) {
  if (signal.title.length < 6) return false;
  if (/登录|注册|广告合作|隐私政策|用户协议|客户端下载|公众号|返回首页/.test(signal.title)) return false;
  if (/游戏本|笔记本|耳机|键盘|鼠标|显示器|显卡|硬件|外设|电竞椅|优惠|必看｜|必看\|/i.test(signal.title)) return false;
  if (/私处|女模特|大雷|翘臀|爆涩|魔爪|成人电影|成人视频|擦边/i.test(signal.title)) return false;
  if (signal.board === "esports" && !ESPORTS_CONTEXT_PATTERN.test(`${signal.title} ${signal.summary || ""}`)) return false;
  return signal.heat >= 48 || signal.game !== fallbackSubject(signal.board);
}

function buildHotspotEvents(signals: HotspotSignal[]) {
  const groups = new Map<string, HotspotSignal[]>();
  for (const signal of signals) {
    const key = buildHotspotGroupKey(signal);
    groups.set(key, [...(groups.get(key) || []), signal]);
  }

  return [...groups.entries()]
    .map(([key, group]) => buildHotspotEvent(key, group.sort((left, right) => right.heat - left.heat)))
    .sort((left, right) => right.score - left.score);
}

function buildHotspotGroupKey(signal: HotspotSignal) {
  return [signal.board, signal.game, inferSignalTopic(signal)].map((part) => part.replace(/:/g, "：")).join(":");
}

function inferSignalTopic(signal: HotspotSignal) {
  const text = `${signal.title} ${signal.summary || ""}`;
  if (signal.board === "esports" || ESPORTS_CONTEXT_PATTERN.test(text)) {
    const competition = inferCompetitionName([signal]);
    if (competition) return competition;
    const stage = inferCompetitionStage([signal], signal.category);
    if (stage !== "赛事信息待核") return stage;
  }

  if (/停服|服务器|崩溃|抢修|封号|封禁|作弊|外挂|bug|回档|补偿|维权|扣款|概率|价格|抄袭|侵权/i.test(text)) {
    return inferOperationIssue([signal], signal.category);
  }

  if (/版号|定档|上线|公测|开服|测试|预约|内测|发布会|直面会|showcase|联动|合作|更新|补丁|版本/i.test(text)) {
    return inferOfficialNode([signal], signal.category);
  }

  if (/动画|电影|影视|剧集|二创|梗|meme|联动|跨界|合作|明星|网红|主播/i.test(text)) {
    return inferBreakoutPoint([signal], signal.category);
  }

  return signal.category;
}

function limitHotspotsByBoard(hotspots: HotspotEvent[], perBoardLimit: number) {
  const boards: HotspotBoard[] = ["entertainment", "game", "esports", "ai"];
  return boards
    .flatMap((board) => hotspots.filter((hotspot) => hotspot.board === board).slice(0, perBoardLimit))
    .sort((left, right) => right.score - left.score);
}

function buildHotspotEvent(key: string, signals: HotspotSignal[]): HotspotEvent {
  const [board, game, category] = key.split(":") as [HotspotBoard, string, string];
  const top = signals[0];
  const sourceCount = new Set(signals.map((signal) => signal.sourceId)).size;
  const score = clampScore(Math.round(signals.reduce((sum, signal) => sum + signal.heat, 0) / signals.length + Math.min(sourceCount, 4) * 5));
  const monitorType = inferMonitorType(board, game, category, signals);
  const monitorProfile = MONITOR_PROFILES[monitorType];
  const status = resolveHotspotStatus(score, category, sourceCount, signals, monitorType);
  const title = buildEventTitle(game, category, top, sourceCount);
  const evidence = signals.slice(0, 5).map((signal) => `${signal.sourceName}：${signal.title}`);
  const scopeMatches = findScopeMatches(monitorType, game, signals);
  const displayInfo = buildDisplayInfo({
    monitorType,
    game,
    category,
    title,
    status,
    score,
    sourceCount,
    signals
  });

  return {
    id: `hotspot:${shortHash(key)}`,
    board,
    monitorType,
    monitorLabel: monitorProfile.label,
    triggerMode: monitorProfile.triggerMode,
    thresholdHint: monitorProfile.thresholdHint,
    actionWindow: resolveActionWindow(monitorType, status, score, sourceCount),
    priorityLabel: resolvePriorityLabel(monitorType, status, score, sourceCount),
    scopeMatches,
    title,
    game,
    category,
    displayInfo,
    status,
    score,
    freshness: describeFreshness(signals),
    sources: sourceCount,
    summary: buildSummary(game, category, signals, score),
    whyNow: buildWhyNow(signals, sourceCount, monitorProfile),
    playerFocus: buildAudienceFocus(board, game, category, monitorType),
    angles: buildAngles(board, game, category, status, monitorType),
    evidence,
    research: buildResearch(category, monitorType),
    risks: buildRisks(category, status, monitorType),
    accounts: buildAccounts(board, category, monitorType),
    signalIds: signals.map((signal) => signal.id)
  };
}

function buildEventTitle(game: string, category: string, top: HotspotSignal, sourceCount: number) {
  if (sourceCount >= 2 && category && category !== "内容信号") return `${game} · ${category}`;
  return top.title;
}

function buildDisplayInfo({
  monitorType,
  game,
  category,
  title,
  status,
  score,
  sourceCount,
  signals
}: {
  monitorType: HotspotMonitorType;
  game: string;
  category: string;
  title: string;
  status: HotspotStatus;
  score: number;
  sourceCount: number;
  signals: HotspotSignal[];
}) {
  const subject = normalizeDisplaySubject(game, monitorType);
  const sourceNames = formatSourceNames(signals);
  const timeLabel = describeFreshness(signals);
  const signalLine = `${sourceCount} 个来源 · ${signals.length} 条信号`;

  if (monitorType === "esports") {
    const competition = inferCompetitionName(signals) || "赛事动态";
    const stage = inferCompetitionStage(signals, category);
    return {
      kind: monitorType,
      subject,
      headline: competition === "赛事动态" ? title : competition,
      statusLine: stage,
      timeLabel,
      sourceLine: signalLine,
      facts: [
        `游戏：${subject}`,
        `赛事/比赛：${competition}`,
        `状态：${stage}`,
        `来源：${sourceNames}`
      ],
      primaryAction: "补赛程比分，确认关键画面或官方赛后信息"
    };
  }

  if (monitorType === "official") {
    const node = inferOfficialNode(signals, category);
    return {
      kind: monitorType,
      subject,
      headline: node,
      statusLine: `${category} · ${statusLabel(status)}`,
      timeLabel,
      sourceLine: signalLine,
      facts: [
        `游戏/产品：${subject}`,
        `官宣节点：${node}`,
        `来源：${sourceNames}`,
        `热度：${score}`
      ],
      primaryAction: "补官方原文和上线/测试时间"
    };
  }

  if (monitorType === "operations") {
    const issue = inferOperationIssue(signals, category);
    return {
      kind: monitorType,
      subject,
      headline: issue,
      statusLine: `${statusLabel(status)} · ${score >= 80 ? "高优先级核验" : "先确认影响范围"}`,
      timeLabel,
      sourceLine: signalLine,
      facts: [
        `游戏：${subject}`,
        `问题类型：${issue}`,
        `影响判断：${sourceCount >= 2 ? "多源扩散" : "单源待核"}`,
        `来源：${sourceNames}`
      ],
      primaryAction: "先核验官方回应、影响范围和玩家反馈"
    };
  }

  const breakoutPoint = inferBreakoutPoint(signals, category);
  return {
    kind: monitorType,
    subject,
    headline: breakoutPoint,
    statusLine: `${category} · ${statusLabel(status)}`,
    timeLabel,
    sourceLine: signalLine,
    facts: [
      `话题/IP：${subject}`,
      `触发点：${breakoutPoint}`,
      `扩散来源：${sourceNames}`,
      `切入方向：泛人群是否看得懂`
    ],
    primaryAction: "判断破圈点能否转成短视频入口"
  };
}

function normalizeDisplaySubject(game: string, monitorType: HotspotMonitorType) {
  const subject = game
    .replace(/赛事$/, "")
    .replace(/\s+赛事$/, "")
    .trim();
  if (monitorType === "esports" && subject === "电竞综合") return "综合赛事";
  return subject || game;
}

function formatSourceNames(signals: HotspotSignal[]) {
  const names = [...new Set(signals.map((signal) => signal.sourceName).filter(Boolean))].slice(0, 3);
  return names.join("、") || "公开来源";
}

function statusLabel(status: HotspotStatus) {
  if (status === "ready") return "可跟进";
  if (status === "risk") return "风险";
  return "观察";
}

function inferCompetitionName(signals: HotspotSignal[]) {
  const text = signals.map((signal) => `${signal.title} ${signal.summary || ""}`).join(" ");
  const patterns = [
    /电竞世界杯/i,
    /TI\s?国际邀请赛/i,
    /The International/i,
    /Valorant Champions Tour|\bVCT\b/i,
    /Intel Extreme Masters|\bIEM\b/i,
    /BLAST(?:\s+Premier)?/i,
    /PGL\s+Major|\bMajor\b/i,
    /英雄联盟全球总决赛|S赛/i,
    /\bLPL\b/i,
    /\bLCK\b/i,
    /\bMSI\b/i,
    /\bKPL\b/i,
    /\bPEL\b/i,
    /\bPCL\b/i,
    /\bCFS\b|\bCFPL\b/i,
    /\bNBPL\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].replace(/\s+/g, " ").trim();
  }
  return "";
}

function inferCompetitionStage(signals: HotspotSignal[], category: string) {
  const text = `${category} ${signals.map((signal) => `${signal.title} ${signal.summary || ""}`).join(" ")}`;
  if (/赛程|开赛|今日|今晚|对阵|schedule/i.test(text)) return "赛程/对阵待跟";
  if (/赛果|夺冠|冠军|晋级|淘汰|战胜|击败|wins?|defeats?/i.test(text)) return "赛果/胜负已出";
  if (/转会|退役|复出|禁赛|选手|战队/i.test(text)) return "选手/战队动态";
  if (/决赛|半决赛|总决赛|grand final|playoffs/i.test(text)) return "关键赛段";
  return "赛事信息待核";
}

function inferOfficialNode(signals: HotspotSignal[], category: string) {
  const text = `${category} ${signals.map((signal) => signal.title).join(" ")}`;
  if (/版号/.test(text)) return "版号/审批信息";
  if (/定档|上线|公测|开服|release|launch/i.test(text)) return "定档/上线节点";
  if (/测试|预约|内测|beta/i.test(text)) return "测试/预约节点";
  if (/发布会|直面会|showcase|gamescom|tgs|tga|chinajoy|520/.test(text.toLowerCase())) return "发布会/展会节点";
  if (/联动|合作|collab/i.test(text)) return "联动/合作节点";
  if (/更新|补丁|版本|patch|update/i.test(text)) return "版本更新";
  return category;
}

function inferOperationIssue(signals: HotspotSignal[], category: string) {
  const text = `${category} ${signals.map((signal) => signal.title).join(" ")}`;
  if (/停服|服务器|崩溃|抢修/.test(text)) return "停服/服务器异常";
  if (/封号|封禁|作弊|外挂/.test(text)) return "封禁/外挂争议";
  if (/bug|回档|数据清零|补偿/i.test(text)) return "BUG/回档补偿";
  if (/维权|扣款|概率|价格/.test(text)) return "付费/维权争议";
  if (/抄袭|侵权/.test(text)) return "侵权/抄袭争议";
  return category;
}

function inferBreakoutPoint(signals: HotspotSignal[], category: string) {
  const text = `${category} ${signals.map((signal) => signal.title).join(" ")}`;
  if (/动画|电影|影视|剧集/.test(text)) return "影视动画改编";
  if (/二创|梗|鬼畜|meme/i.test(text)) return "二创/梗传播";
  if (/联动|跨界|合作/.test(text)) return "跨界联动";
  if (/明星|网红|主播/.test(text)) return "明星/达人带动";
  return category;
}

function inferMonitorType(
  board: HotspotBoard,
  game: string,
  category: string,
  signals: HotspotSignal[]
): HotspotMonitorType {
  const classificationSubject = game.replace(/赛事/g, "").trim();
  const text = `${classificationSubject} ${category} ${signals.map((signal) => `${signal.title} ${signal.summary || ""}`).join(" ")}`.toLowerCase();
  if (/停服|封号|扣款|服务器|崩溃|回档|恶性bug|抢修|概率|数据清零|维权|抄袭|侵权|负面|作弊|外挂|封禁|事故/.test(text)) {
    return "operations";
  }
  if (board === "entertainment" || /影视|动画|电影|剧集|二创|梗|出圈|跨界|明星|网红|改编|破圈/.test(text)) {
    return "breakout";
  }
  if (/版本|更新|补丁/.test(category)) return "official";
  const hasTournamentContext = /赛事|赛程|赛果|比赛|对局|决赛|半决赛|总决赛|冠军|爆冷|赛前|赛后|小组赛|季后赛|\bvct\b|\biem\b|\blpl\b|\blck\b|\bkpl\b|\bmsi\b|\bmajor\b|\bworlds\b|playoffs|tournament|grand final|ti国际邀请赛|the international/.test(text);
  const hasTeamOrPlayerContext = /战队|选手|转会|退役|复出|禁赛/.test(text) && /电竞|赛事|比赛|\bvct\b|\biem\b|\blpl\b|\blck\b|\bkpl\b|\bmsi\b|\bmajor\b|\bworlds\b|tournament/.test(text);
  const hasEsportsSubject = ESPORTS_CONTEXT_PATTERN.test(text);
  const hasEsportsSignal = (hasTournamentContext || hasTeamOrPlayerContext) && hasEsportsSubject;
  if (hasEsportsSignal) {
    return "esports";
  }
  if (/版号|官宣|定档|公测|上线|发布会|发布|测试|联动|直面会|showcase|gamescom|tgs|tga|chinajoy|spark|网易 520|520 游戏/.test(text)) {
    return "official";
  }
  if (signals.some((signal) => signal.sourceType === "video")) return "breakout";
  if (/版本|更新|补丁|角色|英雄|干员|行业动态|产品发布/.test(category)) return "official";
  return "breakout";
}

function resolveHotspotStatus(
  score: number,
  category: string,
  sourceCount: number,
  signals: HotspotSignal[],
  monitorType: HotspotMonitorType
): HotspotStatus {
  if (monitorType === "operations") return score >= 62 ? "risk" : "watch";
  if (/舆情|争议|外挂|封禁|价格/.test(category)) return score >= 72 ? "risk" : "watch";
  if (category === "内容信号" && signals.every((signal) => signal.game === "综合游戏")) return "watch";
  const hasAuthoritativeSignal = signals.some((signal) => signal.sourceType === "official" || signal.sourceType === "video");
  if (monitorType === "breakout" && score >= 72 && (sourceCount >= 2 || hasAuthoritativeSignal)) return "ready";
  if (monitorType === "official" && score >= 70 && hasAuthoritativeSignal) return "ready";
  if (score >= 74 && sourceCount >= 2) return "ready";
  if (score >= 84 && hasAuthoritativeSignal) return "ready";
  if (score >= 60) return "watch";
  return "watch";
}

function resolveActionWindow(
  monitorType: HotspotMonitorType,
  status: HotspotStatus,
  score: number,
  sourceCount: number
) {
  if (monitorType === "operations" && status === "risk") return "15 分钟内核验";
  if (status === "ready" && score >= 86) return "30 分钟内出方向";
  if (status === "ready") return "2 小时内跟进";
  if (sourceCount >= 2) return "持续观察扩散";
  return MONITOR_PROFILES[monitorType].defaultActionWindow;
}

function resolvePriorityLabel(
  monitorType: HotspotMonitorType,
  status: HotspotStatus,
  score: number,
  sourceCount: number
) {
  if (monitorType === "operations" && status === "risk") return "P0 核验";
  if (status === "ready" && score >= 86) return "P1 快跟";
  if (sourceCount >= 2 && score >= 72) return "P1 扩散";
  return "P2 观察";
}

function findScopeMatches(monitorType: HotspotMonitorType, game: string, signals: HotspotSignal[]) {
  const text = `${game} ${signals.map((signal) => `${signal.title} ${signal.summary || ""}`).join(" ")}`.toLowerCase();
  const matches = MONITOR_SCOPE_TERMS[monitorType].filter((term) => text.includes(term.toLowerCase()));
  const normalizedGame = game && !/^综合|娱乐综合|电竞综合|AI 综合/.test(game) ? [game] : [];
  return normalizeTags([...normalizedGame, ...matches, ...MONITOR_PROFILES[monitorType].scopeLabels]).slice(0, 5);
}

function buildSummary(game: string, category: string, signals: HotspotSignal[], score: number) {
  const sourceNames = [...new Set(signals.map((signal) => signal.sourceName))].slice(0, 3).join("、");
  const topTitle = signals[0]?.title || category;
  const extensionText = signals.length > 1 ? `；另有 ${signals.length - 1} 条延伸来源` : "";
  return `${game} · ${category}：${topTitle}${extensionText}。来源：${sourceNames || "公开来源"}，热度 ${score}。`;
}

function buildWhyNow(signals: HotspotSignal[], sourceCount: number, profile: HotspotMonitorProfile) {
  const newest = signals
    .map((signal) => signal.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort(compareIsoDesc)[0];
  const freshness = newest ? describeAge(newest) : "本轮巡检";
  return `${freshness}出现 ${signals.length} 条相关信号，覆盖 ${sourceCount} 个来源；按「${profile.triggerMode}」规则，已经具备进一步观察价值。`;
}

function buildAudienceFocus(board: HotspotBoard, game: string, category: string, monitorType: HotspotMonitorType) {
  if (monitorType === "operations") return ["玩家损失和影响范围到底有多大", "官方是否已经回应或补偿", "是否存在未核实截图和带节奏说法"];
  if (monitorType === "official") return ["官宣节点和实际上线/测试时间", "这个产品或版本对哪类玩家最有吸引力", "是否有预约量、IP 量级或发布会背书"];
  if (monitorType === "breakout") return ["破圈讨论来自游戏玩家还是泛娱乐人群", "梗点或二创作品为什么容易传播", "是否已有短视频/社区内容起量"];
  if (board === "ai") return ["这次变化影响哪些真实使用场景", "官方原文和媒体解读是否一致", "是否存在产品、监管或商业化后续"];
  if (board === "entertainment") return ["事件发生在哪个宣发或舆论节点", "粉丝和路人讨论分别集中在哪", "是否需要补作品、票房或当事人原话"];
  if (board === "esports") return ["关键回合为什么引发讨论", "赛前预期和实际结果差在哪里", "选手/战队后续回应是否会继续发酵"];
  if (/赛事/.test(category)) return ["关键回合为什么引发争议", "赛前预期和实际结果差在哪里", "选手/战队后续回应是否会继续发酵"];
  if (/版本|更新|补丁/.test(category)) return ["这次调整到底影响谁", "旧版本问题是否被解决", "玩家体感和官方说明是否一致"];
  if (/商业化|皮肤|价格/.test(category)) return ["价格和体验是否匹配", "玩家不满集中在哪个环节", "官方是否需要补充说明"];
  if (/角色|英雄|干员/.test(category)) return ["强度是否超模", "会不会影响当前环境", "上线前需要准备哪些资源"];
  if (/舆情|争议/.test(category)) return ["争议事实是否清楚", "各方说法是否一致", "是否存在未核实爆料"];
  return [`${game}玩家最关心的直接变化`, "这个点是否能做成短视频开头", "是否需要补官方原文或一手出处"];
}

function buildAngles(
  board: HotspotBoard,
  game: string,
  category: string,
  status: HotspotStatus,
  monitorType: HotspotMonitorType
) {
  if (monitorType === "operations") return ["事实核验：发生了什么、影响谁", "玩家视角：损失、补偿和官方回应", "避坑提醒：哪些说法现在不能下结论"];
  if (monitorType === "official") return ["快讯：官宣重点和时间线", "期待值拆解：IP、玩法、厂商资源怎么看", "实用信息：预约/测试/上线节点一条讲清"];
  if (monitorType === "breakout") return ["破圈拆解：这个梗为什么能扩散", "素材复盘：最容易被转发的一幕", "泛人群入口：没玩过也能看懂的讲法"];
  if (status === "risk") return ["事实整理：先讲清发生了什么", "中性观察：玩家为什么会有这个反应", "风险提醒：哪些说法现在不能下结论"];
  if (board === "ai") return ["10-20 秒速递：新变化到底是什么", "场景拆解：普通用户能怎么用", "行业观察：这件事说明了什么趋势"];
  if (board === "entertainment") return ["快评：这个节点为什么突然热", "背景补课：作品/人物关系一条讲清", "舆论拆解：不同圈层为什么反应不同"];
  if (board === "esports") return ["10-20 秒快评：最关键一幕", "赛事 AB 面：结果背后的反差", "复盘短稿：三句话讲清转折点"];
  if (/赛事/.test(category)) return ["10-20 秒快评：最关键一幕", "赛事 AB 面：结果背后的反差", "复盘短稿：三句话讲清转折点"];
  if (/版本|更新|补丁/.test(category)) return ["背景科普：这次更新真正改了什么", "观点短稿：谁最受影响", "问答脚本：玩家最关心的三个问题"];
  if (/商业化|皮肤|价格/.test(category)) return ["价格争议拆解：玩家到底在不满什么", "行业观察：这类商业化为什么容易吵", "对比选题：同类产品怎么做"];
  return [`快评：${game}这个点为什么值得看`, "资料整理：一条视频讲清来龙去脉", "观点发散：这件事接下来可能怎么走"];
}

function buildResearch(category: string, monitorType: HotspotMonitorType) {
  if (monitorType === "operations") return ["补官方公告/客服回应", "确认影响范围和持续时间", "抽样玩家反馈和截图来源"];
  if (monitorType === "official") return ["补官方原文和发布时间", "补产品预约/测试/上线信息", "补厂商或 IP 背景资料"];
  if (monitorType === "breakout") return ["补最早出圈内容链接", "补多平台传播样本", "确认是否已有对标内容起量"];
  if (/赛事/.test(category)) return ["补赛程和比分", "补关键回合画面出处", "确认选手或官方赛后原话"];
  if (/版本|更新|补丁/.test(category)) return ["补官方公告原文", "补旧版本对比", "找一条玩家典型反馈"];
  if (/商业化|皮肤|价格/.test(category)) return ["补官方定价和规则", "补历史同档案例", "核实抽取或购买机制"];
  if (/舆情|争议/.test(category)) return ["确认一手来源", "整理不同说法", "标出未核实信息"];
  return ["补官方出处", "补玩家讨论样本", "确认是否已有对标内容起量"];
}

function buildRisks(category: string, status: HotspotStatus, monitorType: HotspotMonitorType) {
  const risks = ["不要把单一来源当成事实结论"];
  if (monitorType === "operations") risks.push("先确认官方回应，再判断责任和补偿");
  if (monitorType === "official") risks.push("爆料、测试时间和上线时间要分开表述");
  if (monitorType === "breakout") risks.push("不要把圈层玩梗误判成全民破圈");
  if (status === "risk" || /舆情|争议|外挂|封禁|价格/.test(category)) {
    risks.push("避免使用煽动性措辞", "爆料和截图必须二次核验");
  }
  if (/赛事|视频/.test(category)) risks.push("引用赛事或视频素材注意来源");
  return risks;
}

function buildAccounts(board: HotspotBoard, category: string, monitorType: HotspotMonitorType) {
  if (monitorType === "operations") return ["游戏快讯号", "玩家避坑号", "行业观察号"];
  if (monitorType === "official") return ["游戏快讯号", "新品前瞻号", "IP 资讯号"];
  if (monitorType === "breakout") return ["热点快评号", "娱乐破圈号", "二创观察号"];
  if (board === "ai") return ["AI 快讯号", "工具测评号", "科技观点号"];
  if (board === "entertainment") return ["娱乐快评号", "影视综艺号", "明星舆情号"];
  if (board === "esports") return ["赛事解说号", "电竞快评号", "游戏观点号"];
  if (/赛事/.test(category)) return ["赛事解说号", "游戏观点号"];
  if (/版本|更新|补丁|角色|英雄|干员/.test(category)) return ["攻略号", "机制科普号"];
  if (/商业化|舆情|争议/.test(category)) return ["行业观察号", "游戏观点号"];
  return ["热点快评号", "综合游戏号"];
}

function buildBoardStats({
  collected,
  signals,
  hotspots
}: {
  collected: CollectedSource[];
  signals: HotspotSignal[];
  hotspots: HotspotEvent[];
}) {
  const boards: HotspotBoard[] = ["entertainment", "game", "esports", "ai"];
  return boards.map((board) => {
    const boardSources = collected.filter((source) => source.config.board === board);
    const boardSignals = signals.filter((signal) => signal.board === board);
    const boardHotspots = hotspots.filter((hotspot) => hotspot.board === board);
    const completedSourceCount = boardSources.filter((source) => source.status === "completed").length;
    return {
      board,
      sourceCount: boardSources.length,
      completedSourceCount,
      failedSourceCount: boardSources.length - completedSourceCount,
      signalCount: boardSignals.length,
      hotspotCount: boardHotspots.length,
      readyCount: boardHotspots.filter((hotspot) => hotspot.status === "ready").length,
      averageScore: boardHotspots.length ? Math.round(boardHotspots.reduce((sum, hotspot) => sum + hotspot.score, 0) / boardHotspots.length) : 0,
      topScore: boardHotspots[0]?.score || 0
    };
  });
}

function toScout(source: CollectedSource): HotspotScout {
  return {
    id: source.config.id,
    board: source.config.board,
    name: source.config.name,
    scope: source.config.scope,
    cadence: source.config.cadence,
    sources: source.config.labels,
    status: source.status === "completed" ? "running" : "failed",
    coverage: source.status === "completed" ? Math.min(96, 58 + source.signals.length * 5) : 24,
    itemCount: source.signals.length,
    lastCheckedAt: source.checkedAt,
    error: source.error
  };
}

async function fetchJson<T>(url: string, signal?: AbortSignal) {
  const text = await fetchText(url, signal, "application/json,text/plain,*/*");
  return JSON.parse(text) as T;
}

async function fetchText(url: string, signal?: AbortSignal, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.7") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept,
          "user-agent": USER_AGENT
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
    } catch (error) {
      const host = new URL(url).hostname;
      if (controller.signal.aborted) throw new Error(`${host} 请求超时或已取消。`);
      throw new Error(`${host} 请求失败：${error instanceof Error ? error.message : "网络异常"}`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${new URL(url).hostname} 返回 ${response.status}：${summarizeResponseText(text)}`);
    }
    if (looksBlocked(text)) {
      throw new Error(`${new URL(url).hostname} 返回了登录或人机验证页面。`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function parseRssItems(xml: string) {
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)
  ].map((match) => match[0]);
  return blocks
    .map((block) => ({
      title: cleanText(readXmlTag(block, "title")),
      link: normalizeLink(readXmlTag(block, "link") || readXmlTagAttribute(block, "link", "href")),
      publishedAt: normalizePublishedAt(readXmlTag(block, "pubDate") || readXmlTag(block, "published") || readXmlTag(block, "updated")),
      description: clampText(cleanText(readXmlTag(block, "description") || readXmlTag(block, "summary") || readXmlTag(block, "content:encoded")), 180)
    }))
    .filter((item) => item.title);
}

function parseHtmlLinks(html: string, baseUrl: string) {
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
      return {
        title: cleanText(match[2]),
        url: normalizeLink(href, baseUrl)
      };
    })
    .filter((item) => item.title.length >= 8 && item.title.length <= 90 && item.url)
    .filter((item) => !/javascript:|#/.test(item.url || ""));
  return dedupeBy(links, (item) => item.title).slice(0, 40);
}

function readXmlTag(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return decodeEntities(stripCdata(match?.[1] || ""));
}

function readXmlTagAttribute(block: string, tag: string, attribute: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escapedTag}[^>]*\\b${escapedAttribute}=["']([^"']+)["'][^>]*>`, "i"));
  return decodeEntities(match?.[1] || "");
}

function dedupeSignals(signals: HotspotSignal[]) {
  return dedupeBy(signals, (signal) => normalizeDedupeKey(signal.title));
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function inferBoard(title: string, config: HotspotSourceConfig): HotspotBoard {
  return inferTitleBoard(title) || config.board;
}

function inferTitleBoard(title: string): HotspotBoard | undefined {
  const normalized = title.toLowerCase();
  if (/openai|chatgpt|sora|gpt-|anthropic|claude|gemini|deepseek|midjourney|llm|人工智能|大模型|模型|生成式|算力|推理模型/.test(normalized)) return "ai";
  if (ESPORTS_CONTEXT_PATTERN.test(normalized)) return "esports";
  if (/电影|电视剧|剧集|综艺|明星|艺人|导演|演员|歌手|演唱会|票房|院线|音乐|专辑|奥斯卡|金球奖|movie|film|celebrity|box office|hollywood|netflix|disney|album|concert/.test(normalized)) return "entertainment";
  return undefined;
}

function inferSubject(title: string, board: HotspotBoard) {
  if (board === "ai") return inferAiSubject(title);
  if (board === "entertainment") return inferEntertainmentSubject(title);
  if (board === "esports") return inferEsportsSubject(title);
  return inferGameSubject(title);
}

function inferAiSubject(title: string) {
  const normalized = title.toLowerCase();
  if (/openai|chatgpt|gpt-|sora/.test(normalized)) return "OpenAI";
  if (/anthropic|claude/.test(normalized)) return "Claude";
  if (/gemini|google/.test(normalized)) return "Gemini";
  if (/deepseek/.test(normalized)) return "DeepSeek";
  if (/midjourney/.test(normalized)) return "Midjourney";
  if (/nvidia|英伟达|算力|芯片|gpu/.test(normalized)) return "AI 算力";
  if (/模型|大模型|llm|人工智能|ai/.test(normalized)) return "AI 行业";
  return "AI 综合";
}

function inferEntertainmentSubject(title: string) {
  const normalized = title.toLowerCase();
  if (/电影|票房|院线|movie|film|box office|hollywood/.test(normalized)) return "电影";
  if (/电视剧|剧集|netflix|disney|streaming|series/.test(normalized)) return "剧集";
  if (/综艺|真人秀|variety show/.test(normalized)) return "综艺";
  if (/音乐|专辑|歌手|演唱会|concert|album|music/.test(normalized)) return "音乐演出";
  if (/明星|艺人|演员|导演|celebrity|actor|director/.test(normalized)) return "明星动态";
  return "娱乐综合";
}

function inferEsportsSubject(title: string) {
  const normalized = title.toLowerCase();
  if (/无畏契约|valorant|\bvct\b/.test(normalized)) return "无畏契约赛事";
  if (/counter-?strike|\bcs2\b|\biem\b|hltv/.test(normalized)) return "CS2 赛事";
  if (/dota/.test(normalized)) return "Dota 2 赛事";
  if (/英雄联盟|league of legends|lpl|lck|lec|lcs/.test(normalized)) return "英雄联盟赛事";
  if (/王者荣耀|kpl|honor of kings|hok/.test(normalized)) return "王者荣耀赛事";
  if (/pubg|绝地求生/.test(normalized)) return "PUBG 赛事";
  return "电竞综合";
}

function inferGameSubject(title: string) {
  const normalized = title.toLowerCase();
  if (/三角洲|delta force/.test(normalized)) return "三角洲行动";
  if (/无畏契约|valorant|\bvct\b/.test(normalized)) return "无畏契约";
  if (/永劫无间|naraka/.test(normalized)) return "永劫无间";
  if (/王者荣耀|honor of kings|hok/.test(normalized)) return "王者荣耀";
  if (/counter-?strike|\bcs2\b|\biem\b/.test(normalized)) return "CS2";
  if (/dota/.test(normalized)) return "Dota 2";
  if (/pubg|绝地求生/.test(normalized)) return "PUBG";
  if (/steam/.test(normalized)) return "Steam";
  if (/腾讯|网易|sony|playstation|xbox|任天堂|nintendo/.test(normalized)) return "游戏行业";
  return "综合游戏";
}

function boardLabel(board: HotspotBoard) {
  if (board === "entertainment") return "娱乐";
  if (board === "game") return "游戏";
  if (board === "esports") return "赛事";
  return "AI";
}

function fallbackSubject(board: HotspotBoard) {
  if (board === "entertainment") return "娱乐综合";
  if (board === "esports") return "电竞综合";
  if (board === "ai") return "AI 综合";
  return "综合游戏";
}

function inferCategory(title: string) {
  const normalized = title.toLowerCase();
  if (/openai|chatgpt|sora|gpt-|anthropic|claude|gemini|deepseek|人工智能|大模型|模型|生成式|llm/.test(normalized)) {
    if (/发布|上线|推出|release|launch|introduce|announce|官宣/.test(normalized)) return "产品发布";
    if (/融资|收购|投资|估值|revenue|funding|acquire/.test(normalized)) return "商业动态";
    if (/安全|版权|诉讼|监管|政策|lawsuit|regulation|copyright|safety/.test(normalized)) return "监管舆情";
    return "AI 动态";
  }
  if (/电影|电视剧|剧集|综艺|明星|艺人|导演|演员|歌手|演唱会|票房|院线|音乐|专辑|movie|film|celebrity|box office|hollywood|concert|album/.test(normalized)) {
    if (/票房|box office/.test(normalized)) return "票房热度";
    if (/官宣|定档|预告|发布|上线|trailer|release|premiere/.test(normalized)) return "宣发节点";
    if (/争议|道歉|分手|恋情|lawsuit|controversy/.test(normalized)) return "娱乐舆情";
    if (/演唱会|巡演|concert|tour/.test(normalized)) return "演出动态";
    return "娱乐动态";
  }
  if (/赛事|比赛|决赛|冠军|战队|选手|esports|vct|iem|major/.test(normalized)) return "赛事热点";
  if (/更新|补丁|版本|维护|上线|update|patch|release/.test(normalized)) return "版本更新";
  if (/新英雄|新角色|角色|干员|agent|operator|hero/.test(normalized)) return "角色前瞻";
  if (/皮肤|价格|抽取|氪金|商城|商业化|会员|skin|price/.test(normalized)) return "商业化舆情";
  if (/争议|质疑|道歉|封禁|外挂|作弊|bug|抄袭|controversy|cheat/.test(normalized)) return "舆情风险";
  if (/收购|投资|财报|裁员|合作|腾讯|网易|industry/.test(normalized)) return "行业动态";
  if (/攻略|教程|地图|机制|build|guide/.test(normalized)) return "攻略机会";
  return "内容信号";
}

function normalizePublishedAt(input?: string) {
  if (!input) return undefined;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sourceBaseHeat(type: HotspotSourceType) {
  if (type === "official") return 76;
  if (type === "video") return 72;
  if (type === "news") return 62;
  if (type === "community") return 58;
  return 55;
}

function freshnessBonus(publishedAt?: string) {
  if (!publishedAt) return 4;
  const ageHours = (Date.now() - Date.parse(publishedAt)) / 3_600_000;
  if (ageHours <= 3) return 18;
  if (ageHours <= 12) return 14;
  if (ageHours <= 24) return 10;
  if (ageHours <= 72) return 6;
  return 1;
}

function keywordBonus(title: string) {
  let bonus = 0;
  if (/爆|热|首曝|官宣|确认|争议|更新|决赛|冠军|上线|发布|票房|融资|监管|patch|update|wins|confirms|launch|release/i.test(title)) bonus += 7;
  if (inferTitleBoard(title) || inferGameSubject(title) !== "综合游戏") bonus += 6;
  if (inferCategory(title) !== "内容信号") bonus += 4;
  return bonus;
}

function describeSignalTrend(heat: number, publishedAt?: string) {
  if (heat >= 86) return "+60%";
  if (heat >= 78) return "+42%";
  if (publishedAt && Date.now() - Date.parse(publishedAt) < 12 * 3_600_000) return "+28%";
  return "+12%";
}

function describeFreshness(signals: HotspotSignal[]) {
  const newest = signals
    .map((signal) => signal.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort(compareIsoDesc)[0];
  return newest ? describeAge(newest) : "本轮巡检";
}

function describeAge(iso: string) {
  const hours = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "1 小时内";
  if (hours < 24) return `${Math.max(1, Math.round(hours))} 小时内`;
  return `${Math.max(1, Math.round(hours / 24))} 天内`;
}

function normalizeHeat(value: number, divisor: number) {
  return clampScore(Math.round(38 + Math.log10(Math.max(value, 1)) * 6 + Math.min(8, value / divisor)));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(99, Math.round(value)));
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map(cleanText).filter(Boolean))];
}

function normalizeDedupeKey(title: string) {
  return title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, "")
    .slice(0, 48);
}

function normalizeLink(input: string, baseUrl?: string) {
  const trimmed = decodeEntities(input.trim());
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function cleanText(input: string) {
  return decodeEntities(stripHtml(stripCdata(input)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(input: string) {
  return input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function stripCdata(input: string) {
  return input.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function looksBlocked(text: string) {
  return /captcha|验证码|访问过于频繁|security verification|verify you are human|just a moment|sina visitor system/i.test(text);
}

function summarizeResponseText(text: string) {
  return cleanText(text).slice(0, 120) || "空响应";
}

function compareIsoDesc(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

export function getHotspotRadarSnapshotSummary(snapshot: HotspotRadarResponse) {
  return `${snapshot.summary.completedSourceCount}/${snapshot.summary.sourceCount} 个源可用，${snapshot.summary.signalCount} 条信号，${snapshot.summary.hotspotCount} 个热点。`;
}
