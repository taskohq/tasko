import { useState } from "react";
import { BookmarkPlus, Check, Trash2, X } from "lucide-react";
import type { TkoSavedViewRenderer } from "@/lib/work-saved-view-state";

export type TkoSavedViewRow = {
  id: string;
  name: string;
  renderer: string;
  visibility: "private" | "workspace";
  filter: Record<string, unknown>;
  layout: Record<string, unknown>;
};

/** Saved-views control per PRD 07 §13: save, apply and delete list/board/calendar/timeline views. */
export function TkoSavedViewsControl({ tko_views, tko_pending, tko_currentRenderer, tko_onSave, tko_onApply, tko_onDelete }: {
  tko_views: TkoSavedViewRow[];
  tko_pending: boolean;
  tko_currentRenderer: TkoSavedViewRenderer | null;
  tko_onSave: (tko_input: { name: string; renderer: TkoSavedViewRenderer; visibility: "private" | "workspace" }) => void;
  tko_onApply: (tko_view: TkoSavedViewRow) => void;
  tko_onDelete: (tko_viewId: string) => void;
}) {
  const [tko_open, setTkoOpen] = useState(false);
  const [tko_name, setTkoName] = useState("");
  const [tko_visibility, setTkoVisibility] = useState<"private" | "workspace">("private");
  return <div className="relative">
    <button type="button" onClick={() => setTkoOpen(tko_current => !tko_current)} aria-expanded={tko_open} className="inline-flex h-8 items-center gap-1.5 border border-[#d0d5dd] bg-white px-3 text-xs font-semibold text-[#344054] hover:border-[#0c66e4] hover:bg-[#deebff] hover:text-[#0c66e4]">
      <BookmarkPlus className="h-3.5 w-3.5" />Saved views{tko_views.length ? ` (${tko_views.length})` : ""}
    </button>
    {tko_open ? <div className="absolute right-0 top-9 z-[70] w-[min(22rem,calc(100vw-2rem))] border border-[#dfe1e6] bg-white p-3 shadow-[0_10px_28px_rgba(9,30,66,.24)]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">Saved views</p>
        <button type="button" onClick={() => setTkoOpen(false)} aria-label="Close saved views" className="grid h-6 w-6 place-items-center text-[#667085] hover:bg-[#f1f2f4]"><X className="h-3.5 w-3.5" /></button>
      </div>
      <form onSubmit={tko_event => { tko_event.preventDefault(); if (!tko_name.trim() || !tko_currentRenderer) return; tko_onSave({ name: tko_name.trim(), renderer: tko_currentRenderer, visibility: tko_visibility }); setTkoName(""); }} className="flex flex-wrap items-center gap-2 border-b border-[#eaecf0] pb-3">
        <input value={tko_name} onChange={tko_event => setTkoName(tko_event.target.value)} placeholder="Name this view" className="h-8 min-w-0 flex-1 border border-[#d0d5dd] px-2 text-xs outline-none focus:border-[#0c66e4]" />
        <select value={tko_visibility} onChange={tko_event => setTkoVisibility(tko_event.target.value as "private" | "workspace")} className="h-8 border border-[#d0d5dd] bg-white px-1 text-[11px] text-[#344054] outline-none focus:border-[#0c66e4]">
          <option value="private">Private</option>
          <option value="workspace">Workspace</option>
        </select>
        <button type="submit" disabled={tko_pending || !tko_name.trim() || !tko_currentRenderer} className="h-8 bg-[#0c66e4] px-2.5 text-[11px] font-semibold text-white hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60">Save</button>
      </form>
      <div className="divide-y divide-[#f2f4f7]">
        {tko_views.map(tko_view => <article key={tko_view.id} className="flex items-center gap-2 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-[#344054]">{tko_view.name}</span>
            <span className="block text-[10px] text-[#667085]">{tko_view.renderer} · {tko_view.visibility === "workspace" ? "Workspace" : "Private"}</span>
          </span>
          <button type="button" disabled={tko_pending} onClick={() => { tko_onApply(tko_view); setTkoOpen(false); }} className="inline-flex h-7 items-center gap-1 border border-[#b3d4ff] px-2 text-[10px] font-semibold text-[#0c66e4] hover:bg-[#deebff] disabled:opacity-50"><Check className="h-3 w-3" />Apply</button>
          <button type="button" aria-label={`Delete ${tko_view.name}`} disabled={tko_pending} onClick={() => tko_onDelete(tko_view.id)} className="grid h-7 w-7 place-items-center border border-[#fecdca] text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-50"><Trash2 className="h-3 w-3" /></button>
        </article>)}
        {!tko_views.length ? <p className="py-3 text-xs text-[#98a2b3]">No saved views yet. Save the current filters, grouping and renderer.</p> : null}
      </div>
    </div> : null}
  </div>;
}
