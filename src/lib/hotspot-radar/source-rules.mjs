// 从用户提供的热点雷达源码提取的无副作用解析与编辑规则。网络、模型和存储由 TypeScript 调用层负责。
import crypto from 'node:crypto';
const THREE_DAYS_MS = 72 * 60 * 60 * 1000;

const SOURCES = [
  { id: 'mrs-today', name: '游戏热点聚合', url: 'https://mrs-today-bases-personality.trycloudflare.com/all.php', type: 'mrs', tier: '社区情绪源', scope: '中文游戏热点 / 社区与媒体汇总' },
  { id: 'vlr', name: 'VLR.gg', url: 'https://www.vlr.gg/rss', type: 'rss', tier: '赛事首发源', scope: '无畏契约赛事 / 选手与转会' },
  { id: '5eplay-cs2', name: '5EPlay CS2', url: 'https://csgo.5eplay.com/', type: '5eplay', tier: '赛事首发源', scope: 'CS2 赛事 / 选手动态 / 社区梗' },
  { id: 'dianjinghu-lol', name: '电竞虎·八卦撸圈', url: 'https://lol.dianjinghu.com/news/bagua/', type: 'dianjinghu', tier: '趣味发现源', scope: 'LPL / 选手动态 / 圈内梗与清算' },
  { id: 'dotesports', name: 'Dot Esports', url: 'https://dotesports.com/feed', type: 'rss', tier: '赛事核验源', scope: '国际电竞 / 选手故事 / 赛后话题' },
  { id: 'gamersky', name: '游民星空', url: 'https://www.gamersky.com/news/', type: 'gamersky', tier: '中文核验源', scope: '国内玩家热点 / 综合游戏资讯' },
  { id: 'ithome-games', name: 'IT之家游戏', url: 'https://www.ithome.com/rss/', type: 'rss', tier: '中文核验源', scope: '游戏官宣 / 运营争议 / 厂商动态' },
  { id: '17173-news', name: '17173 游戏新闻', url: 'https://news.17173.com/', type: '17173', tier: '趣味发现源', scope: '玩家圈事件 / 运营事故 / 离谱新闻' },
  { id: '3dm-news', name: '3DM 游戏新闻', url: 'https://www.3dmgame.com/news/', type: '3dm', tier: '趣味发现源', scope: '玩家争议 / 厂商翻车 / 单机与二游话题', itemLimit: 20 },
  { id: 'sina-esports', name: '新浪电竞', url: 'https://dj.sina.com.cn/', type: 'sina-esports', tier: '赛事核验源', scope: 'CS2 / DOTA2 / LOL 赛事与选手动态', itemLimit: 20 },
  { id: 'dota2-cn', name: 'DOTA2 国服赛事', url: 'https://www.dota2.com.cn/news/competition/index.htm', type: 'dota2-cn', tier: '官方核验源', scope: 'DOTA2 国服 / TI / 赛事与社区活动', itemLimit: 15 },
  { id: 'honor-of-kings-cn', name: '王者荣耀官网', url: 'https://pvp.qq.com/web201706/newsindex.shtml', type: 'qq-news', tier: '官方核验源', scope: '王者荣耀 / 运营处罚 / 版本与社区事件', itemLimit: 15 },
  { id: 'ali213-news', name: '游侠网新闻', url: 'https://www.ali213.net/news/', type: 'generic-news', tier: '趣味发现源', scope: '单机游戏 / 玩家社区 / 厂商与平台事件', itemLimit: 18 },
  { id: 'gamelook', name: 'GameLook', url: 'http://www.gamelook.com.cn/feed', type: 'rss', tier: '产业核验源', scope: '游戏产业 / 厂商经营 / 产品与市场异动' },
  { id: 'gematsu', name: 'Gematsu', url: 'https://www.gematsu.com/feed', type: 'rss', scope: '综合游戏资讯' },
  { id: 'gamesindustry', name: 'GamesIndustry.biz', url: 'https://www.gamesindustry.biz/feed', type: 'rss', scope: '游戏产业 / 商业' },
  { id: 'ign-global', name: 'IGN Global', url: 'https://feeds.feedburner.com/ign/games-all', type: 'rss', scope: '国际综合游戏资讯' },
  { id: 'gamespot', name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/', type: 'rss', scope: '游戏内容 / 硬件' },
  { id: 'vgc', name: 'VGC', url: 'https://www.videogameschronicle.com/feed/', type: 'rss', scope: '综合游戏资讯 / 独家报道' },
  { id: 'nintendolife', name: 'Nintendo Life', url: 'https://www.nintendolife.com/feeds/latest', type: 'rss', scope: '任天堂生态' },
  { id: 'pcgamer', name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/', type: 'rss', scope: 'PC 游戏 / 硬件' },
  { id: 'kotaku', name: 'Kotaku', url: 'https://kotaku.com/rss', type: 'rss', scope: '游戏文化 / 综合资讯' },
  { id: 'gamesradar', name: 'GamesRadar+', url: 'https://www.gamesradar.com/rss/', type: 'rss', scope: '综合游戏内容' },
  { id: 'dexerto', name: 'Dexerto', url: 'https://www.dexerto.com/feed/', type: 'rss', tier: '社区情绪源', scope: '主播 / 玩家争议 / 游戏与网络文化' },
  { id: 'eurogamer', name: 'Eurogamer', url: 'https://www.eurogamer.net/feed', type: 'rss', scope: '欧洲游戏新闻 / 玩家文化 / 深度报道' },
  { id: 'pcgamesn', name: 'PCGamesN', url: 'https://www.pcgamesn.com/mainrss.xml', type: 'rss', tier: '趣味发现源', scope: 'PC 游戏 / Steam 社区 / 玩家奇闻' },
  { id: 'esports-gg', name: 'Esports.gg', url: 'https://esports.gg/feed/', type: 'rss', tier: '赛事核验源', scope: '国际电竞 / 赛事现场 / 选手与主播' },
  { id: 'pushsquare', name: 'Push Square', url: 'https://www.pushsquare.com/feeds/latest', type: 'rss', scope: 'PlayStation 生态 / 玩家社区' },
  { id: 'siliconera', name: 'Siliconera', url: 'https://www.siliconera.com/feed/', type: 'rss', tier: '趣味发现源', scope: '日本游戏 / ACG / 二次元社区' },
  { id: 'automaton-en', name: 'Automaton', url: 'https://automaton-media.com/en/feed/', type: 'rss', tier: '趣味发现源', scope: '日本游戏圈 / 开发者与玩家奇闻' },
  { id: 'playstation-blog', name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/', type: 'rss', tier: '官方核验源', scope: 'PlayStation 官方公告 / 产品与社区活动' },
  { id: 'windowscentral', name: 'Windows Central', url: 'https://www.windowscentral.com/feeds.xml', type: 'rss', scope: 'Windows 硬件 / 游戏生态' },
  { id: 'nintendoeverything', name: 'Nintendo Everything', url: 'https://nintendoeverything.com/feed/', type: 'rss', scope: '任天堂游戏生态' },
  { id: '4gamers', name: '4Gamers', url: 'https://www.4gamers.com.tw/rss/latest-news', type: 'rss', scope: '华语玩家社区 / 游戏报道' },
  { id: 'famitsu', name: 'Famitsu', url: 'https://www.famitsu.com/category/new-article/page/1', type: 'famitsu', scope: '日本游戏圈' },
  { id: 'xiaoheihe', name: '小黑盒社区', url: 'https://www.xiaoheihe.cn/app/bbs/home', type: 'xiaoheihe', tier: '社区情绪源', scope: '玩家奇闻 / 游戏梗 / 社区争议 / 实测体验', itemLimit: 20 },
];


function coarseFilter(signals) {
  const popular = /英雄联盟|league of legends|lol\b|cs2|counter-strike|valorant|无畏契约|王者荣耀|逆水寒|米哈游|原神|崩坏|星穹铁道|恋与深空|叠纸|乙游|二游|任天堂|nintendo|playstation|xbox|steam|gta|怪物猎人|monster hunter|腾讯|网易|faker|t1\b|blg|edg|tes|donk|niko|kojima|小岛秀夫/i;
  const people = /选手|主播|教练|战队|俱乐部|player|streamer|coach|team|creator|director|producer|ceo|明星|夺冠|冠军|转会|退役|回应|道歉/i;
  const conflict = /争议|翻车|离谱|炸裂|逆天|草台班子|乌龙|公关|节奏|差评|投诉|爆冷|惨败|淘汰|封禁|下架|停更|停服|关服|泄露|取消|延迟|故障|漏洞|外挂|抄袭|起诉|罚款|抵制|道歉|controvers|ban\b|banned|lawsuit|delay|cancel|shutdown|outage|leak|cheat|apolog|backlash|upset/i;
  const announcement = /官宣|公布|发布|上线|测试|联动|更新|降价|销量|纪录|announc|release|launch|update|collab|sales|record/i;
  return signals.filter(function(signal) {
    return !isLowValueRoutineSports(signal);
  }).map(function(signal) {
    const text = [signal.title, signal.summary, signal.category].join(' ');
    const hours = signal.publishedAt ? Math.max(0, (Date.now() - dateValue(signal.publishedAt)) / 3600000) : 120;
    let score = Math.max(0, 30 - Math.min(hours, 144) / 6);
    const reasons = [];
    if (signal.sourceId === 'mrs-today') { score += 24; reasons.push('中文人工聚合源'); }
    if (signal.sourceId === 'sample-web-seeds') { score += 30; reasons.push('人工样本反查网页'); }
    if (popular.test(text)) { score += 20; reasons.push('国内玩家有认知'); }
    if (people.test(text)) { score += 18; reasons.push('有人物或赛事主体'); }
    if (conflict.test(text)) { score += 22; reasons.push('存在冲突/反差/舆论点'); }
    if (announcement.test(text)) { score += 9; reasons.push('存在明确事件节点'); }
    if (signal.summary && signal.url) { score += 8; reasons.push('原文素材完整'); }
    if (!/[\u3400-\u9fff]/.test(signal.title || '')) { score -= 8; reasons.push('需翻译和本土化'); }
    if (hours > 96) { score -= 24; reasons.push('时效偏弱'); }
    return Object.assign({}, signal, { coarseScore: Math.max(0, Math.round(score)), coarseReasons: reasons });
  }).filter(function(item) {
    return item.coarseScore >= 34;
  }).sort(function(a, b) {
    return b.coarseScore - a.coarseScore || dateValue(b.publishedAt) - dateValue(a.publishedAt);
  });
}


function isLowValueRoutineSports(item) {
  const text = cleanText([item && item.title, item && item.rawTitle, item && item.summary, item && item.category].filter(Boolean).join(' '));
  const realWorldSports = /世界杯|美加墨|足球国家队|男足|女足|英超|欧冠|西甲|意甲|德甲|法甲|中超|亚冠|NBA|CBA|篮球联赛|网球公开赛|温网|法网|美网|澳网|奥运会|世界锦标赛|F1|一级方程式/i;
  const gamingAnchor = /游戏|电竞|电子竞技|选手|战队|俱乐部|主播|玩家|赛事版本|英雄联盟|league of legends|\blol\b|cs2|counter-strike|valorant|无畏契约|王者荣耀|和平精英|dota|steam|xbox|playstation|switch|任天堂|ea sports|fifa\s*\d|足球经理|实况足球|nba\s*2k/i;
  const storyAnchor = /离谱|荒诞|奇闻|乌龙|争议|冲突|丑闻|反转|翻车|道歉|天价|账单|票价|退钱哥|出轨|恋情|两性|色情|情色|擦边|成人|裸照|裸体|性感|性暗示|onlyfans|porn|sex|nude|scandal|controvers|backlash/i;
  return realWorldSports.test(text) && !gamingAnchor.test(text) && !storyAnchor.test(text);
}


function editorialEventCluster(value) {
  const text = cleanText(value).toLowerCase();
  if (/saber/i.test(text)
    && /(ai|chatgpt|人工智能|编剧|作家|writer|rideshare\s+stimulator)/i.test(text)
    && /(ceo|老板|高管|声明|disclaimer|道歉|apolog|替代|替换|replace|互撕|争议|row|scrap|controvers)/i.test(text)) {
    return 'saber-rideshare-ai-writer-dispute';
  }
  if (/(bside|olivia\s*lin|林離|林离|ai女友|ai陪伴)/i.test(text) && /(停运|停運|停服|停止运营|結束營運|结束运营|离线版|離線版|offline|shutdown)/i.test(text)) return 'bside-olivia-lin-shutdown-offline';
  if (/(异形[：:]?火力小队|aliens?[:：]?\s*fireteam\s*elite)/i.test(text) && /(switch|云版本|雲端版|cloud|停服|下架|不能玩|无法游玩|unplayable|refund|退款)/i.test(text)) return 'aliens-fireteam-elite-switch-cloud-shutdown';
  if (/(战地(?:风云)?\s*6|battlefield\s*6)/i.test(text) && /(rush|突袭|突襲|模式.*删|下架.*模式|mode removal|470\s*小时|470\s*hours|退款|refund)/i.test(text)) return 'battlefield-6-rush-removal-refund';
  if (/(gta\s*6|gta6)/i.test(text) && /(netflix|网飞|網飛)/i.test(text) && /(8000\s*万|80\s*million|\$80m|支付|首播权|首播權)/i.test(text)) return 'gta6-netflix-80m-premiere-rights';
  if (/(gta\s*6|gta6)/i.test(text) && /(netflix|网飞|網飛)/i.test(text) && /(预告|預告|trailer|extended look|前瞻)/i.test(text)) return 'gta6-netflix-trailer-premiere';
  if (/小岛秀夫|hideo kojima/i.test(text) && /电影|电影院|影院|cinema|movie/i.test(text) && /死|去世|临终|death|die/i.test(text)) return 'hideo-kojima-cinema-death-wish';
  if (/(微软|microsoft|xbox)/i.test(text) && /(删号|清空|被盗|blocks? another user|own nothing|game library|onedrive|数字游戏.*归谁)/i.test(text)) return 'microsoft-account-library-deletion';
  if (/(英雄联盟|league of legends|\blol\b)/i.test(text) && /(经典|怀旧|classic|season\s*3|初期環境)/i.test(text)) return 'lol-classic-mode';
  if (/glen schofield/i.test(text) && /(退休|退役|retir)/i.test(text)) return 'glen-schofield-retirement';
  if (/(怪物猎人[：:]?荒野|monster hunter wilds)/i.test(text) && /(永久降价|降价|price cut)/i.test(text)) return 'monster-hunter-wilds-price-cut';
  return '';
}

const SEMANTIC_ENTITY_STOPWORDS = new Set([
  'after', 'before', 'finally', 'about', 'between', 'public', 'latest', 'update',
  'games', 'gaming', 'game', 'steam', 'writer', 'writers', 'chief', 'former',
  'interactive', 'studio', 'company', 'disclaimer', 'apologizes', 'apology',
  'replace', 'replaced', 'using', 'should', 'could', 'would', 'their', 'with'
]);

function semanticEventAnchors(value) {
  const text = cleanText(value).toLowerCase();
  const entities = new Set();
  (text.match(/[a-z][a-z0-9-]{3,}/g) || []).forEach(function(token) {
    if (!SEMANTIC_ENTITY_STOPWORDS.has(token)) entities.add(token);
  });
  [
    ['saber', /\bsaber\b/i],
    ['microsoft', /微软|microsoft/i],
    ['nintendo', /任天堂|nintendo/i],
    ['playstation', /playstation|索尼互动娱乐/i],
    ['ubisoft', /育碧|ubisoft/i],
    ['blizzard', /暴雪|blizzard/i],
    ['tencent', /腾讯|tencent/i],
    ['netease', /网易|netease/i]
  ].forEach(function(entry) {
    if (entry[1].test(text)) entities.add(entry[0]);
  });

  const topics = new Set();
  [
    ['ai', /\bai\b|chatgpt|人工智能|生成式/i],
    ['writer', /编剧|作家|作者|writer|scribe/i],
    ['executive', /ceo|老板|高管|首席执行官/i],
    ['replace', /替代|替换|取代|replace/i],
    ['apology', /道歉|致歉|apolog/i],
    ['disclosure', /声明|披露|标注|disclaimer|disclos/i],
    ['conflict', /互撕|争吵|冲突|争议|嘲讽|row|scrap|controvers|backlash/i],
    ['shutdown', /停运|停服|关服|shutdown|offline/i],
    ['layoff', /裁员|解雇|layoff|laid off|fired/i],
    ['ban', /封禁|封号|禁赛|banned|suspend/i],
    ['price', /涨价|降价|定价|price cut|price increase/i]
  ].forEach(function(entry) {
    if (entry[1].test(text)) topics.add(entry[0]);
  });
  return { entities, topics };
}

function sameSemanticEvent(leftText, rightText, leftDate, rightDate) {
  const at = dateValue(leftDate);
  const bt = dateValue(rightDate);
  if (at && bt && Math.abs(at - bt) > 4 * 86400000) return false;
  const left = semanticEventAnchors(leftText);
  const right = semanticEventAnchors(rightText);
  const hasSharedEntity = Array.from(left.entities).some(function(token) {
    return right.entities.has(token);
  });
  if (!hasSharedEntity) return false;
  const sharedTopicCount = Array.from(left.topics).filter(function(topic) {
    return right.topics.has(topic);
  }).length;
  return sharedTopicCount >= 2;
}

function sameHotspotEvent(left, right) {
  const leftText = [left && left.title, left && left.rawTitle, left && left.summary].filter(Boolean).join(' ');
  const rightText = [right && right.title, right && right.rawTitle, right && right.summary].filter(Boolean).join(' ');
  const leftCluster = editorialEventCluster(leftText);
  const rightCluster = editorialEventCluster(rightText);
  if (leftCluster && leftCluster === rightCluster) return true;
  if (sameSemanticEvent(leftText, rightText, left && left.publishedAt, right && right.publishedAt)) return true;
  const leftTitles = [left && left.title, left && left.rawTitle].filter(Boolean);
  const rightTitles = [right && right.title, right && right.rawTitle].filter(Boolean);
  return leftTitles.some(function(leftTitle) {
    return rightTitles.some(function(rightTitle) {
      return sameEvent(leftTitle, rightTitle, left && left.publishedAt, right && right.publishedAt);
    });
  });
}


function isRecentVerifiedSignal(item) {
  const time = dateValue(item && item.publishedAt);
  if (!time) return false;
  const age = Date.now() - time;
  return age >= -6 * 60 * 60 * 1000 && age <= THREE_DAYS_MS;
}


function extractArticleDate(html, url) {
  const patterns = [
    /["']datePublished["']\s*:\s*["']([^"']+)["']/i,
    /<meta\b[^>]*(?:property|name)=["'](?:article:published_time|pubdate|publishdate|date)["'][^>]*content=["']([^"']+)["']/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|pubdate|publishdate|date)["']/i,
    /<time\b[^>]*datetime=["']([^"']+)["']/i,
    /(20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}:\d{2})?)/
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    const normalized = normalizeDate(match && match[1]);
    if (normalized) return normalized;
  }
  const urlDate = String(url || '').match(/(?:\/|^)(20\d{2})[\/-]?(\d{2})[\/-]?(\d{2})(?:\/|$)/);
  if (urlDate) return normalizeDate(urlDate[1] + '-' + urlDate[2] + '-' + urlDate[3]);
  return '';
}


function parseRss(xml, source) {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.map(function(block) {
    const title = field(block, ['title']);
    let url = field(block, ['link', 'guid']);
    const href = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
    if (href) url = href[1];
    const summary = field(block, ['description', 'summary', 'content:encoded', 'content']);
    const publishedAt = field(block, ['pubDate', 'published', 'updated', 'dc:date']);
    if (!title || !url) return null;
    return makeSignal(source, title, url, summary, publishedAt);
  }).filter(Boolean);
}

function filterSourceItems(items, source) {
  if (source.id !== 'ithome-games') return items;
  const gameTerms = /游戏|电竞|玩家|主机|掌机|steam|xbox|playstation|ps5|switch|任天堂|育碧|暴雪|微软游戏|索尼互动娱乐|ea sports|英雄联盟|王者荣耀|无畏契约|cs2|gta|怪物猎人|米哈游|腾讯游戏|网易游戏/i;
  return items.filter(function(item) { return gameTerms.test(item.title); });
}

function parseMrs(html, source) {
  const blocks = html.match(/<article\s+class=["']waterfall-card["'][\s\S]*?<\/article>/gi) || [];
  return blocks.map(function(block) {
    const titleMatch = block.match(/<a\s+href=["']([^"']+)["']\s+class=["']card-title["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) return null;
    const sourceMatch = block.match(/class=["']card-source["'][^>]*>([\s\S]*?)<\/span>/i);
    const summaryMatch = block.match(/class=["']card-summary["'][^>]*>([\s\S]*?)<\/p>/i);
    const dateMatch = block.match(/class=["']card-time["'][^>]*>([\s\S]*?)<\/span>/i);
    const scoreMatch = block.match(/class=["'][^"']*card-score[^"']*["'][^>]*>(\d+)/i);
    const item = makeSignal(source, titleMatch[2], new URL(titleMatch[1], source.url).href, summaryMatch ? summaryMatch[1] : '', dateMatch ? dateMatch[1] : '');
    item.originalSource = cleanText(sourceMatch ? sourceMatch[1] : '');
    item.score = scoreMatch ? Number(scoreMatch[1]) : undefined;
    return item;
  }).filter(Boolean);
}

function parseFamitsu(html, source) {
  const seen = new Set();
  const items = [];
  const pattern = /<a\b[^>]*aria-label=["']([^"']+)["'][^>]*href=["'](\/article\/(?:\d+\/)?\d+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) && items.length < 20) {
    const url = new URL(match[2], source.url).href;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push(makeSignal(source, match[1], url, '', ''));
  }
  return items;
}

function parseGamersky(html, source) {
  const seen = new Set();
  const items = [];
  const pattern = /<a\b[^>]*href=["'](https?:\/\/www\.gamersky\.com\/(?:news|hardware)\/\d+\/\d+\.shtml)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) && items.length < 30) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    items.push(makeSignal(source, match[2], match[1], '', ''));
  }
  return items;
}

function parse5EPlay(html, source) {
  const seen = new Set();
  const items = [];
  const pattern = /<a\b[^>]*href=["'](https?:\/\/csgo\.5eplay\.com\/article\/[a-z0-9]+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) && items.length < 35) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    items.push(makeSignal(source, match[2], match[1], '', ''));
  }
  return items;
}

function parse17173(html, source) {
  const seen = new Set();
  const items = [];
  const pattern = /<a\b[^>]*href=["']((?:https?:)?\/\/news\.17173\.com\/content\/[^"']+\.shtml)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && items.length < 35) {
    const title = cleanText(match[2]);
    const url = new URL(match[1], source.url).href;
    if (title.length < 8 || seen.has(url)) continue;
    seen.add(url);
    items.push(makeSignal(source, title, url, '', ''));
  }
  return items;
}

function parseDianjinghu(html, source) {
  const seen = new Set();
  const items = [];
  const pattern = /<a\b[^>]*href=["'](\/news\/\d+\.html)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) && items.length < 35) {
    const card = html.slice(pattern.lastIndex, pattern.lastIndex + 1200);
    const titleMatch = card.match(/<h4\b[^>]*class=["'][^"']*tit[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i);
    const title = cleanText(titleMatch ? titleMatch[1] : '');
    const url = new URL(match[1], source.url).href;
    if (title.length < 8 || seen.has(url)) continue;
    seen.add(url);
    items.push(makeSignal(source, title, url, '', ''));
  }
  return items;
}

function parse3DM(html, source) {
  return parseAnchoredNews(html, source, function(url) {
    return /^https:\/\/www\.3dmgame\.com\/news\/20\d{4}\//i.test(url);
  });
}

function parseSinaEsports(html, source) {
  return parseAnchoredNews(html, source, function(url) {
    return /^https:\/\/dj\.sina\.com\.cn\/article\//i.test(url);
  });
}

function parseDota2CN(html, source) {
  return parseAnchoredNews(html, source, function(url) {
    return /^https:\/\/www\.dota2\.com\.cn\/article\/details\//i.test(url);
  });
}

function parseQQNews(html, source) {
  return parseAnchoredNews(html, source, function(url) {
    return /^https:\/\/pvp\.qq\.com\/web201706\/newsdetail\.shtml\?tid=\d+/i.test(url);
  });
}

function parseGenericNewsPage(html, source) {
  const host = new URL(source.url).hostname.replace(/^www\./i, '');
  return parseAnchoredNews(html, source, function(url) {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') === host && /\/news\//i.test(parsed.pathname);
  });
}

function parseAnchoredNews(html, source, acceptUrl) {
  const seen = new Set();
  const items = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && items.length < 80) {
    let url = '';
    try { url = new URL(match[1], source.url).href; } catch { continue; /* 可选坏链接不能成为文章，跳过解析。 */ }
    if (!acceptUrl(url) || seen.has(url)) continue;
    const title = cleanText(match[2]);
    if (title.length < 8) continue;
    seen.add(url);
    items.push(makeSignal(source, title, url, '', ''));
  }
  return items;
}

function field(block, names) {
  for (const name of names) {
    const escaped = name.replace(':', '\\:');
    const match = block.match(new RegExp('<' + escaped + '\\b[^>]*>([\\s\\S]*?)<\\/' + escaped + '>', 'i'));
    if (match) return cleanText(match[1]);
  }
  return '';
}

function cleanText(value) {
  return decodeEntities(String(value || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, function(all, token) {
    if (token[0] === '#') {
      const hex = token[1].toLowerCase() === 'x';
      const code = parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return named[token.toLowerCase()] || all;
  });
}

function makeSignal(source, title, url, summary, publishedAt) {
  const cleanTitle = cleanText(title);
  const cleanUrl = cleanText(url);
  return {
    id: 'signal:' + source.id + ':' + hash(cleanUrl || cleanTitle),
    board: 'game',
    sourceId: source.id,
    source: source.name,
    originalSource: '',
    title: cleanTitle,
    summary: cleanText(summary).slice(0, 360),
    url: cleanUrl,
    category: source.scope,
    publishedAt: normalizeDate(publishedAt),
    collectedAt: new Date().toISOString()
  };
}


function normalizeDate(value) {
  const text = cleanText(value);
  if (!text) return '';
  const now = new Date();
  let relative = text.match(/(\d+)\s*分钟(?:前|内)/);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * 60000).toISOString();
  relative = text.match(/(\d+)\s*小时(?:前|内)/);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * 3600000).toISOString();
  relative = text.match(/(\d+)\s*天(?:前|内)/);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * 86400000).toISOString();
  if (/刚刚|片刻前/.test(text)) return now.toISOString();
  if (/昨天/.test(text)) {
    const clock = text.match(/(\d{1,2}):(\d{2})/);
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    if (clock) date.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    return date.toISOString();
  }
  const chinese = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/);
  if (chinese) return new Date(Number(chinese[1]), Number(chinese[2]) - 1, Number(chinese[3]), Number(chinese[4] || 12), Number(chinese[5] || 0)).toISOString();
  const short = text.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (short && !/20\d{2}[\/-]/.test(text)) return new Date(now.getFullYear(), Number(short[1]) - 1, Number(short[2]), Number(short[3] || 12), Number(short[4] || 0)).toISOString();
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function dateValue(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function hash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}


function sameEvent(left, right, leftDate, rightDate) {
  const a = normalizeEventText(left);
  const b = normalizeEventText(right);
  if (!a || !b) return false;
  const at = dateValue(leftDate), bt = dateValue(rightDate);
  if (at && bt && Math.abs(at - bt) > 4 * 86400000) return false;
  if (a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)))) return true;
  const aTokens = eventTokens(a), bTokens = eventTokens(b);
  const intersection = Array.from(aTokens).filter(function(token) { return bTokens.has(token); }).length;
  const union = new Set(Array.from(aTokens).concat(Array.from(bTokens))).size || 1;
  if (intersection / union >= 0.52) return true;
  const aEntities = eventEntities(a), bEntities = eventEntities(b);
  const sharedEntities = Array.from(aEntities).filter(function(token) { return bEntities.has(token); }).length;
  const sharedEventWord = /冠军|夺冠|问鼎|停更|道歉|取消|降价|处罚|罚款|战胜|击败|不敌|淘汰|签约|加盟/.test(a) && /冠军|夺冠|问鼎|停更|道歉|取消|降价|处罚|罚款|战胜|击败|不敌|淘汰|签约|加盟/.test(b);
  return sharedEntities >= 3 && sharedEventWord;
}

function normalizeEventText(value) {
  return cleanText(value).toLowerCase().replace(/《|》|“|”|「|」|【|】/g, '').replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function eventTokens(text) {
  const tokens = new Set(text.match(/[a-z0-9]{2,}/g) || []);
  const chinese = text.replace(/[a-z0-9]+/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) tokens.add(chinese.slice(index, index + 2));
  return tokens;
}

function eventEntities(text) {
  const entities = new Set(text.match(/[a-z]+\d*|\d+[a-z]+|\d{4}/g) || []);
  const known = ['广州', '恋与深空', '怪物猎人', '深空之眼', '英雄联盟', '无畏契约', '王者荣耀', '米哈游', '叠纸', '天禄', '小蜜蜂', '刘青松'];
  known.forEach(function(name) { if (text.includes(name.toLowerCase())) entities.add(name); });
  return entities;
}

export { SOURCES, coarseFilter, isLowValueRoutineSports, sameHotspotEvent, isRecentVerifiedSignal, extractArticleDate, filterSourceItems, makeSignal, sameEvent, parseRss, parseMrs, parseFamitsu, parseGamersky, parse5EPlay, parse17173, parseDianjinghu, parse3DM, parseSinaEsports, parseDota2CN, parseQQNews, parseGenericNewsPage };