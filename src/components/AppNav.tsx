"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  ImagePlus,
  Settings2,
  Activity,
  Calculator,
  LibraryBig,
  Flame,
  Layers2,
  MessageSquarePlus,
  PenLine,
  Radar,
  Sword,
  Wrench
} from "lucide-react";
import { TaskCenter } from "./TaskCenter";
import { SkinToggle } from "./SkinToggle";
import type { AppMode } from "@/lib/app-mode";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
  group: "内容发现" | "创作工作区" | "数据与工具";
};

const navItems: NavItem[] = [
  { href: "/images", label: "生图工作台", icon: ImagePlus, group: "数据与工具" },
  { href: "/hotspots", label: "热点雷达", icon: Radar, group: "内容发现" },
  { href: "/douyin-hotlist", label: "视频热榜", icon: Flame, group: "内容发现" },
  { href: "/library", label: "账号库", icon: LibraryBig, group: "创作工作区" },
  { href: "/writer", label: "对话写作", icon: PenLine, group: "创作工作区" },
  { href: "/assets", label: "评论生成", icon: MessageSquarePlus, group: "创作工作区" },
  { href: "/tools", label: "工具台", icon: Wrench, group: "数据与工具" },
  { href: "/gross-margin", label: "数据维护", icon: Calculator, group: "数据与工具" },
  { href: "/gross-margin/monitor", label: "数据监控", icon: Activity, group: "数据与工具" },
  { href: "/ai-settings", label: "AI 模型配置", icon: Settings2, group: "数据与工具" }
];

const navGroupOrder: NavItem["group"][] = ["内容发现", "创作工作区", "数据与工具"];
const navGroupCodes: Record<NavItem["group"], string> = {
  "内容发现": "壱 · RECON",
  "创作工作区": "弐 · CREATION",
  "数据与工具": "参 · ARSENAL"
};

const grossMarginNavItems = navItems.filter((item) => item.href.startsWith("/gross-margin"));
const devRouteApiWarmups: Record<string, string[]> = {
  "/hotspots": ["/api/hotspots"],
  "/douyin-hotlist": ["/api/douyin-hotlist"],
  "/library": ["/api/library/overview", "/api/accounts"],
  "/project-workbench": ["/api/copy-sources", "/api/projects"],
  "/writer": ["/api/drafts", "/api/accounts", "/api/projects"],
  "/assets": ["/api/engagement"],
  "/gross-margin": ["/api/gross-margin"],
  "/gross-margin/monitor": ["/api/gross-margin"]
};
const devSharedApiWarmups = ["/api/jobs/__workbench_warmup__"];
const ROUTE_BUSY_DELAY_MS = 200;
const DEV_ROUTE_PREWARM_DELAY_MS = 2500;
const DEV_ROUTE_PREWARM_STEP_MS = 250;

