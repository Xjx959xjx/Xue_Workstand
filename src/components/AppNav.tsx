"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  Activity,
  Calculator,
  FileText,
  Flame,
  FolderKanban,
  MessageSquarePlus,
  PenLine,
  Sparkles,
  Wrench
} from "lucide-react";
import { TaskCenter } from "./TaskCenter";
import type { AppMode } from "@/lib/app-mode";
import { prefetchWorkspaceRouteData } from "@/lib/client";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
};

const navItems: NavItem[] = [
  { href: "/douyin-hotlist", label: "抖音热榜", icon: Flame },
  { href: "/library", label: "账号库", icon: FileText },
  { href: "/project-workbench", label: "项目工作台", icon: FolderKanban },
  { href: "/writer", label: "对话写作", icon: PenLine },
  { href: "/assets", label: "评论生成", icon: MessageSquarePlus },
  { href: "/tools", label: "工具台", icon: Wrench },
  { href: "/gross-margin", label: "数据维护", icon: Calculator },
  { href: "/gross-margin/monitor", label: "数据监控", icon: Activity }
];

const grossMarginNavItems = navItems.filter((item) => item.href.startsWith("/gross-margin"));
const ROUTE_BUSY_DELAY_MS = 200;
const ROUTE_DATA_PREFETCH_INTENT_MS = 180;

export function AppNav({ appMode }: { appMode: AppMode }) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetchedCodeRoutesRef = useRef(new Set<string>());
  const prefetchedDataRoutesRef = useRef(new Set<string>());
  const dataPrefetchTimersRef = useRef(new Map<string, number>());
  const pendingTimerRef = useRef<number | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [showRouteBusy, setShowRouteBusy] = useState(false);
  const grossMarginMode = appMode === "gross-margin";
  const visibleNavItems = useMemo(() => grossMarginMode ? grossMarginNavItems : navItems, [grossMarginMode]);
  const brandHref = grossMarginMode ? "/gross-margin" : "/douyin-hotlist";
  const activeHref = visibleNavItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;

  const clearDataPrefetchTimer = useCallback((href: string) => {
    const timer = dataPrefetchTimersRef.current.get(href);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    dataPrefetchTimersRef.current.delete(href);
  }, []);

  const clearDataPrefetchTimers = useCallback(() => {
    dataPrefetchTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    dataPrefetchTimersRef.current.clear();
  }, []);

  const prefetchRouteCode = useCallback((href: string) => {
    if (prefetchedCodeRoutesRef.current.has(href)) return;
    prefetchedCodeRoutesRef.current.add(href);
    router.prefetch(href);
  }, [router]);

  const prefetchRouteData = useCallback((href: string) => {
    if (prefetchedDataRoutesRef.current.has(href)) return;
    const routeDataWarmup = prefetchWorkspaceRouteData(href);
    if (!routeDataWarmup) return;

    prefetchedDataRoutesRef.current.add(href);
    if (routeDataWarmup) {
      void routeDataWarmup.catch((error) => {
        prefetchedDataRoutesRef.current.delete(href);
        console.warn(`预热模块数据失败：${href}`, error);
      });
    }
  }, []);

  const prefetchRoute = useCallback((href: string, options: { includeData?: boolean } = {}) => {
    prefetchRouteCode(href);
    if (options.includeData) prefetchRouteData(href);
  }, [prefetchRouteCode, prefetchRouteData]);

  const scheduleDataPrefetch = useCallback((href: string) => {
    if (prefetchedDataRoutesRef.current.has(href) || dataPrefetchTimersRef.current.has(href)) return;
    const timer = window.setTimeout(() => {
      dataPrefetchTimersRef.current.delete(href);
      prefetchRouteData(href);
    }, ROUTE_DATA_PREFETCH_INTENT_MS);
    dataPrefetchTimersRef.current.set(href, timer);
  }, [prefetchRouteData]);

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
    prefetchRoute(pathname);
  }, [clearPending, pathname, prefetchRoute]);

  useEffect(() => () => {
    clearDataPrefetchTimers();
  }, [clearDataPrefetchTimers]);

  const beginNavigation = useCallback((href: string) => {
    if (href === activeHref || href === pathname) return;
    clearDataPrefetchTimers();
    prefetchRoute(href, { includeData: true });
    setPendingHref(href);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      setShowRouteBusy(true);
    }, ROUTE_BUSY_DELAY_MS);
  }, [activeHref, clearDataPrefetchTimers, pathname, prefetchRoute]);

  const handleNavClick = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    beginNavigation(href);
  }, [beginNavigation]);

  return (
    <aside className="sidebar">
      {showRouteBusy ? <span className="route-progress" aria-hidden="true" /> : null}
      <div className="window-controls" aria-hidden="true">
        <span className="window-control close" />
        <span className="window-control minimize" />
        <span className="window-control zoom" />
      </div>
      <Link
        href={brandHref}
        className="brand"
        prefetch={false}
        onClick={(event) => handleNavClick(event, brandHref)}
        onFocus={() => prefetchRoute(brandHref, { includeData: true })}
        onPointerEnter={() => {
          prefetchRoute(brandHref);
          scheduleDataPrefetch(brandHref);
        }}
        onPointerLeave={() => clearDataPrefetchTimer(brandHref)}
      >
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
          const active = item.href === activeHref;
          const pending = item.href === pendingHref && !active;
          const Icon = item.icon;
          return (
            <div className="nav-group" key={item.href}>
              <Link
                href={item.href}
                className={`nav-link ${active ? "active" : ""} ${pending ? "pending" : ""}`}
                aria-current={active ? "page" : undefined}
                prefetch={false}
                onClick={(event) => handleNavClick(event, item.href)}
                onFocus={() => prefetchRoute(item.href, { includeData: true })}
                onPointerEnter={() => {
                  prefetchRoute(item.href);
                  scheduleDataPrefetch(item.href);
                }}
                onPointerLeave={() => clearDataPrefetchTimer(item.href)}
              >
                <span className="nav-emoji" aria-hidden="true">
                  <Icon size={17} strokeWidth={2.1} />
                </span>
                <span>{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>
      {grossMarginMode ? null : (
        <div className="sidebar-bottom">
          <TaskCenter />
        </div>
      )}
    </aside>
  );
}
