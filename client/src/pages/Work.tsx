import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Columns3,
  Flag,
  FolderKanban,
  LayoutList,
  ListFilter,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type TkoPreviewItem = {
  id: string;
  key: string;
  title: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  status: "todo" | "in_progress" | "done";
  detail: string;
  assignee: string;
  dueLabel: string;
};

const tko_previewItems: TkoPreviewItem[] = [
  { id: "preview-1", key: "TASKO-12", title: "Confirm workspace hierarchy", priority: "urgent", status: "todo", detail: "Architecture", assignee: "TL", dueLabel: "May 23" },
  { id: "preview-2", key: "TASKO-18", title: "Ship project board", priority: "high", status: "in_progress", detail: "Product", assignee: "AN", dueLabel: "May 15" },
  { id: "preview-3", key: "TASKO-22", title: "Verify tenant-scoped events", priority: "high", status: "in_progress", detail: "Platform", assignee: "MT", dueLabel: "May 16" },
  { id: "preview-4", key: "TASKO-27", title: "Define sprint review ritual", priority: "medium", status: "done", detail: "Planning", assignee: "TL", dueLabel: "May 12" },
];

const tko_columns = [
  { id: "todo", label: "To do", accent: "bg-[#ef9b3a]" },
  { id: "in_progress", label: "In progress", accent: "bg-[#5b51e8]" },
  { id: "done", label: "Done", accent: "bg-[#12b76a]" },
] as const;

function tko_statusFor(tko_category: string): TkoPreviewItem["status"] {
  return tko_category === "in_progress" ? "in_progress" : tko_category === "done" ? "done" : "todo";
}

function tko_dueLabel(tko_dueAt: Date | null | undefined) {
  if (!tko_dueAt) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(tko_dueAt));
}

