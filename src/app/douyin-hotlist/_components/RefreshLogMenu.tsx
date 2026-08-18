import { ChevronDown, Clock3 } from "lucide-react";
import {
  formatLogTime,
  getRefreshLogStatusLabel,
  type RefreshLogEntry,
  type RefreshLogGroup,
  type RefreshLogGroupKind
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
            {logs.map((log) => <RefreshLogItem key={log.id} log={log} />)}
          </ol>
        ) : (
          <p>暂无记录，下一次自动刷新会写在这里。</p>
        )}
      </div>
    </details>
  );
}

function RefreshLogItem({ log }: { log: RefreshLogEntry }) {
  const hasDetails = Boolean(log.groups?.length || log.details?.length);
  const summary = <RefreshLogSummary log={log} />;

  return (
    <li className={`tone-${log.status}`}>
      {hasDetails ? (
        <details className="douyin-hotlist-refresh-log-entry">
          <summary>
            {summary}
            <span className="douyin-hotlist-refresh-log-disclosure">
              {getDisclosureLabel(log)}
              <ChevronDown aria-hidden="true" size={13} />
            </span>
          </summary>
          <div className="douyin-hotlist-refresh-log-details">
            {log.groups?.map((group, index) => (
              <RefreshLogGroupBlock group={group} key={`${group.kind}-${group.reason || ""}-${index}`} />
            ))}
            {log.details?.length ? (
              <div className="douyin-hotlist-refresh-log-legacy">
                <strong>历史明细</strong>
                {log.details.map((detail) => <span key={detail}>{detail}</span>)}
              </div>
            ) : null}
          </div>
        </details>
      ) : (
        <div className="douyin-hotlist-refresh-log-entry-static">{summary}</div>
      )}
    </li>
  );
}

function RefreshLogSummary({ log }: { log: RefreshLogEntry }) {
  return (
    <>
      <span className="douyin-hotlist-refresh-log-meta">
        <span>{formatLogTime(log.at)}</span>
        <span>{log.automatic ? "自动" : "手动"}</span>
        <span>{getRefreshLogStatusLabel(log.status)}</span>
      </span>
      <span className="douyin-hotlist-refresh-log-summary">{log.text}</span>
    </>
  );
}

function RefreshLogGroupBlock({ group }: { group: RefreshLogGroup }) {
  return (
    <div className={`douyin-hotlist-refresh-log-group kind-${group.kind}`}>
      <div className="douyin-hotlist-refresh-log-group-head">
        <strong>{getGroupLabel(group.kind)}</strong>
        <span>{group.accounts.length} 个</span>
      </div>
      <p>{group.accounts.join("、")}</p>
      {group.reason ? <small>{group.reason}</small> : null}
    </div>
  );
}

function getDisclosureLabel(log: RefreshLogEntry) {
  if (!log.groups?.length) return `查看明细 · ${log.details?.length || 0} 条`;
  const counts = new Map<RefreshLogGroupKind, number>();
  log.groups.forEach((group) => counts.set(group.kind, (counts.get(group.kind) || 0) + group.accounts.length));
  const parts: string[] = [];
  if (counts.get("failed")) parts.push(`${counts.get("failed")} 失败`);
  if (counts.get("recovered")) parts.push(`${counts.get("recovered")} 已恢复`);
  if (counts.get("unchanged")) parts.push(`${counts.get("unchanged")} 无变化`);
  return `查看明细 · ${parts.join(" / ")}`;
}

function getGroupLabel(kind: RefreshLogGroupKind) {
  if (kind === "failed") return "失败账号";
  if (kind === "recovered") return "重试已恢复";
  return "无变化";
}
