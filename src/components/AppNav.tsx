"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TaskCenter } from "./TaskCenter";

const navItems = [
  { href: "/library", label: "账号库", icon: "📚" },
  { href: "/project-workbench", label: "项目工作台", icon: "🗂️" },
  { href: "/writer", label: "对话写作", icon: "✍️" },
  { href: "/assets", label: "评论生成", icon: "💬" },
  { href: "/gross-margin", label: "数据维护", icon: "🧮" }
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/library" className="brand">
        <span className="brand-mark" aria-hidden="true">
          📖
        </span>
        <span>
          <strong>账号风格库</strong>
          <small>本地工作台</small>
        </span>
      </Link>
      <TaskCenter />
      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link href={item.href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} key={item.href}>
              <span className="nav-emoji" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
