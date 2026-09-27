import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, CornerDownLeft, Hash, MessageSquare, Search, Sparkles, UserPlus } from "lucide-react";
import { useLocation } from "wouter";
import type { WorkspaceSearchDocument } from "../../../packages/contracts/src/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

/** Command palette (spec 16 §8): Ctrl/Cmd + K opens a keyboard-first surface for navigate,
 * search, create and quick work-item actions. Fully self-contained — the header mounts
 * `<TkoCommandPalette open={...} onOpenChange={...} />` and can trigger it from anywhere with
 * `tko_openCommandPalette()` without prop drilling. UI language mirrors pages/Workspace.tsx. */

const tko_paletteEventName = "tasko:command-palette:open";
const tko_paletteBus = new EventTarget();

export function tko_openCommandPalette(): void {
  tko_paletteBus.dispatchEvent(new Event(tko_paletteEventName));
}

/** Optional subscription for hosts that want side effects on open; returns an unsubscribe fn. */
export function tko_onOpenCommandPalette(tko_listener: () => void): () => void {
  tko_paletteBus.addEventListener(tko_paletteEventName, tko_listener);
  return () => tko_paletteBus.removeEventListener(tko_paletteEventName, tko_listener);
}

type TkoPaletteEntry = { id: string; section: "Search" | "Navigate" | "Create"; label: string; detail?: string; href?: string; run?: () => void };

const tko_navigateTargets: Array<{ label: string; href: string }> = [
  { label: "Home", href: "/" }, { label: "Work", href: "/work" }, { label: "Chat", href: "/chat" },
  { label: "CRM", href: "/crm" }, { label: "Docs", href: "/docs" }, { label: "Forms", href: "/forms" },
  { label: "Automations", href: "/automations" }, { label: "Calendar", href: "/calendar" }, { label: "Inbox", href: "/inbox" },
  { label: "Settings", href: "/settings" }, { label: "AI", href: "/ai" }, { label: "Imports", href: "/imports" }, { label: "Ecosystem", href: "/ecosystem" },
];
const tko_createTargets: Array<{ label: string; href: string; detail: string }> = [
  { label: "Work item", href: "/work", detail: "Open the Work module" },
  { label: "Channel", href: "/chat", detail: "Open the Chat module" },
  { label: "Lead", href: "/crm", detail: "Open the CRM module" },
  { label: "Company", href: "/crm", detail: "Open the CRM module" },
  { label: "Contact", href: "/crm", detail: "Open the CRM module" },
  { label: "Deal", href: "/crm", detail: "Open the CRM module" },
  { label: "Document", href: "/docs", detail: "Open the Docs library" },
];
const tko_kindLabel: Record<WorkspaceSearchDocument["kind"], string> = { work: "Work", chat: "Chat", crm: "CRM", doc: "Docs" };

