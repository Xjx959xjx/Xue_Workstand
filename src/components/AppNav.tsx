"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Calculator, FileText, FolderKanban, MessageSquarePlus, PenLine, Sparkles } from "lucide-react";
import { TaskCenter } from "./TaskCenter";

type NavChild = {
  href: string;
  label: string;
  icon?: typeof Activity;
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
  children?: NavChild[];
};

const navItems: NavItem[] = [
  { href: "/library", label: "账号库", icon: FileText },
  { href: "/project-workbench", label: "项目工作台", icon: FolderKanban },
  { href: "/writer", label: "对话写作", icon: PenLine },
  { href: "/assets", label: "评论生成", icon: MessageSquarePlus },
  {
    href: "/gross-margin",
    label: "数据维护",
    icon: Calculator,
    children: [{ href: "/gross-margin/monitor", label: "数据监控", icon: Activity }]
  }
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/library" className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Sparkles size={18} strokeWidth={2.1} />
        </span>
        <span>
          <strong>风格库</strong>
          <small>本地</small>
        </span>
      </Link>
      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const exactActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <div className="nav-group" key={item.href}>
              <Link href={item.href} className={`nav-link ${active ? "active" : ""}`} aria-current={exactActive ? "page" : undefined}>
                <span className="nav-emoji" aria-hidden="true">
                  <Icon size={17} strokeWidth={2.1} />
                </span>
                <span>{item.label}</span>
              </Link>
              {item.children?.length && active ? (
                <div className="nav-sub-list" aria-label={`${item.label}子导航`}>
                  {item.children.map((child) => {
                    const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                    const ChildIcon = child.icon;
                    return (
                      <Link
                        aria-current={childActive ? "page" : undefined}
                        className={`nav-sub-link ${childActive ? "active" : ""}`}
                        href={child.href}
                        key={child.href}
                      >
                        {ChildIcon ? (
                          <span className="nav-sub-icon" aria-hidden="true">
                            <ChildIcon size={13} strokeWidth={2.1} />
                          </span>
                        ) : null}
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <TaskCenter />
    </aside>
  );
}
