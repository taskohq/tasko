import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { startLogin } from "@/const";
import { tko_runBulkStatusMove } from "@/lib/bulk-work-status";
import { tko_filterKanbanItems, tko_groupKanbanItems, type TkoKanbanFilter, type TkoKanbanGrouping } from "@/lib/kanban-board-controls";
import { tko_addOptimistic, tko_applyOptimisticMove, tko_removeOptimistic, tko_runOptimisticCreate } from "@/lib/kanban-optimistic";
import { tko_displayWorkflowStatus } from "@/lib/work-status-reconciliation";
import { useWorkBoardRealtime } from "@/hooks/useWorkBoardRealtime";
import { trpc } from "@/lib/trpc";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronDown as ChevronDownIcon,
  CircleDot,
  Columns3,
  Flag,
  FolderKanban,
  GripVertical,
  LayoutList,
  ListChecks,
  ListFilter,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Plus,
  Search,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";

type TkoCategory = "todo" | "in_progress" | "done";
type TkoPriority = "urgent" | "high" | "medium" | "low" | "none";

type TkoBoardItem = {
  id: string;
  key: string;
  title: string;
  priority: TkoPriority;
  status: string;
  statusId?: string;
  version?: number;
  rank?: string;
  tkoOptimisticOrder?: number;
  detail: string;
  assignee: string;
  dueLabel: string;
  statusChangedBy?: string;
  statusChangedAt?: Date;
  optimistic?: boolean;
};

type TkoItemEditor = {
  workItemId: string;
  title: string;
  description: string;
  priority: TkoPriority;
  assigneeMemberIds: string[];
  dueAt: string;
  estimateMinutes: string;
};

type TkoCreateDraft = {
  statusId: string;
  status: TkoCategory;
  title: string;
  description: string;
  priority: TkoPriority;
  assigneeMemberIds: string[];
  dueAt: string;
  estimateMinutes: string;
  checklistItems: string[];
};

type TkoAssigneeOption = { id: string; displayName: string; role: string };

const tko_previewItems: TkoBoardItem[] = [
  { id: "preview-1", key: "TASKO-12", title: "Confirm workspace hierarchy", priority: "urgent", status: "todo", detail: "Architecture", assignee: "TL", dueLabel: "May 23", rank: "001" },
  { id: "preview-2", key: "TASKO-18", title: "Ship project board", priority: "high", status: "in_progress", detail: "Product", assignee: "AN", dueLabel: "May 15", rank: "001" },
  { id: "preview-3", key: "TASKO-22", title: "Verify tenant-scoped events", priority: "high", status: "in_progress", detail: "Platform", assignee: "MT", dueLabel: "May 16", rank: "002" },
  { id: "preview-4", key: "TASKO-27", title: "Define sprint review ritual", priority: "medium", status: "done", detail: "Planning", assignee: "TL", dueLabel: "May 12", rank: "001" },
];

const tko_previewColumns: Array<{ id: TkoCategory; label: string; accent: string }> = [
  { id: "todo", label: "To do", accent: "bg-[#ef9b3a]" },
  { id: "in_progress", label: "In progress", accent: "bg-[#5b51e8]" },
  { id: "done", label: "Done", accent: "bg-[#12b76a]" },
];

function tko_statusFor(tko_category: string): TkoCategory {
  return tko_category === "in_progress" ? "in_progress" : tko_category === "done" ? "done" : "todo";
}

function tko_statusAccent(tko_color: string | undefined, tko_category: TkoCategory) {
  const tko_colors: Record<string, string> = { slate: "bg-[#667085]", blue: "bg-[#0c66e4]", purple: "bg-[#5b51e8]", green: "bg-[#12b76a]", amber: "bg-[#f79009]", red: "bg-[#d92d20]", teal: "bg-[#0e9384]", indigo: "bg-[#6172f3]", pink: "bg-[#ee46bc]", orange: "bg-[#ef6820]" };
  return tko_colors[tko_color ?? ""] ?? (tko_category === "done" ? "bg-[#12b76a]" : tko_category === "in_progress" ? "bg-[#5b51e8]" : "bg-[#ef9b3a]");
}

function tko_dueLabel(tko_dueAt: Date | null | undefined) {
  if (!tko_dueAt) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(tko_dueAt));
}

function tko_statusChangeLabel(tko_changedAt: Date | undefined) {
  if (!tko_changedAt) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(tko_changedAt));
}

function tko_dateInputValue(tko_dueAt: Date | null | undefined) {
  if (!tko_dueAt) return "";
  const tko_date = new Date(tko_dueAt);
  return `${tko_date.getFullYear()}-${String(tko_date.getMonth() + 1).padStart(2, "0")}-${String(tko_date.getDate()).padStart(2, "0")}`;
}

function tko_fileAsBase64(tko_file: File) {
  return new Promise<string>((tko_resolve, tko_reject) => {
    const tko_reader = new FileReader();
    tko_reader.onerror = () => tko_reject(tko_reader.error ?? new Error("FILE_READ_FAILED"));
    tko_reader.onload = () => tko_resolve(String(tko_reader.result).split(",")[1] ?? "");
    tko_reader.readAsDataURL(tko_file);
  });
}

