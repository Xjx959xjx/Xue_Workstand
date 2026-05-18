export function formatJobErrorMessage(message: string) {
  const normalized = message.trim();
  if (!normalized) return "任务失败，请稍后重试。";

  if (/data\.bilibili\.com\/log\/web/i.test(normalized) && /Invalid data found when processing input/i.test(normalized)) {
    return "此 B站视频没有公开字幕，系统回退音频转写时误把 B站日志地址当成媒体地址，导致音频提取失败。这个解析问题已修复，重新转写即可。";
  }

  if (/opencli browser .*douyin-media/i.test(normalized)) {
    return "没有取得当前抖音视频的可转写媒体地址。请确认 opencli 已登录抖音、视频链接仍可访问，或重新采集账号后再试。";
  }

  if (/最近 50 条视频里找不到|可能已删除、隐藏、下架/.test(normalized)) {
    return normalized;
  }

  if (/没有可转写的本地媒体文件/.test(normalized)) {
    return normalized.replace("没有可转写的本地媒体文件", "没有取得可转写的媒体地址或本地文件");
  }

  return normalized.replace(/https?:\/\/\S{80,}/gi, (url) => {
    try {
      const parsed = new URL(url.split(/[|<>]/)[0]);
      return `${parsed.hostname}${parsed.pathname}`;
    } catch {
      return "远程媒体地址";
    }
  });
}
