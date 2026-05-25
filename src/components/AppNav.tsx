"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Calculator, FileText, FolderKanban, MessageSquarePlus, PenLine, Sparkles } from "lucide-react";
import { TaskCenter } from "./TaskCenter";
import type { AppMode } from "@/lib/app-mode";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
};

const navItems: NavItem[] = [
  { href: "/library", label: "账号库", icon: FileText },
  { href: "/project-workbench", label: "项目工作台", icon: FolderKanban },
  { href: "/writer", label: "对话写作", icon: PenLine },
  { href: "/assets", label: "评论生成", icon: MessageSquarePlus },
  { href: "/gross-margin", label: "数据维护", icon: Calculator },
  { href: "/gross-margin/monitor", label: "数据监控", icon: Activity }
];

const grossMarginNavItems = navItems.filter((item) => item.href.startsWith("/gross-margin"));

export function AppNav({ appMode }: { appMode: AppMode }) {
  const pathname = usePathname();
  const grossMarginMode = appMode === "gross-margin";
  const visibleNavItems = grossMarginMode ? grossMarginNavItems : navItems;
  const brandHref = grossMarginMode ? "/gross-margin" : "/library";

  return (
    <aside className="sidebar">
      <Link href={brandHref} className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Sparkles size={18} strokeWidth={2.1} />
        </span>
        <span>
          <strong>{grossMarginMode ? "数据维护监控" : "风格库"}</strong>
          <small>{grossMarginMode ? "Windows 便携版" : "本地"}</small>
        </span>
      </Link>
      <nav className="nav-list" aria-label="主导航">
        {visibleNavItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <div className="nav-group" key={item.href}>
              <Link href={item.href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
                <span className="nav-emoji" aria-hidden="true">
                  <Icon size={17} strokeWidth={2.1} />
                </span>
                <span>{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>
      {grossMarginMode ? null : <TaskCenter />}
    </aside>
  );
}