function TkoPriority({ priority, compact = false }: { priority: TkoPreviewItem["priority"]; compact?: boolean }) {
  if (priority === "none") return null;
  const tko_color = priority === "urgent" ? "border-[#fecdca] bg-[#fef3f2] text-[#d92d20]" : priority === "high" ? "border-[#fedf89] bg-[#fffaeb] text-[#b54708]" : priority === "medium" ? "border-[#d9d6fe] bg-[#f4f3ff] text-[#5b51e8]" : "border-[#abefc6] bg-[#ecfdf3] text-[#067647]";
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tko_color}`}><Flag className="h-2.5 w-2.5" />{compact ? priority.slice(0, 1) : priority}</span>;
}

export default function Work() {
  const { isAuthenticated, loading: tko_authLoading } = useAuth();
  const [tko_view, setTkoView] = useState<"board" | "list">("board");
  const [tko_selectedItem, setTkoSelectedItem] = useState<TkoPreviewItem | null>(null);
  const [tko_commentDraft, setTkoCommentDraft] = useState("");
  const [tko_filterOpen, setTkoFilterOpen] = useState(false);
  const tko_utils = trpc.useUtils();
  const tko_projects = trpc.work.projects.useQuery(undefined, { enabled: isAuthenticated });
  const tko_selectedProject = tko_projects.data?.[0];
  const tko_board = trpc.work.board.useQuery({ projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(tko_selectedProject) });
  const tko_seed = trpc.work.seedDemo.useMutation({ onSuccess: async () => { await tko_utils.work.projects.invalidate(); } });
  const tko_itemDetails = trpc.work.item.useQuery({ workItemId: tko_selectedItem?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(tko_selectedItem && isAuthenticated && tko_selectedProject) });
  const tko_transition = trpc.work.transitionItem.useMutation({ onSuccess: async () => { await Promise.all([tko_utils.work.board.invalidate(), tko_utils.work.item.invalidate()]); toast.success("Workflow đã được cập nhật."); } });
  const tko_comment = trpc.work.createComment.useMutation({ onSuccess: async () => { setTkoCommentDraft(""); await tko_utils.work.item.invalidate(); toast.success("Đã thêm bình luận."); } });

  const tko_items = useMemo<TkoPreviewItem[]>(() => {
    if (!tko_board.data) return tko_previewItems;
    const tko_statusById = new Map(tko_board.data.statuses.map(tko_status => [tko_status.id, tko_status.category]));
    return tko_board.data.items.map(tko_item => ({
      id: tko_item.id,
      key: tko_item.key,
      title: tko_item.title,
      priority: tko_item.priority,
      status: tko_statusFor(tko_statusById.get(tko_item.statusId) ?? "todo"),
      detail: tko_item.estimateMinutes ? `${Math.round(tko_item.estimateMinutes / 60)}h estimate` : "Work item",
      assignee: tko_item.assigneeMemberIds.length ? "ME" : "—",
      dueLabel: tko_dueLabel(tko_item.dueAt),
    }));
  }, [tko_board.data]);

  const tko_projectName = tko_selectedProject?.name ?? "Q2 Renewal Implementation";
  const tko_isPreview = !isAuthenticated || !tko_selectedProject;
  const tko_selectedDetail = tko_itemDetails.data;
  const tko_nextStatus = useMemo(() => {
    if (!tko_selectedDetail || !tko_board.data) return null;
    const tko_currentIndex = tko_board.data.statuses.findIndex(tko_status => tko_status.id === tko_selectedDetail.item.statusId);
    return tko_board.data.statuses[tko_currentIndex + 1] ?? null;
  }, [tko_board.data, tko_selectedDetail]);

  function tko_openItem(tko_item: TkoPreviewItem) {
    setTkoSelectedItem(tko_item);
    setTkoCommentDraft("");
  }

  return (
    <div className="min-w-0 bg-[#fbfbfe]">
      <div className="border-b border-[#eaecf0] bg-white px-5 py-5 lg:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><h1 className="text-[21px] font-semibold tracking-[-.035em] text-[#182230]">{tko_projectName}</h1><span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-medium text-[#067647]"><CheckCircle2 className="h-3 w-3" />On track</span><button aria-label="More project actions" className="grid h-7 w-7 place-items-center rounded-md text-[#98a2b3] hover:bg-[#f9fafb]"><MoreHorizontal className="h-4 w-4" /></button></div><p className="mt-1 text-[13px] text-[#667085]">Plan delivery, coordinate work and turn conversations into outcomes.</p></div>
          <div className="flex items-center gap-2"><div className="hidden -space-x-2 sm:flex">{["AM", "PS", "RK"].map(tko_member => <span key={tko_member} className="grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-[#e7e5ff] text-[9px] font-bold text-[#5146d9]">{tko_member}</span>)}</div>{isAuthenticated ? <Button onClick={() => tko_selectedProject ? toast("Chọn một cột để thêm work item trong workflow tiếp theo.") : tko_seed.mutate()} disabled={tko_seed.isPending} className="h-9 rounded-lg bg-[#5b51e8] px-3.5 text-xs font-semibold hover:bg-[#4d43da]"><Plus className="mr-1.5 h-4 w-4" />{tko_selectedProject ? "Create task" : "Set up demo"}</Button> : <Button onClick={startLogin} className="h-9 rounded-lg bg-[#5b51e8] px-3.5 text-xs font-semibold hover:bg-[#4d43da]">Sign in</Button>}</div>
        </div>
        <div className="mt-5 flex items-center gap-5 overflow-x-auto border-t border-[#f2f4f7] pt-3 text-[13px] whitespace-nowrap"><button className="text-[#667085]">Overview</button><button onClick={() => setTkoView("board")} className={`border-b-2 pb-2 ${tko_view === "board" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Board</button><button onClick={() => setTkoView("list")} className={`border-b-2 pb-2 ${tko_view === "list" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Backlog</button><button className="text-[#667085]">Timeline</button><button className="text-[#667085]">Files</button></div>
      </div>
      <section className="px-5 py-5 lg:px-7">
        {tko_isPreview && !tko_authLoading ? <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2.5 text-xs text-[#93370d]"><Sparkles className="h-4 w-4" /><span>Work Alpha preview. Sign in to load your tenant-scoped project and create work.</span><button onClick={startLogin} className="ml-auto font-semibold underline">Sign in</button></div> : null}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><button className="flex h-9 items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 text-xs font-medium text-[#475467]"><CalendarDays className="h-3.5 w-3.5" />Sprint 2: May 6 – May 19 <ChevronDown className="h-3.5 w-3.5" /></button><div className="relative"><button onClick={() => setTkoFilterOpen(!tko_filterOpen)} className="flex h-9 items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 text-xs font-medium text-[#475467]"><ListFilter className="h-3.5 w-3.5" />Filters <ChevronDown className="h-3.5 w-3.5" /></button>{tko_filterOpen ? <div className="absolute z-20 mt-1 w-48 rounded-lg border border-[#eaecf0] bg-white p-1.5 text-xs shadow-lg"><button className="block w-full rounded px-2 py-2 text-left hover:bg-[#f4f3ff]">Assigned to me</button><button className="block w-full rounded px-2 py-2 text-left hover:bg-[#f4f3ff]">Due this sprint</button></div> : null}</div><button className="flex h-9 items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 text-xs font-medium text-[#475467]"><SlidersHorizontal className="h-3.5 w-3.5" />Group: None <ChevronDown className="h-3.5 w-3.5" /></button></div><div className="flex items-center gap-1 rounded-lg border border-[#eaecf0] bg-white p-1"><button onClick={() => setTkoView("board")} aria-label="Board view" className={`grid h-7 w-7 place-items-center rounded ${tko_view === "board" ? "bg-[#f0efff] text-[#5b51e8]" : "text-[#667085]"}`}><Columns3 className="h-4 w-4" /></button><button onClick={() => setTkoView("list")} aria-label="List view" className={`grid h-7 w-7 place-items-center rounded ${tko_view === "list" ? "bg-[#f0efff] text-[#5b51e8]" : "text-[#667085]"}`}><LayoutList className="h-4 w-4" /></button></div></div>
        {tko_view === "board" ? <div className="overflow-x-auto pb-4"><div className="grid min-w-[900px] grid-cols-3 gap-3">{tko_columns.map(tko_column => { const tko_columnItems = tko_items.filter(tko_item => tko_item.status === tko_column.id); return <section key={tko_column.id} className="rounded-xl bg-[#f8f8fc] p-2.5"><div className="mb-2.5 flex items-center justify-between px-1"><div className="flex items-center gap-2 text-xs font-semibold text-[#344054]"><span className={`h-2 w-2 rounded-full ${tko_column.accent}`} />{tko_column.label}<span className="grid h-5 min-w-5 place-items-center rounded bg-white px-1 text-[10px] text-[#667085]">{tko_columnItems.length}</span></div><button aria-label={`Add to ${tko_column.label}`} className="text-[#98a2b3] hover:text-[#5b51e8]"><Plus className="h-4 w-4" /></button></div><div className="space-y-2">{tko_columnItems.map(tko_item => <button type="button" key={tko_item.id} onClick={() => tko_openItem(tko_item)} className="block w-full rounded-lg border border-[#eaecf0] bg-white p-3 text-left shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:-translate-y-px hover:border-[#c7c3ff] hover:shadow-[0_7px_18px_rgba(91,81,232,.09)]"><div className="flex items-start justify-between gap-2"><span className="font-mono text-[10px] text-[#98a2b3]">{tko_item.key}</span><TkoPriority priority={tko_item.priority} compact /></div><p className="mt-2 text-[13px] font-semibold leading-5 text-[#344054]">{tko_item.title}</p><div className="mt-3 flex items-center justify-between text-[11px] text-[#667085]"><span className="flex items-center gap-1"><CalendarDays className="h-3 w-3 text-[#98a2b3]" />{tko_item.dueLabel}</span><span className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#e7e5ff] text-[8px] font-bold text-[#5146d9]">{tko_item.assignee}</span><span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />0</span></span></div><p className="mt-2 flex items-center gap-1 text-[10px] text-[#5b51e8]"><FolderKanban className="h-3 w-3" />{tko_item.detail}</p></button>)}<button type="button" onClick={() => toast("Quick add will be available in the next Work slice.")} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-[#667085] hover:bg-white hover:text-[#5b51e8]"><Plus className="h-3.5 w-3.5" />Add task</button></div></section>; })}</div></div> : <div className="overflow-hidden rounded-xl border border-[#eaecf0] bg-white"><div className="grid grid-cols-[90px_minmax(260px,1fr)_130px_130px] border-b border-[#eaecf0] bg-[#fcfcfd] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-[#98a2b3]"><span>Key</span><span>Work item</span><span>Priority</span><span>Status</span></div>{tko_items.map(tko_item => <button type="button" key={tko_item.id} onClick={() => tko_openItem(tko_item)} className="grid w-full grid-cols-[90px_minmax(260px,1fr)_130px_130px] items-center border-b border-[#f2f4f7] px-4 py-3 text-left text-xs last:border-b-0 hover:bg-[#fcfcff]"><span className="font-mono text-[#98a2b3]">{tko_item.key}</span><span className="font-semibold text-[#344054]">{tko_item.title}</span><span><TkoPriority priority={tko_item.priority} /></span><span className="capitalize text-[#667085]">{tko_item.status.replace("_", " ")}</span></button>)}</div>}
      </section>
      {tko_selectedItem ? <div className="fixed inset-0 z-[60] flex justify-end bg-[#101828]/20" role="dialog" aria-modal="true" aria-label="Work item details"><aside className="h-full w-full max-w-[420px] overflow-y-auto border-l border-[#eaecf0] bg-white shadow-[-16px_0_38px_rgba(16,24,40,.15)]"><div className="border-b border-[#eaecf0] px-5 py-5"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Task</span><button onClick={() => setTkoSelectedItem(null)} aria-label="Close inspector" className="grid h-8 w-8 place-items-center rounded-md text-[#667085] hover:bg-[#f9fafb]"><X className="h-4 w-4" /></button></div><div className="mt-4 flex items-center gap-2"><TkoPriority priority={tko_selectedItem.priority} /><button className="flex items-center gap-1 rounded-md border border-[#d0d5dd] px-2 py-1 text-[11px] font-medium text-[#5b51e8]"><CircleDot className="h-3 w-3" />{tko_selectedItem.status.replace("_", " ")}</button></div><h2 className="mt-3 text-xl font-semibold tracking-[-.03em] text-[#182230]">{tko_selectedDetail?.item.title ?? tko_selectedItem.title}</h2><p className="mt-2 text-[13px] leading-5 text-[#667085]">{tko_selectedDetail?.item.description || "Keep the context, decisions and delivery notes attached to this work item."}</p></div><div className="space-y-6 p-5"><section className="space-y-3 text-xs"><div className="flex items-center justify-between"><span className="text-[#667085]">Assignee</span><span className="flex items-center gap-2 font-medium text-[#344054]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#e7e5ff] text-[9px] font-bold text-[#5146d9]">{tko_selectedItem.assignee}</span>Tasko member</span></div><div className="flex items-center justify-between"><span className="text-[#667085]">Due date</span><span className="flex items-center gap-1.5 font-medium text-[#344054]"><CalendarDays className="h-3.5 w-3.5 text-[#98a2b3]" />{tko_selectedItem.dueLabel}</span></div><div className="flex items-center justify-between"><span className="text-[#667085]">Project</span><span className="flex items-center gap-1.5 font-medium text-[#5b51e8]"><FolderKanban className="h-3.5 w-3.5" />{tko_projectName}</span></div></section>{tko_nextStatus ? <Button disabled={tko_transition.isPending} onClick={() => tko_transition.mutate({ workItemId: tko_selectedDetail!.item.id, targetStatusId: tko_nextStatus.id, expectedVersion: tko_selectedDetail!.item.version })} className="h-9 w-full rounded-lg bg-[#5b51e8] text-xs font-semibold hover:bg-[#4d43da]">Move to {tko_nextStatus.name}</Button> : null}<section className="border-t border-[#f2f4f7] pt-5"><div className="mb-3 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Linked</p><button className="text-[11px] font-medium text-[#5b51e8]">Configure</button></div><Link href="/crm" className="flex items-center justify-between rounded-lg border border-[#eaecf0] p-3 text-xs hover:border-[#c7c3ff]"><span className="flex items-center gap-2 font-medium text-[#344054]"><span className="grid h-6 w-6 place-items-center rounded bg-[#ecfdf3] text-[#067647]">$</span>Deal context</span><ChevronDown className="h-3.5 w-3.5 -rotate-90 text-[#98a2b3]" /></Link><Link href="/chat" className="mt-2 flex items-center justify-between rounded-lg border border-[#eaecf0] p-3 text-xs hover:border-[#c7c3ff]"><span className="flex items-center gap-2 font-medium text-[#344054]"><span className="grid h-6 w-6 place-items-center rounded bg-[#f4f3ff] text-[#5b51e8]">#</span>Conversation</span><ChevronDown className="h-3.5 w-3.5 -rotate-90 text-[#98a2b3]" /></Link></section><section className="border-t border-[#f2f4f7] pt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Activity</p>{tko_selectedDetail?.history.length ? <div className="space-y-3">{tko_selectedDetail.history.slice().reverse().map(tko_entry => <div key={tko_entry.id} className="border-l-2 border-[#d9d6fe] pl-3 text-xs"><p className="font-medium text-[#344054]">{tko_entry.field.replace("_", " ")} updated</p><p className="mt-0.5 text-[#98a2b3]">Tenant-scoped activity</p></div>)}</div> : <p className="text-xs text-[#98a2b3]">Open a live item to inspect history.</p>}</section>{!tko_isPreview ? <section className="border-t border-[#f2f4f7] pt-5"><label className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Add comment</label><textarea value={tko_commentDraft} onChange={tko_event => setTkoCommentDraft(tko_event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-[#d0d5dd] p-3 text-xs outline-none focus:border-[#5b51e8] focus:ring-2 focus:ring-[#e7e5ff]" placeholder="Add a decision, context or handoff…" /><Button disabled={!tko_commentDraft.trim() || tko_comment.isPending} onClick={() => tko_comment.mutate({ workItemId: tko_selectedDetail!.item.id, body: tko_commentDraft.trim() })} className="mt-2 h-8 rounded-lg bg-[#5b51e8] px-3 text-xs hover:bg-[#4d43da]"><Send className="mr-1.5 h-3.5 w-3.5" />Add comment</Button></section> : null}</div></aside></div> : null}
    </div>
  );
}
