import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import {
  Bell,
  Bot,
  BriefcaseBusiness,
  ClipboardList,
  Cable,
  ChevronDown,
  CircleHelp,
  FileText,
  Grid2X2,
  Hash,
  Home,
  Inbox,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Plus,
  Search,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type TkoModuleKey = "overview" | "work" | "chat" | "crm" | "ai";
type TkoNavItem = { label: string; path: string; icon: ComponentType<{ className?: string }>; badge?: string };

export const tko_shellModules: Record<TkoModuleKey, { label: string; eyebrow: string; nav: TkoNavItem[] }> = {
  overview: {
    label: "Overview",
    eyebrow: "Operations",
    nav: [
      { label: "Overview", path: "/platform", icon: LayoutDashboard },
      { label: "Inbox", path: "/inbox", icon: Inbox },
      { label: "Docs", path: "/docs", icon: FileText },
      { label: "Forms", path: "/forms", icon: ClipboardList },
      { label: "Automations", path: "/automations", icon: Bot },
      { label: "Projects", path: "/work", icon: BriefcaseBusiness },
    ],
  },
  work: {
    label: "Work",
    eyebrow: "Work",
    nav: [
      { label: "My work", path: "/work#my-work", icon: Inbox },
      { label: "Projects", path: "/work", icon: BriefcaseBusiness },
      { label: "Sprints", path: "/work#sprints", icon: Grid2X2 },
      { label: "Calendar", path: "/calendar", icon: Home },
    ],
  },
  chat: {
    label: "Chat",
    eyebrow: "Collaborate",
    nav: [
      { label: "Threads", path: "/chat#threads", icon: MessageSquareText },
      { label: "Mentions", path: "/chat#mentions", icon: Hash },
      { label: "Saved", path: "/chat#saved", icon: FileText },
    ],
  },
  crm: {
    label: "CRM",
    eyebrow: "Revenue",
    nav: [
      { label: "Deals", path: "/crm", icon: BriefcaseBusiness },
      { label: "Leads", path: "/crm#leads", icon: UsersRound },
      { label: "Companies", path: "/crm#companies", icon: Home },
      { label: "Pipelines", path: "/crm#pipelines", icon: Grid2X2 },
    ],
  },
  ai: {
    label: "Tasko AI",
    eyebrow: "Intelligence",
    nav: [
      { label: "Assistant", path: "/ai", icon: Sparkles },
      { label: "Proposals", path: "/ai#proposals", icon: Bot },
    ],
  },
};

export function tko_moduleForPath(tko_path: string): TkoModuleKey {
  if (tko_path.startsWith("/chat")) return "chat";
  if (tko_path.startsWith("/crm")) return "crm";
  if (tko_path.startsWith("/ai")) return "ai";
  if (tko_path.startsWith("/work") || tko_path === "/") return "work";
  return "overview";
}

function TkoRailLink({ item, active }: { item: TkoNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.path}
      className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors ${active ? "bg-[#eef0ff] font-semibold text-[#4f46e5]" : "text-[#667085] hover:bg-[#f7f7ff] hover:text-[#344054]"}`}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
      {item.badge ? <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-[#f04438] px-1 text-[10px] font-bold leading-5 text-white">{item.badge}</span> : null}
    </Link>
  );
}

export default function TaskoShell({ children }: { children: ReactNode }) {
  const [tko_location] = useLocation();
  const { user } = useAuth();
  const tko_module = tko_moduleForPath(tko_location);
  const tko_context = tko_shellModules[tko_module];
  const tko_primaryItems: Array<{ label: string; path: string; icon: ComponentType<{ className?: string }>; badge?: string }> = [
    { label: "Home", path: "/platform", icon: Home },
    { label: "Inbox", path: "/inbox", icon: Inbox },
    { label: "Work", path: "/work", icon: BriefcaseBusiness },
    { label: "Chat", path: "/chat", icon: MessageSquareText },
    { label: "CRM", path: "/crm", icon: UsersRound },
    { label: "Docs", path: "/docs", icon: FileText },
    { label: "Automations", path: "/automations", icon: Bot },
    { label: "Imports", path: "/imports", icon: ClipboardList },
    { label: "Ecosystem", path: "/ecosystem", icon: Cable },
    { label: "Tasko AI", path: "/ai", icon: Sparkles },
  ];
  const tko_initial = user?.name?.trim().slice(0, 1).toUpperCase() || "T";

  return (
    <div className="min-h-screen bg-[#f8f8fc] text-[#182230]">
      <header className="sticky top-0 z-50 flex h-16 items-center gap-4 border-b border-[#eaecf0] bg-white px-4 shadow-[0_1px_2px_rgba(16,24,40,.02)] lg:px-5">
        <Link href="/platform" className="flex shrink-0 items-center gap-2.5 pr-2" aria-label="Tasko operations overview">
          <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-[#6257f6] via-[#5f7df4] to-[#e28dc7] text-sm font-black text-white shadow-sm">T</span>
          <span className="hidden text-[21px] font-bold tracking-[-0.055em] text-[#101828] sm:block">tasko</span>
        </Link>
        <Link href="/platform#search" className="hidden max-w-[525px] flex-1 items-center gap-3 rounded-lg border border-[#eaecf0] bg-[#fcfcfd] px-3.5 py-2 text-left text-[13px] text-[#98a2b3] shadow-sm md:flex">
          <Search className="h-4 w-4" />
          <span className="flex-1">Search Tasko or type / command</span>
          <kbd className="rounded border border-[#eaecf0] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#667085]">⌘ K</kbd>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="hidden items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 py-2 text-[13px] font-medium text-[#344054] shadow-sm lg:flex" onClick={() => toast("Workspace switcher sẽ hỗ trợ nhiều workspace trong M4.") }>
            <Grid2X2 className="h-4 w-4 text-[#667085]" />
            <span>Acme Operations</span>
            <ChevronDown className="h-3.5 w-3.5 text-[#98a2b3]" />
          </button>
          <button type="button" className="hidden h-9 items-center gap-1.5 rounded-lg bg-[#5b51e8] px-3.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#4d43da] active:scale-[.97] sm:flex" onClick={() => toast("Quick create sẽ tập hợp các flow Work, Chat và CRM trong M4.") }>
            <Plus className="h-4 w-4" /> Create
          </button>
          <Link href="/inbox" aria-label="Notifications" className="relative grid h-9 w-9 place-items-center rounded-lg text-[#667085] hover:bg-[#f4f3ff] hover:text-[#5b51e8]">
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full border-2 border-white bg-[#f04438]" />
          </Link>
          <button type="button" aria-label="Help" className="hidden grid h-9 w-9 place-items-center rounded-lg text-[#667085] hover:bg-[#f4f3ff] hover:text-[#5b51e8] sm:grid"><CircleHelp className="h-[18px] w-[18px]" /></button>
          <button type="button" className="hidden items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[#f9fafb] md:flex" onClick={() => toast("User profile controls are provided by Manus authentication.") }>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#e7e5ff] text-[11px] font-bold text-[#5146d9]">{tko_initial}</span>
            <span className="hidden text-left lg:block"><span className="block text-xs font-semibold text-[#344054]">{user?.name || "Tasko member"}</span><span className="block text-[10px] text-[#98a2b3]">Operations</span></span>
            <ChevronDown className="h-3.5 w-3.5 text-[#98a2b3]" />
          </button>
          <button type="button" aria-label="Open navigation" className="grid h-9 w-9 place-items-center rounded-lg text-[#667085] hover:bg-[#f4f3ff] sm:hidden"><Menu className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-64px)]">
        <nav aria-label="Primary navigation" className="sticky top-16 hidden h-[calc(100vh-64px)] w-[68px] shrink-0 border-r border-[#eaecf0] bg-white py-3 sm:flex sm:flex-col sm:items-center">
          <div className="flex flex-col gap-1.5">
            {tko_primaryItems.map(tko_item => {
              const Icon = tko_item.icon;
              const tko_active = tko_module === "overview" ? tko_item.path === "/platform" : tko_item.path === `/${tko_module}`;
              return <Link key={tko_item.label} href={tko_item.path} aria-label={tko_item.label} className={`relative grid h-10 w-10 place-items-center rounded-lg transition-colors ${tko_active ? "bg-[#f0efff] text-[#5b51e8]" : "text-[#667085] hover:bg-[#f7f7ff] hover:text-[#5b51e8]"}`}><Icon className="h-[18px] w-[18px]" />{tko_item.badge ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#f04438] px-1 text-[9px] font-bold text-white">{tko_item.badge}</span> : null}</Link>;
            })}
          </div>
          <div className="mt-auto flex flex-col gap-2"><Link href="/settings" aria-label="Settings" className={`grid h-10 w-10 place-items-center rounded-lg transition-colors ${tko_location === "/settings" ? "bg-[#f0efff] text-[#5b51e8]" : "text-[#667085] hover:bg-[#f7f7ff] hover:text-[#5b51e8]"}`}><Settings className="h-[18px] w-[18px]" /></Link><span className="grid h-8 w-8 place-items-center self-center rounded-full bg-[#e7e5ff] text-[10px] font-bold text-[#5146d9]">{tko_initial}</span></div>
        </nav>
        <aside className="sticky top-16 hidden h-[calc(100vh-64px)] w-[232px] shrink-0 border-r border-[#eaecf0] bg-white px-3 py-5 lg:block">
          <p className="px-2.5 text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">{tko_context.eyebrow}</p>
          <h2 className="px-2.5 pt-1 text-[17px] font-semibold tracking-[-.03em] text-[#182230]">{tko_context.label}</h2>
          <nav className="mt-4 space-y-1" aria-label={`${tko_context.label} navigation`}>
            {tko_context.nav.map(tko_item => <TkoRailLink key={`${tko_item.label}-${tko_item.path}`} item={tko_item} active={tko_item.path.split("#")[0] === tko_location && (!tko_item.path.includes("#") || tko_item.label === "Projects" || tko_item.label === "Deals" || tko_item.label === "Overview")} />)}
          </nav>
          <div className="mt-8 border-t border-[#f2f4f7] pt-5">
            <p className="px-2.5 text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Pinned</p>
            <button type="button" onClick={() => toast("Pinned lists will be configurable in M4.") } className="mt-2 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-[#667085] hover:bg-[#f7f7ff]"><Sparkles className="h-4 w-4 text-[#665cf0]" />Ops updates</button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
