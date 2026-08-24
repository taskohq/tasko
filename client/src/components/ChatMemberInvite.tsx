import { trpc } from "@/lib/trpc";
import { Check, Search, UserPlus, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type TkoChatMemberInviteProps = {
  channelId: string | null;
  channelKind: "public" | "private" | "dm" | "group_dm" | undefined;
  channelName: string | null;
};

function tkoInitials(tkoName: string) {
  return tkoName.trim().split(/\s+/).slice(0, 2).map(tkoPart => tkoPart[0]).join("").toUpperCase() || "T";
}

function TkoPresencePill({ member }: { member: { id: string; displayName: string; isActive: boolean; presenceStatus?: "online" | "away" | "offline" } }) {
  const tko_status = member.isActive ? member.presenceStatus ?? "offline" : "offline";
  const tko_label = !member.isActive ? "inactive" : tko_status === "online" ? "online" : tko_status === "away" ? "away" : "offline";
  const tko_dot = tko_status === "online" ? "bg-[#2eb67d]" : tko_status === "away" ? "bg-[#ecb22e]" : "bg-[#9b9a9b]";
  return <span key={member.id} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${member.isActive ? "bg-[#f3edf4] text-[#4a154b]" : "bg-[#f1f1f1] text-[#616061]"}`}><span className={`h-1.5 w-1.5 rounded-full ${tko_dot}`} /><span>{member.displayName}</span><span className="text-[9px] font-bold uppercase tracking-wide text-[#777477]">{tko_label}</span></span>;
}

export function ChatMemberInvite({ channelId, channelKind, channelName }: TkoChatMemberInviteProps) {
  const tkoUtils = trpc.useUtils();
  const [tkoOpen, tkoSetOpen] = useState(false);
  const [tkoSearch, tkoSetSearch] = useState("");
  const [tkoSelectedIds, tkoSetSelectedIds] = useState<string[]>([]);
  const tkoSupported = channelKind === "public" || channelKind === "private" || channelKind === "group_dm";
  const tkoCandidates = trpc.chat.memberCandidates.useQuery(
    { channelId: channelId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tkoOpen && channelId && tkoSupported) },
  );
  const tkoMembers = trpc.chat.channelMembers.useQuery(
    { channelId: channelId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(tkoOpen && channelId) },
  );
  const tkoInvite = trpc.chat.addMembers.useMutation({
    onSuccess: async () => {
      await Promise.all([
        tkoUtils.chat.channelMembers.invalidate(),
        tkoUtils.chat.memberCandidates.invalidate(),
        tkoUtils.chat.channels.invalidate(),
      ]);
      tkoSetSelectedIds([]);
      tkoSetSearch("");
      toast.success("Đã mời thành viên vào channel.");
    },
    onError: () => toast.error("Không thể mời thành viên. Chỉ quản lý channel mới có thể thực hiện thao tác này."),
  });

  const tkoEligible = useMemo(() => {
    const tkoQuery = tkoSearch.trim().toLocaleLowerCase();
    return (tkoCandidates.data ?? []).filter(tkoCandidate => !tkoCandidate.isInChannel && (!tkoQuery || `${tkoCandidate.displayName} ${tkoCandidate.role}`.toLocaleLowerCase().includes(tkoQuery)));
  }, [tkoCandidates.data, tkoSearch]);

  if (!channelId || !tkoSupported) return null;

  return <div className="fixed bottom-5 right-5 z-40">
    <button type="button" onClick={() => tkoSetOpen(true)} className="flex items-center gap-2 rounded-xl bg-[#4a154b] px-3.5 py-2.5 text-[12px] font-semibold text-white shadow-[0_12px_26px_rgba(74,21,75,.28)] transition hover:bg-[#611f69] active:scale-[.97]" aria-haspopup="dialog">
      <UserPlus className="h-4 w-4" />Mời thành viên
    </button>
    {tkoOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-[#1d1c1d]/45 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-label="Mời thành viên vào channel" className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(29,28,29,.3)]">
        <header className="flex items-start justify-between border-b border-[#e6e4eb] px-5 py-4"><div><h2 className="text-base font-bold text-[#1d1c1d]">Mời vào {channelName ? `#${channelName}` : "channel"}</h2><p className="mt-1 text-[12px] leading-5 text-[#616061]">Danh sách được đồng bộ từ thành viên đang hoạt động của workspace.</p></div><button type="button" onClick={() => { tkoSetOpen(false); tkoSetSelectedIds([]); tkoSetSearch(""); }} className="rounded-md p-1.5 text-[#616061] hover:bg-[#efedf0]" aria-label="Đóng lời mời"><X className="h-4 w-4" /></button></header>
        <div className="border-b border-[#e6e4eb] px-5 py-3"><div className="flex items-center gap-2 rounded-lg border border-[#c9c3ca] bg-white px-2.5 py-2 focus-within:border-[#4a154b] focus-within:ring-2 focus-within:ring-[#e7dcec]"><Search className="h-4 w-4 text-[#777477]" /><input autoFocus value={tkoSearch} onChange={tkoEvent => tkoSetSearch(tkoEvent.target.value)} placeholder="Tìm thành viên workspace…" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none" /></div></div>
        <div className="max-h-[330px] overflow-y-auto px-5 py-3"><p className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-[#777477]">Đang ở trong channel</p><div className="mb-4 flex flex-wrap gap-1.5">{tkoMembers.isLoading ? <span className="text-[12px] text-[#777477]">Đang tải…</span> : (tkoMembers.data ?? []).map(tkoMember => <TkoPresencePill key={tkoMember.id} member={tkoMember} />)}</div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-[#777477]">Có thể mời</p>
          {tkoCandidates.isLoading ? <p className="py-6 text-center text-[12px] text-[#777477]">Đang tải thành viên workspace…</p> : tkoCandidates.isError ? <p className="py-6 text-center text-[12px] text-[#b33a3a]">Bạn không có quyền quản lý thành viên channel này.</p> : tkoEligible.length ? <div className="space-y-1">{tkoEligible.map(tkoMember => { const tkoSelected = tkoSelectedIds.includes(tkoMember.id); return <button type="button" key={tkoMember.id} onClick={() => tkoSetSelectedIds(tkoCurrent => tkoSelected ? tkoCurrent.filter(tkoId => tkoId !== tkoMember.id) : [...tkoCurrent, tkoMember.id])} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${tkoSelected ? "bg-[#f3edf4]" : "hover:bg-[#faf9fa]"}`}><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#4f46e5] to-[#9333ea] text-[10px] font-semibold text-white">{tkoInitials(tkoMember.displayName)}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-[#1d1c1d]">{tkoMember.displayName}</span><span className="block text-[10px] capitalize text-[#777477]">{tkoMember.role}</span></span><span className={`grid h-5 w-5 place-items-center rounded border ${tkoSelected ? "border-[#4a154b] bg-[#4a154b] text-white" : "border-[#bdb7bf] bg-white text-transparent"}`}><Check className="h-3.5 w-3.5" /></span></button>; })}</div> : <div className="rounded-xl border border-dashed border-[#d9d5da] bg-[#faf9fa] px-4 py-8 text-center"><p className="text-[12px] font-semibold text-[#454245]">Không có thành viên phù hợp để mời</p><p className="mt-1 text-[11px] leading-4 text-[#777477]">Tài khoản bị vô hiệu hóa không xuất hiện trong danh sách này.</p></div>}</div>
        <footer className="flex items-center justify-between gap-3 border-t border-[#e6e4eb] bg-[#faf9fa] px-5 py-3"><p className="text-[11px] text-[#777477]">{tkoSelectedIds.length ? `Đã chọn ${tkoSelectedIds.length} thành viên` : "Chọn thành viên để mời"}</p><div className="flex gap-2"><button type="button" onClick={() => { tkoSetOpen(false); tkoSetSelectedIds([]); }} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[#454245] hover:bg-[#efedf0]">Hủy</button><button type="button" disabled={!tkoSelectedIds.length || tkoInvite.isPending} onClick={() => tkoInvite.mutate({ channelId, memberIds: tkoSelectedIds })} className="rounded-lg bg-[#4a154b] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-[#611f69] disabled:cursor-not-allowed disabled:opacity-40">{tkoInvite.isPending ? "Đang mời…" : "Mời vào channel"}</button></div></footer>
      </section>
    </div> : null}
  </div>;
}
