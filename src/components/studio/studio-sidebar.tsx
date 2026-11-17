"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, History, ImagePlus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/create", label: "新建创作", icon: ImagePlus },
  { href: "/history", label: "历史记录", icon: History },
  { href: "/system", label: "系统状态", icon: Activity },
];

const STORAGE_KEY = "pixora.sidebar.collapsed";

export function StudioSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true");
      } catch {
        // 忽略存储不可用
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // 忽略存储不可用
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "flex flex-col border-b bg-white/80 px-4 py-4 backdrop-blur transition-[width] duration-200",
        "md:sticky md:top-0 md:h-[100dvh] md:shrink-0 md:border-r md:border-b-0 md:py-6",
        collapsed ? "md:w-16 md:px-2" : "md:w-60 md:px-4",
      )}
    >
      <Link
        href="/create"
        className={cn("mb-6 flex items-center gap-2", collapsed ? "justify-center px-0" : "px-2")}
        title="Pixora"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-black/5 bg-[#ece9e2] text-sm font-semibold text-neutral-800">
          P
        </span>
        {!collapsed ? (
          <span className="hidden text-base font-semibold tracking-tight md:block">Pixora</span>
        ) : null}
      </Link>

      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative isolate flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground",
                active &&
                  "font-medium text-neutral-900 hover:bg-transparent hover:text-neutral-900",
                collapsed && "md:justify-center md:px-0",
              )}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute left-1 top-1/2 h-[9px] w-[3px] -translate-y-1/2 rounded-full bg-neutral-500/55"
                />
              ) : null}
              <Icon className="relative size-4 shrink-0" />
              <span className={cn("relative", collapsed && "md:hidden")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        aria-expanded={!collapsed}
        title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        className={cn(
          "mt-3 hidden items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:mt-auto md:flex",
          collapsed && "justify-center px-0",
        )}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4 shrink-0" />
        ) : (
          <PanelLeftClose className="size-4 shrink-0" />
        )}
        {!collapsed ? <span>收起侧边栏</span> : null}
      </button>
    </aside>
  );
}
