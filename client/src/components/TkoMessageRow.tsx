import { useState } from "react";
import { Bell, Bookmark, FileText, Forward, Link2, MessageCircleMore, MoreHorizontal, Pencil, Pin, SmilePlus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

const tko_reactions = ["👍", "✅", "🎉", "👀", "💡", "❤️"];

function tko_dayKey(tko_value: Date | string) {
  const tko_date = new Date(tko_value);
  return `${tko_date.getFullYear()}-${tko_date.getMonth()}-${tko_date.getDate()}`;
}

function tko_time(tko_value: Date | string) {
  return new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit" }).format(new Date(tko_value));
}

function tko_fullTime(tko_value: Date | string) {
  return new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(tko_value));
}

function tko_day(tko_value: Date | string) {
  const tko_date = new Date(tko_value);
  const tko_today = new Date();
  const tko_yesterday = new Date();
  tko_yesterday.setDate(tko_today.getDate() - 1);
  if (tko_date.toDateString() === tko_today.toDateString()) return "Hôm nay";
  if (tko_date.toDateString() === tko_yesterday.toDateString()) return "Hôm qua";
  return new Intl.DateTimeFormat("vi", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(tko_date);
}

function TkoAvatar({ name }: { name: string }) {
  const tko_initials = name.trim().split(/\s+/).slice(0, 2).map(tko_part => tko_part[0]).join("").toUpperCase() || "T";
  return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#4f46e5] to-[#9333ea] text-xs font-semibold text-white shadow-sm">{tko_initials}</span>;
}

function TkoAttachment({ messageId, attachment, onOpen }: { messageId: string; attachment: any; onOpen: () => void }) {
  const tko_isImage = attachment.contentType?.startsWith("image/");
  const tko_attachmentUrl = trpc.chat.attachmentUrl.useQuery({ messageId, attachmentId: attachment.id }, { enabled: tko_isImage, staleTime: 300_000 });
  if (!tko_isImage) return <button type="button" onClick={onOpen} className="mt-2 flex max-w-xs items-center gap-2 rounded-lg border border-[#dfdbe0] bg-white px-3 py-2 text-left shadow-sm transition hover:border-[#9d90aa]"><span className="grid h-7 w-7 place-items-center rounded-md bg-[#f1eef2] text-[#4a154b]"><FileText className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-[#373438]">{attachment.filename}</span><span className="block text-[10px] text-[#777477]">Tệp đính kèm · Mở để xem</span></span></button>;
  return <div className="mt-2 max-w-md overflow-hidden rounded-xl border border-[#dfdbe0] bg-[#faf9fa] shadow-sm"><button type="button" onClick={onOpen} className="block w-full text-left hover:opacity-90">{tko_attachmentUrl.data?.url ? <img src={tko_attachmentUrl.data.url} alt={attachment.filename} className="max-h-80 w-full object-cover" /> : <span className="grid h-28 place-items-center text-[11px] text-[#777477]">{tko_attachmentUrl.isError ? "Không tải được ảnh" : "Đang tải ảnh…"}</span>}</button><div className="flex items-center justify-between gap-2 px-3 py-2"><span className="truncate text-[11px] font-semibold text-[#454245]">{attachment.filename}</span>{tko_attachmentUrl.isError ? <button type="button" onClick={() => void tko_attachmentUrl.refetch()} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#4a154b] hover:bg-[#f1eaf4]">Thử lại</button> : null}</div></div>;
}

function TkoReactionPicker({ onReact }: { onReact: (emoji: string) => void }) {
  const [tko_open, tko_setOpen] = useState(false);
  return <span className="relative inline-flex"><button type="button" onClick={() => tko_setOpen(tko_value => !tko_value)} className="flex items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] text-[#616061] hover:border-[#dfdbe0] hover:bg-white hover:text-[#4a154b]" aria-label="Thêm reaction" aria-expanded={tko_open}><SmilePlus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Thả cảm xúc</span></button>{tko_open ? <span className="absolute bottom-full left-0 z-30 mb-1 flex gap-0.5 rounded-lg border border-[#dedade] bg-white p-1 shadow-[0_8px_20px_rgba(29,28,29,.16)]">{tko_reactions.map(tko_emoji => <button type="button" key={tko_emoji} onClick={() => { onReact(tko_emoji); tko_setOpen(false); }} className="rounded-md p-1 text-base hover:bg-[#f3edf4]" aria-label={`Thêm phản ứng ${tko_emoji}`}>{tko_emoji}</button>)}</span> : null}</span>;
}

function TkoMessageActions({ saved, pinned, onReply, onSave, onPin, onToggleMenu }: { saved: boolean; pinned: boolean; onReply: () => void; onSave: () => void; onPin: () => void; onToggleMenu: () => void }) {
  return <div className="absolute right-5 top-1 hidden rounded-lg border border-[#dedade] bg-white p-0.5 shadow-[0_2px_8px_rgba(29,28,29,.14)] group-hover:flex"><button type="button" onClick={onReply} className="rounded-md p-1.5 text-[#616061] hover:bg-[#f3edf4]" aria-label="Trả lời thread"><MessageCircleMore className="h-3.5 w-3.5" /></button><button type="button" onClick={onSave} className={`rounded-md p-1.5 hover:bg-[#f3edf4] ${saved ? "text-[#4a154b]" : "text-[#616061]"}`} aria-label="Lưu để xử lý sau"><Bookmark className="h-3.5 w-3.5" fill={saved ? "currentColor" : "none"} /></button><button type="button" onClick={onPin} className={`rounded-md p-1.5 hover:bg-[#f3edf4] ${pinned ? "text-[#4a154b]" : "text-[#616061]"}`} aria-label={pinned ? "Bỏ ghim tin nhắn" : "Ghim tin nhắn"}><Pin className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} /></button><button type="button" onClick={onToggleMenu} className="rounded-md p-1.5 text-[#616061] hover:bg-[#f3edf4]" aria-label="Thêm thao tác"><MoreHorizontal className="h-3.5 w-3.5" /></button></div>;
}

export function TkoMessageRow({ message, previous, currentMemberId, saved, pinned, menuOpen, editing, editDraft, onEditDraft, onToggleMenu, onReact, onOpenThread, onReply, onSave, onRemind, onForward, onPin, onQuote, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onOpenAttachment, onCopyLink, highlighted }: { message: any; previous: any; currentMemberId: string | undefined; saved: boolean; pinned: boolean; menuOpen: boolean; editing: boolean; editDraft: string; onEditDraft: (value: string) => void; onToggleMenu: () => void; onReact: (emoji: string) => void; onOpenThread: () => void; onReply: () => void; onSave: () => void; onRemind?: () => void; onForward?: () => void; onPin: () => void; onQuote: () => void; onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: () => void; onDelete: () => void; onOpenAttachment: (attachment: any) => void; onCopyLink?: () => void; highlighted?: boolean }) {
  const tko_sameAuthor = previous?.authorMemberId === message.authorMemberId && Math.abs(new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) < 300_000 && tko_dayKey(previous.createdAt) === tko_dayKey(message.createdAt);
  const tko_newDay = !previous || tko_dayKey(previous.createdAt) !== tko_dayKey(message.createdAt);
  const tko_authorName = message.author?.displayName ?? `Thành viên ${message.authorMemberId.slice(0, 5)}`;
  const tko_own = currentMemberId === message.authorMemberId;
  const tko_requestReminder = () => onRemind ? onRemind() : window.dispatchEvent(new CustomEvent("tasko-chat-reminder", { detail: message }));
  const tko_requestForward = () => onForward ? onForward() : window.dispatchEvent(new CustomEvent("tasko-chat-forward", { detail: message }));
  return <>
    {tko_newDay ? <div className="my-6 flex items-center gap-3" role="separator" aria-label={tko_day(message.createdAt)}><span className="h-px flex-1 bg-[#e8e5ea]" /><span className="rounded-full border border-[#dfdbe0] bg-white px-3 py-1 text-[10px] font-bold text-[#615d62] shadow-sm">{tko_day(message.createdAt)}</span><span className="h-px flex-1 bg-[#e8e5ea]" /></div> : null}
    <article data-message-id={message.id} className={`group relative -mx-3 px-3 py-2 transition hover:bg-[#faf9fa] sm:-mx-5 sm:px-5 ${tko_sameAuthor ? "mt-0" : "mt-3"} ${highlighted ? "rounded-lg bg-[#fff8e1] ring-2 ring-inset ring-[#f2c94c]" : ""}`}>
      <div className="flex gap-3">
        {tko_sameAuthor ? <time dateTime={new Date(message.createdAt).toISOString()} title={tko_fullTime(message.createdAt)} className="w-9 shrink-0 pt-0.5 text-center text-[10px] text-[#8d898e] opacity-0 transition group-hover:opacity-100">{tko_time(message.createdAt)}</time> : <TkoAvatar name={tko_authorName} />}
        <div className="min-w-0 flex-1">
          {!tko_sameAuthor ? <div className="flex flex-wrap items-baseline gap-x-2"><button type="button" onClick={onOpenThread} className="text-[13px] font-bold text-[#1d1c1d] hover:underline">{tko_authorName}</button><time dateTime={new Date(message.createdAt).toISOString()} title={tko_fullTime(message.createdAt)} className="text-[10px] text-[#777477]">{tko_fullTime(message.createdAt)}</time>{message.editedAt ? <span className="text-[10px] text-[#8d898e]">(đã sửa)</span> : null}</div> : null}
          {pinned ? <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#4a154b]"><Pin className="h-3 w-3" fill="currentColor" />Đã ghim vào channel</span> : null}
          {message.body.quotedMessageId ? <button type="button" onClick={onOpenThread} className="mt-1.5 flex max-w-xl items-center gap-1.5 rounded-r-md border-l-2 border-[#8a6ba7] bg-[#f8f6f8] px-2 py-1 text-left text-[11px] text-[#616061]"><Link2 className="h-3 w-3 shrink-0" />Đã trích dẫn một tin nhắn trong channel</button> : null}
          {editing ? <div className="mt-1.5 rounded-lg border border-[#bdb7bf] bg-white p-2"><textarea autoFocus value={editDraft} onChange={tko_event => onEditDraft(tko_event.target.value)} className="min-h-[74px] w-full resize-none text-[13px] outline-none" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={onCancelEdit} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[#616061] hover:bg-[#efedf0]">Hủy</button><button type="button" onClick={onSaveEdit} className="rounded-md bg-[#4a154b] px-2.5 py-1 text-[11px] font-semibold text-white">Lưu</button></div></div> : message.body.text ? <p className="mt-0.5 max-w-3xl whitespace-pre-wrap text-[13px] leading-5 text-[#373438]">{message.body.text}</p> : null}
          {(message.attachments ?? []).map((attachment: any) => <TkoAttachment key={attachment.id} messageId={message.id} attachment={attachment} onOpen={() => onOpenAttachment(attachment)} />)}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">{(message.reactions ?? []).map((reaction: any) => { const tko_selected = currentMemberId ? reaction.memberIds.includes(currentMemberId) : false; return <button type="button" key={reaction.emoji} onClick={() => onReact(reaction.emoji)} title={`${reaction.count} phản ứng ${reaction.emoji}`} className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition ${tko_selected ? "border-[#1264a3] bg-[#e8f5fa] text-[#1264a3]" : "border-[#dfdbe0] bg-white hover:border-[#8d898e]"}`}><span>{reaction.emoji}</span><span>{reaction.count}</span></button>; })}<TkoReactionPicker onReact={onReact} />{message.replyCount ? <button type="button" onClick={onOpenThread} className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[#1264a3] hover:bg-[#e8f5fa]"><MessageCircleMore className="h-3.5 w-3.5" />{message.replyCount} phản hồi</button> : null}</div>
        </div>
      </div>
      <TkoMessageActions saved={saved} pinned={pinned} onReply={onReply} onSave={onSave} onPin={onPin} onToggleMenu={onToggleMenu} />
      {menuOpen ? <div className="absolute right-5 top-9 z-20 w-52 rounded-lg border border-[#e6e4eb] bg-white py-1 shadow-[0_12px_30px_rgba(29,28,29,.18)]"><button type="button" onClick={onQuote} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Link2 className="h-3.5 w-3.5" />Trích dẫn vào channel</button>{onCopyLink ? <button type="button" onClick={onCopyLink} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Link2 className="h-3.5 w-3.5" />Sao chép liên kết</button> : null}<button type="button" onClick={tko_requestForward} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Forward className="h-3.5 w-3.5" />Chuyển tiếp tin nhắn</button><button type="button" onClick={onSave} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Bookmark className="h-3.5 w-3.5" />{saved ? "Cập nhật đã lưu" : "Lưu để xử lý sau"}</button><button type="button" onClick={tko_requestReminder} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Bell className="h-3.5 w-3.5" />Nhắc tôi về việc này</button><button type="button" onClick={onPin} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Pin className="h-3.5 w-3.5" />{pinned ? "Bỏ ghim tin nhắn" : "Ghim vào channel"}</button>{tko_own ? <><button type="button" onClick={onStartEdit} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Pencil className="h-3.5 w-3.5" />Chỉnh sửa tin nhắn</button><button type="button" onClick={onDelete} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#b33a3a] hover:bg-[#fff3f2]"><Trash2 className="h-3.5 w-3.5" />Xóa tin nhắn</button></> : null}</div> : null}
    </article>
  </>;
}
