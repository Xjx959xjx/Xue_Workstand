"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, FileText, Home, Layers3, MessageSquareMore, MessageSquareText, Sparkles } from "lucide-react";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/library", label: "账号库", icon: BookOpenText },
  { href: "/projects", label: "项目库", icon: Layers3 },
  { href: "/writer", label: "对话写作", icon: MessageSquareText },
  { href: "/assets", label: "衍生素材", icon: MessageSquareMore },
  { href: "/drafts", label: "草稿", icon: FileText }
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Sparkles aria-hidden="true" size={20} />
        </span>
        <span>
          <strong>账号风格库</strong>
          <small>本地工作台</small>
        </span>
      </Link>
      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
