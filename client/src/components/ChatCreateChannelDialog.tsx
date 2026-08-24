import { trpc } from "@/lib/trpc";
import { Check, LockKeyhole, Search, ShieldCheck, UsersRound, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

type TkoCreateChannelDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (channelId: string) => void;
};

const tko_roleLabels = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
} as const;

export function ChatCreateChannelDialog({ open, onClose, onCreated }: TkoCreateChannelDialogProps) {
  const tko_utils = trpc.useUtils();
  const [tko_name, tko_setName] = useState("");
  const [tko_topic, tko_setTopic] = useState("");
  const [tko_isPrivate, tko_setIsPrivate] = useState(false);
  const [tko_search, tko_setSearch] = useState("");
  const [tko_selectedIds, tko_setSelectedIds] = useState<string[]>([]);
  const tko_policy = trpc.chat.creationPolicy.useQuery(undefined, { enabled: open, retry: false });
  const tko_candidates = trpc.chat.creationCandidates.useQuery(undefined, { enabled: open && Boolean(tko_policy.data?.allowed), retry: false });
  const tko_filtered = useMemo(
    () => (tko_candidates.data ?? []).filter(tko_member => tko_member.displayName.toLocaleLowerCase().includes(tko_search.trim().toLocaleLowerCase())),
    [tko_candidates.data, tko_search],
  );
  const tko_updatePolicy = trpc.chat.updateCreationPolicy.useMutation({
    onSuccess: async () => {
      await tko_utils.chat.creationPolicy.invalidate();
      toast.success("Đã cập nhật quyền tạo channel.");
    },
    onError: () => toast.error("Không thể cập nhật quyền tạo channel."),
  });
  const tko_create = trpc.chat.createChannel.useMutation({
    onSuccess: async tko_channel => {
      await tko_utils.chat.channels.invalidate();
      const tko_invitedCount = tko_selectedIds.length;
      tko_setName("");
      tko_setTopic("");
      tko_setSearch("");
      tko_setSelectedIds([]);
      onCreated(tko_channel.id);
      toast.success(tko_invitedCount ? `Đã tạo channel và mời ${tko_invitedCount} thành viên.` : "Đã tạo channel mới.");
    },
    onError: tko_error => toast.error(
      tko_error.message.includes("DISABLED_FOR_ROLE")
        ? "Quản trị viên đã giới hạn quyền tạo channel cho vai trò của bạn."
        : tko_error.message.includes("MEMBER_NOT_FOUND")
          ? "Một thành viên được chọn không còn hoạt động."
          : "Không thể tạo channel. Vui lòng thử lại.",
    ),
  });

  if (!open) return null;

  const tko_toggleMember = (tko_memberId: string) => {
    tko_setSelectedIds(tko_current => tko_current.includes(tko_memberId)
      ? tko_current.filter(tko_id => tko_id !== tko_memberId)
      : [...tko_current, tko_memberId]);
  };
  const tko_toggleRole = (tko_role: "owner" | "admin" | "member") => {
    const tko_currentRoles = tko_policy.data?.chatChannelCreationRoles ?? ["owner", "admin", "member"];
    const tko_nextRoles = tko_role === "owner"
      ? tko_currentRoles
      : tko_currentRoles.includes(tko_role)
        ? tko_currentRoles.filter(tko_item => tko_item !== tko_role)
        : [...tko_currentRoles, tko_role];
    tko_updatePolicy.mutate({ roles: tko_nextRoles });
  };
  const tko_submit = (tko_event: FormEvent) => {
    tko_event.preventDefault();
    if (!tko_name.trim() || !tko_policy.data?.allowed) return;
    tko_create.mutate({
      kind: tko_isPrivate ? "private" : "public",
      name: tko_name.trim(),
      topic: tko_topic.trim() || undefined,
      memberIds: tko_selectedIds,
      visibility: tko_isPrivate ? "private" : "internal",
    });
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[#1d1c1d]/45 p-4">
      <form onSubmit={tko_submit} className="flex max-h-[min(760px,calc(100vh-32px))] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(29,28,29,.3)]">
        <div className="flex items-start justify-between border-b border-[#e6e4eb] p-6">
          <div>
            <h3 className="text-lg font-bold text-[#1d1c1d]">Tạo channel</h3>
            <p className="mt-1 text-[12px] text-[#616061]">Bắt đầu một không gian trao đổi và mời đúng người ngay từ đầu.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[#616061] hover:bg-[#efedf0]" aria-label="Đóng tạo channel"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tko_policy.isLoading ? <div className="mb-4 animate-pulse rounded-lg bg-[#f8f6f8] p-3 text-[12px] text-[#777477]">Đang kiểm tra quyền tạo channel…</div> : null}
          {tko_policy.data && !tko_policy.data.allowed ? <div className="mb-4 rounded-lg border border-[#fed7aa] bg-[#fff7ed] p-3 text-[12px] leading-5 text-[#9a3412]">Vai trò của bạn hiện không được phép tạo channel. {tko_policy.data.canManage ? "Bạn có thể cập nhật cấu hình bên dưới." : "Hãy liên hệ quản trị viên workspace nếu cần một channel mới."}</div> : null}

          {tko_policy.data?.canManage ? <section className="mb-5 rounded-xl border border-[#ddd6fe] bg-[#f7f5ff] p-3.5"><div className="flex items-start gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-[#5b51e8]"><ShieldCheck className="h-4 w-4" /></span><div><p className="text-[12px] font-bold text-[#3730a3]">Ai có thể tạo channel?</p><p className="mt-0.5 text-[11px] leading-4 text-[#5b51e8]">Quy tắc này áp dụng ngay ở máy chủ cho toàn workspace.</p></div></div><div className="mt-3 grid grid-cols-3 gap-2">{(["owner", "admin", "member"] as const).map(tko_role => { const tko_checked = tko_policy.data.chatChannelCreationRoles.includes(tko_role); return <label key={tko_role} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold ${tko_checked ? "border-[#c4b5fd] bg-white text-[#4c1d95]" : "border-transparent bg-[#eeebff] text-[#777477]"}`}><input type="checkbox" checked={tko_checked} disabled={tko_role === "owner" || tko_updatePolicy.isPending} onChange={() => tko_toggleRole(tko_role)} className="accent-[#5b51e8]" />{tko_roleLabels[tko_role]}</label>; })}</div></section> : null}

          <fieldset disabled={!tko_policy.data?.allowed} className="disabled:opacity-55">
            <label className="block text-[12px] font-semibold text-[#454245]">Tên channel<input autoFocus value={tko_name} onChange={tko_event => tko_setName(tko_event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b] focus:ring-2 focus:ring-[#e7dcec]" placeholder="ví dụ: launch-2026" /></label>
            <label className="mt-3 block text-[12px] font-semibold text-[#454245]">Mục đích<input value={tko_topic} onChange={tko_event => tko_setTopic(tko_event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b] focus:ring-2 focus:ring-[#e7dcec]" placeholder="Mô tả ngắn về chủ đề trao đổi" /></label>
            <label className="mt-4 flex items-start gap-2.5 rounded-lg bg-[#f8f6f8] p-3 text-[12px] text-[#454245]"><input type="checkbox" checked={tko_isPrivate} onChange={tko_event => tko_setIsPrivate(tko_event.target.checked)} className="mt-0.5 accent-[#4a154b]" /><span><span className="flex items-center gap-1 font-semibold"><LockKeyhole className="h-3.5 w-3.5" />Channel riêng tư</span><span className="mt-0.5 block leading-5 text-[#777477]">Chỉ người được thêm mới nhìn thấy nội dung của channel.</span></span></label>

            <section className="mt-5"><div className="flex items-center justify-between"><div><p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#454245]"><UsersRound className="h-3.5 w-3.5 text-[#4a154b]" />Mời thành viên</p><p className="mt-0.5 text-[11px] text-[#777477]">Chỉ hiển thị các tài khoản đang hoạt động.</p></div><span className="rounded-full bg-[#f3edf4] px-2 py-1 text-[10px] font-bold text-[#4a154b]">{tko_selectedIds.length} đã chọn</span></div><div className="relative mt-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#777477]" /><input value={tko_search} onChange={tko_event => tko_setSearch(tko_event.target.value)} placeholder="Tìm thành viên…" className="w-full rounded-lg border border-[#d9d5da] py-2 pl-8 pr-3 text-[12px] outline-none focus:border-[#4a154b]" /></div><div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-[#e6e4eb] p-1">{tko_candidates.isLoading ? <p className="px-3 py-4 text-center text-[12px] text-[#777477]">Đang tải thành viên…</p> : tko_candidates.isError ? <p className="px-3 py-4 text-center text-[12px] text-[#b42318]">Không thể tải danh sách thành viên.</p> : tko_filtered.length ? tko_filtered.map(tko_member => { const tko_selected = tko_selectedIds.includes(tko_member.id); return <button key={tko_member.id} type="button" onClick={() => tko_toggleMember(tko_member.id)} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition ${tko_selected ? "bg-[#f3edf4]" : "hover:bg-[#f8f6f8]"}`}><span className={`grid h-4 w-4 place-items-center rounded border ${tko_selected ? "border-[#4a154b] bg-[#4a154b] text-white" : "border-[#bdb7bf] bg-white"}`}>{tko_selected ? <Check className="h-3 w-3" /> : null}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-[#1d1c1d]">{tko_member.displayName}</span><span className="block text-[10px] capitalize text-[#777477]">{tko_member.role}</span></span></button>; }) : <p className="px-3 py-4 text-center text-[12px] text-[#777477]">Không tìm thấy thành viên phù hợp.</p>}</div></section>
          </fieldset>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e6e4eb] bg-[#fcfbfc] px-6 py-4"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[#454245] hover:bg-[#efedf0]">Hủy</button><button disabled={tko_create.isPending || !tko_name.trim() || !tko_policy.data?.allowed} className="rounded-lg bg-[#4a154b] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[#611f69] disabled:opacity-40">{tko_create.isPending ? "Đang tạo…" : "Tạo channel"}</button></div>
      </form>
    </div>
  );
}
