import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { startLogin } from "@/const";
import { tko_filterKanbanItems, tko_groupKanbanItems, type TkoKanbanFilter, type TkoKanbanGrouping } from "@/lib/kanban-board-controls";
import { tko_addOptimistic, tko_removeOptimistic, tko_runOptimisticCreate } from "@/lib/kanban-optimistic";
import { trpc } from "@/lib/trpc";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Columns3,
  Flag,
  FolderKanban,
  GripVertical,
  LayoutList,
  ListFilter,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";

type TkoCategory = "todo" | "in_progress" | "done";
type TkoPriority = "urgent" | "high" | "medium" | "low" | "none";

type TkoBoardItem = {
  id: string;
  key: string;
  title: string;
  priority: TkoPriority;
  status: TkoCategory;
  statusId?: string;
  version?: number;
  rank?: string;
  detail: string;
  assignee: string;
  dueLabel: string;
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

function tko_dueLabel(tko_dueAt: Date | null | undefined) {
  if (!tko_dueAt) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(tko_dueAt));
}

function tko_dateInputValue(tko_dueAt: Date | null | undefined) {
  if (!tko_dueAt) return "";
  const tko_date = new Date(tko_dueAt);
  return `${tko_date.getFullYear()}-${String(tko_date.getMonth() + 1).padStart(2, "0")}-${String(tko_date.getDate()).padStart(2, "0")}`;
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

function TkoKanbanCard({ tko_item, tko_canDrag, tko_isDragging, tko_onOpen, tko_onDragStart, tko_onDragEnd, tko_onDrop }: {
  tko_item: TkoBoardItem;
  tko_canDrag: boolean;
  tko_isDragging: boolean;
  tko_onOpen: () => void;
  tko_onDragStart: () => void;
  tko_onDragEnd: () => void;
  tko_onDrop: (tko_event: DragEvent<HTMLElement>) => void;
}) {
  return <article draggable={tko_canDrag && !tko_item.optimistic} aria-busy={tko_item.optimistic || undefined} onDragStart={tko_onDragStart} onDragEnd={tko_onDragEnd} onDragOver={tko_event => { tko_event.preventDefault(); tko_event.stopPropagation(); }} onDrop={tko_onDrop} className={`rounded-lg border border-[#eaecf0] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] transition ${tko_item.optimistic ? "border-dashed border-[#0c66e4] bg-[#f7fbff] opacity-80" : tko_isDragging ? "opacity-45" : "hover:border-[#c7c3ff] hover:shadow-[0_7px_18px_rgba(91,81,232,.09)]"}`}>
    <button type="button" disabled={tko_item.optimistic} onClick={tko_onOpen} className="block w-full p-3 text-left disabled:cursor-wait"><div className="flex items-start justify-between gap-2"><span className="flex items-center gap-1 font-mono text-[10px] text-[#98a2b3]"><GripVertical className="h-3 w-3 text-[#c5cbd5]" />{tko_item.key}</span><TkoPriority priority={tko_item.priority} compact /></div><p className="mt-2 text-[13px] font-semibold leading-5 text-[#344054]">{tko_item.title}</p><div className="mt-3 flex items-center justify-between text-[11px] text-[#667085]"><span className="flex items-center gap-1"><CalendarDays className="h-3 w-3 text-[#98a2b3]" />{tko_item.dueLabel}</span><span className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#e7e5ff] text-[8px] font-bold text-[#5146d9]">{tko_item.assignee}</span><span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />0</span></span></div><p className="mt-2 flex items-center gap-1 text-[10px] text-[#5b51e8]"><FolderKanban className="h-3 w-3" />{tko_item.optimistic ? "Creating task…" : tko_item.detail}</p></button>
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
}: {
  tko_draft: TkoCreateDraft;
  tko_columnLabel: string;
  tko_assignees: TkoAssigneeOption[];
  tko_isPending: boolean;
  tko_onChange: (tko_next: TkoCreateDraft) => void;
  tko_onSubmit: (tko_event: FormEvent) => void;
  tko_onCancel: () => void;
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
        <div className="flex gap-1.5"><button type="button" onClick={tko_onCancel} className="h-7 px-2 text-[11px] font-medium text-[#44546f] hover:bg-[#f1f2f4]">Cancel</button><Button type="submit" disabled={!tko_draft.title.trim() || tko_isPending} className="h-7 rounded-sm bg-[#0c66e4] px-2.5 text-[11px] font-semibold hover:bg-[#0055cc]">{tko_isPending ? "Creating…" : "Create & open"}</Button></div>
      </div>
    </form>
  );
}

