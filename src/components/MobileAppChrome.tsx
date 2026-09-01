"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Flame, Home, Menu, PenLine, Sword } from "lucide-react";
import { SkinToggle } from "./SkinToggle";
import { TaskCenter } from "./TaskCenter";
import { useRemoteStatus } from "./RemoteStatusProvider";
import type { AppMode } from "@/lib/app-mode";

const primaryItems = [
  { href: "/mobile", label: "首页", icon: Home, exact: true },
  { href: "/douyin-hotlist", label: "热榜", icon: Flame },
  { href: "/library", label: "账号库", icon: BookOpen },
  { href: "/writer", label: "写作", icon: PenLine },
  { href: "/mobile/more", label: "更多", icon: Menu, more: true }
];

const secondaryPrefixes = ["/hotspots", "/project-workbench", "/assets", "/tools", "/gross-margin"];

export function MobileAppChrome({ appMode }: { appMode: AppMode }) {
  const pathname = usePathname();
  const remote = useRemoteStatus();
  if (appMode === "gross-margin") return null;

  return (
    <>
      <header className="mobile-top-bar">
        <Link className="mobile-top-brand" href="/mobile">
          <span className="mobile-top-mark" aria-hidden="true">
            <span className="mobile-top-mark-default">P</span>
            <Sword className="mobile-top-mark-shinigami" size={19} strokeWidth={2} />
          </span>
          <span className="mobile-brand-copy mobile-brand-copy-default">
            <strong>风格库</strong>
            <small>私人远程工作台</small>
          </span>
          <span className="mobile-brand-copy mobile-brand-copy-shinigami">
            <strong>BLEACH</strong>
            <small>SOUL SOCIETY</small>
          </span>
        </Link>
        <div className="mobile-top-actions">
          <SkinToggle compact />
          <Link
            className={`remote-status-chip ${remote.connection}`}
            href="/mobile/more#service-status"
            aria-label={`后台状态：${connectionLabel(remote.connection)}`}
          >
            <span aria-hidden="true" />
            {connectionLabel(remote.connection)}
          </Link>
          <TaskCenter variant="mobile" />
        </div>
      </header>
      <nav className="mobile-tab-bar" aria-label="手机主导航">
        {primaryItems.map((item) => {
          const active = isActiveItem(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`mobile-tab-link ${active ? "active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden="true" size={21} strokeWidth={2} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function isActiveItem(
  pathname: string,
  item: { href: string; exact?: boolean; more?: boolean }
) {
  if (item.more) {
    return pathname.startsWith(item.href) || secondaryPrefixes.some((prefix) => pathname.startsWith(prefix));
  }
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function connectionLabel(connection: ReturnType<typeof useRemoteStatus>["connection"]) {
  if (connection === "online") return "在线";
  if (connection === "degraded") return "部分可用";
  if (connection === "offline") return "离线";
  return "检查中";
}
