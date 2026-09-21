import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
// 独立临时 Chrome 配置，不读取用户浏览器资料，也不写业务缓存。
const candidates = [process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
const CHROME = candidates.find(candidate => fs.existsSync(candidate));
const HOME_URL = 'https://www.xiaoheihe.cn/app/bbs/home';
let childProcess;
let cacheDir;
function cleanup() {
  if (childProcess && !childProcess.killed) childProcess.kill();
}
function stop() { cleanup(); setTimeout(() => process.exit(1), 1000).unref(); }
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForDevtools(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), timeoutMs);
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once('error', error => { clearTimeout(timer); reject(new Error('Chrome 启动失败：' + error.message)); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome 在采集就绪前退出 (${code})`));
    });
  });
}

async function openPageSocket(browserWs) {
  const parsed = new URL(browserWs);
  const listUrl = `http://${parsed.hostname}:${parsed.port}/json/list`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await fetch(listUrl).then(response => response.json()).catch(() => []); // Chrome 启动时目标列表短暂不可用，限定重试后显式失败。
    const page = rows.find(row => row.type === 'page');
    if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    await delay(100);
  }
  throw new Error('Chrome 采集页面不可用');
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Set();
    let nextId = 1;
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((resolveCommand, rejectCommand) => {
            const id = nextId++;
            pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        close() { socket.close(); }
      });
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) task.reject(new Error(message.error.message || 'Chrome 采集指令失败'));
        else task.resolve(message.result || {});
        return;
      }
      if (message.method) listeners.forEach(listener => listener(message));
    });
    socket.addEventListener('error', () => reject(new Error('无法连接 Chrome 采集进程')));
  });
}

function findFeedArray(value, depth = 0) {
  if (!value || depth > 8) return null;
  if (Array.isArray(value)) {
    if (value.some(row => row && typeof row === 'object' && (row.link_id || row.title || row.text))) return value;
    for (const row of value) {
      const found = findFeedArray(row, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const item of Object.values(value)) {
    const found = findFeedArray(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function pickText(...values) {
  return values.map(value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
}

function normalizeTime(value) {
  if (!value) return '';
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const number = Number(value);
    const date = new Date(number < 1e12 ? number * 1000 : number);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizeRows(payload) {
  const rows = findFeedArray(payload) || [];
  return rows.map(row => {
    const linkId = row.linkid || row.link_id || row.linkId || row.id || (row.link && row.link.id) || '';
    const title = pickText(row.title, row.link && row.link.title, row.text, row.content && row.content.title);
    const summary = pickText(row.summary, row.desc, row.description, row.content, row.link && row.link.content, row.text);
    const publishedAt = normalizeTime(row.create_at || row.create_time || row.created_at || row.publish_time || row.time || row.link && row.link.create_time);
    return {
      id: String(linkId || ''),
      title,
      summary: summary === title ? '' : summary,
      url: linkId ? `https://www.xiaoheihe.cn/app/bbs/link/${linkId}` : '',
      publishedAt,
      comments: Number(row.comment_num || row.comment_count || row.comments || 0) || 0,
      likes: Number(row.like_num || row.like_count || row.link_award_num || row.likes || 0) || 0,
      topic: pickText(row.topics && row.topics[0] && row.topics[0].name)
    };
  }).filter(row => row.id && row.title && row.publishedAt);
}

async function collect() {
  if (!CHROME) throw new Error('未找到 Chrome，请安装 Google Chrome 或配置 CHROME_BIN');
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotspot-chrome-'));
  const child = spawn(CHROME, [
    `--user-data-dir=${cacheDir}`,
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-default-apps',
    '--no-first-run',
    '--remote-debugging-port=0',
    'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });

  childProcess = child;
  let cdp;
  try {
    const browserWs = await waitForDevtools(child, 15000);
    cdp = await connectCdp(await openPageSocket(browserWs));
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');

    const feedResponses = new Map();
    const payloads = [];
    cdp.onEvent(async message => {
      if (message.method === 'Network.responseReceived') {
        const response = message.params && message.params.response;
        if (response && /\/bbs\/app\/feeds(?:\?|$)/.test(response.url)) {
          feedResponses.set(message.params.requestId, response.url);
        }
        return;
      }
      if (message.method !== 'Network.loadingFinished' || !feedResponses.has(message.params.requestId)) return;
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: message.params.requestId });
        payloads.push(JSON.parse(body.body));
      } catch {
        // Ignore one failed body read; another feed request may still succeed.
      }
    });

    for (let round = 0; round < 3; round += 1) {
      await cdp.send('Page.navigate', { url: HOME_URL + (round ? `?radar_round=${round}` : '') });
      for (let page = 0; page < 3; page += 1) {
        await delay(1400);
        await cdp.send('Runtime.evaluate', {
          expression: 'window.scrollTo(0, document.documentElement.scrollHeight); document.documentElement.scrollHeight',
          returnByValue: true
        });
      }
    }
    await delay(1800);
    if (!payloads.length) throw new Error('小黑盒未返回帖子数据，请检查网络或稍后重试');
    const payloadList = payloads;
    const items = payloadList.flatMap(normalizeRows);
    const unique = [...new Map(items.map(item => [item.url, item])).values()];
    return { collectedAt: new Date().toISOString(), source: HOME_URL, items: unique };
  } finally {
    if (cdp) cdp.close();
    if (!child.killed) child.kill();
    // 仅清理本进程创建的临时浏览器目录，不接触用户资料。
    await new Promise(resolve => {
      if (child.exitCode !== null || !child.pid) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

collect().then(result => {
  const json = JSON.stringify(result, null, 2);
  process.stdout.write(json + os.EOL);
}).catch(error => {
  process.stderr.write(`[xiaoheihe] ${error.message || error}\n`);
  process.exitCode = 1;
});
