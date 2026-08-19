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

export const tko_brandAssets = {
  logo: "/manus-storage/tasko-logo_50726dd1.png",
  favicon: "/manus-storage/tasko-favicon_2220cdac.png",
} as const;

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
      className={`group flex items-center gap-2 px-2 py-1.5 text-[13px] transition-colors ${active ? "border-l-2 border-[#0c66e4] bg-[#deebff] font-semibold text-[#0052cc]" : "border-l-2 border-transparent text-[#5e6c84] hover:bg-[#ebecf0] hover:text-[#172b4d]"}`}
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
    <div className="min-h-screen bg-[#f7f8f9] text-[#172b4d]">
      <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b border-[#dfe1e6] bg-white px-3 lg:px-4">
        <Link href="/platform" className="flex shrink-0 items-center gap-2 pr-2" aria-label="Tasko operations overview">
          <img
            src={tko_brandAssets.favicon}
            alt=""
            aria-hidden="true"
            className="h-7 w-7 object-contain sm:hidden"
          />
          <img
            src={tko_brandAssets.logo}
            alt="Tasko"
            className="hidden h-7 w-auto object-contain sm:block"
          />
        </Link>
        <Link href="/platform#search" className="hidden max-w-[525px] flex-1 items-center gap-3 border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-1.5 text-left text-[13px] text-[#5e6c84] md:flex">
          <Search className="h-4 w-4" />
          <span className="flex-1">Search Tasko or type / command</span>
          <kbd className="border border-[#dfe1e6] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#5e6c84]">⌘ K</kbd>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="hidden items-center gap-2 border border-[#dfe1e6] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[#172b4d] lg:flex" onClick={() => toast("Workspace switcher sẽ hỗ trợ nhiều workspace trong M4.") }>
            <Grid2X2 className="h-4 w-4 text-[#5e6c84]" />
            <span>Acme Operations</span>
            <ChevronDown className="h-3.5 w-3.5 text-[#98a2b3]" />
          </button>
          <button type="button" className="hidden h-8 items-center gap-1.5 bg-[#0c66e4] px-3 text-[13px] font-semibold text-white transition hover:bg-[#0055cc] active:scale-[.97] sm:flex" onClick={() => toast("Quick create sẽ tập hợp các flow Work, Chat và CRM trong M4.") }>
            <Plus className="h-4 w-4" /> Create
          </button>
          <Link href="/inbox" aria-label="Notifications" className="relative grid h-8 w-8 place-items-center text-[#5e6c84] hover:bg-[#deebff] hover:text-[#0052cc]">
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full border-2 border-white bg-[#f04438]" />
          </Link>
          <button type="button" aria-label="Help" className="hidden grid h-8 w-8 place-items-center text-[#5e6c84] hover:bg-[#deebff] hover:text-[#0052cc] sm:grid"><CircleHelp className="h-[18px] w-[18px]" /></button>
          <button type="button" className="hidden items-center gap-2 px-1 py-1 hover:bg-[#f4f5f7] md:flex" onClick={() => toast("User profile controls are provided by Manus authentication.") }>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#deebff] text-[11px] font-bold text-[#0052cc]">{tko_initial}</span>
            <span className="hidden text-left lg:block"><span className="block text-xs font-semibold text-[#172b4d]">{user?.name || "Tasko member"}</span><span className="block text-[10px] text-[#5e6c84]">Operations</span></span>
            <ChevronDown className="h-3.5 w-3.5 text-[#5e6c84]" />
          </button>
          <button type="button" aria-label="Open navigation" className="grid h-8 w-8 place-items-center text-[#5e6c84] hover:bg-[#deebff] sm:hidden"><Menu className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-56px)]">
        <nav aria-label="Primary navigation" className="sticky top-14 hidden h-[calc(100vh-56px)] w-[56px] shrink-0 border-r border-[#dfe1e6] bg-[#f4f5f7] py-2 sm:flex sm:flex-col sm:items-center">
          <div className="flex flex-col gap-1">
            {tko_primaryItems.map(tko_item => {
              const Icon = tko_item.icon;
              const tko_active = tko_module === "overview" ? tko_item.path === "/platform" : tko_item.path === `/${tko_module}`;
              return <Link key={tko_item.label} href={tko_item.path} aria-label={tko_item.label} className={`relative grid h-9 w-9 place-items-center transition-colors ${tko_active ? "bg-[#deebff] text-[#0052cc]" : "text-[#5e6c84] hover:bg-[#ebecf0] hover:text-[#172b4d]"}`}><Icon className="h-[17px] w-[17px]" />{tko_item.badge ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#f04438] px-1 text-[9px] font-bold text-white">{tko_item.badge}</span> : null}</Link>;
            })}
          </div>
          <div className="mt-auto flex flex-col gap-2"><Link href="/settings" aria-label="Settings" className={`grid h-9 w-9 place-items-center transition-colors ${tko_location === "/settings" ? "bg-[#deebff] text-[#0052cc]" : "text-[#5e6c84] hover:bg-[#ebecf0] hover:text-[#172b4d]"}`}><Settings className="h-[17px] w-[17px]" /></Link><span className="grid h-7 w-7 place-items-center self-center rounded-full bg-[#deebff] text-[10px] font-bold text-[#0052cc]">{tko_initial}</span></div>
        </nav>
        <aside className="sticky top-14 hidden h-[calc(100vh-56px)] w-[220px] shrink-0 border-r border-[#dfe1e6] bg-[#f4f5f7] px-2 py-4 lg:block">
          <p className="px-2 text-[10px] font-bold uppercase tracking-[.11em] text-[#5e6c84]">{tko_context.eyebrow}</p>
          <h2 className="px-2 pt-1 text-[16px] font-semibold tracking-[-.02em] text-[#172b4d]">{tko_context.label}</h2>
          <nav className="mt-3 space-y-0.5" aria-label={`${tko_context.label} navigation`}>
            {tko_context.nav.map(tko_item => <TkoRailLink key={`${tko_item.label}-${tko_item.path}`} item={tko_item} active={tko_item.path.split("#")[0] === tko_location && (!tko_item.path.includes("#") || tko_item.label === "Projects" || tko_item.label === "Deals" || tko_item.label === "Overview")} />)}
          </nav>
          <div className="mt-6 border-t border-[#dfe1e6] pt-4">
            <p className="px-2 text-[10px] font-bold uppercase tracking-[.11em] text-[#5e6c84]">Pinned</p>
            <button type="button" onClick={() => toast("Pinned lists will be configurable in M4.") } className="mt-2 flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] text-[#5e6c84] hover:bg-[#ebecf0]"><Sparkles className="h-4 w-4 text-[#0052cc]" />Ops updates</button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
