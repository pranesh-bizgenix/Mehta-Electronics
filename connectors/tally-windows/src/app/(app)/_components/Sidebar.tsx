"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Cable,
  CircleDollarSign,
  Database,
  ShieldCheck,
  Gauge,
  TrendingUp,
  Landmark,
  BadgeIndianRupee,
  ListChecks,
  Boxes,
  MessageSquareText,
  MessageSquareMore,
  Send,
  Settings,
  FlaskConical,
  BookCheck,
} from "lucide-react";
import { useState } from "react";

const GROUPS = [
  {
    label: "Operate",
    items: [
      { href: "/dashboard", label: "Today", icon: Gauge },
      { href: "/review", label: "Performance", icon: Activity },
      { href: "/growth", label: "Growth Command", icon: TrendingUp },
      { href: "/cash", label: "Cash Command", icon: Landmark },
      { href: "/costs", label: "Cost Command", icon: CircleDollarSign },
      { href: "/funding", label: "Funding Command", icon: BadgeIndianRupee },
      { href: "/planning", label: "Plan & Procurement", icon: ListChecks },
      { href: "/inventory", label: "Inventory Command", icon: Boxes },
      { href: "/connections", label: "Data Spine", icon: Cable },
      { href: "/evidence", label: "Evidence Room", icon: ShieldCheck },
      { href: "/data", label: "Ledger Explorer", icon: Database },
    ],
  },
  {
    label: "Act",
    items: [
      { href: "/ask", label: "Advisor", icon: MessageSquareText },
      { href: "/scenarios", label: "Scenario Lab", icon: FlaskConical },
      { href: "/automations", label: "Action Center", icon: Bot },
      { href: "/outcomes", label: "Outcome Ledger", icon: BookCheck },
      { href: "/reports", label: "Board Packs", icon: Send },
      { href: "/feedback", label: "Feedback", icon: MessageSquareMore },
      { href: "/settings", label: "Control Center", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(false);

  const toggleSidebar = () => {
    if (collapsed) {
      setCollapsed(false);
      window.setTimeout(() => setLabelsVisible(true), 120);
      return;
    }
    setLabelsVisible(false);
    window.setTimeout(() => setCollapsed(true), 120);
  };

  return (
    <aside className={`grain sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-sidebar-line bg-sidebar transition-[width] duration-200 md:flex ${collapsed ? "w-[72px] px-3 py-4" : "w-[228px] p-4"}`}>
      <div className={`relative mb-7 flex items-center ${collapsed ? "justify-center" : "gap-3 px-1"} pt-1`}>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex min-w-0 items-center text-left transition focus:outline-none ${collapsed ? "justify-center" : "gap-3"}`}
        >
        <span className={`${collapsed ? "h-10 w-10" : "h-11 w-11"} grid shrink-0 place-items-center rounded-xl border border-jade-bright/25 bg-jade/15 font-mono text-[13px] font-bold tracking-[-0.08em] text-jade-bright shadow-[inset_0_1px_0_rgba(255,255,255,.08)]`}>
          GI
        </span>
        {labelsVisible && <div className="leading-tight">
          <div className="max-w-[120px] text-[17px] font-semibold leading-[1.08] tracking-[-0.03em] text-sidebar-fg">Growth Intelligence</div>
          <div className="mt-2 text-[9px] font-semibold uppercase tracking-[0.24em] text-jade-bright">Executive OS</div>
        </div>}
        </button>
      </div>

      <nav className={`scrollbar-none relative flex min-h-0 flex-1 flex-col overflow-y-auto ${collapsed ? "items-center gap-4 pt-1" : "-mr-2 gap-6 pr-2"}`}>
        {GROUPS.map((group) => (
          <div key={group.label}>
            {labelsVisible && <div className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-sidebar-muted/70">{group.label}</div>}
            <div className={collapsed ? "space-y-2.5" : "space-y-1"}>
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? label : undefined}
                    aria-label={label}
                    className={collapsed
                      ? `grid h-9 w-9 place-items-center rounded-xl border transition-colors ${active ? "border-jade-bright/25 bg-jade/20 text-jade-bright shadow-[inset_3px_0_0_#B7E4A0]" : "border-transparent text-sidebar-muted hover:border-sidebar-line hover:bg-sidebar-2 hover:text-sidebar-fg"}`
                      : `nav-item ${active ? "nav-item-active" : ""}`}
                  >
                    <Icon size={16} className={active ? "text-jade-bright" : ""} />
                    {labelsVisible && label}
                    {labelsVisible && active && <ArrowUpRight size={13} className="ml-auto text-jade-bright" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {labelsVisible && <div className="relative overflow-hidden rounded-xl border border-sidebar-line bg-sidebar-2/90 p-3.5">
        <div className="absolute -right-7 -top-8 h-20 w-20 rounded-full bg-jade/20 blur-2xl" />
        <div className="relative flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">Data Spine</div>
          <span className="flex items-center gap-1 text-[10px] font-semibold text-good"><span className="h-1.5 w-1.5 rounded-full bg-good shadow-[0_0_8px_#0E9F8F]" /> Secure</span>
        </div>
        <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-sidebar-line">
          <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-jade to-jade-bright" />
        </div>
        <p className="relative mt-2 text-[10px] leading-relaxed text-sidebar-muted">Accounting data stays isolated by company workspace.</p>
      </div>}
    </aside>
  );
}