export default function Work() {
  const { isAuthenticated, loading: tko_authLoading } = useAuth();
  const tko_utils = trpc.useUtils();
  const [tko_view, setTkoView] = useState<"board" | "list">("board");
  const [tko_selectedItem, setTkoSelectedItem] = useState<TkoBoardItem | null>(null);
  const [tko_editor, setTkoEditor] = useState<TkoItemEditor | null>(null);
  const [tko_commentDraft, setTkoCommentDraft] = useState("");
  const [tko_filterOpen, setTkoFilterOpen] = useState(false);
  const [tko_filter, setTkoFilter] = useState<TkoKanbanFilter>("all");
  const [tko_groupOpen, setTkoGroupOpen] = useState(false);
  const [tko_grouping, setTkoGrouping] = useState<TkoKanbanGrouping>("none");
  const [tko_draggedId, setTkoDraggedId] = useState<string | null>(null);
  const [tko_createDraft, setTkoCreateDraft] = useState<TkoCreateDraft | null>(null);
  const [tko_optimisticItems, setTkoOptimisticItems] = useState<TkoBoardItem[]>([]);

  const tko_projects = trpc.work.projects.useQuery(undefined, { enabled: isAuthenticated });
  const tko_assignees = trpc.work.assignees.useQuery(undefined, { enabled: isAuthenticated });
  const tko_selectedProject = tko_projects.data?.[0];
  const tko_board = trpc.work.board.useQuery(
    { projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_selectedProject) },
  );
  const tko_itemDetails = trpc.work.item.useQuery(
    { workItemId: tko_selectedItem?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_selectedItem && isAuthenticated && tko_selectedProject) },
  );
  const tko_refreshBoard = async () => Promise.all([
    tko_utils.work.board.invalidate(),
    tko_utils.work.item.invalidate(),
  ]);
  const tko_seed = trpc.work.seedDemo.useMutation({
    onSuccess: async () => { await tko_utils.work.projects.invalidate(); },
  });
  const tko_move = trpc.work.moveItem.useMutation({
    onSuccess: async () => { await tko_refreshBoard(); toast.success("Đã cập nhật vị trí trên board."); },
    onError: async () => { await tko_refreshBoard(); toast.error("Board vừa thay đổi. Dữ liệu đã được làm mới, hãy thử lại."); },
  });
  const tko_create = trpc.work.createItem.useMutation();
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

  const tko_columns = useMemo(() => {
    if (!tko_board.data) return tko_previewColumns.map(tko_column => ({ ...tko_column, statusId: undefined }));
    return tko_board.data.statuses.map(tko_status => ({
      id: tko_statusFor(tko_status.category),
      label: tko_status.name,
      accent: tko_status.category === "done" ? "bg-[#12b76a]" : tko_status.category === "in_progress" ? "bg-[#5b51e8]" : "bg-[#ef9b3a]",
      statusId: tko_status.id,
    }));
  }, [tko_board.data]);
  const tko_items = useMemo<TkoBoardItem[]>(() => {
    if (!tko_board.data) return [...tko_previewItems, ...tko_optimisticItems];
    const tko_statusById = new Map(tko_board.data.statuses.map(tko_status => [tko_status.id, tko_status.category]));
    const tko_serverItems = tko_board.data.items.map(tko_item => ({
      id: tko_item.id,
      key: tko_item.key,
      title: tko_item.title,
      priority: tko_item.priority,
      status: tko_statusFor(tko_statusById.get(tko_item.statusId) ?? "todo"),
      statusId: tko_item.statusId,
      version: tko_item.version,
      rank: tko_item.rank,
      detail: tko_item.estimateMinutes ? `${Math.round(tko_item.estimateMinutes / 60)}h estimate` : "Work item",
      assignee: tko_item.assigneeMemberIds.length ? "ME" : "—",
      dueLabel: tko_dueLabel(tko_item.dueAt),
    }));
    return [...tko_serverItems, ...tko_optimisticItems];
  }, [tko_board.data, tko_optimisticItems]);

  const tko_projectName = tko_selectedProject?.name ?? "Q2 Renewal Implementation";
  const tko_isPreview = !isAuthenticated || !tko_selectedProject;
  const tko_selectedDetail = tko_itemDetails.data;
  const tko_filteredItems = useMemo(() => tko_filterKanbanItems(tko_items, tko_filter), [tko_filter, tko_items]);
  const tko_filterLabel = tko_filter === "all" ? "All tasks" : tko_filter === "high_priority" ? "High priority" : tko_filter === "assigned" ? "Assigned" : "Unassigned";
  const tko_groupLabel = tko_grouping === "none" ? "None" : tko_grouping === "priority" ? "Priority" : "Assignee";

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

  function tko_openItem(tko_item: TkoBoardItem) {
    setTkoSelectedItem(tko_item);
    setTkoCommentDraft("");
    setTkoEditor(null);
  }

  function tko_closeItem() {
    setTkoSelectedItem(null);
    setTkoEditor(null);
  }

  function tko_requestMove(tko_item: TkoBoardItem, tko_targetStatusId: string | undefined, tko_beforeWorkItemId: string | null = null) {
    const tko_expectedVersion = tko_selectedDetail?.item.id === tko_item.id ? tko_selectedDetail.item.version : tko_item.version;
    if (tko_isPreview || !tko_targetStatusId || !tko_expectedVersion) {
      toast("Sign in to update tenant-scoped work.");
      return;
    }
    tko_move.mutate({ workItemId: tko_item.id, targetStatusId: tko_targetStatusId, beforeWorkItemId: tko_beforeWorkItemId, expectedVersion: tko_expectedVersion });
  }

  function tko_dropOnColumn(tko_event: DragEvent<HTMLElement>, tko_statusId: string | undefined, tko_beforeWorkItemId: string | null = null) {
    tko_event.preventDefault();
    const tko_item = tko_items.find(tko_candidate => tko_candidate.id === tko_draggedId);
    setTkoDraggedId(null);
    if (!tko_item || tko_item.id === tko_beforeWorkItemId) return;
    tko_requestMove(tko_item, tko_statusId, tko_beforeWorkItemId);
  }

  function tko_openCreateComposer(tko_statusId: string | undefined, tko_status: TkoCategory) {
    if (!isAuthenticated) { startLogin(); return; }
    if (!tko_statusId) return;
    setTkoCreateDraft({ statusId: tko_statusId, status: tko_status, title: "", description: "", priority: "none", assigneeMemberIds: [], dueAt: "", estimateMinutes: "" });
  }

  function tko_cancelCreateComposer() { setTkoCreateDraft(null); }

  async function tko_submitCreateDraft(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_selectedProject || !tko_createDraft?.title.trim()) return;
    const tko_draft = tko_createDraft;
    const tko_estimateText = tko_draft.estimateMinutes.trim();
    const tko_estimate = tko_estimateText ? Number(tko_estimateText) : null;
    if (tko_estimate !== null && (!Number.isInteger(tko_estimate) || tko_estimate < 0)) {
      toast.error("Estimate phải là số phút không âm.");
      return;
    }
    const tko_optimisticId = `optimistic:${crypto.randomUUID()}`;
    const tko_optimisticItem: TkoBoardItem = {
      id: tko_optimisticId,
      key: "Creating…",
      title: tko_draft.title.trim(),
      priority: tko_draft.priority,
      status: tko_draft.status,
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
      create: () => tko_create.mutateAsync({ projectId: tko_selectedProject.id, title: tko_draft.title.trim(), description: tko_draft.description.trim(), priority: tko_draft.priority, assigneeMemberIds: tko_draft.assigneeMemberIds, dueAt: tko_draft.dueAt ? new Date(`${tko_draft.dueAt}T12:00:00`) : null, estimateMinutes: tko_estimate }),
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
      setTkoCreateDraft(null);
      await tko_refreshBoard();
      tko_openItem({ id: tko_created.id, key: tko_created.key, title: tko_created.title, priority: tko_created.priority, status: "todo", statusId: tko_created.statusId, version: tko_created.version, rank: tko_created.rank, detail: tko_created.estimateMinutes ? `${Math.round(tko_created.estimateMinutes / 60)}h estimate` : "Work item", assignee: tko_created.assigneeMemberIds.length ? "ME" : "—", dueLabel: tko_dueLabel(tko_created.dueAt) });
      toast.error("Task đã tạo ở To do nhưng chưa thể đặt vào cột đã chọn. Đã mở task để bạn thử lại.");
      return;
    }
    const tko_finalItem = tko_result.item;
    setTkoCreateDraft(null);
    await tko_refreshBoard();
    tko_openItem({ id: tko_finalItem.id, key: tko_finalItem.key, title: tko_finalItem.title, priority: tko_finalItem.priority, status: tko_draft.status, statusId: tko_finalItem.statusId, version: tko_finalItem.version, rank: tko_finalItem.rank, detail: tko_finalItem.estimateMinutes ? `${Math.round(tko_finalItem.estimateMinutes / 60)}h estimate` : "Work item", assignee: tko_finalItem.assigneeMemberIds.length ? "ME" : "—", dueLabel: tko_dueLabel(tko_finalItem.dueAt) });
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
          <button className="text-[#667085]">Overview</button>
          <button onClick={() => setTkoView("board")} className={`border-b-2 pb-2 ${tko_view === "board" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Board</button>
          <button onClick={() => setTkoView("list")} className={`border-b-2 pb-2 ${tko_view === "list" ? "border-[#5b51e8] font-semibold text-[#5b51e8]" : "border-transparent text-[#667085]"}`}>Backlog</button>
          <button className="text-[#667085]">Timeline</button>
          <button className="text-[#667085]">Files</button>
        </nav>
      </header>

      <main className="px-5 py-5 lg:px-7">
        {tko_isPreview && !tko_authLoading ? <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2.5 text-xs text-[#93370d]"><Sparkles className="h-4 w-4" /><span>Work preview. Sign in to update your tenant-scoped project.</span><button onClick={startLogin} className="ml-auto font-semibold underline">Sign in</button></div> : null}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button className="flex h-9 items-center gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 text-xs font-medium text-[#475467]"><CalendarDays className="h-3.5 w-3.5" />Sprint 2 <ChevronDown className="h-3.5 w-3.5" /></button>
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

        {tko_view === "board" ? (
          <div className="overflow-x-auto pb-4"><div className="grid min-w-[900px] grid-cols-3 gap-3">
            {tko_columns.map(tko_column => {
              const tko_columnItems = tko_filteredItems.filter(tko_item => tko_item.status === tko_column.id).sort((tko_left, tko_right) => (tko_left.rank ?? "").localeCompare(tko_right.rank ?? ""));
              return <section key={`${tko_column.id}-${tko_column.statusId ?? "preview"}`} onDragOver={tko_event => tko_event.preventDefault()} onDrop={tko_event => tko_dropOnColumn(tko_event, tko_column.statusId)} className={`min-h-[420px] bg-[#f4f5f7] p-2.5 ${tko_draggedId ? "ring-1 ring-inset ring-[#85b8ff]" : ""}`}>
                <div className="mb-2.5 flex items-center justify-between px-1"><div className="flex items-center gap-2 text-xs font-semibold text-[#172b4d]"><span className={`h-2 w-2 rounded-full ${tko_column.accent}`} />{tko_column.label}<span className="grid h-5 min-w-5 place-items-center bg-white px-1 text-[10px] text-[#44546f]">{tko_columnItems.length}</span></div><button onClick={() => tko_openCreateComposer(tko_column.statusId, tko_column.id)} aria-label={`Add to ${tko_column.label}`} className="grid h-6 w-6 place-items-center text-[#626f86] hover:bg-[#dfe1e6] hover:text-[#0c66e4]"><Plus className="h-4 w-4" /></button></div>
                <div className="space-y-2">
                  {tko_groupKanbanItems(tko_columnItems, tko_grouping).map(tko_group => <div key={tko_group.key} className="space-y-2">{tko_grouping !== "none" ? <p className="border-b border-[#dfe1e6] px-1 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#44546f]">{tko_group.label} <span className="ml-1 font-normal text-[#6b778c]">{tko_group.items.length}</span></p> : null}{tko_group.items.map(tko_item => <TkoKanbanCard key={tko_item.id} tko_item={tko_item} tko_canDrag={!tko_isPreview} tko_isDragging={tko_draggedId === tko_item.id} tko_onOpen={() => tko_openItem(tko_item)} tko_onDragStart={() => setTkoDraggedId(tko_item.id)} tko_onDragEnd={() => setTkoDraggedId(null)} tko_onDrop={tko_event => { tko_event.stopPropagation(); tko_dropOnColumn(tko_event, tko_column.statusId, tko_item.id); }} />)}</div>)}
                  {tko_createDraft && tko_createDraft.statusId === tko_column.statusId ? <TkoKanbanCreateComposer tko_draft={tko_createDraft} tko_columnLabel={tko_column.label} tko_assignees={tko_assignees.data ?? []} tko_isPending={tko_create.isPending || tko_move.isPending} tko_onChange={setTkoCreateDraft} tko_onSubmit={tko_submitCreateDraft} tko_onCancel={tko_cancelCreateComposer} /> : <button type="button" onClick={() => tko_openCreateComposer(tko_column.statusId, tko_column.id)} className="flex w-full items-center gap-2 px-2 py-2 text-xs text-[#626f86] hover:bg-white hover:text-[#0c66e4]"><Plus className="h-3.5 w-3.5" />Add task</button>}
                </div>
              </section>;
            })}
          </div></div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#eaecf0] bg-white"><div className="grid grid-cols-[90px_minmax(260px,1fr)_130px_130px] border-b border-[#eaecf0] bg-[#fcfcfd] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-[#98a2b3]"><span>Key</span><span>Work item</span><span>Priority</span><span>Status</span></div>{tko_filteredItems.map(tko_item => <button type="button" key={tko_item.id} onClick={() => tko_openItem(tko_item)} className="grid w-full grid-cols-[90px_minmax(260px,1fr)_130px_130px] items-center border-b border-[#f2f4f7] px-4 py-3 text-left text-xs last:border-b-0 hover:bg-[#fcfcff]"><span className="font-mono text-[#98a2b3]">{tko_item.key}</span><span className="font-semibold text-[#344054]">{tko_item.title}</span><span><TkoPriority priority={tko_item.priority} /></span><span className="capitalize text-[#667085]">{tko_item.status.replace("_", " ")}</span></button>)}</div>
        )}
      </main>

      {tko_selectedItem ? <div className="fixed inset-0 z-[60] flex justify-end bg-[#101828]/20" role="dialog" aria-modal="true" aria-label="Work item details"><aside className="h-full w-full max-w-[460px] overflow-y-auto border-l border-[#eaecf0] bg-white shadow-[-16px_0_38px_rgba(16,24,40,.15)]"><div className="border-b border-[#eaecf0] px-5 py-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">{tko_selectedItem.key}</span><button onClick={tko_closeItem} aria-label="Close inspector" className="grid h-8 w-8 place-items-center rounded-md text-[#667085] hover:bg-[#f9fafb]"><X className="h-4 w-4" /></button></div><div className="mt-3 flex items-center gap-2"><TkoPriority priority={tko_selectedDetail?.item.priority ?? tko_selectedItem.priority} /><span className="flex items-center gap-1 rounded-md border border-[#d0d5dd] px-2 py-1 text-[11px] font-medium text-[#5b51e8]"><CircleDot className="h-3 w-3" />{tko_selectedItem.status.replace("_", " ")}</span></div></div><div className="space-y-6 p-5">
        {tko_editor ? <form onSubmit={tko_saveEditor} className="space-y-4"><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-title">Summary<input id="work-title" value={tko_editor.title} disabled={tko_isPreview} onChange={tko_event => setTkoEditor({ ...tko_editor, title: tko_event.target.value })} className="mt-1.5 block h-10 w-full rounded-lg border border-[#d0d5dd] px-3 text-sm font-semibold text-[#182230] outline-none focus:border-[#5b51e8] focus:ring-2 focus:ring-[#e7e5ff] disabled:bg-[#f9fafb]" /></label><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-description">Description<textarea id="work-description" value={tko_editor.description} disabled={tko_isPreview} onChange={tko_event => setTkoEditor({ ...tko_editor, description: tko_event.target.value })} className="mt-1.5 block min-h-24 w-full rounded-lg border border-[#d0d5dd] p-3 text-xs leading-5 text-[#344054] outline-none focus:border-[#5b51e8] focus:ring-2 focus:ring-[#e7e5ff] disabled:bg-[#f9fafb]" placeholder="Add delivery context, decisions or acceptance notes…" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Priority<select disabled={tko_isPreview} value={tko_editor.priority} onChange={tko_event => setTkoEditor({ ...tko_editor, priority: tko_event.target.value as TkoPriority })} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-xs font-medium text-[#344054] outline-none focus:border-[#5b51e8] disabled:bg-[#f9fafb]"><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Due date<input type="date" disabled={tko_isPreview} value={tko_editor.dueAt} onChange={tko_event => setTkoEditor({ ...tko_editor, dueAt: tko_event.target.value })} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054] outline-none focus:border-[#5b51e8] disabled:bg-[#f9fafb]" /></label></div><fieldset className="block"><legend className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Assignees</legend><div className="mt-1.5 max-h-28 overflow-y-auto rounded-lg border border-[#d0d5dd] bg-white p-1"><label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[#344054] hover:bg-[#f4f5f7]"><input type="checkbox" disabled={tko_isPreview} checked={tko_editor.assigneeMemberIds.length === 0} onChange={() => setTkoEditor({ ...tko_editor, assigneeMemberIds: [] })} className="accent-[#0c66e4]" />Unassigned</label>{tko_assignees.data?.map(tko_assignee => <label key={tko_assignee.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[#344054] hover:bg-[#f4f5f7]"><input type="checkbox" disabled={tko_isPreview} checked={tko_editor.assigneeMemberIds.includes(tko_assignee.id)} onChange={tko_event => setTkoEditor({ ...tko_editor, assigneeMemberIds: tko_event.target.checked ? [...tko_editor.assigneeMemberIds, tko_assignee.id] : tko_editor.assigneeMemberIds.filter(tko_id => tko_id !== tko_assignee.id) })} className="accent-[#0c66e4]" />{tko_assignee.displayName}<span className="text-[#98a2b3]">{tko_assignee.role}</span></label>) ?? <p className="px-2 py-1.5 text-xs text-[#98a2b3]">Loading workspace members…</p>}</div></fieldset><label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-estimate">Estimate (minutes)<input id="work-estimate" type="number" min="0" step="1" disabled={tko_isPreview} value={tko_editor.estimateMinutes} onChange={tko_event => setTkoEditor({ ...tko_editor, estimateMinutes: tko_event.target.value })} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] px-2 text-xs text-[#344054] outline-none focus:border-[#5b51e8] disabled:bg-[#f9fafb]" placeholder="No estimate" /></label><div className="flex justify-end border-b border-[#f2f4f7] pb-5"><Button type="submit" disabled={tko_isPreview || tko_update.isPending || !tko_editor.title.trim()} className="h-8 rounded-lg bg-[#5b51e8] px-3 text-xs hover:bg-[#4d43da]"><Save className="mr-1.5 h-3.5 w-3.5" />{tko_update.isPending ? "Saving…" : "Save changes"}</Button></div></form> : <div className="space-y-2"><div className="h-6 w-3/4 animate-pulse rounded bg-[#f2f4f7]" /><div className="h-16 animate-pulse rounded bg-[#f9fafb]" /></div>}
        <section className="space-y-3 text-xs"><div className="flex items-center justify-between"><span className="text-[#667085]">Assignee</span><span className="font-medium text-[#344054]">{tko_selectedItem.assignee === "—" ? "Unassigned" : "Tasko member"}</span></div><label className="block text-[#667085]">Status<select aria-label="Move work item to status" disabled={tko_isPreview || tko_move.isPending} value={tko_selectedDetail?.item.statusId ?? tko_selectedItem.statusId ?? tko_selectedItem.status} onChange={tko_event => tko_requestMove(tko_selectedItem, tko_event.target.value)} className="mt-1.5 block h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-xs font-medium text-[#344054] focus:border-[#5b51e8] focus:outline-none">{tko_columns.map(tko_column => <option key={tko_column.statusId ?? tko_column.id} value={tko_column.statusId ?? tko_column.id}>{tko_column.label}</option>)}</select></label></section>
        <section className="border-t border-[#f2f4f7] pt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]">Activity</p>{tko_selectedDetail?.history.length ? <div className="space-y-3">{tko_selectedDetail.history.slice().reverse().map(tko_entry => <div key={tko_entry.id} className="border-l-2 border-[#d9d6fe] pl-3 text-xs"><p className="font-medium text-[#344054]">{tko_entry.field.replace("_", " ")} updated</p><p className="mt-0.5 text-[#98a2b3]">Tenant-scoped activity</p></div>)}</div> : <p className="text-xs text-[#98a2b3]">Open a live item to inspect history.</p>}</section>
        {!tko_isPreview ? <section className="border-t border-[#f2f4f7] pt-5"><label className="text-[10px] font-bold uppercase tracking-[.11em] text-[#98a2b3]" htmlFor="work-comment">Add comment</label><textarea id="work-comment" value={tko_commentDraft} onChange={tko_event => setTkoCommentDraft(tko_event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-[#d0d5dd] p-3 text-xs outline-none focus:border-[#5b51e8] focus:ring-2 focus:ring-[#e7e5ff]" placeholder="Add a decision, context or handoff…" /><Button disabled={!tko_commentDraft.trim() || tko_comment.isPending || !tko_selectedDetail} onClick={() => tko_selectedDetail && tko_comment.mutate({ workItemId: tko_selectedDetail.item.id, body: tko_commentDraft.trim() })} className="mt-2 h-8 rounded-lg bg-[#5b51e8] px-3 text-xs hover:bg-[#4d43da]"><Send className="mr-1.5 h-3.5 w-3.5" />Add comment</Button></section> : null}
      </div></aside></div> : null}
    </div>
  );
}
