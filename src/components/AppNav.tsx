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
  FileText,
  Flame,
  FolderKanban,
  MessageSquarePlus,
  PenLine,
  Radar,
  ChevronDown,
  Search,
  Wrench
} from "lucide-react";
import { TaskCenter } from "./TaskCenter";
import { SkinToggle } from "./SkinToggle";
import type { AppMode } from "@/lib/app-mode";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
  group: "内容发现" | "素材管理" | "内容创作" | "数据运营" | "工作区设置";
};

const navItems: NavItem[] = [
  { href: "/hotspots", label: "热点雷达", icon: Radar, group: "内容发现" },
  { href: "/douyin-hotlist", label: "视频热榜", icon: Flame, group: "内容发现" },
  { href: "/library", label: "账号库", icon: FileText, group: "素材管理" },
  { href: "/project-workbench", label: "项目工作台", icon: FolderKanban, group: "素材管理" },
  { href: "/writer", label: "对话写作", icon: PenLine, group: "内容创作" },
  { href: "/images", label: "生图工作台", icon: ImagePlus, group: "内容创作" },
  { href: "/assets", label: "评论生成", icon: MessageSquarePlus, group: "内容创作" },
  { href: "/ai-settings", label: "AI 模型配置", icon: Settings2, group: "工作区设置" },
  { href: "/tools", label: "工具台", icon: Wrench, group: "工作区设置" },
  { href: "/gross-margin", label: "数据维护", icon: Calculator, group: "数据运营" },
  { href: "/gross-margin/monitor", label: "数据监控", icon: Activity, group: "数据运营" }
];

const navGroupOrder: NavItem["group"][] = ["内容发现", "素材管理", "内容创作", "数据运营", "工作区设置"];

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
  const [navigationQuery, setNavigationQuery] = useState("");
  const [menuLeft, setMenuLeft] = useState(240);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const menuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  function cancelMenuTimer() { if (menuTimer.current) clearTimeout(menuTimer.current); }
  function closeMenu() { cancelMenuTimer(); setOpenGroup(null); }
  function showMenu(group: string, trigger?: HTMLButtonElement) {
    cancelMenuTimer();
    if (trigger) { menuTrigger.current = trigger; setMenuLeft(Math.max(16, Math.min(trigger.getBoundingClientRect().left, window.innerWidth - 376))); }
    setNavigationQuery("");
    setOpenGroup(group);
  }
  useEffect(() => {
    function outside(event: PointerEvent) { if (!headerRef.current?.contains(event.target as Node)) setOpenGroup(null); }
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); if (menuTimer.current) clearTimeout(menuTimer.current); };
  }, []);
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
    .map(label => ({ label, items: visibleNavItems.filter(item => item.group === label) }))
    .filter(group => group.items.length), [visibleNavItems]);
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
    setOpenGroup(null);
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

  const currentGroup = visibleNavItems.find(item => item.href === activeHref)?.group || visibleNavGroups[0]?.label;
  const contextItems = visibleNavItems.filter(item => (openGroup === "all" || item.group === openGroup)
    && item.label.toLowerCase().includes(navigationQuery.trim().toLowerCase()));

  return (
    <>
    <header className="studio-shell-header" ref={headerRef}
      onPointerEnter={cancelMenuTimer}
      onPointerLeave={event => { if (event.pointerType === "mouse") menuTimer.current = setTimeout(() => setOpenGroup(null), 180); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu(); }}
      onKeyDown={event => { if (event.key === "Escape") { closeMenu(); menuTrigger.current?.focus(); } }}>
      {showRouteBusy ? <span className="route-progress" aria-hidden="true" /> : null}
      <div className="studio-global-bar">
        <Link href={brandHref} className="studio-brand" onClick={event => handleNavClick(event, brandHref)}>
          <strong>studio</strong><span>{grossMarginMode ? "数据运营" : "内容工作室"}</span>
        </Link>
        <nav className="studio-workspaces" aria-label="工作区导航">
          {visibleNavGroups.map(group => <button key={group.label} type="button"
            className={currentGroup === group.label ? "active" : undefined}
            aria-expanded={openGroup === group.label} aria-controls="studio-module-menu"
            onPointerEnter={event => { if (event.pointerType === "mouse") showMenu(group.label, event.currentTarget); }}
            onClick={event => showMenu(group.label, event.currentTarget)}
            onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); showMenu(group.label, event.currentTarget); requestAnimationFrame(() => headerRef.current?.querySelector<HTMLAnchorElement>(".studio-module-menu a")?.focus()); } }}>
              {group.label}<ChevronDown size={13} />
            </button>)}
        </nav>
        <div className="studio-global-actions">
          <button className="btn compact" aria-expanded={openGroup === "all"} aria-controls="studio-module-menu" onClick={event => openGroup === "all" ? closeMenu() : showMenu("all", event.currentTarget)}>全部模块</button>
          <SkinToggle compact /><TaskCenter />
        </div>
      </div>
      {openGroup ? <div id="studio-module-menu" style={openGroup === "all" ? undefined : { left: menuLeft }} className={`studio-module-menu ${openGroup === "all" ? "all" : ""}`}>
        <div className="studio-menu-heading"><strong>{openGroup === "all" ? "全部模块" : openGroup}</strong>
          <label className="studio-search"><Search size={15} aria-hidden="true" /><span className="sr-only">查找功能</span>
            <input type="search" value={navigationQuery} onChange={event => setNavigationQuery(event.target.value)} placeholder="查找功能" />
          </label>
        </div>
        <nav className="studio-context-links" aria-label="功能导航">
          {contextItems.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href}
            aria-current={item.href === activeHref ? "page" : undefined} className={item.href === pendingHref ? "pending" : undefined}
            onClick={event => { handleNavClick(event, item.href); closeMenu(); }}
            onFocus={() => void prewarmRoute(item.href)} onPointerEnter={() => void prewarmRoute(item.href)}>
              <Icon size={18} /><span>{item.label}<small>{item.group}</small></span>
            </Link>; })}
          {!contextItems.length ? <p className="studio-search-empty" role="status">没有匹配的功能</p> : null}
        </nav>
      </div> : null}
    </header>
    <div className="studio-breadcrumb" aria-label="当前位置"><span>{currentGroup}</span><span aria-hidden="true">/</span><strong>{visibleNavItems.find(item => item.href === activeHref)?.label}</strong></div>
    </>
  );
}
