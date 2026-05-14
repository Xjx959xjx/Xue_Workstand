"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, FileText, Home, Layers3, MessageSquareMore, MessageSquareText, NotebookText, Sparkles } from "lucide-react";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/copy-tools", label: "文案工具", icon: NotebookText },
  { href: "/library", label: "账号库", icon: BookOpenText },
  { href: "/projects", label: "项目库", icon: Layers3 },
  {
    href: "/writer",
    label: "对话写作",
    icon: MessageSquareText,
    children: [
      { href: "/assets", label: "衍生素材", icon: MessageSquareMore },
      { href: "/drafts", label: "草稿", icon: FileText }
    ]
  }
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
          const childActive = item.children?.some((child) => pathname.startsWith(child.href));
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href) || Boolean(childActive);
          return (
            <div className="nav-branch" key={item.href}>
              <Link href={item.href} className={`nav-link ${active ? "active" : ""}`} aria-current={pathname.startsWith(item.href) ? "page" : undefined}>
                <Icon aria-hidden="true" size={19} />
                <span>{item.label}</span>
              </Link>
              {item.children ? (
                <div className="nav-children" aria-label={`${item.label}子导航`}>
                  {item.children.map((child) => {
                    const ChildIcon = child.icon;
                    const childIsActive = pathname.startsWith(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`nav-link nav-child-link ${childIsActive ? "active" : ""}`}
                        aria-current={childIsActive ? "page" : undefined}
                      >
                        <ChildIcon aria-hidden="true" size={16} />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