export function AppNav({ appMode }: { appMode: AppMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pendingTimerRef = useRef<number | null>(null);
  const prewarmedRoutesRef = useRef<Set<string>>(new Set());
  const prewarmedDevTargetsRef = useRef<Set<string>>(new Set());
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [showRouteBusy, setShowRouteBusy] = useState(false);
  const grossMarginMode = appMode === "gross-margin";
  const visibleNavItems = useMemo(() => grossMarginMode ? grossMarginNavItems : navItems, [grossMarginMode]);
  const visibleNavGroups = useMemo(() => navGroupOrder
    .map((label) => ({ label, items: visibleNavItems.filter((item) => item.group === label && item.href !== "/ai-settings") }))
    .filter((group) => group.items.length), [visibleNavItems]);
  const brandHref = grossMarginMode ? "/gross-margin" : "/douyin-hotlist";
  const activeHref = visibleNavItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setPendingHref(null);
    setShowRouteBusy(false);
  }, []);

  useEffect(() => {
    clearPending();
  }, [clearPending, pathname]);

  const prewarmRoute = useCallback(async (href: string) => {
    if (href === pathname || prewarmedRoutesRef.current.has(href)) return;
    prewarmedRoutesRef.current.add(href);
    if (process.env.NODE_ENV !== "development") {
      router.prefetch(href);
      return;
    }

    try {
      const targets = [href, ...devSharedApiWarmups, ...(devRouteApiWarmups[href] || [])];
      for (const target of targets) {
        if (prewarmedDevTargetsRef.current.has(target)) continue;
        prewarmedDevTargetsRef.current.add(target);
        try {
          await fetch(target, {
            cache: "no-store",
            headers: { "x-workbench-route-warmup": "1" },
            method: target.startsWith("/api/") ? "OPTIONS" : "GET"
          });
        } catch (error) {
          prewarmedDevTargetsRef.current.delete(target);
          throw error;
        }
      }
    } catch {
      prewarmedRoutesRef.current.delete(href);
    }
  }, [pathname, router]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const activeIndex = visibleNavItems.findIndex((item) => item.href === activeHref);
    const prioritizedItems = activeIndex < 0
      ? visibleNavItems
      : [...visibleNavItems.slice(activeIndex + 1), ...visibleNavItems.slice(0, activeIndex)];
    const pendingRoutes = prioritizedItems
      .map((item) => item.href)
      .filter((href) => href !== pathname && !prewarmedRoutesRef.current.has(href));
    if (!pendingRoutes.length) return;

    let cancelled = false;
    const startTimerId = window.setTimeout(async () => {
      for (const href of pendingRoutes) {
        if (cancelled) return;
        await prewarmRoute(href);
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, DEV_ROUTE_PREWARM_STEP_MS);
        });
      }
    }, DEV_ROUTE_PREWARM_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimerId);
    };
  }, [activeHref, pathname, prewarmRoute, visibleNavItems]);

  const beginNavigation = useCallback((href: string) => {
    if (href === activeHref || href === pathname) return;
    setPendingHref(href);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      setShowRouteBusy(true);
    }, ROUTE_BUSY_DELAY_MS);
  }, [activeHref, pathname]);

  const handleNavClick = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    beginNavigation(href);
  }, [beginNavigation]);

  return (
    <aside className="sidebar">
      {showRouteBusy ? <span className="route-progress" aria-hidden="true" /> : null}
      <Link
        href={brandHref}
        className="brand"
        onFocus={() => void prewarmRoute(brandHref)}
        onClick={(event) => handleNavClick(event, brandHref)}
        onPointerEnter={() => void prewarmRoute(brandHref)}
      >
        <span className="brand-mark" aria-hidden="true">
          <Layers2 className="brand-mark-default" size={23} strokeWidth={1.8} />
          <Sword className="brand-mark-shinigami" size={20} strokeWidth={1.9} />
        </span>
        <span className="brand-copy brand-copy-default">
          <strong>{grossMarginMode ? "数据维护监控" : "风格库"}</strong>
          <small>{grossMarginMode ? "Windows 便携版" : "创作工作台"}</small>
        </span>
        <span className="brand-copy brand-copy-shinigami">
          <strong>BLEACH</strong>
          <small>死神 · SOUL SOCIETY</small>
        </span>
      </Link>
      <nav className="nav-list" aria-label="主导航">
        {visibleNavGroups.map((group) => {
          return (
            <section className="nav-section" key={group.label} aria-labelledby={`nav-${group.label}`}>
              <h2 className="nav-section-label" id={`nav-${group.label}`}>
                <span>{group.label}</span>
                <small className="nav-section-code" aria-hidden="true">{navGroupCodes[group.label]}</small>
              </h2>
              <div className="nav-section-items">
                {group.items.map((item) => {
                  const active = item.href === activeHref;
                  const pending = item.href === pendingHref && !active;
                  const Icon = item.icon;
                  return (
                    <div className="nav-group" key={item.href}>
                      <Link
                        href={item.href}
                        className={`nav-link ${active ? "active" : ""} ${pending ? "pending" : ""}`}
                        aria-current={active ? "page" : undefined}
                        onFocus={() => void prewarmRoute(item.href)}
                        onClick={(event) => handleNavClick(event, item.href)}
                        onPointerEnter={() => void prewarmRoute(item.href)}
                      >
                        <span className="nav-emoji" aria-hidden="true">
                          <Icon size={18} strokeWidth={1.75} />
                        </span>
                        <span>{item.label}</span>
                        <span className="nav-soul-mark" aria-hidden="true">魂</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <SkinToggle />
        <TaskCenter />
        {!grossMarginMode ? <Link href="/ai-settings" className={`nav-link sidebar-settings ${activeHref === "/ai-settings" ? "active" : ""}`} aria-current={activeHref === "/ai-settings" ? "page" : undefined}
          onClick={(event) => handleNavClick(event, "/ai-settings")} onFocus={() => void prewarmRoute("/ai-settings")} onPointerEnter={() => void prewarmRoute("/ai-settings")}>
          <Settings2 size={18} strokeWidth={1.75} aria-hidden="true" /><span>AI 模型配置</span>
        </Link> : null}
      </div>
    </aside>
  );
}