function TkoQuickWorkActions({ tko_workItemId, tko_onDone }: { tko_workItemId: string; tko_onDone: () => void }) {
  const tko_utils = trpc.useUtils();
  const tko_item = trpc.work.item.useQuery({ workItemId: tko_workItemId });
  const tko_assignees = trpc.work.assignees.useQuery();
  const tko_projectId = tko_item.data?.item.projectId ?? "";
  const tko_board = trpc.work.board.useQuery({ projectId: tko_projectId }, { enabled: Boolean(tko_projectId) });
  const tko_transition = trpc.work.transitionItem.useMutation({ onSuccess: () => { tko_utils.work.board.invalidate(); tko_utils.workspace.search.invalidate(); tko_onDone(); } });
  const tko_assign = trpc.work.updateItem.useMutation({ onSuccess: () => { tko_utils.work.board.invalidate(); tko_onDone(); } });
  if (!tko_item.data) return <p className="px-3 py-2 text-xs text-[#667085]">Loading selected item…</p>;
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-1.5">{(tko_board.data?.statuses ?? []).filter(tko_status => tko_status.id !== tko_item.data?.item.statusId).map(tko_status => <Button key={tko_status.id} size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={tko_transition.isPending} onClick={() => tko_transition.mutate({ workItemId: tko_workItemId, targetStatusId: tko_status.id, expectedVersion: tko_item.data!.item.version })}>Move to {tko_status.name}</Button>)}</div>
    <div className="flex flex-wrap gap-1.5">{(tko_assignees.data ?? []).slice(0, 8).map(tko_member => <Button key={tko_member.id} size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-[#475467]" disabled={tko_assign.isPending || tko_item.data!.item.assigneeMemberIds.includes(tko_member.id)} onClick={() => tko_assign.mutate({ workItemId: tko_workItemId, expectedVersion: tko_item.data!.item.version, assigneeMemberIds: tko_item.data!.item.assigneeMemberIds.concat(tko_member.id) })}><UserPlus className="mr-1 h-3 w-3" />Assign {tko_member.displayName}</Button>)}</div>
  </div>;
}

export function TkoCommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (tko_open: boolean) => void }) {
  const [, tko_setLocation] = useLocation();
  const [tko_query, setTko_query] = useState("");
  const [tko_selectedItem, setTko_selectedItem] = useState<{ id: string; key: string; title: string } | null>(null);
  const [tko_cursor, setTko_cursor] = useState(0);
  const tko_inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tko_off = tko_onOpenCommandPalette(() => onOpenChange(true));
    return tko_off;
  }, [onOpenChange]);

  useEffect(() => {
    if (open) { setTko_query(""); setTko_selectedItem(null); setTko_cursor(0); requestAnimationFrame(() => tko_inputRef.current?.focus()); }
  }, [open]);

  const tko_results = trpc.workspace.search.useQuery({ query: tko_query.trim() }, { enabled: open && tko_query.trim().length >= 2 });

  const tko_entries = useMemo<TkoPaletteEntry[]>(() => {
    const tko_entries: TkoPaletteEntry[] = [];
    for (const tko_target of tko_navigateTargets) tko_entries.push({ id: `nav:${tko_target.href}:${tko_target.label}`, section: "Navigate", label: tko_target.label, href: tko_target.href });
    for (const tko_target of tko_createTargets) tko_entries.push({ id: `create:${tko_target.label}`, section: "Create", label: `Create ${tko_target.label.toLowerCase()}`, detail: tko_target.detail, href: tko_target.href });
    if (tko_query.trim().length >= 2) {
      for (const tko_result of tko_results.data ?? []) tko_entries.push({
        id: `search:${tko_result.entityType}:${tko_result.entityId}`,
        section: "Search",
        label: tko_result.title,
        detail: `${tko_kindLabel[tko_result.kind]} · ${tko_result.bodyText || tko_result.href}`,
        href: tko_result.href,
        run: tko_result.entityType === "work_item" ? () => setTko_selectedItem({ id: tko_result.entityId, key: tko_result.title.split(" · ")[0] ?? tko_result.title, title: tko_result.title }) : undefined,
      });
    }
    return tko_entries;
  }, [tko_results.data, tko_query]);

  const tko_go = (tko_entry: TkoPaletteEntry | undefined) => {
    if (!tko_entry) return;
    onOpenChange(false);
    if (tko_entry.run) { tko_entry.run(); return; }
    if (tko_entry.href) void tko_setLocation(tko_entry.href);
  };

  if (!open) return null;
  const tko_sectionOrder: Array<TkoPaletteEntry["section"]> = tko_selectedItem ? ["Search"] : ["Search", "Navigate", "Create"];
  const tko_grouped = tko_sectionOrder.map(tko_section => ({ tko_section, tko_items: tko_entries.filter(tko_entry => tko_entry.section === tko_section) })).filter(tko_group => tko_group.tko_items.length);
  let tko_flatIndex = -1;

  return <div className="fixed inset-0 z-[80] flex items-start justify-center bg-[#10182866] px-4 pt-[12vh] backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Command palette" onClick={() => onOpenChange(false)}>
    <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-[0_20px_50px_rgba(16,24,40,.25)]" onClick={tko_event => tko_event.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-[#eaecf0] px-4 py-3">
        <Search className="h-4 w-4 text-[#667085]" />
        <Input ref={tko_inputRef} value={tko_query} onChange={tko_event => { setTko_query(tko_event.target.value); setTko_cursor(0); }} onKeyDown={tko_event => {
          if (tko_event.key === "Escape") { onOpenChange(false); return; }
          if (tko_event.key === "ArrowDown") { tko_event.preventDefault(); setTko_cursor(tko_current => Math.min(tko_current + 1, Math.max(0, tko_entries.length - 1))); return; }
          if (tko_event.key === "ArrowUp") { tko_event.preventDefault(); setTko_cursor(tko_current => Math.max(0, tko_current - 1)); return; }
          if (tko_event.key === "Enter") { tko_event.preventDefault(); tko_go(tko_entries[tko_cursor]); }
        }} placeholder="Search work, conversations, CRM and docs, or jump anywhere…" className="border-0 px-0 text-sm shadow-none focus-visible:ring-0" />
        <kbd className="rounded border border-[#eaecf0] bg-[#fcfcfd] px-1.5 py-0.5 text-[10px] font-semibold text-[#98a2b3]">Esc</kbd>
      </div>
      <div className="max-h-[52vh] overflow-y-auto p-2">
        {tko_selectedItem ? <div className="rounded-lg border border-[#e4e7ec] bg-[#fcfcff] p-3">
          <div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold text-[#344054]">{tko_selectedItem.key} · {tko_selectedItem.title}</p><Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => void tko_setLocation(`/work?item=${tko_selectedItem.id}`)}>Open item<ArrowUpRight className="ml-1 h-3 w-3" /></Button></div>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[#7c73e6]">Quick actions</p>
          <div className="mt-2"><TkoQuickWorkActions tko_workItemId={tko_selectedItem.id} tko_onDone={() => setTko_selectedItem(null)} /></div>
        </div> : null}
        {tko_grouped.length ? tko_grouped.map(tko_group => <div key={tko_group.tko_section} className="mt-1 first:mt-0">
          <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#98a2b3]">{tko_group.tko_section}</p>
          {tko_group.tko_items.map(tko_entry => { tko_flatIndex += 1; const tko_active = tko_flatIndex === tko_cursor; return <button key={tko_entry.id} type="button" onMouseEnter={() => setTko_cursor(tko_entries.indexOf(tko_entry))} onClick={() => tko_go(tko_entry)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${tko_active ? "bg-[#f0efff]" : "hover:bg-[#f8f8ff]"}`}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#f2f4f7] text-[#5b51e8]">{tko_entry.section === "Search" ? <Sparkles className="h-3.5 w-3.5" /> : tko_entry.section === "Create" ? <CornerDownLeft className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#344054]">{tko_entry.label}</span>{tko_entry.detail ? <span className="block truncate text-[11px] text-[#667085]">{tko_entry.detail}</span> : null}</span>
            {tko_active ? <ArrowUpRight className="h-4 w-4 shrink-0 text-[#98a2b3]" /> : null}
          </button>; })}
        </div>) : <p className="px-3 py-6 text-center text-xs text-[#667085]">{tko_query.trim().length >= 2 ? "No authorized results yet." : "Type to search, or pick a destination below."}</p>}
      </div>
      <div className="flex items-center justify-between border-t border-[#eaecf0] bg-[#fcfcfd] px-4 py-2 text-[10px] font-medium text-[#98a2b3]">
        <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />Select a Work result for status + assign actions</span>
        <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Permission-filtered server-side</span>
      </div>
    </div>
  </div>;
}
