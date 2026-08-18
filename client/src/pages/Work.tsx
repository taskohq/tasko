import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  Bell,
  Blocks,
  CalendarDays,
  ChevronDown,
  CircleDot,
  Columns3,
  Command,
  Flag,
  FolderKanban,
  LayoutList,
  ListFilter,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type PreviewItem = { id: string; key: string; title: string; priority: "urgent" | "high" | "medium" | "low" | "none"; status: "todo" | "in_progress" | "done"; detail: string; assignee: string };

const tko_previewItems: PreviewItem[] = [
  { id: "preview-1", key: "TASKO-12", title: "Confirm workspace hierarchy", priority: "urgent", status: "todo", detail: "M1 · Architecture", assignee: "TL" },
  { id: "preview-2", key: "TASKO-18", title: "Ship project board", priority: "high", status: "in_progress", detail: "M1 · Product", assignee: "AN" },
  { id: "preview-3", key: "TASKO-22", title: "Verify tenant-scoped events", priority: "high", status: "in_progress", detail: "M1 · Platform", assignee: "MT" },
  { id: "preview-4", key: "TASKO-27", title: "Define sprint review ritual", priority: "medium", status: "done", detail: "M1 · Planning", assignee: "TL" },
];

const tko_columns = [
  { id: "todo", label: "To do", accent: "bg-[#b38a3d]" },
  { id: "in_progress", label: "In progress", accent: "bg-[#4f78c4]" },
  { id: "done", label: "Done", accent: "bg-[#398a68]" },
] as const;

function tko_statusFor(tko_category: string): "todo" | "in_progress" | "done" {
  return tko_category === "in_progress" ? "in_progress" : tko_category === "done" ? "done" : "todo";
}

function PriorityMark({ priority }: { priority: PreviewItem["priority"] }) {
  if (priority === "none") return <span className="h-2 w-2 rounded-full bg-[#d7d7d2]" />;
  const tko_color = priority === "urgent" ? "bg-[#d84c4c]" : priority === "high" ? "bg-[#e58d36]" : "bg-[#d8b145]";
  return <span className={`h-2 w-2 rounded-full ${tko_color}`} />;
}

