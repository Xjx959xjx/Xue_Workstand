import { Clock3 } from "lucide-react";
import {
  formatLogTime,
  getRefreshLogStatusLabel,
  type RefreshLogEntry
} from "../_lib/douyin-hotlist-model";

export function RefreshLogMenu({ logs }: { logs: RefreshLogEntry[] }) {
  const latestLog = logs[0];

  return (
    <details className="douyin-hotlist-refresh-log">
      <summary aria-label="查看刷新日志" className="btn douyin-hotlist-refresh-log-trigger">
        <Clock3 aria-hidden="true" size={13} />
        <span>{latestLog ? formatLogTime(latestLog.at) : "刷新日志"}</span>
      </summary>
      <div className="douyin-hotlist-refresh-log-panel" role="log" aria-label="刷新日志">
        <div className="douyin-hotlist-refresh-log-head">
          <strong>刷新日志</strong>
          <span>页面打开时每 3 小时自动检查，失败会记录</span>
        </div>
        {logs.length ? (
          <ol>
            {logs.map((log) => (
              <li className={`tone-${log.status}`} key={log.id}>
                <span className="douyin-hotlist-refresh-log-meta">
                  <span>{formatLogTime(log.at)}</span>
                  <span>{log.automatic ? "自动" : "手动"}</span>
                  <span>{getRefreshLogStatusLabel(log.status)}</span>
                </span>
                <span>{log.text}</span>
                {log.details?.length ? (
                  <span className="douyin-hotlist-refresh-log-details">
                    {log.details.map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>暂无记录，下一次自动刷新会写在这里。</p>
        )}
      </div>
    </details>
  );
}