function TkoPriority({ priority, compact = false }: { priority: TkoPriority; compact?: boolean }) {
  if (priority === "none") return null;
  const tko_color = priority === "urgent"
    ? "border-[#fecdca] bg-[#fef3f2] text-[#d92d20]"
    : priority === "high"
      ? "border-[#fedf89] bg-[#fffaeb] text-[#b54708]"
      : priority === "medium"
        ? "border-[#d9d6fe] bg-[#f4f3ff] text-[#5b51e8]"
        : "border-[#abefc6] bg-[#ecfdf3] text-[#067647]";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tko_color}`}>
      <Flag className="h-2.5 w-2.5" />
      {compact ? priority.slice(0, 1) : priority}
    </span>
  );
}

function TkoKanbanCard({ tko_item, tko_canDrag, tko_isDragging, tko_isSelected, tko_canSelect, tko_onToggleSelection, tko_onOpen, tko_onDragStart, tko_onDragEnd, tko_onDrop }: {
  tko_item: TkoBoardItem;
  tko_canDrag: boolean;
  tko_isDragging: boolean;
  tko_isSelected: boolean;
  tko_canSelect: boolean;
  tko_onToggleSelection: () => void;
  tko_onOpen: () => void;
  tko_onDragStart: () => void;
  tko_onDragEnd: () => void;
  tko_onDrop: (tko_event: DragEvent<HTMLElement>) => void;
}) {
  return <article draggable={tko_canDrag && !tko_item.optimistic} aria-busy={tko_item.optimistic || undefined} onDragStart={tko_onDragStart} onDragEnd={tko_onDragEnd} onDragOver={tko_event => { tko_event.preventDefault(); tko_event.stopPropagation(); }} onDrop={tko_onDrop} className={`relative rounded-lg border bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] will-change-transform transition-[transform,box-shadow,opacity,border-color] duration-150 ease-out ${tko_canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${tko_isSelected ? "border-[#0c66e4] ring-1 ring-[#0c66e4]" : "border-[#eaecf0]"} ${tko_item.optimistic ? "border-dashed bg-[#f7fbff] opacity-80" : tko_isDragging ? "scale-[.98] opacity-45 shadow-none" : "hover:border-[#c7c3ff] hover:shadow-[0_7px_18px_rgba(91,81,232,.09)]"}`}>
    {tko_canSelect ? <label className="absolute left-3 top-3 z-10 flex h-4 w-4 cursor-pointer items-center justify-center rounded bg-white/90"><span className="sr-only">Select {tko_item.title}</span><input type="checkbox" checked={tko_isSelected} onChange={tko_onToggleSelection} className="h-3.5 w-3.5 accent-[#0c66e4]" /></label> : null}
    <button type="button" disabled={tko_item.optimistic} onClick={tko_onOpen} className={`block w-full p-3 text-left disabled:cursor-wait ${tko_canSelect ? "pl-9" : ""}`}><div className="flex items-start justify-between gap-2"><span className="flex items-center gap-1 font-mono text-[10px] text-[#98a2b3]"><GripVertical className="h-3 w-3 text-[#c5cbd5]" />{tko_item.key}</span><TkoPriority priority={tko_item.priority} compact /></div><p className="mt-2 text-[13px] font-semibold leading-5 text-[#344054]">{tko_item.title}</p><div className="mt-3 flex items-center justify-between text-[11px] text-[#667085]"><span className="flex items-center gap-1"><CalendarDays className="h-3 w-3 text-[#98a2b3]" />{tko_item.dueLabel}</span><span className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#e7e5ff] text-[8px] font-bold text-[#5146d9]">{tko_item.assignee}</span><span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />0</span></span></div>{tko_item.statusChangedBy ? <p className="mt-2 truncate text-[10px] text-[#667085]" title={`Last moved by ${tko_item.statusChangedBy} on ${tko_statusChangeLabel(tko_item.statusChangedAt)}`}>Moved by <span className="font-semibold text-[#344054]">{tko_item.statusChangedBy}</span><span className="text-[#98a2b3]"> · {tko_statusChangeLabel(tko_item.statusChangedAt)}</span></p> : null}<p className="mt-2 flex items-center gap-1 text-[10px] text-[#5b51e8]"><FolderKanban className="h-3 w-3" />{tko_item.optimistic ? "Creating task…" : tko_item.detail}</p></button>
  </article>;
}

function TkoKanbanCreateComposer({
  tko_draft,
  tko_columnLabel,
  tko_assignees,
  tko_isPending,
  tko_onChange,
  tko_onSubmit,
  tko_onCancel,
  tko_onExpand,
}: {
  tko_draft: TkoCreateDraft;
  tko_columnLabel: string;
  tko_assignees: TkoAssigneeOption[];
  tko_isPending: boolean;
  tko_onChange: (tko_next: TkoCreateDraft) => void;
  tko_onSubmit: (tko_event: FormEvent) => void;
  tko_onCancel: () => void;
  tko_onExpand: () => void;
}) {
  return (
    <form
      onSubmit={tko_onSubmit}
      onKeyDown={tko_event => {
        if (tko_event.key === "Escape") {
          tko_event.preventDefault();
          tko_onCancel();
        }
      }}
      className="border border-[#0c66e4] bg-white p-3 shadow-[0_1px_2px_rgba(9,30,66,.16)]"
      aria-label={`Create task in ${tko_columnLabel}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[.08em] text-[#44546f]">New task · {tko_columnLabel}</span>
        <button type="button" onClick={tko_onCancel} aria-label="Cancel creating task" className="grid h-6 w-6 place-items-center text-[#626f86] hover:bg-[#f1f2f4] hover:text-[#172b4d]"><X className="h-3.5 w-3.5" /></button>
      </div>
      <label className="sr-only" htmlFor={`create-title-${tko_draft.statusId}`}>Task title</label>
      <input
        id={`create-title-${tko_draft.statusId}`}
        autoFocus
        value={tko_draft.title}
        onChange={tko_event => tko_onChange({ ...tko_draft, title: tko_event.target.value })}
        placeholder="What needs to be done?"
        className="h-9 w-full border border-[#dfe1e6] px-2.5 text-xs font-medium text-[#172b4d] outline-none placeholder:text-[#6b778c] focus:border-[#0c66e4] focus:ring-1 focus:ring-[#0c66e4]"
      />
      <label className="sr-only" htmlFor={`create-description-${tko_draft.statusId}`}>Description</label>
      <textarea
        id={`create-description-${tko_draft.statusId}`}
        value={tko_draft.description}
        onChange={tko_event => tko_onChange({ ...tko_draft, description: tko_event.target.value })}
        placeholder="Add context (optional)"
        className="mt-2 min-h-16 w-full resize-y border border-[#dfe1e6] px-2.5 py-2 text-xs leading-5 text-[#172b4d] outline-none placeholder:text-[#6b778c] focus:border-[#0c66e4] focus:ring-1 focus:ring-[#0c66e4]"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] font-semibold text-[#44546f]">Priority
          <select value={tko_draft.priority} onChange={tko_event => tko_onChange({ ...tko_draft, priority: tko_event.target.value as TkoPriority })} className="mt-1 block h-8 w-full border border-[#dfe1e6] bg-white px-2 text-[11px] text-[#172b4d] outline-none focus:border-[#0c66e4]">
            <option value="none">No priority</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="text-[10px] font-semibold text-[#44546f]">Assignee
          <select value={tko_draft.assigneeMemberIds[0] ?? "unassigned"} onChange={tko_event => tko_onChange({ ...tko_draft, assigneeMemberIds: tko_event.target.value === "unassigned" ? [] : [tko_event.target.value] })} className="mt-1 block h-8 w-full border border-[#dfe1e6] bg-white px-2 text-[11px] text-[#172b4d] outline-none focus:border-[#0c66e4]">
            <option value="unassigned">Unassigned</option>{tko_assignees.map(tko_assignee => <option key={tko_assignee.id} value={tko_assignee.id}>{tko_assignee.displayName}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-[#44546f]">Due date
          <input type="date" value={tko_draft.dueAt} onChange={tko_event => tko_onChange({ ...tko_draft, dueAt: tko_event.target.value })} className="mt-1 block h-8 w-full border border-[#dfe1e6] bg-white px-2 text-[11px] text-[#172b4d] outline-none focus:border-[#0c66e4]" />
        </label>
        <label className="text-[10px] font-semibold text-[#44546f]">Estimate (min)
          <input type="number" min="0" step="1" value={tko_draft.estimateMinutes} onChange={tko_event => tko_onChange({ ...tko_draft, estimateMinutes: tko_event.target.value })} placeholder="—" className="mt-1 block h-8 w-full border border-[#dfe1e6] px-2 text-[11px] text-[#172b4d] outline-none placeholder:text-[#6b778c] focus:border-[#0c66e4]" />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] text-[#626f86]">Enter to create · Esc to cancel</span>
        <div className="flex gap-1.5"><button type="button" onClick={tko_onExpand} className="inline-flex h-7 items-center gap-1 px-2 text-[11px] font-medium text-[#0c66e4] hover:bg-[#deebff]"><PanelRight className="h-3.5 w-3.5" />More fields</button><button type="button" onClick={tko_onCancel} className="h-7 px-2 text-[11px] font-medium text-[#44546f] hover:bg-[#f1f2f4]">Cancel</button><Button type="submit" disabled={!tko_draft.title.trim() || tko_isPending} className="h-7 rounded-sm bg-[#0c66e4] px-2.5 text-[11px] font-semibold hover:bg-[#0055cc]">{tko_isPending ? "Creating…" : "Create & open"}</Button></div>
      </div>
    </form>
  );
}

function TkoRichTaskComposer({
  tko_draft,
  tko_assignees,
  tko_files,
  tko_mode,
  tko_isPending,
  tko_onChange,
  tko_onFilesChange,
  tko_onMode,
  tko_onSubmit,
  tko_onClose,
}: {
  tko_draft: TkoCreateDraft;
  tko_assignees: TkoAssigneeOption[];
  tko_files: File[];
  tko_mode: "panel" | "fullscreen";
  tko_isPending: boolean;
  tko_onChange: (tko_next: TkoCreateDraft) => void;
  tko_onFilesChange: (tko_files: File[]) => void;
  tko_onMode: (tko_mode: "quick" | "panel" | "fullscreen") => void;
  tko_onSubmit: (tko_event: FormEvent) => void;
  tko_onClose: () => void;
}) {
  const [tko_checklistInput, setTkoChecklistInput] = useState("");
  const tko_addChecklist = () => {
    const tko_title = tko_checklistInput.trim();
    if (!tko_title) return;
    tko_onChange({ ...tko_draft, checklistItems: [...tko_draft.checklistItems, tko_title] });
    setTkoChecklistInput("");
  };
  return <form onSubmit={tko_onSubmit} className="flex min-h-0 flex-1 flex-col" aria-label="Detailed task composer">
    <div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">New task</p><p className="mt-0.5 text-sm font-semibold text-[#172b4d]">Detailed task composer</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => tko_onMode(tko_mode === "fullscreen" ? "panel" : "fullscreen")} className="inline-flex h-8 items-center gap-1 border border-[#dfe1e6] px-2 text-[11px] font-medium text-[#344054] hover:bg-[#f7f8fa]">{tko_mode === "fullscreen" ? <PanelRight className="h-3.5 w-3.5" /> : <Columns3 className="h-3.5 w-3.5" />}{tko_mode === "fullscreen" ? "Side panel" : "Full screen"}</button><button type="button" onClick={() => tko_onMode("quick")} className="h-8 px-2 text-[11px] font-medium text-[#0c66e4] hover:bg-[#deebff]">Quick</button><button type="button" onClick={tko_onClose} aria-label="Close task composer" className="grid h-8 w-8 place-items-center text-[#667085] hover:bg-[#f1f2f4]"><X className="h-4 w-4" /></button></div></div>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"><label className="block text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">Summary<input autoFocus value={tko_draft.title} onChange={tko_event => tko_onChange({ ...tko_draft, title: tko_event.target.value })} placeholder="Describe the outcome" className="mt-1.5 h-10 w-full border border-[#d0d5dd] px-3 text-sm font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4] focus:ring-1 focus:ring-[#0c66e4]" /></label><label className="block text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">Description<textarea value={tko_draft.description} onChange={tko_event => tko_onChange({ ...tko_draft, description: tko_event.target.value })} placeholder="Context, scope, decisions and acceptance criteria…" className="mt-1.5 min-h-40 w-full resize-y border border-[#d0d5dd] p-3 text-xs leading-5 text-[#344054] outline-none focus:border-[#0c66e4] focus:ring-1 focus:ring-[#0c66e4]" /></label><div className="grid grid-cols-2 gap-3"><label className="text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">Priority<select value={tko_draft.priority} onChange={tko_event => tko_onChange({ ...tko_draft, priority: tko_event.target.value as TkoPriority })} className="mt-1.5 h-9 w-full border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]"><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">Assignee<select value={tko_draft.assigneeMemberIds[0] ?? "unassigned"} onChange={tko_event => tko_onChange({ ...tko_draft, assigneeMemberIds: tko_event.target.value === "unassigned" ? [] : [tko_event.target.value] })} className="mt-1.5 h-9 w-full border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]"><option value="unassigned">Unassigned</option>{tko_assignees.map(tko_assignee => <option key={tko_assignee.id} value={tko_assignee.id}>{tko_assignee.displayName}</option>)}</select></label><label className="text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">Due date<input type="date" value={tko_draft.dueAt} onChange={tko_event => tko_onChange({ ...tko_draft, dueAt: tko_event.target.value })} className="mt-1.5 h-9 w-full border border-[#d0d5dd] px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]" /></label><label className="text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">Estimate (min)<input type="number" min="0" step="1" value={tko_draft.estimateMinutes} onChange={tko_event => tko_onChange({ ...tko_draft, estimateMinutes: tko_event.target.value })} className="mt-1.5 h-9 w-full border border-[#d0d5dd] px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]" /></label></div>
      <section className="border-t border-[#eaecf0] pt-4"><div className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-[#5b51e8]" /><h3 className="text-xs font-semibold text-[#172b4d]">Checklist</h3><span className="text-[11px] text-[#667085]">{tko_draft.checklistItems.length} item</span></div><div className="mt-2 space-y-1.5">{tko_draft.checklistItems.map((tko_item, tko_index) => <div key={`${tko_item}-${tko_index}`} className="flex items-center gap-2 border border-[#eaecf0] px-2 py-1.5 text-xs text-[#344054]"><span className="h-3.5 w-3.5 border border-[#98a2b3]" />{tko_item}<button type="button" onClick={() => tko_onChange({ ...tko_draft, checklistItems: tko_draft.checklistItems.filter((_, tko_current) => tko_current !== tko_index) })} className="ml-auto text-[#667085] hover:text-[#d92d20]" aria-label={`Remove ${tko_item}`}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div><div className="mt-2 flex gap-2"><input value={tko_checklistInput} onChange={tko_event => setTkoChecklistInput(tko_event.target.value)} onKeyDown={tko_event => { if (tko_event.key === "Enter") { tko_event.preventDefault(); tko_addChecklist(); } }} placeholder="Add acceptance step" className="h-8 min-w-0 flex-1 border border-[#dfe1e6] px-2 text-xs outline-none focus:border-[#0c66e4]" /><button type="button" onClick={tko_addChecklist} className="h-8 border border-[#dfe1e6] px-2 text-xs font-semibold text-[#0c66e4] hover:bg-[#deebff]">Add</button></div></section>
      <section className="border-t border-[#eaecf0] pt-4"><div className="flex items-center gap-2"><Paperclip className="h-4 w-4 text-[#5b51e8]" /><h3 className="text-xs font-semibold text-[#172b4d]">Attachments</h3><span className="text-[11px] text-[#667085]">Upload after task is created · 10 MiB/file</span></div><label className="mt-2 flex cursor-pointer items-center justify-center gap-2 border border-dashed border-[#98a2b3] bg-[#fcfcfd] px-3 py-3 text-xs font-medium text-[#0c66e4] hover:border-[#0c66e4] hover:bg-[#deebff]"><Paperclip className="h-3.5 w-3.5" />Choose files<input type="file" multiple className="sr-only" onChange={tko_event => tko_onFilesChange([...tko_files, ...Array.from(tko_event.target.files ?? [])])} /></label>{tko_files.length ? <div className="mt-2 space-y-1">{tko_files.map((tko_file, tko_index) => <div key={`${tko_file.name}-${tko_index}`} className="flex items-center gap-2 border border-[#eaecf0] px-2 py-1.5 text-xs text-[#344054]"><Paperclip className="h-3.5 w-3.5 text-[#667085]" /><span className="min-w-0 flex-1 truncate">{tko_file.name}</span><span className="text-[#667085]">{Math.ceil(tko_file.size / 1024)} KB</span><button type="button" onClick={() => tko_onFilesChange(tko_files.filter((_, tko_current) => tko_current !== tko_index))} aria-label={`Remove ${tko_file.name}`}><X className="h-3.5 w-3.5 text-[#667085]" /></button></div>)}</div> : null}</section>
    </div><div className="flex items-center justify-between border-t border-[#eaecf0] px-5 py-4"><span className="text-[11px] text-[#667085]">The same draft persists when changing modes.</span><Button type="submit" disabled={!tko_draft.title.trim() || tko_isPending} className="h-9 rounded-sm bg-[#0c66e4] px-3 text-xs font-semibold hover:bg-[#0055cc]">{tko_isPending ? "Creating…" : "Create task"}</Button></div>
  </form>;
}

export default function Work() {
  const { isAuthenticated, loading: tko_authLoading } = useAuth();
  const tko_utils = trpc.useUtils();
  const [tko_view, setTkoView] = useState<"overview" | "board" | "list" | "timeline" | "files">("board");
  const [tko_selectedItem, setTkoSelectedItem] = useState<TkoBoardItem | null>(null);
  const [tko_editor, setTkoEditor] = useState<TkoItemEditor | null>(null);
  const [tko_commentDraft, setTkoCommentDraft] = useState("");
  const [tko_filterOpen, setTkoFilterOpen] = useState(false);
  const [tko_filter, setTkoFilter] = useState<TkoKanbanFilter>("all");
  const [tko_groupOpen, setTkoGroupOpen] = useState(false);
  const [tko_grouping, setTkoGrouping] = useState<TkoKanbanGrouping>("none");
  const [tko_draggedId, setTkoDraggedId] = useState<string | null>(null);
  const [tko_dragOverStatusId, setTkoDragOverStatusId] = useState<string | null>(null);
  const [tko_createDraft, setTkoCreateDraft] = useState<TkoCreateDraft | null>(null);
  const [tko_createMode, setTkoCreateMode] = useState<"quick" | "panel" | "fullscreen">("quick");
  const [tko_createFiles, setTkoCreateFiles] = useState<File[]>([]);
  const [tko_optimisticItems, setTkoOptimisticItems] = useState<TkoBoardItem[]>([]);
  const [tko_selectedItemIds, setTkoSelectedItemIds] = useState<Set<string>>(() => new Set());
  const [tko_bulkTargetStatusId, setTkoBulkTargetStatusId] = useState("");
  const [tko_bulkPriorityValue, setTkoBulkPriorityValue] = useState<TkoPriority | "">("");
  const [tko_sprintPlannerOpen, setTkoSprintPlannerOpen] = useState(false);
  const [tko_sprintName, setTkoSprintName] = useState("");
  const [tko_sprintGoal, setTkoSprintGoal] = useState("");
  const [tko_sprintStartAt, setTkoSprintStartAt] = useState("");
  const [tko_sprintEndAt, setTkoSprintEndAt] = useState("");
  const [tko_selectedSprintId, setTkoSelectedSprintId] = useState("");
  const [tko_incompleteDisposition, setTkoIncompleteDisposition] = useState<"backlog" | "next_sprint">("backlog");
  const [tko_nextSprintId, setTkoNextSprintId] = useState("");
  const [tko_dependencyTargetId, setTkoDependencyTargetId] = useState("unselected");
  const [tko_dependencyRelationType, setTkoDependencyRelationType] = useState<"blocks" | "blocked_by" | "relates_to" | "duplicates" | "duplicated_by">("blocks");
  const [tko_columnsOpen, setTkoColumnsOpen] = useState(false);
  const [tko_newColumn, setTkoNewColumn] = useState({ name: "", description: "", category: "todo" as TkoCategory, colorToken: "blue" });
  const [tko_projectSearch, setTkoProjectSearch] = useState("");
  const [tko_downloadRequest, setTkoDownloadRequest] = useState<{ workItemId: string; attachmentId: string } | null>(null);

  const tko_projects = trpc.work.projects.useQuery(undefined, { enabled: isAuthenticated });
  const tko_assignees = trpc.work.assignees.useQuery(undefined, { enabled: isAuthenticated });
  const tko_currentTenant = trpc.platform.currentTenant.useQuery(undefined, { enabled: isAuthenticated });
  const tko_selectedProject = tko_projects.data?.[0];
  const tko_board = trpc.work.board.useQuery(
    { projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_selectedProject) },
  );
  const tko_overview = trpc.work.overview.useQuery(
    { projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_selectedProject && isAuthenticated) },
  );
  const tko_projectSearchResults = trpc.work.searchProject.useQuery(
    { projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000", query: tko_projectSearch },
    { enabled: Boolean(tko_selectedProject && isAuthenticated && tko_projectSearch.trim().length >= 2) },
  );
  const tko_projectFiles = trpc.work.projectFiles.useQuery(
    { projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_selectedProject && isAuthenticated) },
  );
  const tko_fileDownload = trpc.work.attachmentDownloadUrl.useQuery(
    { workItemId: tko_downloadRequest?.workItemId ?? "00000000-0000-0000-0000-000000000000", attachmentId: tko_downloadRequest?.attachmentId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_downloadRequest) },
  );
  const tko_itemDetails = trpc.work.item.useQuery(
    { workItemId: tko_selectedItem?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_selectedItem && isAuthenticated && tko_selectedProject) },
  );
  const tko_refreshBoard = useCallback(async () => Promise.all([
    tko_utils.work.board.invalidate(),
    tko_utils.work.item.invalidate(),
    tko_utils.work.overview.invalidate(),
    tko_utils.work.searchProject.invalidate(),
    tko_utils.work.projectFiles.invalidate(),
  ]), [tko_utils]);
  useWorkBoardRealtime({
    enabled: Boolean(isAuthenticated && tko_selectedProject),
    projectId: tko_selectedProject?.id,
    memberId: tko_currentTenant.data?.memberId,
    onBoardChanged: () => {
      void tko_refreshBoard();
      void tko_utils.workspace.inbox.invalidate();
    },
  });
  useEffect(() => {
    if (!tko_fileDownload.data?.url) return;
    window.open(tko_fileDownload.data.url, "_blank", "noopener,noreferrer");
    setTkoDownloadRequest(null);
  }, [tko_fileDownload.data?.url]);
  const tko_seed = trpc.work.seedDemo.useMutation({
    onSuccess: async () => { await tko_utils.work.projects.invalidate(); },
  });
  const tko_move = trpc.work.moveItem.useMutation({
    onMutate: async tko_input => {
      const tko_boardKey = { projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000" };
      await tko_utils.work.board.cancel(tko_boardKey);
      const tko_previousBoard = tko_utils.work.board.getData(tko_boardKey);
      tko_utils.work.board.setData(tko_boardKey, tko_current => tko_current ? {
        ...tko_current,
        items: tko_applyOptimisticMove(tko_current.items, tko_input.workItemId, tko_input.targetStatusId, tko_input.beforeWorkItemId),
      } : tko_current);
      return { tko_previousBoard, tko_boardKey };
    },
    onSuccess: async () => { await tko_refreshBoard(); },
    onError: async () => { await tko_refreshBoard(); toast.error("Board vừa thay đổi. Dữ liệu đã được làm mới, hãy thử lại."); },
  });
  const tko_bulkMove = trpc.work.moveItem.useMutation();
  const tko_bulkPriority = trpc.work.updateItem.useMutation();
  const tko_create = trpc.work.createItem.useMutation();
  const tko_uploadAttachment = trpc.work.uploadAttachment.useMutation();
  const tko_createStatus = trpc.work.createStatus.useMutation({
    onSuccess: async () => { setTkoNewColumn({ name: "", description: "", category: "todo", colorToken: "blue" }); await tko_refreshBoard(); toast.success("Đã tạo cột workflow."); },
    onError: () => toast.error("Không thể tạo cột. Hãy kiểm tra thông tin và thử lại."),
  });
  const tko_updateStatus = trpc.work.updateStatus.useMutation({
    onSuccess: async () => { await tko_refreshBoard(); toast.success("Đã lưu cột workflow."); },
    onError: () => toast.error("Không thể lưu cột workflow. Board đã được làm mới."),
  });
  const tko_reorderStatus = trpc.work.reorderStatus.useMutation({
    onSuccess: async () => { await tko_refreshBoard(); toast.success("Đã cập nhật thứ tự cột."); },
    onError: async () => { await tko_refreshBoard(); toast.error("Không thể đổi thứ tự cột. Board đã được làm mới."); },
  });
  const tko_createSprint = trpc.work.createSprint.useMutation({
    onSuccess: async tko_sprint => {
      setTkoSelectedSprintId(tko_sprint.id);
      setTkoSprintName("");
      setTkoSprintGoal("");
      setTkoSprintStartAt("");
      setTkoSprintEndAt("");
      await tko_refreshBoard();
      toast.success("Đã tạo sprint.");
    },
    onError: () => toast.error("Không thể tạo sprint. Hãy kiểm tra lại thông tin và thử lại."),
  });
  const tko_addItemsToSprint = trpc.work.addItemsToSprint.useMutation({
    onSuccess: async () => {
      setTkoSelectedItemIds(new Set());
      await tko_refreshBoard();
      toast.success("Đã thêm task vào sprint.");
    },
    onError: async () => {
      await tko_refreshBoard();
      toast.error("Không thể thêm toàn bộ task vào sprint. Board đã được làm mới.");
    },
  });
  const tko_completeSprint = trpc.work.completeSprint.useMutation({
    onSuccess: async () => {
      setTkoNextSprintId("");
      setTkoIncompleteDisposition("backlog");
      await tko_refreshBoard();
      toast.success("Đã hoàn tất sprint và cập nhật các task chưa xong.");
    },
    onError: async () => {
      await tko_refreshBoard();
      toast.error("Không thể hoàn tất sprint. Dữ liệu planning đã được làm mới.");
    },
  });
  const tko_startSprint = trpc.work.startSprint.useMutation({
    onSuccess: async () => {
      await tko_refreshBoard();
      toast.success("Sprint đã bắt đầu.");
    },
    onError: async tko_error => {
      await tko_refreshBoard();
      toast.error(tko_error.message.includes("ACTIVE_EXISTS") ? "Project đã có sprint đang chạy." : "Không thể bắt đầu sprint. Dữ liệu đã được làm mới.");
    },
  });
  const tko_comment = trpc.work.createComment.useMutation({
    onSuccess: async () => {
      setTkoCommentDraft("");
      await tko_utils.work.item.invalidate();
      toast.success("Đã thêm bình luận.");
    },
  });
  const tko_update = trpc.work.updateItem.useMutation({
    onMutate: tko_input => {
      const tko_previous = tko_selectedItem;
      setTkoSelectedItem(tko_current => tko_current?.id === tko_input.workItemId ? {
        ...tko_current,
        title: tko_input.title ?? tko_current.title,
        priority: tko_input.priority ?? tko_current.priority,
        assignee: tko_input.assigneeMemberIds === undefined ? tko_current.assignee : tko_input.assigneeMemberIds.length ? "ME" : "—",
        dueLabel: tko_input.dueAt === undefined ? tko_current.dueLabel : tko_dueLabel(tko_input.dueAt),
      } : tko_current);
      return { tko_previous };
    },
    onError: async (_tko_error, _tko_input, tko_context) => {
      if (tko_context?.tko_previous) setTkoSelectedItem(tko_context.tko_previous);
      await tko_refreshBoard();
      toast.error("Không thể lưu thay đổi. Dữ liệu item đã được làm mới.");
    },
    onSuccess: async () => {
      await tko_refreshBoard();
      toast.success("Đã lưu work item.");
    },
  });
  const tko_addDependency = trpc.work.addDependency.useMutation({
    onSuccess: async () => {
      setTkoDependencyTargetId("unselected");
      await tko_refreshBoard();
      toast.success("Đã liên kết work item.");
    },
    onError: async tko_error => {
      await tko_refreshBoard();
      toast.error(tko_error.message.includes("CYCLE") ? "Không thể tạo dependency vòng lặp." : "Không thể tạo dependency. Dữ liệu đã được làm mới.");
    },
  });
  const tko_removeDependency = trpc.work.removeDependency.useMutation({
    onMutate: async tko_input => {
      await tko_utils.work.item.cancel();
      const tko_previous = tko_utils.work.item.getData({ workItemId: tko_input.workItemId });
      tko_utils.work.item.setData({ workItemId: tko_input.workItemId }, tko_current => tko_current ? {
        ...tko_current,
        dependencies: tko_current.dependencies.filter(tko_relation => tko_relation.id !== tko_input.relationId),
      } : tko_current);
      return { tko_previous };
    },
    onSuccess: async () => {
      await tko_refreshBoard();
      toast.success("Đã gỡ dependency.");
    },
    onError: async (_tko_error, tko_input, tko_context) => {
      if (tko_context?.tko_previous) tko_utils.work.item.setData({ workItemId: tko_input.workItemId }, tko_context.tko_previous);
      await tko_refreshBoard();
      toast.error("Không thể gỡ dependency. Dữ liệu đã được làm mới.");
    },
  });

  const tko_columns = useMemo(() => {
    if (!tko_board.data) return tko_previewColumns.map(tko_column => ({ ...tko_column, statusId: undefined, description: "", colorToken: undefined }));
    return tko_board.data.statuses.map(tko_status => ({
      id: tko_statusFor(tko_status.category),
      label: tko_status.name,
      accent: tko_statusAccent(tko_status.colorToken, tko_statusFor(tko_status.category)),
      statusId: tko_status.id,
      description: tko_status.description,
      colorToken: tko_status.colorToken,
    }));
  }, [tko_board.data]);
  const tko_items = useMemo<TkoBoardItem[]>(() => {
    if (!tko_board.data) return [...tko_previewItems, ...tko_optimisticItems];
    const tko_statusById = new Map(tko_board.data.statuses.map(tko_status => [tko_status.id, tko_status]));
    const tko_serverItems = tko_board.data.items.map(tko_item => ({
      id: tko_item.id,
      key: tko_item.key,
      title: tko_item.title,
      priority: tko_item.priority,
      status: tko_displayWorkflowStatus(tko_item.statusId, tko_board.data.statuses, "Unknown status"),
      statusId: tko_item.statusId,
      version: tko_item.version,
      rank: tko_item.rank,
      detail: tko_item.estimateMinutes ? `${Math.round(tko_item.estimateMinutes / 60)}h estimate` : "Work item",
      assignee: tko_item.assigneeMemberIds.length ? "ME" : "—",
      dueLabel: tko_dueLabel(tko_item.dueAt),
      statusChangedBy: tko_board.data.latestStatusChangeByWorkItemId[tko_item.id]?.actorDisplayName,
      statusChangedAt: tko_board.data.latestStatusChangeByWorkItemId[tko_item.id]?.changedAt,
    }));
    return [...tko_serverItems, ...tko_optimisticItems];
  }, [tko_board.data, tko_optimisticItems]);

  const tko_projectName = tko_selectedProject?.name ?? "Q2 Renewal Implementation";
  const tko_isPreview = !isAuthenticated || !tko_selectedProject;
  const tko_selectedDetail = tko_itemDetails.data;
  const tko_filteredItems = useMemo(() => tko_filterKanbanItems(tko_items, tko_filter), [tko_filter, tko_items]);
  const tko_filterLabel = tko_filter === "all" ? "All tasks" : tko_filter === "high_priority" ? "High priority" : tko_filter === "assigned" ? "Assigned" : "Unassigned";
  const tko_groupLabel = tko_grouping === "none" ? "None" : tko_grouping === "priority" ? "Priority" : "Assignee";
  const tko_selectedBoardItems = useMemo(() => tko_items.filter(tko_item => tko_selectedItemIds.has(tko_item.id)), [tko_items, tko_selectedItemIds]);
  const tko_selectableItems = useMemo(() => tko_filteredItems.filter(tko_item => !tko_item.optimistic && Boolean(tko_item.version)), [tko_filteredItems]);
  const tko_allVisibleSelected = tko_selectableItems.length > 0 && tko_selectableItems.every(tko_item => tko_selectedItemIds.has(tko_item.id));
  const tko_sprints = tko_board.data?.sprints ?? [];
  const tko_selectedSprint = tko_sprints.find(tko_sprint => tko_sprint.id === tko_selectedSprintId) ?? tko_sprints.find(tko_sprint => tko_sprint.state === "active") ?? tko_sprints.find(tko_sprint => tko_sprint.state === "planned") ?? null;
  const tko_carryOverSprints = tko_sprints.filter(tko_sprint => tko_sprint.id !== tko_selectedSprint?.id && tko_sprint.state !== "completed");
  const tko_dependencyCandidates = useMemo(() => tko_items.filter(tko_item => !tko_item.optimistic && tko_item.id !== tko_selectedDetail?.item.id), [tko_items, tko_selectedDetail?.item.id]);
  const tko_workItemById = useMemo(() => new Map(tko_items.map(tko_item => [tko_item.id, tko_item])), [tko_items]);

  useEffect(() => {
    if (!tko_selectedDetail?.item || tko_editor?.workItemId === tko_selectedDetail.item.id) return;
    const tko_item = tko_selectedDetail.item;
    setTkoEditor({
      workItemId: tko_item.id,
      title: tko_item.title,
      description: tko_item.description,
      priority: tko_item.priority,
      assigneeMemberIds: tko_item.assigneeMemberIds,
      dueAt: tko_dateInputValue(tko_item.dueAt),
      estimateMinutes: tko_item.estimateMinutes?.toString() ?? "",
    });
  }, [tko_editor?.workItemId, tko_selectedDetail?.item]);

  useEffect(() => {
    const tko_visibleIds = new Set(tko_items.map(tko_item => tko_item.id));
    setTkoSelectedItemIds(tko_current => {
      const tko_next = new Set(Array.from(tko_current).filter(tko_id => tko_visibleIds.has(tko_id)));
      return tko_next.size === tko_current.size ? tko_current : tko_next;
    });
  }, [tko_items]);

  useEffect(() => {
    if (!tko_selectedItem?.id) return;
    const tko_liveItem = tko_items.find(tko_item => tko_item.id === tko_selectedItem.id && !tko_item.optimistic);
    if (!tko_liveItem) return;
    setTkoSelectedItem(tko_current => {
      if (!tko_current || tko_current.id !== tko_liveItem.id) return tko_current;
      return tko_current.statusId === tko_liveItem.statusId
        && tko_current.status === tko_liveItem.status
        && tko_current.version === tko_liveItem.version
        && tko_current.title === tko_liveItem.title
        ? tko_current
        : tko_liveItem;
    });
  }, [tko_items, tko_selectedItem?.id]);

  function tko_openItem(tko_item: TkoBoardItem) {
    setTkoSelectedItem(tko_item);
    setTkoCommentDraft("");
    setTkoEditor(null);
  }

  function tko_closeItem() {
    setTkoSelectedItem(null);
    setTkoEditor(null);
    setTkoDependencyTargetId("unselected");
  }

  function tko_submitDependency(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (tko_isPreview) { startLogin(); return; }
    if (!tko_selectedDetail?.item || tko_dependencyTargetId === "unselected") {
      toast.error("Chọn work item cần liên kết.");
      return;
    }
    tko_addDependency.mutate({
      sourceWorkItemId: tko_selectedDetail.item.id,
      targetWorkItemId: tko_dependencyTargetId,
      relationType: tko_dependencyRelationType,
    });
  }

  function tko_requestMove(tko_item: TkoBoardItem, tko_targetStatusId: string | undefined, tko_beforeWorkItemId: string | null = null) {
    const tko_expectedVersion = tko_selectedDetail?.item.id === tko_item.id ? tko_selectedDetail.item.version : tko_item.version;
    if (tko_isPreview || !tko_targetStatusId || !tko_expectedVersion) {
      toast("Sign in to update tenant-scoped work.");
      return;
    }
    tko_move.mutate({ workItemId: tko_item.id, targetStatusId: tko_targetStatusId, beforeWorkItemId: tko_beforeWorkItemId, expectedVersion: tko_expectedVersion });
  }

  function tko_toggleItemSelection(tko_workItemId: string) {
    setTkoSelectedItemIds(tko_current => {
      const tko_next = new Set(tko_current);
      if (tko_next.has(tko_workItemId)) tko_next.delete(tko_workItemId);
      else tko_next.add(tko_workItemId);
      return tko_next;
    });
  }

  function tko_toggleVisibleSelection() {
    setTkoSelectedItemIds(tko_current => {
      const tko_next = new Set(tko_current);
      if (tko_allVisibleSelected) tko_selectableItems.forEach(tko_item => tko_next.delete(tko_item.id));
      else tko_selectableItems.forEach(tko_item => tko_next.add(tko_item.id));
      return tko_next;
    });
  }

  function tko_submitSprint(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (tko_isPreview) { startLogin(); return; }
    if (!tko_selectedProject || !tko_sprintName.trim()) {
      toast.error("Tên sprint là bắt buộc.");
      return;
    }
    if (tko_sprintStartAt && tko_sprintEndAt && tko_sprintEndAt < tko_sprintStartAt) {
      toast.error("Ngày kết thúc phải sau ngày bắt đầu.");
      return;
    }
    tko_createSprint.mutate({
      projectId: tko_selectedProject.id,
      name: tko_sprintName.trim(),
      goal: tko_sprintGoal.trim() || undefined,
      startAt: tko_sprintStartAt ? new Date(`${tko_sprintStartAt}T12:00:00`) : null,
      endAt: tko_sprintEndAt ? new Date(`${tko_sprintEndAt}T12:00:00`) : null,
    });
  }

  function tko_addSelectionToSprint() {
    if (tko_isPreview) { startLogin(); return; }
    if (!tko_selectedSprint || !tko_selectedBoardItems.length) return;
    const tko_workItemIds = tko_selectedBoardItems.filter(tko_item => !tko_item.optimistic).map(tko_item => tko_item.id);
    if (tko_workItemIds.length) tko_addItemsToSprint.mutate({ sprintId: tko_selectedSprint.id, workItemIds: tko_workItemIds });
  }

  function tko_finishSelectedSprint() {
    if (tko_isPreview) { startLogin(); return; }
    if (!tko_selectedSprint) return;
    if (tko_incompleteDisposition === "next_sprint" && !tko_nextSprintId) {
      toast.error("Chọn sprint đích để chuyển các task chưa hoàn tất.");
      return;
    }
    tko_completeSprint.mutate({
      sprintId: tko_selectedSprint.id,
      incompleteDisposition: tko_incompleteDisposition,
      nextSprintId: tko_incompleteDisposition === "next_sprint" ? tko_nextSprintId : null,
    });
  }

  async function tko_moveSelectedItems() {
    if (tko_isPreview) { startLogin(); return; }
    if (!tko_bulkTargetStatusId || !tko_selectedBoardItems.length || tko_bulkMove.isPending) return;

    const tko_result = await tko_runBulkStatusMove({
      items: tko_selectedBoardItems,
      targetStatusId: tko_bulkTargetStatusId,
      move: ({ workItemId, targetStatusId, expectedVersion }) => tko_bulkMove.mutateAsync({ workItemId, targetStatusId, beforeWorkItemId: null, expectedVersion }),
    });
    await tko_refreshBoard();
    setTkoSelectedItemIds(new Set(tko_result.failedIds));
    setTkoBulkTargetStatusId("");
    if (tko_result.failedIds.length) toast.error(`${tko_result.succeededIds.length} task đã chuyển. ${tko_result.failedIds.length} task chưa chuyển do board vừa thay đổi; các task này vẫn được chọn để thử lại.`);
    else if (tko_result.succeededIds.length) toast.success(`Đã chuyển ${tko_result.succeededIds.length} task.`);
    else toast("Các task đã ở trạng thái đích hoặc đang được đồng bộ.");
  }

  async function tko_updateSelectedPriority() {
    if (tko_isPreview || !tko_bulkPriorityValue || !tko_selectedBoardItems.length || tko_bulkPriority.isPending) return;
    const tko_results = await Promise.allSettled(tko_selectedBoardItems.filter(tko_item => !tko_item.optimistic && Boolean(tko_item.version)).map(tko_item => tko_bulkPriority.mutateAsync({ workItemId: tko_item.id, expectedVersion: tko_item.version!, priority: tko_bulkPriorityValue })));
    const tko_failed = tko_results.filter(tko_result => tko_result.status === "rejected").length;
    await tko_refreshBoard();
    setTkoBulkPriorityValue("");
    if (tko_failed) toast.error(`${tko_results.length - tko_failed} task đã được triage. ${tko_failed} task cần làm mới trước khi thử lại.`);
    else toast.success(`Đã đặt priority cho ${tko_results.length} task.`);
  }

  function tko_dropOnColumn(tko_event: DragEvent<HTMLElement>, tko_statusId: string | undefined, tko_beforeWorkItemId: string | null = null) {
    tko_event.preventDefault();
    const tko_item = tko_items.find(tko_candidate => tko_candidate.id === tko_draggedId);
    setTkoDraggedId(null);
    setTkoDragOverStatusId(null);
    if (!tko_item || tko_item.id === tko_beforeWorkItemId) return;
    tko_requestMove(tko_item, tko_statusId, tko_beforeWorkItemId);
  }

  function tko_openCreateComposer(tko_statusId: string | undefined, tko_status: TkoCategory) {
    if (!isAuthenticated) { startLogin(); return; }
    if (!tko_statusId) return;
    setTkoCreateMode("quick");
    setTkoCreateFiles([]);
    setTkoCreateDraft({ statusId: tko_statusId, status: tko_status, title: "", description: "", priority: "none", assigneeMemberIds: [], dueAt: "", estimateMinutes: "", checklistItems: [] });
  }

  function tko_cancelCreateComposer() { setTkoCreateDraft(null); setTkoCreateFiles([]); setTkoCreateMode("quick"); }

  async function tko_uploadDraftFiles(tko_workItemId: string, tko_files: File[]) {
    if (!tko_files.length) return;
    const tko_results = await Promise.allSettled(tko_files.map(async tko_file => tko_uploadAttachment.mutateAsync({
      workItemId: tko_workItemId,
      filename: tko_file.name,
      contentType: tko_file.type || "application/octet-stream",
      base64: await tko_fileAsBase64(tko_file),
    })));
    const tko_failed = tko_results.filter(tko_result => tko_result.status === "rejected").length;
    if (tko_failed) toast.error(`${tko_failed} file chưa tải lên được. Task vẫn đã tạo; bạn có thể thêm lại từ inspector.`);
    else toast.success(`${tko_files.length} file đã đính kèm.`);
  }

  async function tko_submitCreateDraft(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_selectedProject || !tko_createDraft?.title.trim()) return;
    const tko_draft = tko_createDraft;
    const tko_files = tko_createFiles;
    const tko_estimateText = tko_draft.estimateMinutes.trim();
    const tko_estimate = tko_estimateText ? Number(tko_estimateText) : null;
    if (tko_estimate !== null && (!Number.isInteger(tko_estimate) || tko_estimate < 0)) {
      toast.error("Estimate phải là số phút không âm.");
      return;
    }
    if (tko_files.some(tko_file => !tko_file.size || tko_file.size > 10 * 1024 * 1024)) {
      toast.error("Mỗi file đính kèm phải lớn hơn 0 và không quá 10 MiB.");
      return;
    }
    const tko_optimisticId = `optimistic:${crypto.randomUUID()}`;
    const tko_optimisticItem: TkoBoardItem = {
      id: tko_optimisticId,
      key: "Creating…",
      title: tko_draft.title.trim(),
      priority: tko_draft.priority,
      status: tko_columns.find(tko_column => tko_column.statusId === tko_draft.statusId)?.label ?? tko_draft.status.replace("_", " "),
      statusId: tko_draft.statusId,
      version: 0,
      rank: "zzzzzzzzzzzz",
      detail: tko_estimate ? `${Math.round(tko_estimate / 60)}h estimate` : "Work item",
      assignee: tko_draft.assigneeMemberIds.length ? "ME" : "—",
      dueLabel: tko_draft.dueAt ? tko_draft.dueAt : "No due date",
      optimistic: true,
    };
    const tko_result = await tko_runOptimisticCreate({
      onOptimistic: () => setTkoOptimisticItems(tko_current => tko_addOptimistic(tko_current, tko_optimisticItem)),
      onRollback: () => setTkoOptimisticItems(tko_current => tko_removeOptimistic(tko_current, tko_optimisticId)),
      onReconciled: () => setTkoOptimisticItems(tko_current => tko_removeOptimistic(tko_current, tko_optimisticId)),
      create: () => tko_create.mutateAsync({ projectId: tko_selectedProject.id, title: tko_draft.title.trim(), description: tko_draft.description.trim(), priority: tko_draft.priority, assigneeMemberIds: tko_draft.assigneeMemberIds, dueAt: tko_draft.dueAt ? new Date(`${tko_draft.dueAt}T12:00:00`) : null, estimateMinutes: tko_estimate, checklistItems: tko_draft.checklistItems }),
      shouldMove: tko_created => tko_created.statusId !== tko_draft.statusId,
      move: tko_created => tko_move.mutateAsync({ workItemId: tko_created.id, targetStatusId: tko_draft.statusId, beforeWorkItemId: null, expectedVersion: tko_created.version }),
    });
    if (tko_result.outcome === "create-failed") {
      await tko_refreshBoard();
      toast.error("Không thể tạo task. Board đã được làm mới, hãy thử lại.");
      return;
    }
    if (tko_result.outcome === "move-failed") {
      const tko_created = tko_result.created;
      await tko_uploadDraftFiles(tko_created.id, tko_files);
      tko_cancelCreateComposer();
      await tko_refreshBoard();
      tko_openItem({ id: tko_created.id, key: tko_created.key, title: tko_created.title, priority: tko_created.priority, status: tko_columns.find(tko_column => tko_column.statusId === tko_created.statusId)?.label ?? "To do", statusId: tko_created.statusId, version: tko_created.version, rank: tko_created.rank, detail: tko_created.estimateMinutes ? `${Math.round(tko_created.estimateMinutes / 60)}h estimate` : "Work item", assignee: tko_created.assigneeMemberIds.length ? "ME" : "—", dueLabel: tko_dueLabel(tko_created.dueAt) });
      toast.error("Task đã tạo ở To do nhưng chưa thể đặt vào cột đã chọn. Đã mở task để bạn thử lại.");
      return;
    }
    const tko_finalItem = tko_result.item;
    await tko_uploadDraftFiles(tko_finalItem.id, tko_files);
    tko_cancelCreateComposer();
    await tko_refreshBoard();
    tko_openItem({ id: tko_finalItem.id, key: tko_finalItem.key, title: tko_finalItem.title, priority: tko_finalItem.priority, status: tko_columns.find(tko_column => tko_column.statusId === tko_finalItem.statusId)?.label ?? tko_draft.status.replace("_", " "), statusId: tko_finalItem.statusId, version: tko_finalItem.version, rank: tko_finalItem.rank, detail: tko_finalItem.estimateMinutes ? `${Math.round(tko_finalItem.estimateMinutes / 60)}h estimate` : "Work item", assignee: tko_finalItem.assigneeMemberIds.length ? "ME" : "—", dueLabel: tko_dueLabel(tko_finalItem.dueAt) });
    toast.success("Đã tạo task và mở chi tiết để hoàn thiện.");
  }

  function tko_saveEditor(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_editor || !tko_selectedItem || tko_isPreview) return;
    const tko_expectedVersion = tko_selectedDetail?.item.version ?? tko_selectedItem.version;
    if (!tko_expectedVersion || !tko_editor.title.trim()) {
      toast.error("Task title là bắt buộc.");
      return;
    }
    const tko_estimate = tko_editor.estimateMinutes.trim();
    const tko_parsedEstimate = tko_estimate ? Number(tko_estimate) : null;
    if (tko_parsedEstimate !== null && (!Number.isInteger(tko_parsedEstimate) || tko_parsedEstimate < 0)) {
      toast.error("Estimate phải là số phút không âm.");
      return;
    }
    tko_update.mutate({
      workItemId: tko_editor.workItemId,
      expectedVersion: tko_expectedVersion,
      title: tko_editor.title.trim(),
      description: tko_editor.description.trim(),
      priority: tko_editor.priority,
      assigneeMemberIds: tko_editor.assigneeMemberIds,
      dueAt: tko_editor.dueAt ? new Date(`${tko_editor.dueAt}T12:00:00`) : null,
      estimateMinutes: tko_parsedEstimate,
    });
  }

  return (
    <div className="min-w-0 bg-[#fbfbfe]">
      <header className="border-b border-[#eaecf0] bg-white px-5 py-5 lg:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[21px] font-semibold tracking-[-.035em] text-[#182230]">{tko_projectName}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-medium text-[#067647]"><CheckCircle2 className="h-3 w-3" />On track</span>
              <button aria-label="More project actions" className="grid h-7 w-7 place-items-center rounded-md text-[#98a2b3] hover:bg-[#f9fafb]"><MoreHorizontal className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-[13px] text-[#667085]">Plan delivery, coordinate work and turn conversations into outcomes.</p>
          </div>
          {isAuthenticated ? (
            <Button onClick={() => tko_selectedProject ? tko_openCreateComposer(tko_columns[0]?.statusId, tko_columns[0]?.id ?? "todo") : tko_seed.mutate()} disabled={tko_seed.isPending} className="h-9 rounded-sm bg-[#0c66e4] px-3.5 text-xs font-semibold hover:bg-[#0055cc]"><Plus className="mr-1.5 h-4 w-4" />{tko_selectedProject ? "Create task" : "Set up demo"}</Button>
          ) : <Button onClick={startLogin} className="h-9 rounded-lg bg-[#5b51e8] px-3.5 text-xs font-semibold hover:bg-[#4d43da]">Sign in</Button>}
        </div>
        <nav className="mt-5 flex items-center gap-5 overflow-x-auto border-t border-[#f2f4f7] pt-3 text-[13px] whitespace-nowrap" aria-label="Project views">
	          <button onClick={() => setTkoView("overview")} className={`border-b-2 pb-2 ${tko_view === "overview" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Overview</button>
	          <button onClick={() => setTkoView("board")} className={`border-b-2 pb-2 ${tko_view === "board" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Board</button>
	          <button onClick={() => setTkoView("list")} className={`border-b-2 pb-2 ${tko_view === "list" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Backlog</button>
	          <button onClick={() => setTkoView("timeline")} className={`border-b-2 pb-2 ${tko_view === "timeline" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Timeline</button>
	          <button onClick={() => setTkoView("files")} className={`border-b-2 pb-2 ${tko_view === "files" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Files</button>
        </nav>
      </header>

      <main className="px-5 py-5 lg:px-7">
        {tko_view === "board" && isAuthenticated && tko_selectedProject ? <div className="mb-4 flex justify-end"><button type="button" onClick={() => setTkoColumnsOpen(true)} className="inline-flex h-8 items-center gap-1.5 border border-[#d0d5dd] bg-white px-3 text-xs font-semibold text-[#344054] hover:border-[#0c66e4] hover:bg-[#deebff] hover:text-[#0c66e4]"><Columns3 className="h-3.5 w-3.5" />Manage columns</button></div> : null}
        {tko_columnsOpen && tko_selectedProject ? <aside className="fixed right-4 top-4 z-[66] w-[min(19rem,calc(100vw-2rem))] border border-[#dfe1e6] bg-white p-3 shadow-[0_10px_28px_rgba(9,30,66,.24)]" aria-label="Reorder workflow columns"><div className="mb-2 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">Column order</p><p className="text-xs text-[#344054]">Move columns without losing their rules.</p></div><button type="button" onClick={() => setTkoColumnsOpen(false)} aria-label="Close column tools" className="grid h-7 w-7 place-items-center text-[#667085] hover:bg-[#f1f2f4]"><X className="h-4 w-4" /></button></div><div className="space-y-1">{tko_columns.filter(tko_column => tko_column.statusId).map((tko_column, tko_index, tko_managedColumns) => <div key={tko_column.statusId} className="flex items-center gap-2 border border-[#eaecf0] bg-[#fcfcfd] px-2 py-1.5"><span className={`h-2 w-2 shrink-0 rounded-full ${tko_column.accent}`} /><span className="min-w-0 flex-1 truncate text-xs font-medium text-[#344054]">{tko_column.label}</span><button type="button" aria-label={`Move ${tko_column.label} earlier`} disabled={tko_index === 0 || tko_reorderStatus.isPending} onClick={() => tko_column.statusId && tko_reorderStatus.mutate({ projectId: tko_selectedProject.id, statusId: tko_column.statusId, beforeStatusId: tko_managedColumns[tko_index - 1]?.statusId ?? null })} className="grid h-6 w-6 place-items-center border border-[#d0d5dd] text-[#44546f] hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-35"><ChevronUp className="h-3.5 w-3.5" /></button><button type="button" aria-label={`Move ${tko_column.label} later`} disabled={tko_index === tko_managedColumns.length - 1 || tko_reorderStatus.isPending} onClick={() => tko_column.statusId && tko_reorderStatus.mutate({ projectId: tko_selectedProject.id, statusId: tko_column.statusId, beforeStatusId: tko_managedColumns[tko_index + 2]?.statusId ?? null })} className="grid h-6 w-6 place-items-center border border-[#d0d5dd] text-[#44546f] hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-35"><ChevronDownIcon className="h-3.5 w-3.5" /></button></div>)}</div></aside> : null}
        {tko_isPreview && !tko_authLoading ? <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2.5 text-xs text-[#93370d]"><Sparkles className="h-4 w-4" /><span>Work preview. Sign in to update your tenant-scoped project.</span><button onClick={startLogin} className="ml-auto font-semibold underline">Sign in</button></div> : null}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <label className="flex h-9 w-[min(20rem,70vw)] items-center gap-2 border border-[#dfe1e6] bg-white px-2.5 text-xs text-[#667085] focus-within:border-[#0c66e4] focus-within:ring-1 focus-within:ring-[#0c66e4]"><Search className="h-3.5 w-3.5 shrink-0" /><input aria-label="Search this project" value={tko_projectSearch} onChange={tko_event => setTkoProjectSearch(tko_event.target.value)} placeholder="Search tasks and sprints" className="min-w-0 flex-1 bg-transparent outline-none" />{tko_projectSearch ? <button type="button" onClick={() => setTkoProjectSearch("")} aria-label="Clear project search" className="text-[#667085] hover:text-[#172b4d]"><X className="h-3.5 w-3.5" /></button> : null}</label>
              {tko_projectSearch.trim().length >= 2 ? <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto border border-[#dfe1e6] bg-white py-1 shadow-[0_8px_20px_rgba(9,30,66,.18)]">{tko_projectSearchResults.isLoading ? <p className="px-3 py-2 text-xs text-[#667085]">Searching project…</p> : tko_projectSearchResults.data?.length ? tko_projectSearchResults.data.map(tko_result => <button key={`${tko_result.kind}-${tko_result.id}`} type="button" onClick={() => { if (tko_result.kind === "work_item") { const tko_item = tko_items.find(tko_entry => tko_entry.id === tko_result.id); if (tko_item) setTkoSelectedItem(tko_item); } else { setTkoSelectedSprintId(tko_result.id); setTkoSprintPlannerOpen(true); } setTkoProjectSearch(""); }} className="block w-full border-b border-[#f2f4f7] px-3 py-2 text-left last:border-0 hover:bg-[#deebff]"><span className="block text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">{tko_result.kind === "work_item" ? tko_result.summary : "Sprint"}</span><span className="block truncate text-xs font-semibold text-[#172b4d]">{tko_result.title}</span></button>) : <p className="px-3 py-2 text-xs text-[#667085]">No matching tasks or sprints in this project.</p>}</div> : null}
            </div>
            <button type="button" aria-expanded={tko_sprintPlannerOpen} onClick={() => setTkoSprintPlannerOpen(tko_open => !tko_open)} className="flex h-9 items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 text-xs font-medium text-[#475467] hover:border-[#85b8ff] hover:text-[#0c66e4]"><CalendarDays className="h-3.5 w-3.5" />{tko_selectedSprint ? tko_selectedSprint.name : "Sprint planning"} <ChevronDown className="h-3.5 w-3.5" /></button>
            <div className="relative">
              <button onClick={() => setTkoFilterOpen(!tko_filterOpen)} className="flex h-9 items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 text-xs font-medium text-[#475467]"><ListFilter className="h-3.5 w-3.5" />{tko_filter === "all" ? "Filters" : tko_filterLabel} <ChevronDown className="h-3.5 w-3.5" /></button>
              {tko_filterOpen ? <div className="absolute z-20 mt-1 w-48 border border-[#dfe1e6] bg-white p-1 text-xs shadow-[0_3px_8px_rgba(9,30,66,.18)]"><p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-[#6b778c]">Show tasks</p>{([ ["all", "All tasks"], ["high_priority", "High priority"], ["assigned", "Assigned"], ["unassigned", "Unassigned"] ] as Array<[TkoKanbanFilter, string]>).map(([tko_value, tko_label]) => <button key={tko_value} type="button" aria-pressed={tko_filter === tko_value} onClick={() => { setTkoFilter(tko_value); setTkoFilterOpen(false); }} className={`block w-full px-2 py-2 text-left hover:bg-[#deebff] ${tko_filter === tko_value ? "bg-[#deebff] font-semibold text-[#0c66e4]" : "text-[#172b4d]"}`}>{tko_label}</button>)}</div> : null}
            </div>
            <div className="relative"><button type="button" onClick={() => setTkoGroupOpen(!tko_groupOpen)} className="flex h-9 items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 text-xs font-medium text-[#475467]"><SlidersHorizontal className="h-3.5 w-3.5" />Group: {tko_groupLabel} <ChevronDown className="h-3.5 w-3.5" /></button>{tko_groupOpen ? <div className="absolute z-20 mt-1 w-44 border border-[#dfe1e6] bg-white p-1 text-xs shadow-[0_3px_8px_rgba(9,30,66,.18)]"><p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-[#6b778c]">Group cards</p>{([ ["none", "None"], ["priority", "Priority"], ["assignee", "Assignee"] ] as Array<[TkoKanbanGrouping, string]>).map(([tko_value, tko_label]) => <button key={tko_value} type="button" aria-pressed={tko_grouping === tko_value} onClick={() => { setTkoGrouping(tko_value); setTkoGroupOpen(false); }} className={`block w-full px-2 py-2 text-left hover:bg-[#deebff] ${tko_grouping === tko_value ? "bg-[#deebff] font-semibold text-[#0c66e4]" : "text-[#172b4d]"}`}>{tko_label}</button>)}</div> : null}</div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[#eaecf0] bg-white p-1">
            <button onClick={() => setTkoView("board")} aria-label="Board view" className={`grid h-7 w-7 place-items-center rounded ${tko_view === "board" ? "bg-[#f0efff] text-[#5b51e8]" : "text-[#667085]"}`}><Columns3 className="h-4 w-4" /></button>
            <button onClick={() => setTkoView("list")} aria-label="List view" className={`grid h-7 w-7 place-items-center rounded ${tko_view === "list" ? "bg-[#f0efff] text-[#5b51e8]" : "text-[#667085]"}`}><LayoutList className="h-4 w-4" /></button>
          </div>
        </div>
        {tko_sprintPlannerOpen ? <section aria-label="Sprint planning" className="mb-4 border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,.12)]"><div className="flex items-start justify-between gap-3 border-b border-[#eaecf0] px-4 py-3"><div><h2 className="text-sm font-semibold text-[#172b4d]">Sprint planning</h2><p className="mt-0.5 text-xs text-[#626f86]">Create a timebox, assign selected work, then make an explicit decision for unfinished work.</p></div><button type="button" onClick={() => setTkoSprintPlannerOpen(false)} aria-label="Close sprint planning" className="grid h-7 w-7 place-items-center text-[#626f86] hover:bg-[#f1f2f4]"><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-4 lg:grid-cols-2"><form onSubmit={tko_submitSprint} className="space-y-2 border-b border-[#eaecf0] pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#44546f]">New sprint</p><label className="block text-xs font-medium text-[#344054]">Name<input value={tko_sprintName} onChange={tko_event => setTkoSprintName(tko_event.target.value)} placeholder="Sprint 3 — Delivery" className="mt-1 h-9 w-full border border-[#dfe1e6] px-2.5 text-xs outline-none focus:border-[#0c66e4] focus:ring-1 focus:ring-[#0c66e4]" /></label><label className="block text-xs font-medium text-[#344054]">Goal<textarea value={tko_sprintGoal} onChange={tko_event => setTkoSprintGoal(tko_event.target.value)} placeholder="What outcome should this sprint achieve?" className="mt-1 min-h-16 w-full border border-[#dfe1e6] px-2.5 py-2 text-xs outline-none focus:border-[#0c66e4] focus:ring-1 focus:ring-[#0c66e4]" /></label><div className="grid grid-cols-2 gap-2"><label className="text-xs font-medium text-[#344054]">Start<input type="date" value={tko_sprintStartAt} onChange={tko_event => setTkoSprintStartAt(tko_event.target.value)} className="mt-1 h-9 w-full border border-[#dfe1e6] px-2 text-xs outline-none focus:border-[#0c66e4]" /></label><label className="text-xs font-medium text-[#344054]">End<input type="date" value={tko_sprintEndAt} onChange={tko_event => setTkoSprintEndAt(tko_event.target.value)} className="mt-1 h-9 w-full border border-[#dfe1e6] px-2 text-xs outline-none focus:border-[#0c66e4]" /></label></div><Button type="submit" disabled={tko_isPreview || tko_createSprint.isPending} className="h-8 rounded-sm bg-[#0c66e4] px-3 text-xs font-semibold hover:bg-[#0055cc]">{tko_createSprint.isPending ? "Creating…" : "Create sprint"}</Button></form><div className="space-y-3"><label className="block text-xs font-medium text-[#344054]">Current sprint<select value={tko_selectedSprint?.id ?? ""} onChange={tko_event => setTkoSelectedSprintId(tko_event.target.value)} className="mt-1 h-9 w-full border border-[#dfe1e6] bg-white px-2 text-xs outline-none focus:border-[#0c66e4]"><option value="">Choose a sprint</option>{tko_sprints.map(tko_sprint => <option key={tko_sprint.id} value={tko_sprint.id}>{tko_sprint.name} · {tko_sprint.state}</option>)}</select></label><div className="flex flex-wrap items-center gap-2"><Button type="button" onClick={tko_addSelectionToSprint} disabled={tko_isPreview || !tko_selectedSprint || !tko_selectedBoardItems.length || tko_addItemsToSprint.isPending} className="h-8 rounded-sm bg-[#0055cc] px-3 text-xs font-semibold hover:bg-[#0747a6]">{tko_addItemsToSprint.isPending ? "Adding…" : `Add ${tko_selectedBoardItems.length || "selected"} task${tko_selectedBoardItems.length === 1 ? "" : "s"}`}</Button><span className="text-[11px] text-[#626f86]">Select work using board/backlog checkboxes.</span></div>{tko_selectedSprint ? <div className="border-t border-[#eaecf0] pt-3"><p className="text-xs font-semibold text-[#172b4d]">Complete {tko_selectedSprint.name}</p><div className="mt-2 flex flex-wrap items-center gap-3"><label className="flex items-center gap-1.5 text-xs text-[#344054]"><input type="radio" checked={tko_incompleteDisposition === "backlog"} onChange={() => setTkoIncompleteDisposition("backlog")} className="accent-[#0c66e4]" />Move unfinished to backlog</label><label className="flex items-center gap-1.5 text-xs text-[#344054]"><input type="radio" checked={tko_incompleteDisposition === "next_sprint"} onChange={() => setTkoIncompleteDisposition("next_sprint")} disabled={!tko_carryOverSprints.length} className="accent-[#0c66e4]" />Carry over</label>{tko_incompleteDisposition === "next_sprint" ? <select aria-label="Carry-over target sprint" value={tko_nextSprintId} onChange={tko_event => setTkoNextSprintId(tko_event.target.value)} className="h-8 border border-[#dfe1e6] bg-white px-2 text-xs outline-none focus:border-[#0c66e4]"><option value="">Choose sprint</option>{tko_carryOverSprints.map(tko_sprint => <option key={tko_sprint.id} value={tko_sprint.id}>{tko_sprint.name}</option>)}</select> : null}<button type="button" onClick={tko_finishSelectedSprint} disabled={tko_isPreview || tko_selectedSprint.state === "completed" || tko_completeSprint.isPending} className="ml-auto h-8 border border-[#d92d20] px-3 text-xs font-semibold text-[#b42318] hover:bg-[#fef3f2] disabled:cursor-not-allowed disabled:border-[#d0d5dd] disabled:text-[#98a2b3]">{tko_completeSprint.isPending ? "Completing…" : tko_selectedSprint.state === "completed" ? "Completed" : "Complete sprint"}</button></div></div> : <p className="border-t border-[#eaecf0] pt-3 text-xs text-[#626f86]">Create a sprint, then select work items to add.</p>}</div></div></section> : null}
        {tko_selectedSprint?.state === "planned" ? <div className="mb-4 flex flex-wrap items-center gap-3 border border-[#b9d4ff] bg-[#f0f7ff] px-3 py-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#0747a6]">{tko_selectedSprint.name} is ready to start</p><p className="mt-0.5 text-[11px] text-[#44546f]">Starting a sprint is an explicit project action; only one sprint can be active at a time.</p></div><Button type="button" onClick={() => tko_selectedProject && tko_startSprint.mutate({ projectId: tko_selectedProject.id, sprintId: tko_selectedSprint.id })} disabled={tko_isPreview || tko_startSprint.isPending} className="h-8 rounded-sm bg-[#0055cc] px-3 text-xs font-semibold hover:bg-[#0747a6]">{tko_startSprint.isPending ? "Starting…" : "Start sprint"}</Button></div> : null}
        {tko_selectedItemIds.size ? <div aria-live="polite" className="mb-4 flex flex-wrap items-center gap-2 border border-[#85b8ff] bg-[#deebff] px-3 py-2"><span className="text-xs font-semibold text-[#0747a6]">{tko_selectedItemIds.size} selected</span><button type="button" onClick={tko_toggleVisibleSelection} className="text-xs font-medium text-[#0c66e4] underline underline-offset-2">{tko_allVisibleSelected ? "Clear visible" : "Select visible"}</button><label className="ml-auto flex items-center gap-2 text-xs font-medium text-[#172b4d]">Move to<select aria-label="Target status for selected tasks" value={tko_bulkTargetStatusId} onChange={tko_event => setTkoBulkTargetStatusId(tko_event.target.value)} className="h-8 min-w-32 border border-[#dfe1e6] bg-white px-2 text-xs outline-none focus:border-[#0c66e4]"><option value="">Choose status</option>{tko_columns.map(tko_column => tko_column.statusId ? <option key={tko_column.statusId} value={tko_column.statusId}>{tko_column.label}</option> : null)}</select></label><Button type="button" onClick={tko_moveSelectedItems} disabled={!tko_bulkTargetStatusId || tko_bulkMove.isPending || tko_isPreview} className="h-8 rounded-sm bg-[#0c66e4] px-3 text-xs font-semibold hover:bg-[#0055cc]">{tko_bulkMove.isPending ? "Moving…" : "Move tasks"}</Button><button type="button" onClick={() => setTkoSelectedItemIds(new Set())} className="grid h-7 w-7 place-items-center text-[#44546f] hover:bg-white" aria-label="Clear selected tasks"><X className="h-4 w-4" /></button></div> : <div className="mb-4 flex items-center gap-2"><button type="button" onClick={tko_toggleVisibleSelection} disabled={!tko_selectableItems.length || tko_isPreview} className="text-xs font-medium text-[#44546f] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:text-[#98a2b3]">Select all visible</button><span className="text-[11px] text-[#6b778c]">Use checkboxes to move selected tasks together.</span></div>}

        {tko_selectedItemIds.size ? <div className="-mt-2 mb-3 flex flex-wrap items-center justify-end gap-2 text-xs"><label className="flex items-center gap-2 font-medium text-[#172b4d]">Set priority<select aria-label="Priority for selected tasks" value={tko_bulkPriorityValue} onChange={tko_event => setTkoBulkPriorityValue(tko_event.target.value as TkoPriority | "")} className="h-8 border border-[#dfe1e6] bg-white px-2 text-xs outline-none focus:border-[#0c66e4]"><option value="">Choose priority</option><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><Button type="button" onClick={tko_updateSelectedPriority} disabled={!tko_bulkPriorityValue || tko_bulkPriority.isPending || tko_isPreview} className="h-8 rounded-sm border border-[#0c66e4] bg-white px-3 text-xs font-semibold text-[#0c66e4] hover:bg-[#deebff]">{tko_bulkPriority.isPending ? "Triaging…" : "Apply priority"}</Button></div> : null}

        {tko_view === "overview" ? <section aria-label="Project overview" className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
          ["Completion", `${tko_overview.data?.completionPercent ?? 0}%`, `${tko_overview.data?.completedItems ?? 0} of ${tko_overview.data?.totalItems ?? 0} tasks complete`, "text-[#067647]"],
          ["In progress", String(tko_overview.data?.inProgressItems ?? 0), "Tasks currently in delivery", "text-[#5b51e8]"],
          ["At risk", String(tko_overview.data?.overdueItems ?? 0), "Past their due date", "text-[#b42318]"],
          ["Backlog", String(tko_overview.data?.backlogItems ?? 0), `${tko_overview.data?.unestimatedItems ?? 0} without estimate`, "text-[#344054]"],
        ].map(([tko_label, tko_value, tko_detail, tko_color]) => <article key={tko_label} className="border border-[#dfe1e6] bg-white p-4 shadow-[0_1px_2px_rgba(9,30,66,.08)]"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">{tko_label}</p><p className={`mt-2 text-2xl font-bold ${tko_color}`}>{tko_value}</p><p className="mt-1 text-xs text-[#667085]">{tko_detail}</p></article>)}</div><div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]"><section className="border border-[#dfe1e6] bg-white"><div className="border-b border-[#eaecf0] px-4 py-3"><h2 className="text-sm font-semibold text-[#172b4d]">Workload</h2><p className="mt-0.5 text-xs text-[#667085]">Assigned scope and estimated effort by project member.</p></div><div className="divide-y divide-[#f2f4f7]">{tko_overview.data?.workload.length ? tko_overview.data.workload.map(tko_member => <div key={tko_member.memberId} className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="text-xs font-semibold text-[#344054]">{tko_member.displayName}</p><p className="text-[11px] text-[#667085]">{tko_member.assignedItems} assigned task{tko_member.assignedItems === 1 ? "" : "s"}</p></div><span className="text-xs font-semibold text-[#475467]">{Math.round(tko_member.estimatedMinutes / 60 * 10) / 10}h</span></div>) : <p className="px-4 py-6 text-xs text-[#667085]">No assigned work in this project yet.</p>}</div></section><section className="border border-[#dfe1e6] bg-white p-4"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">Sprint health</p><p className="mt-2 text-sm font-semibold text-[#172b4d]">{tko_overview.data?.activeSprint ? tko_overview.data.activeSprint.name : "No active sprint"}</p><p className="mt-1 text-xs leading-5 text-[#667085]">{tko_overview.data?.activeSprint ? `${tko_overview.data.completedItems} completed of ${tko_overview.data.totalItems} project tasks.` : `${tko_overview.data?.plannedSprintCount ?? 0} planned sprint${(tko_overview.data?.plannedSprintCount ?? 0) === 1 ? "" : "s"} available to start.`}</p><button type="button" onClick={() => { setTkoSprintPlannerOpen(true); setTkoView("board"); }} className="mt-4 text-xs font-semibold text-[#0c66e4] hover:underline">Open sprint planning</button></section></div></section> : null}
	        {tko_view === "timeline" ? <section aria-label="Project timeline" className="border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,.08)]"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eaecf0] px-4 py-3"><div><h2 className="text-sm font-semibold text-[#172b4d]">Timeline</h2><p className="mt-0.5 text-xs text-[#667085]">Plan start and due dates from the same versioned task state used by Board and Backlog.</p></div><span className="border border-[#dfe1e6] bg-[#f7f8fa] px-2 py-1 text-[11px] font-semibold text-[#44546f]">{tko_board.data?.items.filter(tko_item => tko_item.startAt || tko_item.dueAt).length ?? 0} scheduled</span></div><div className="divide-y divide-[#f2f4f7]">{tko_board.data?.items.filter(tko_item => tko_item.startAt || tko_item.dueAt).sort((tko_left, tko_right) => (tko_left.startAt ?? tko_left.dueAt ?? new Date(8640000000000000)).getTime() - (tko_right.startAt ?? tko_right.dueAt ?? new Date(8640000000000000)).getTime()).map(tko_item => <article key={tko_item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(14rem,1fr)_9rem_9rem_auto]"><button type="button" onClick={() => { const tko_card = tko_items.find(tko_entry => tko_entry.id === tko_item.id); if (tko_card) tko_openItem(tko_card); }} className="min-w-0 text-left"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">{tko_item.key}</p><p className="truncate text-xs font-semibold text-[#172b4d]">{tko_item.title}</p></button><label className="text-[10px] font-bold uppercase tracking-[.06em] text-[#667085]">Start<input type="date" value={tko_dateInputValue(tko_item.startAt)} disabled={tko_isPreview || tko_update.isPending} onChange={tko_event => tko_update.mutate({ workItemId: tko_item.id, expectedVersion: tko_item.version, startAt: tko_event.target.value ? new Date(`${tko_event.target.value}T12:00:00`) : null })} className="mt-1 block h-8 w-full border border-[#dfe1e6] px-1.5 text-xs font-normal text-[#344054] outline-none focus:border-[#0c66e4]" /></label><label className="text-[10px] font-bold uppercase tracking-[.06em] text-[#667085]">Due<input type="date" value={tko_dateInputValue(tko_item.dueAt)} disabled={tko_isPreview || tko_update.isPending} onChange={tko_event => tko_update.mutate({ workItemId: tko_item.id, expectedVersion: tko_item.version, dueAt: tko_event.target.value ? new Date(`${tko_event.target.value}T12:00:00`) : null })} className="mt-1 block h-8 w-full border border-[#dfe1e6] px-1.5 text-xs font-normal text-[#344054] outline-none focus:border-[#0c66e4]" /></label><span className="self-end text-[11px] text-[#667085]">{tko_displayWorkflowStatus(tko_item.statusId, tko_board.data?.statuses ?? [], "Unknown")}</span></article>) ?? <p className="px-4 py-8 text-sm text-[#667085]">No scheduled work yet. Add a due date in a task, then plan its start here.</p>}</div></section> : null}
	        {tko_view === "files" ? <section aria-label="Project files" className="border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,.08)]"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eaecf0] px-4 py-3"><div><h2 className="text-sm font-semibold text-[#172b4d]">Files</h2><p className="mt-0.5 text-xs text-[#667085]">Authorized project library of S3 attachments, each kept linked to the source task.</p></div><span className="border border-[#dfe1e6] bg-[#f7f8fa] px-2 py-1 text-[11px] font-semibold text-[#44546f]">{tko_projectFiles.data?.length ?? 0} file{(tko_projectFiles.data?.length ?? 0) === 1 ? "" : "s"}</span></div><div className="divide-y divide-[#f2f4f7]">{tko_projectFiles.isLoading ? <p className="px-4 py-8 text-sm text-[#667085]">Loading authorized project files…</p> : tko_projectFiles.data?.length ? tko_projectFiles.data.map(tko_file => <article key={tko_file.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><Paperclip className="h-4 w-4 text-[#5b51e8]" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#172b4d]">{tko_file.filename}</p><p className="text-[11px] text-[#667085]">{tko_file.workItemKey} · {tko_file.workItemTitle} · {Math.ceil(tko_file.byteSize / 1024)} KB</p></div><span className="text-[11px] text-[#667085]">{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(tko_file.createdAt))}</span><button type="button" onClick={() => setTkoDownloadRequest({ workItemId: tko_file.workItemId, attachmentId: tko_file.id })} className="h-8 border border-[#0c66e4] px-2.5 text-xs font-semibold text-[#0c66e4] hover:bg-[#deebff]">Download</button></article>) : <p className="px-4 py-8 text-sm text-[#667085]">No files are attached to this project yet. Upload an attachment from a task to add it here.</p>}</div></section> : null}
	        {tko_view === "board" ? (
          <div className="overflow-x-auto pb-4"><div className="grid min-w-[900px] grid-flow-col auto-cols-[minmax(280px,1fr)] gap-3">
            {tko_columns.map(tko_column => {
              const tko_columnItems = tko_filteredItems.filter(tko_item => tko_column.statusId ? tko_item.statusId === tko_column.statusId : tko_item.status === tko_column.id).sort((tko_left, tko_right) => (tko_left.tkoOptimisticOrder ?? Number.MAX_SAFE_INTEGER) - (tko_right.tkoOptimisticOrder ?? Number.MAX_SAFE_INTEGER) || (tko_left.rank ?? "").localeCompare(tko_right.rank ?? ""));
              return <section key={`${tko_column.id}-${tko_column.statusId ?? "preview"}`} onDragEnter={() => tko_column.statusId && setTkoDragOverStatusId(tko_column.statusId)} onDragOver={tko_event => { tko_event.preventDefault(); if (tko_column.statusId) setTkoDragOverStatusId(tko_column.statusId); }} onDragLeave={tko_event => { if (tko_event.currentTarget === tko_event.target) setTkoDragOverStatusId(null); }} onDrop={tko_event => tko_dropOnColumn(tko_event, tko_column.statusId)} className={`min-h-[420px] bg-[#f4f5f7] p-2.5 transition-colors duration-150 ${tko_draggedId ? "ring-1 ring-inset ring-[#dfe1e6]" : ""} ${tko_dragOverStatusId === tko_column.statusId ? "bg-[#deebff] ring-2 ring-inset ring-[#0c66e4]" : ""}`}>
                <div className="mb-2.5 flex items-start justify-between gap-2 px-1"><div className="min-w-0"><div className="flex items-center gap-2 text-xs font-semibold text-[#172b4d]"><span className={`h-2 w-2 shrink-0 rounded-full ${tko_column.accent}`} />{tko_column.label}<span className="grid h-5 min-w-5 place-items-center bg-white px-1 text-[10px] text-[#44546f]">{tko_columnItems.length}</span></div>{tko_column.description ? <p className="mt-1 pl-4 text-[10px] leading-4 text-[#667085]">{tko_column.description}</p> : null}</div><button onClick={() => tko_openCreateComposer(tko_column.statusId, tko_column.id)} aria-label={`Add to ${tko_column.label}`} className="grid h-6 w-6 shrink-0 place-items-center text-[#626f86] hover:bg-[#dfe1e6] hover:text-[#0c66e4]"><Plus className="h-4 w-4" /></button></div>
                <div className="space-y-2">
                  {tko_groupKanbanItems(tko_columnItems, tko_grouping).map(tko_group => <div key={tko_group.key} className="space-y-2">{tko_grouping !== "none" ? <p className="border-b border-[#dfe1e6] px-1 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#44546f]">{tko_group.label} <span className="ml-1 font-normal text-[#6b778c]">{tko_group.items.length}</span></p> : null}{tko_group.items.map(tko_item => <TkoKanbanCard key={tko_item.id} tko_item={tko_item} tko_canDrag={!tko_isPreview} tko_isDragging={tko_draggedId === tko_item.id} tko_isSelected={tko_selectedItemIds.has(tko_item.id)} tko_canSelect={!tko_isPreview && !tko_item.optimistic && Boolean(tko_item.version)} tko_onToggleSelection={() => tko_toggleItemSelection(tko_item.id)} tko_onOpen={() => tko_openItem(tko_item)} tko_onDragStart={() => setTkoDraggedId(tko_item.id)} tko_onDragEnd={() => { setTkoDraggedId(null); setTkoDragOverStatusId(null); }} tko_onDrop={tko_event => { tko_event.stopPropagation(); tko_dropOnColumn(tko_event, tko_column.statusId, tko_item.id); }} />)}</div>)}
                  {tko_createDraft && tko_createDraft.statusId === tko_column.statusId && tko_createMode === "quick" ? <TkoKanbanCreateComposer tko_draft={tko_createDraft} tko_columnLabel={tko_column.label} tko_assignees={tko_assignees.data ?? []} tko_isPending={tko_create.isPending || tko_move.isPending} tko_onChange={setTkoCreateDraft} tko_onSubmit={tko_submitCreateDraft} tko_onCancel={tko_cancelCreateComposer} tko_onExpand={() => setTkoCreateMode("panel")} /> : <button type="button" onClick={() => tko_openCreateComposer(tko_column.statusId, tko_column.id)} className="flex w-full items-center gap-2 px-2 py-2 text-xs text-[#626f86] hover:bg-white hover:text-[#0c66e4]"><Plus className="h-3.5 w-3.5" />Add task</button>}
                </div>
              </section>;
            })}
          </div></div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#eaecf0] bg-white"><div className="grid grid-cols-[34px_90px_minmax(260px,1fr)_130px_130px] border-b border-[#eaecf0] bg-[#fcfcfd] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-[#98a2b3]"><label className="flex items-center"><span className="sr-only">Select all visible tasks</span><input type="checkbox" checked={tko_allVisibleSelected} onChange={tko_toggleVisibleSelection} disabled={!tko_selectableItems.length || tko_isPreview} className="h-3.5 w-3.5 accent-[#0c66e4]" /></label><span>Key</span><span>Work item</span><span>Priority</span><span>Status</span></div>{tko_groupKanbanItems(tko_filteredItems, tko_grouping).map(tko_group => <div key={tko_group.key}>{tko_grouping !== "none" ? <div className="border-b border-[#dfe1e6] bg-[#f7f8fa] px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em] text-[#44546f]">{tko_group.label}<span className="ml-1.5 font-normal text-[#667085]">{tko_group.items.length}</span></div> : null}{tko_group.items.map(tko_item => <div key={tko_item.id} className="grid grid-cols-[34px_1fr] items-center border-b border-[#f2f4f7] px-4 py-3 text-left text-xs last:border-b-0 hover:bg-[#fcfcff]"><label className="flex items-center"><span className="sr-only">Select {tko_item.title}</span><input type="checkbox" checked={tko_selectedItemIds.has(tko_item.id)} onChange={() => tko_toggleItemSelection(tko_item.id)} disabled={tko_isPreview || tko_item.optimistic || !tko_item.version} className="h-3.5 w-3.5 accent-[#0c66e4]" /></label><button type="button" onClick={() => tko_openItem(tko_item)} className="grid grid-cols-[90px_minmax(260px,1fr)_130px_130px] items-center text-left"><span className="font-mono text-[#98a2b3]">{tko_item.key}</span><span className="font-semibold text-[#344054]">{tko_item.title}</span><span><TkoPriority priority={tko_item.priority} /></span><span className="capitalize text-[#667085]">{tko_item.status.replace("_", " ")}</span></button></div>)}</div>)}</div>
        )}
      </main>

      {tko_columnsOpen ? <div className="fixed inset-0 z-[64] grid place-items-center bg-[#101828]/45 p-4" role="dialog" aria-modal="true" aria-label="Manage board columns"><div className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-3xl flex-col bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#667085]">Board workflow</p><h2 className="mt-0.5 text-base font-semibold text-[#172b4d]">Columns & rules</h2></div><button type="button" onClick={() => setTkoColumnsOpen(false)} aria-label="Close column manager" className="grid h-8 w-8 place-items-center text-[#667085] hover:bg-[#f1f2f4]"><X className="h-4 w-4" /></button></div><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"><p className="text-xs leading-5 text-[#667085]">Add as many workflow columns as your team needs. A description is shown below each column title as the team rule for moving work.</p><div className="space-y-3">{tko_columns.filter(tko_column => tko_column.statusId).map(tko_column => <form key={tko_column.statusId} onSubmit={tko_event => { tko_event.preventDefault(); const tko_data = new FormData(tko_event.currentTarget); if (!tko_selectedProject || !tko_column.statusId) return; tko_updateStatus.mutate({ projectId: tko_selectedProject.id, statusId: tko_column.statusId, name: String(tko_data.get("name") ?? "").trim(), description: String(tko_data.get("description") ?? "").trim(), category: String(tko_data.get("category")) as TkoCategory, colorToken: String(tko_data.get("colorToken")) as "slate" | "blue" | "purple" | "green" | "amber" | "red" | "teal" | "indigo" | "pink" | "orange" }); }} className="grid gap-2 border border-[#dfe1e6] bg-[#fcfcfd] p-3 sm:grid-cols-[minmax(0,1fr)_120px_110px_auto]"><div className="min-w-0"><input name="name" defaultValue={tko_column.label} maxLength={80} aria-label="Column name" className="h-8 w-full border border-[#d0d5dd] bg-white px-2 text-xs font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4]" /><input name="description" defaultValue={tko_column.description ?? ""} maxLength={1000} aria-label="Column description or rule" placeholder="Rule / definition for this column" className="mt-2 h-8 w-full border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]" /></div><select name="category" defaultValue={tko_column.id} aria-label="Column category" className="h-8 border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054]"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select><select name="colorToken" defaultValue={tko_column.colorToken ?? "blue"} aria-label="Column color" className="h-8 border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054]"><option value="slate">Slate</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option><option value="teal">Teal</option><option value="indigo">Indigo</option><option value="pink">Pink</option><option value="orange">Orange</option></select><Button type="submit" disabled={tko_updateStatus.isPending} className="h-8 rounded-sm bg-white px-3 text-xs font-semibold text-[#0c66e4] ring-1 ring-inset ring-[#0c66e4] hover:bg-[#deebff]">Save</Button></form>)}</div><form onSubmit={tko_event => { tko_event.preventDefault(); if (tko_selectedProject && tko_newColumn.name.trim()) tko_createStatus.mutate({ projectId: tko_selectedProject.id, name: tko_newColumn.name.trim(), description: tko_newColumn.description.trim() || undefined, category: tko_newColumn.category, colorToken: tko_newColumn.colorToken as "slate" | "blue" | "purple" | "green" | "amber" | "red" | "teal" | "indigo" | "pink" | "orange" }); }} className="border-t border-[#dfe1e6] pt-4"><p className="mb-2 text-xs font-semibold text-[#172b4d]">Add workflow column</p><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_110px_auto]"><div><input value={tko_newColumn.name} onChange={tko_event => setTkoNewColumn({ ...tko_newColumn, name: tko_event.target.value })} maxLength={80} placeholder="Column name" aria-label="New column name" className="h-8 w-full border border-[#d0d5dd] px-2 text-xs outline-none focus:border-[#0c66e4]" /><input value={tko_newColumn.description} onChange={tko_event => setTkoNewColumn({ ...tko_newColumn, description: tko_event.target.value })} maxLength={1000} placeholder="Rule / description" aria-label="New column rule or description" className="mt-2 h-8 w-full border border-[#d0d5dd] px-2 text-xs outline-none focus:border-[#0c66e4]" /></div><select value={tko_newColumn.category} onChange={tko_event => setTkoNewColumn({ ...tko_newColumn, category: tko_event.target.value as TkoCategory })} aria-label="New column category" className="h-8 border border-[#d0d5dd] bg-white px-2 text-xs"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select><select value={tko_newColumn.colorToken} onChange={tko_event => setTkoNewColumn({ ...tko_newColumn, colorToken: tko_event.target.value })} aria-label="New column color" className="h-8 border border-[#d0d5dd] bg-white px-2 text-xs"><option value="slate">Slate</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option><option value="teal">Teal</option><option value="indigo">Indigo</option><option value="pink">Pink</option><option value="orange">Orange</option></select><Button type="submit" disabled={!tko_newColumn.name.trim() || tko_createStatus.isPending} className="h-8 rounded-sm bg-[#0c66e4] px-3 text-xs font-semibold hover:bg-[#0055cc]">{tko_createStatus.isPending ? "Adding…" : "Add column"}</Button></div></form></div></div></div> : null}
      {tko_createDraft && tko_createMode === "panel" ? <div className="fixed inset-0 z-[65] flex justify-end bg-[#101828]/20" role="dialog" aria-modal="true" aria-label="Detailed task composer"><aside className="flex h-full w-full max-w-[540px] flex-col border-l border-[#eaecf0] bg-white shadow-[-16px_0_38px_rgba(16,24,40,.15)]"><TkoRichTaskComposer tko_draft={tko_createDraft} tko_assignees={tko_assignees.data ?? []} tko_files={tko_createFiles} tko_mode="panel" tko_isPending={tko_create.isPending || tko_move.isPending || tko_uploadAttachment.isPending} tko_onChange={setTkoCreateDraft} tko_onFilesChange={setTkoCreateFiles} tko_onMode={setTkoCreateMode} tko_onSubmit={tko_submitCreateDraft} tko_onClose={tko_cancelCreateComposer} /></aside></div> : null}
      {tko_createDraft && tko_createMode === "fullscreen" ? <div className="fixed inset-0 z-[70] flex bg-[#101828]/45 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Full-screen task composer"><div className="mx-auto flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl"><TkoRichTaskComposer tko_draft={tko_createDraft} tko_assignees={tko_assignees.data ?? []} tko_files={tko_createFiles} tko_mode="fullscreen" tko_isPending={tko_create.isPending || tko_move.isPending || tko_uploadAttachment.isPending} tko_onChange={setTkoCreateDraft} tko_onFilesChange={setTkoCreateFiles} tko_onMode={setTkoCreateMode} tko_onSubmit={tko_submitCreateDraft} tko_onClose={tko_cancelCreateComposer} /></div></div> : null}

      {tko_selectedItem ? <div className="fixed inset-0 z-[60] flex justify-end bg-[#101828]/20" role="dialog" aria-modal="true" aria-label="Work item details"><aside className="h-full w-full max-w-[460px] overflow-y-auto border-l border-[#eaecf0] bg-white shadow-[-16px_0_38px_rgba(16,24,40,.15)]"><div className="border-b border-[#eaecf0] px-5 py-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">{tko_selectedItem.key}</span><button onClick={tko_closeItem} aria-label="Close inspector" className="grid h-8 w-8 place-items-center rounded-md text-[#667085] hover:bg-[#f9fafb]"><X className="h-4 w-4" /></button></div><div className="mt-3 flex items-center gap-2"><TkoPriority priority={tko_selectedDetail?.item.priority ?? tko_selectedItem.priority} /><span className="flex items-center gap-1 rounded-md border border-[#d0d5dd] px-2 py-1 text-[11px] font-medium text-[#5b51e8]"><CircleDot className="h-3 w-3" />{tko_selectedItem.status.replace("_", " ")}</span></div></div><div className="space-y-6 p-5">
        {tko_editor ? <form onSubmit={tko_saveEditor} className="space-y-4"><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-title">Summary<input id="work-title" value={tko_editor.title} disabled={tko_isPreview} onChange={tko_event => setTkoEditor({ ...tko_editor, title: tko_event.target.value })} className="mt-1.5 block h-10 w-full rounded-lg border border-[#d0d5dd] px-3 text-sm font-semibold text-[#182230] outline-none focus:border-[#5b51e8] focus:ring-2 focus:ring-[#e7e5ff] disabled:bg-[#f9fafb]" /></label><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-description">Description<textarea id="work-description" value={tko_editor.description} disabled={tko_isPreview} onChange={tko_event => setTkoEditor({ ...tko_editor, description: tko_event.target.value })} className="mt-1.5 block min-h-24 w-full rounded-lg border border-[#d0d5dd] p-3 text-xs leading-5 text-[#344054] outline-none focus:border-[#5b51e8] focus:ring-2 focus:ring-[#e7e5ff] disabled:bg-[#f9fafb]" placeholder="Add delivery context, decisions or acceptance notes…" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Priority<select disabled={tko_isPreview} value={tko_editor.priority} onChange={tko_event => setTkoEditor({ ...tko_editor, priority: tko_event.target.value as TkoPriority })} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-xs font-medium text-[#344054] outline-none focus:border-[#5b51e8] disabled:bg-[#f9fafb]"><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Due date<input type="date" disabled={tko_isPreview} value={tko_editor.dueAt} onChange={tko_event => setTkoEditor({ ...tko_editor, dueAt: tko_event.target.value })} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054] outline-none focus:border-[#5b51e8] disabled:bg-[#f9fafb]" /></label></div><fieldset className="block"><legend className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Assignees</legend><div className="mt-1.5 max-h-28 overflow-y-auto rounded-lg border border-[#d0d5dd] bg-white p-1"><label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[#344054] hover:bg-[#f4f5f7]"><input type="checkbox" disabled={tko_isPreview} checked={tko_editor.assigneeMemberIds.length === 0} onChange={() => setTkoEditor({ ...tko_editor, assigneeMemberIds: [] })} className="accent-[#0c66e4]" />Unassigned</label>{tko_assignees.data?.map(tko_assignee => <label key={tko_assignee.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[#344054] hover:bg-[#f4f5f7]"><input type="checkbox" disabled={tko_isPreview} checked={tko_editor.assigneeMemberIds.includes(tko_assignee.id)} onChange={tko_event => setTkoEditor({ ...tko_editor, assigneeMemberIds: tko_event.target.checked ? [...tko_editor.assigneeMemberIds, tko_assignee.id] : tko_editor.assigneeMemberIds.filter(tko_id => tko_id !== tko_assignee.id) })} className="accent-[#0c66e4]" />{tko_assignee.displayName}<span className="text-[#98a2b3]">{tko_assignee.role}</span></label>) ?? <p className="px-2 py-1.5 text-xs text-[#98a2b3]">Loading workspace members…</p>}</div></fieldset><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-estimate">Estimate (minutes)<input id="work-estimate" type="number" min="0" step="1" disabled={tko_isPreview} value={tko_editor.estimateMinutes} onChange={tko_event => setTkoEditor({ ...tko_editor, estimateMinutes: tko_event.target.value })} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] px-2 text-xs text-[#344054] outline-none focus:border-[#5b51e8] disabled:bg-[#f9fafb]" placeholder="No estimate" /></label><div className="flex justify-end border-b border-[#f2f4f7] pb-5"><Button type="submit" disabled={tko_isPreview || tko_update.isPending || !tko_editor.title.trim()} className="h-8 rounded-lg bg-[#5b51e8] px-3 text-xs hover:bg-[#4d43da]"><Save className="mr-1.5 h-3.5 w-3.5" />{tko_update.isPending ? "Saving…" : "Save changes"}</Button></div></form> : <div className="space-y-2"><div className="h-6 w-3/4 animate-pulse rounded bg-[#f2f4f7]" /><div className="h-16 animate-pulse rounded bg-[#f9fafb]" /></div>}
        <section className="space-y-3 text-xs"><div className="flex items-center justify-between"><span className="text-[#667085]">Assignee</span><span className="font-medium text-[#344054]">{tko_selectedItem.assignee === "—" ? "Unassigned" : "Tasko member"}</span></div><label className="block text-[#667085]">Status<select aria-label="Move work item to status" disabled={tko_isPreview || tko_move.isPending} value={tko_selectedDetail?.item.statusId ?? tko_selectedItem.statusId ?? tko_selectedItem.status} onChange={tko_event => tko_requestMove(tko_selectedItem, tko_event.target.value)} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-xs font-medium text-[#344054] focus:border-[#5b51e8] focus:outline-none">{tko_columns.map(tko_column => <option key={tko_column.statusId ?? tko_column.id} value={tko_column.statusId ?? tko_column.id}>{tko_column.label}</option>)}</select></label></section>
        <section className="border-t border-[#f2f4f7] pt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Activity</p>{tko_selectedDetail?.history.length ? <div className="space-y-3">{tko_selectedDetail.history.slice().reverse().map(tko_entry => <div key={tko_entry.id} className="border-l-2 border-[#d9d6fe] pl-3 text-xs"><p className="font-medium text-[#344054]">{tko_entry.field.replace("_", " ")} updated</p><p className="mt-0.5 text-[#98a2b3]">Tenant-scoped activity</p></div>)}</div> : <p className="text-xs text-[#98a2b3]">Open a live item to inspect history.</p>}</section>
        <section className="border-t border-[#f2f4f7] pt-5" aria-label="Dependencies"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Dependencies</p><span className="text-[10px] text-[#98a2b3]">{tko_selectedDetail?.dependencies.length ?? 0} linked</span></div>{tko_selectedDetail?.dependencies.length ? <ul className="mt-3 space-y-2">{tko_selectedDetail.dependencies.map(tko_relation => { const tko_isSource = tko_relation.sourceWorkItemId === tko_selectedDetail.item.id; const tko_relatedItemId = tko_isSource ? tko_relation.targetWorkItemId : tko_relation.sourceWorkItemId; const tko_relatedItem = tko_workItemById.get(tko_relatedItemId); const tko_relationLabel = tko_isSource ? tko_relation.relationType.replaceAll("_", " ") : tko_relation.relationType === "blocks" ? "blocked by" : tko_relation.relationType === "blocked_by" ? "blocks" : tko_relation.relationType === "duplicates" ? "duplicated by" : tko_relation.relationType === "duplicated_by" ? "duplicates" : "relates to"; return <li key={tko_relation.id} className="flex items-center gap-2 border border-[#e4e7ec] bg-[#fcfcfd] px-2.5 py-2"><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-wide text-[#7c73e6]">{tko_relationLabel}</span><span className="mt-0.5 block truncate text-xs font-medium text-[#344054]">{tko_relatedItem ? `${tko_relatedItem.key} · ${tko_relatedItem.title}` : `Work item ${tko_relatedItemId.slice(0, 8)}`}</span></span>{!tko_isPreview ? <button type="button" onClick={() => tko_removeDependency.mutate({ workItemId: tko_selectedDetail.item.id, relationId: tko_relation.id })} disabled={tko_removeDependency.isPending} className="h-7 border border-[#d0d5dd] px-2 text-[10px] font-semibold text-[#b42318] hover:bg-[#fef3f2] disabled:cursor-wait disabled:opacity-60">Remove</button> : null}</li>; })}</ul> : <p className="mt-3 text-xs text-[#98a2b3]">No linked work items yet.</p>}{!tko_isPreview ? <form onSubmit={tko_submitDependency} className="mt-3 grid grid-cols-[minmax(0,1fr)_116px_auto] gap-2"><label className="sr-only" htmlFor="dependency-target">Work item to link</label><select id="dependency-target" value={tko_dependencyTargetId} onChange={tko_event => setTkoDependencyTargetId(tko_event.target.value)} disabled={tko_addDependency.isPending || !tko_selectedDetail} className="h-8 min-w-0 border border-[#d0d5dd] bg-white px-2 text-[11px] text-[#344054] outline-none focus:border-[#0c66e4]"><option value="unselected">Choose work item…</option>{tko_dependencyCandidates.map(tko_item => <option key={tko_item.id} value={tko_item.id}>{tko_item.key} · {tko_item.title}</option>)}</select><label className="sr-only" htmlFor="dependency-relation">Relation type</label><select id="dependency-relation" value={tko_dependencyRelationType} onChange={tko_event => setTkoDependencyRelationType(tko_event.target.value as typeof tko_dependencyRelationType)} disabled={tko_addDependency.isPending || !tko_selectedDetail} className="h-8 border border-[#d0d5dd] bg-white px-2 text-[11px] text-[#344054] outline-none focus:border-[#0c66e4]"><option value="blocks">blocks</option><option value="blocked_by">blocked by</option><option value="relates_to">relates to</option><option value="duplicates">duplicates</option><option value="duplicated_by">duplicated by</option></select><Button type="submit" disabled={tko_addDependency.isPending || !tko_selectedDetail || tko_dependencyTargetId === "unselected"} className="h-8 rounded-sm bg-[#0c66e4] px-2.5 text-[11px] font-semibold hover:bg-[#0055cc]">{tko_addDependency.isPending ? "Linking…" : "Link"}</Button></form> : null}</section>
        {!tko_isPreview ? <section className="border-t border-[#f2f4f7] pt-5"><label className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-comment">Add comment</label><textarea id="work-comment" value={tko_commentDraft} onChange={tko_event => setTkoCommentDraft(tko_event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-[#d0d5dd] p-3 text-xs outline-none focus:border-[#5b51e8] focus:ring-2 focus:ring-[#e7e5ff]" placeholder="Add a decision, context or handoff…" /><Button disabled={!tko_commentDraft.trim() || tko_comment.isPending || !tko_selectedDetail} onClick={() => tko_selectedDetail && tko_comment.mutate({ workItemId: tko_selectedDetail.item.id, body: tko_commentDraft.trim() })} className="mt-2 h-8 rounded-lg bg-[#5b51e8] px-3 text-xs hover:bg-[#4d43da]"><Send className="mr-1.5 h-3.5 w-3.5" />Add comment</Button></section> : null}
      </div></aside></div> : null}
    </div>
  );
}