export default function Work() {
  const { isAuthenticated, loading: tko_authLoading } = useAuth();
  const [tko_view, setTkoView] = useState<"board" | "list">("board");
  const [tko_filterOpen, setTkoFilterOpen] = useState(false);
  const [tko_selectedItem, setTkoSelectedItem] = useState<PreviewItem | null>(null);
  const [tko_commentDraft, setTkoCommentDraft] = useState("");
  const tko_utils = trpc.useUtils();
  const tko_projects = trpc.work.projects.useQuery(undefined, { enabled: isAuthenticated });
  const tko_selectedProject = tko_projects.data?.[0];
  const tko_board = trpc.work.board.useQuery({ projectId: tko_selectedProject?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(tko_selectedProject) });
  const tko_seed = trpc.work.seedDemo.useMutation({
    onSuccess: async () => {
      await tko_utils.work.projects.invalidate();
    },
  });
  const tko_itemDetails = trpc.work.item.useQuery(
    { workItemId: tko_selectedItem?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tko_selectedItem && isAuthenticated && tko_selectedProject) },
  );
  const tko_transition = trpc.work.transitionItem.useMutation({
    onSuccess: async () => {
      await Promise.all([tko_utils.work.board.invalidate(), tko_utils.work.item.invalidate()]);
      toast.success("Workflow đã được cập nhật.");
    },
  });
  const tko_comment = trpc.work.createComment.useMutation({
    onSuccess: async () => {
      setTkoCommentDraft("");
      await tko_utils.work.item.invalidate();
      toast.success("Đã thêm bình luận.");
    },
  });

  const tko_items = useMemo<PreviewItem[]>(() => {
    if (!tko_board.data) return tko_previewItems;
    const tko_statusById = new Map(tko_board.data.statuses.map(tko_status => [tko_status.id, tko_status.category]));
    return tko_board.data.items.map(tko_item => ({
      id: tko_item.id,
      key: tko_item.key,
      title: tko_item.title,
      priority: tko_item.priority,
      status: tko_statusFor(tko_statusById.get(tko_item.statusId) ?? "todo"),
      detail: tko_item.estimateMinutes ? `${Math.round(tko_item.estimateMinutes / 60)}h estimate` : "No estimate",
      assignee: tko_item.assigneeMemberIds.length ? "ME" : "—",
    }));
  }, [tko_board.data]);

  const tko_projectName = tko_selectedProject?.name ?? "Tasko Work Alpha";
  const tko_isPreview = !isAuthenticated || !tko_selectedProject;
  const tko_selectedDetail = tko_itemDetails.data;
  const tko_nextStatus = useMemo(() => {
    if (!tko_selectedDetail || !tko_board.data) return null;
    const tko_currentIndex = tko_board.data.statuses.findIndex(tko_status => tko_status.id === tko_selectedDetail.item.statusId);
    return tko_board.data.statuses[tko_currentIndex + 1] ?? null;
  }, [tko_board.data, tko_selectedDetail]);

  function tko_openItem(tko_item: PreviewItem) {
    setTkoSelectedItem(tko_item);
    setTkoCommentDraft("");
  }

  return (
    <div className="min-h-screen bg-[#f5f5f1] text-[#252625]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[58px] flex-col items-center border-r border-[#deded8] bg-[#242a28] py-4 text-[#bfc5bf] md:flex">
          <div className="mb-8 grid h-8 w-8 place-items-center bg-[#e2c179] font-serif text-lg font-bold text-[#292c26]">T</div>
          <div className="flex flex-col gap-2">
            {[{ icon: FolderKanban, active: true }, { icon: Bell }, { icon: Users }, { icon: CalendarDays }].map((tko_entry, tko_index) => (
              <button key={tko_index} className={`grid h-9 w-9 place-items-center transition-colors ${tko_entry.active ? "bg-[#3b4d46] text-white" : "hover:bg-[#39413e] hover:text-white"}`} aria-label="Workspace section">
                <tko_entry.icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-2"><button className="grid h-9 w-9 place-items-center hover:bg-[#39413e] hover:text-white" aria-label="Settings"><Settings2 className="h-4 w-4" /></button><span className="grid h-8 w-8 place-items-center rounded-full bg-[#d8e5df] text-[10px] font-bold text-[#274239]">TL</span></div>
        </aside>

        <aside className="hidden w-[244px] shrink-0 border-r border-[#deded8] bg-[#fafaf7] lg:block">
          <div className="flex h-[57px] items-center justify-between border-b border-[#deded8] px-4"><button className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded bg-[#355d4d] text-[10px] text-white">T</span> Tasko <ChevronDown className="h-3.5 w-3.5 text-[#777c76]" /></button><button aria-label="Search"><Search className="h-4 w-4 text-[#686e69]" /></button></div>
          <nav className="p-3 text-sm">
            <p className="mb-2 px-2 pt-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#929890]">Workspace</p>
            <a href="#inbox" className="flex items-center gap-2 rounded px-2 py-2 text-[#5c625e] hover:bg-[#ededE8]"><Menu className="h-3.5 w-3.5" /> My work</a>
            <a href="#projects" className="flex items-center gap-2 rounded bg-[#e8eee9] px-2 py-2 font-medium text-[#284738]"><FolderKanban className="h-3.5 w-3.5" /> Projects</a>
            <p className="mb-2 mt-7 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#929890]">Spaces <Plus className="h-3.5 w-3.5" /></p>
            <div className="rounded border border-[#dfdfd9] bg-white p-2"><div className="flex items-center gap-2 px-1 py-1.5 font-medium"><span className="h-2 w-2 rounded-full bg-[#d8a54a]" /> Product</div><a className="ml-4 flex items-center gap-2 rounded bg-[#f2f4f0] px-2 py-1.5 text-[#355d4d]" href="#board"><Columns3 className="h-3.5 w-3.5" /> {tko_projectName}</a></div>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex h-[57px] items-center justify-between border-b border-[#deded8] bg-[#fbfbf8] px-4 md:px-6"><div className="flex items-center gap-3"><button className="lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button><div><div className="flex items-center gap-2 text-sm font-semibold"><span className="text-[#7a817b]">Product</span><span className="text-[#b0b4ad]">/</span>{tko_projectName}</div><p className="mt-0.5 text-[11px] text-[#8a908a]">{tko_isPreview ? "Preview · sign in to load workspace" : `${tko_board.data?.items.length ?? 0} work items`}</p></div></div><div className="flex items-center gap-2"><button onClick={() => toast("Tìm kiếm toàn cục sẽ mở rộng ở milestone kế tiếp.")} className="hidden items-center gap-1.5 border border-[#deded8] px-2.5 py-1.5 text-xs text-[#626862] sm:flex"><Command className="h-3.5 w-3.5" /> Search</button><Link href="/platform" className="hidden text-xs text-[#53665d] hover:underline md:block">Platform</Link>{isAuthenticated ? <Button onClick={() => tko_selectedProject ? toast("Chọn một cột rồi thêm work item trong workflow tiếp theo.") : tko_seed.mutate()} disabled={tko_seed.isPending} className="h-8 rounded bg-[#315c4a] px-3 text-xs text-white hover:bg-[#274c3d]"><Plus className="mr-1 h-3.5 w-3.5" /> {tko_selectedProject ? "New item" : "Set up demo"}</Button> : <Button onClick={() => startLogin()} className="h-8 rounded bg-[#315c4a] px-3 text-xs text-white hover:bg-[#274c3d]">Sign in</Button>}</div></header>

          <section className="p-4 md:p-6">
            {tko_isPreview && !tko_authLoading ? <div className="mb-5 flex items-center justify-between gap-4 border border-[#dfd5b9] bg-[#fffbef] px-4 py-3 text-xs text-[#735f2c]"><span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Work Alpha preview. Sign in, then initialize the product-team demo workspace.</span><button onClick={() => startLogin()} className="font-semibold underline">Sign in</button></div> : null}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-1 border-b border-[#deded8]"><button onClick={() => setTkoView("board")} className={`flex items-center gap-2 px-3 py-2 text-xs font-medium ${tko_view === "board" ? "border-b-2 border-[#315c4a] text-[#315c4a]" : "text-[#777c76]"}`}><Columns3 className="h-3.5 w-3.5" /> Board</button><button onClick={() => setTkoView("list")} className={`flex items-center gap-2 px-3 py-2 text-xs font-medium ${tko_view === "list" ? "border-b-2 border-[#315c4a] text-[#315c4a]" : "text-[#777c76]"}`}><LayoutList className="h-3.5 w-3.5" /> List</button><button className="flex items-center gap-2 px-3 py-2 text-xs text-[#777c76]"><CalendarDays className="h-3.5 w-3.5" /> Calendar</button></div><div className="relative"><button onClick={() => setTkoFilterOpen(!tko_filterOpen)} className="flex items-center gap-2 border border-[#deded8] bg-white px-2.5 py-1.5 text-xs text-[#5e655f]"><ListFilter className="h-3.5 w-3.5" /> Filters <ChevronDown className="h-3 w-3" /></button>{tko_filterOpen ? <div className="absolute right-0 z-10 mt-1 w-48 border border-[#deded8] bg-white p-2 text-xs shadow-lg"><p className="px-2 py-1 font-semibold">Quick filters</p><button className="block w-full px-2 py-1.5 text-left hover:bg-[#f2f4f0]">Assigned to me</button><button className="block w-full px-2 py-1.5 text-left hover:bg-[#f2f4f0]">Due this sprint</button></div> : null}</div></div>

            {tko_view === "board" ? <div id="board" className="grid min-w-[760px] grid-cols-3 gap-4 overflow-x-auto pb-5">{tko_columns.map(tko_column => { const tko_columnItems = tko_items.filter(tko_item => tko_item.status === tko_column.id); return <section key={tko_column.id} className="min-w-0"><div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2 text-xs font-semibold"><span className={`h-2 w-2 rounded-full ${tko_column.accent}`} /> {tko_column.label}<span className="text-[#9a9f99]">{tko_columnItems.length}</span></div><button aria-label={`More ${tko_column.label}`}><MoreHorizontal className="h-4 w-4 text-[#919791]" /></button></div><div className="min-h-[420px] space-y-2 rounded border border-dashed border-[#d9ddd6] bg-[#f0f1ed] p-2">{tko_columnItems.map(tko_item => <button onClick={() => tko_openItem(tko_item)} key={tko_item.id} className="group block w-full cursor-pointer border border-[#deded8] bg-white p-3 text-left shadow-[0_1px_1px_rgba(36,42,40,.04)] transition hover:-translate-y-0.5 hover:shadow-[0_5px_14px_rgba(36,42,40,.1)]"><div className="flex items-start justify-between gap-3"><span className="font-mono text-[10px] text-[#8d938d]">{tko_item.key}</span><PriorityMark priority={tko_item.priority} /></div><p className="mt-2 text-sm font-medium leading-5 text-[#303531]">{tko_item.title}</p><div className="mt-4 flex items-center justify-between text-[10px] text-[#858b85]"><span>{tko_item.detail}</span><span className="grid h-5 w-5 place-items-center rounded-full bg-[#dbe8e1] text-[8px] font-bold text-[#355d4d]">{tko_item.assignee}</span></div></button>)}<button onClick={() => toast("Tạo work item qua quick add được lên kế hoạch cho slice tiếp theo.")} className="flex w-full items-center gap-2 px-2 py-2 text-xs text-[#7c827c] hover:text-[#315c4a]"><Plus className="h-3.5 w-3.5" /> Add work item</button></div></section>; })}</div> : <div className="overflow-hidden border border-[#deded8] bg-white"><div className="grid grid-cols-[72px_minmax(260px,1fr)_120px_110px] border-b border-[#deded8] bg-[#f7f8f5] px-4 py-2 text-[10px] font-bold uppercase tracking-[.09em] text-[#818780]"><span>Key</span><span>Work item</span><span>Priority</span><span>Status</span></div>{tko_items.map(tko_item => <button onClick={() => tko_openItem(tko_item)} key={tko_item.id} className="grid w-full grid-cols-[72px_minmax(260px,1fr)_120px_110px] items-center border-b border-[#eeeeea] px-4 py-3 text-left text-xs last:border-b-0 hover:bg-[#fafbf8]"><span className="font-mono text-[#808780]">{tko_item.key}</span><span className="font-medium">{tko_item.title}</span><span className="flex items-center gap-2 capitalize"><PriorityMark priority={tko_item.priority} />{tko_item.priority}</span><span className="capitalize text-[#65746c]">{tko_item.status.replace("_", " ")}</span></button>)}</div>}
          </section>
        </main>
      </div>
      {tko_selectedItem ? <div className="fixed inset-0 z-50 flex justify-end bg-[#1d2421]/25" role="dialog" aria-modal="true" aria-label="Work item details">
        <aside className="flex h-full w-full max-w-[470px] flex-col overflow-y-auto border-l border-[#deded8] bg-[#fbfbf8] shadow-[-16px_0_42px_rgba(32,42,37,.16)]">
          <div className="relative border-b border-[#deded8] px-5 pb-5 pt-5 pr-12">
            <button onClick={() => setTkoSelectedItem(null)} className="absolute right-4 top-4 grid h-8 w-8 place-items-center text-[#66716a] hover:bg-[#edf0eb]" aria-label="Close inspector"><X className="h-4 w-4" /></button>
            <div className="flex items-center gap-2"><span className="font-mono text-xs text-[#718078]">{tko_selectedItem?.key}</span><PriorityMark priority={tko_selectedItem?.priority ?? "none"} /></div>
            <h2 className="mt-2 text-lg font-semibold leading-6 text-[#252625]">{tko_selectedDetail?.item.title ?? tko_selectedItem?.title}</h2>
            <p className="mt-1.5 text-sm text-[#6c756e]">{tko_selectedDetail?.item.description || tko_selectedItem?.detail || "No description yet."}</p>
          </div>
          <div className="space-y-6 p-5 text-sm">
            <section className="grid grid-cols-2 gap-px border border-[#deded8] bg-[#deded8] text-xs"><div className="bg-white p-3"><p className="text-[#858b85]">Status</p><p className="mt-1 font-medium capitalize">{tko_selectedItem?.status.replace("_", " ")}</p></div><div className="bg-white p-3"><p className="text-[#858b85]">Priority</p><p className="mt-1 flex items-center gap-1.5 font-medium capitalize"><PriorityMark priority={tko_selectedItem?.priority ?? "none"} />{tko_selectedItem?.priority}</p></div></section>
            {tko_nextStatus ? <Button disabled={tko_transition.isPending} onClick={() => tko_transition.mutate({ workItemId: tko_selectedDetail!.item.id, targetStatusId: tko_nextStatus.id, expectedVersion: tko_selectedDetail!.item.version })} className="w-full rounded bg-[#315c4a] text-white hover:bg-[#274c3d]">Move to {tko_nextStatus.name}</Button> : null}
            <section><p className="mb-2 text-xs font-semibold uppercase tracking-[.1em] text-[#7a817b]">Custom fields</p>{tko_selectedDetail?.customValues.length ? <div className="space-y-2">{tko_selectedDetail.customValues.map(tko_value => <div key={tko_value.id} className="flex justify-between border-b border-[#e7e8e3] py-2 text-xs"><span className="font-mono text-[#758078]">{tko_value.fieldId.slice(0, 8)}</span><span>{String(tko_value.value)}</span></div>)}</div> : <p className="text-xs text-[#858b85]">No custom values assigned.</p>}</section>
            <section><p className="mb-2 text-xs font-semibold uppercase tracking-[.1em] text-[#7a817b]">Activity</p><div className="space-y-3">{tko_selectedDetail?.history.slice().reverse().map(tko_entry => <div key={tko_entry.id} className="border-l-2 border-[#d8e5df] pl-3 text-xs"><p className="font-medium">{tko_entry.field.replace("_", " ")}</p><p className="mt-0.5 text-[#858b85]">Updated in tenant-scoped history</p></div>) ?? <p className="text-xs text-[#858b85]">Open a live item to inspect history.</p>}</div></section>
            {!tko_isPreview ? <section><p className="mb-2 text-xs font-semibold uppercase tracking-[.1em] text-[#7a817b]">Comment</p><textarea value={tko_commentDraft} onChange={tko_event => setTkoCommentDraft(tko_event.target.value)} className="min-h-20 w-full border border-[#deded8] bg-white p-3 text-xs outline-none focus:border-[#315c4a]" placeholder="Add a decision, context or handoff…" /><Button disabled={!tko_commentDraft.trim() || tko_comment.isPending} onClick={() => tko_comment.mutate({ workItemId: tko_selectedDetail!.item.id, body: tko_commentDraft.trim() })} className="mt-2 h-8 rounded bg-[#315c4a] px-3 text-xs text-white hover:bg-[#274c3d]"><Send className="mr-1.5 h-3.5 w-3.5" /> Add comment</Button></section> : null}
          </div>
        </aside>
      </div> : null}
    </div>
  );
}
