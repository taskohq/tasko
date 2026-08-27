import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { ChatMemberInvite } from "@/components/ChatMemberInvite";
import { ChatCreateChannelDialog } from "@/components/ChatCreateChannelDialog";
import { TkoMessageRow } from "@/components/TkoMessageRow";
import { tko_readCursorAttemptKey, tko_shouldSyncReadCursor } from "@/lib/chat-read-state";
import { trpc } from "@/lib/trpc";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  AtSign,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  FileText,
  Hash,
  Info,
  Italic,
  Link2,
  LockKeyhole,
  MessageCircleMore,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  SendHorizontal,
  SmilePlus,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

type TkoPendingAttachment = { filename: string; contentType: string; dataBase64: string };
type TkoChatView = "channel" | "threads" | "mentions" | "saved";
type TkoReminderDraft = { messageId: string | null; title: string; note: string; reminderAt: string };
type TkoForwardDraft = { messageId: string; targetChannelId: string; note: string };

const tko_reactionChoices = ["👍", "✅", "🎉", "👀", "💡", "❤️"];

function tko_time(tko_value: Date | string) {
  return new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit" }).format(new Date(tko_value));
}

function tko_day(tko_value: Date | string) {
  return new Intl.DateTimeFormat("vi", { weekday: "long", day: "2-digit", month: "long" }).format(new Date(tko_value));
}

function tko_dayKey(tko_value: Date | string) {
  const tko_date = new Date(tko_value);
  return `${tko_date.getFullYear()}-${tko_date.getMonth()}-${tko_date.getDate()}`;
}

function tko_fullTime(tko_value: Date | string) {
  return new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(tko_value));
}

function tko_isImage(tko_contentType: string) {
  return tko_contentType.startsWith("image/");
}

function tko_defaultReminderAt() {
  const tko_date = new Date(Date.now() + 60 * 60_000);
  tko_date.setMinutes(0, 0, 0);
  return new Date(tko_date.getTime() - tko_date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function tko_initials(tko_name: string) {
  return tko_name.trim().split(/\s+/).slice(0, 2).map(tko_part => tko_part[0]).join("").toUpperCase() || "T";
}

function tko_hashToView(): TkoChatView {
  const tko_hash = window.location.hash.replace("#", "");
  return tko_hash === "threads" || tko_hash === "mentions" || tko_hash === "saved" ? tko_hash : "channel";
}

function TkoAvatar({ name, small = false, online = false }: { name: string; small?: boolean; online?: boolean }) {
  return (
    <span className={`relative grid shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#4f46e5] to-[#9333ea] font-semibold text-white shadow-sm ${small ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs"}`} aria-label={name}>
      {tko_initials(name)}
      {online ? <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#2eb67d]" /> : null}
    </span>
  );
}

export default function Chat() {
  const { isAuthenticated, loading: tko_authLoading } = useAuth();
  const tko_utils = trpc.useUtils();
  const tko_fileInput = useRef<HTMLInputElement>(null);
  const tko_composerInput = useRef<HTMLTextAreaElement>(null);
  const tko_lastReadAttempt = useRef<string | null>(null);
  const tko_announcedReminderIds = useRef(new Set<string>());
  const [tko_activeChannelId, tko_setActiveChannelId] = useState<string | null>(null);
  const [tko_view, tko_setView] = useState<TkoChatView>(() => tko_hashToView());
  const [tko_draft, tko_setDraft] = useState("");
  const [tko_attachments, tko_setAttachments] = useState<TkoPendingAttachment[]>([]);
  const [tko_selectedMessageId, tko_setSelectedMessageId] = useState<string | null>(null);
  const [tko_replyToMessageId, tko_setReplyToMessageId] = useState<string | null>(null);
  const [tko_quotedMessageId, tko_setQuotedMessageId] = useState<string | null>(null);
  const [tko_searchOpen, tko_setSearchOpen] = useState(false);
  const [tko_searchText, tko_setSearchText] = useState("");
  const [tko_sidebarOpen, tko_setSidebarOpen] = useState(false);
  const [tko_infoOpen, tko_setInfoOpen] = useState(false);
  const [tko_channelSettingsOpen, tko_setChannelSettingsOpen] = useState(false);
  const [tko_createChannelOpen, tko_setCreateChannelOpen] = useState(false);
  const [tko_channelName, tko_setChannelName] = useState("");
  const [tko_channelTopic, tko_setChannelTopic] = useState("");
  const [tko_notificationLevel, tko_setNotificationLevel] = useState<"all" | "mentions" | "none">("mentions");
  const [tko_messageMenuId, tko_setMessageMenuId] = useState<string | null>(null);
  const [tko_editingMessageId, tko_setEditingMessageId] = useState<string | null>(null);
  const [tko_editDraft, tko_setEditDraft] = useState("");
  const [tko_selectedMentionIds, tko_setSelectedMentionIds] = useState<string[]>([]);
  const [tko_draggingFiles, tko_setDraggingFiles] = useState(false);
  const [tko_lightbox, tko_setLightbox] = useState<{ url: string; filename: string } | null>(null);
  const [tko_reminderDraft, tko_setReminderDraft] = useState<TkoReminderDraft | null>(null);
  const [tko_forwardDraft, tko_setForwardDraft] = useState<TkoForwardDraft | null>(null);

  const tko_tenant = trpc.platform.currentTenant.useQuery(undefined, { enabled: isAuthenticated });
  const tko_channels = trpc.chat.channels.useQuery(undefined, { enabled: isAuthenticated });
  const tko_channelId = tko_activeChannelId ?? tko_channels.data?.[0]?.id ?? null;
  const tko_messages = trpc.chat.messages.useQuery(
    { channelId: tko_channelId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(isAuthenticated && tko_channelId), refetchInterval: 12_000 },
  );
  const tko_channelMembers = trpc.chat.channelMembers.useQuery(
    { channelId: tko_channelId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(isAuthenticated && tko_channelId) },
  );
  const tko_readStates = trpc.chat.readStates.useQuery(undefined, { enabled: isAuthenticated });
  const tko_presence = trpc.chat.presence.useQuery(
    { channelId: tko_channelId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(isAuthenticated && tko_channelId), refetchInterval: 20_000 },
  );
  const tko_typing = trpc.chat.typing.useQuery(
    { channelId: tko_channelId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(isAuthenticated && tko_channelId), refetchInterval: 2_500 },
  );
  const tko_saved = trpc.chat.savedEntries.useQuery(undefined, { enabled: isAuthenticated });
  const tko_reminders = trpc.chat.reminders.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 60_000 });
  const tko_mentions = trpc.chat.mentionedMessages.useQuery(undefined, { enabled: isAuthenticated });
  const tko_pins = trpc.chat.pinnedMessages.useQuery(
    { channelId: tko_channelId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(isAuthenticated && tko_channelId) },
  );
  const tko_search = trpc.chat.search.useQuery(
    { query: tko_searchText.trim() },
    { enabled: Boolean(isAuthenticated && tko_searchText.trim().length >= 2) },
  );

  const tko_activeChannel = tko_channels.data?.find(tko_channel => tko_channel.id === tko_channelId) ?? null;
  const tko_liveMessages = tko_messages.data ?? [];
  const tko_rootMessages = useMemo(() => tko_liveMessages.filter(tko_message => !tko_message.parentMessageId), [tko_liveMessages]);
  const tko_selectedMessage = tko_liveMessages.find(tko_message => tko_message.id === tko_selectedMessageId) ?? null;
  const tko_threadRoot = tko_selectedMessage ? (tko_selectedMessage.parentMessageId ? tko_liveMessages.find(tko_message => tko_message.id === tko_selectedMessage.parentMessageId) ?? tko_selectedMessage : tko_selectedMessage) : null;
  const tko_threadReplies = tko_threadRoot ? tko_liveMessages.filter(tko_message => tko_message.parentMessageId === tko_threadRoot.id) : [];
  const tko_replyRoot = tko_liveMessages.find(tko_message => tko_message.id === tko_replyToMessageId) ?? null;
  const tko_quotedMessage = tko_liveMessages.find(tko_message => tko_message.id === tko_quotedMessageId) ?? null;
  const tko_lastSequence = tko_liveMessages[tko_liveMessages.length - 1]?.sequence ?? 0;
  const tko_readState = tko_readStates.data?.find(tko_state => tko_state.channelId === tko_channelId);
  const tko_activeChannelMemberIds = new Set((tko_channelMembers.data ?? []).filter(tko_member => tko_member.isActive).map(tko_member => tko_member.id));
  const tko_onlineMemberIds = new Set((tko_presence.data ?? []).filter(tko_member => tko_member.status === "online" && tko_activeChannelMemberIds.has(tko_member.memberId)).map(tko_member => tko_member.memberId));
  const tko_onlineCount = tko_onlineMemberIds.size;
  const tko_savedIds = new Set((tko_saved.data ?? []).map(tko_item => tko_item.message.id));
  const tko_pinnedIds = new Set((tko_pins.data ?? []).map(tko_item => tko_item.message.id));
  const tko_unreadChannels = (tko_channels.data ?? []).filter(tko_channel => {
    const tko_state = tko_readStates.data?.find(tko_item => tko_item.channelId === tko_channel.id);
    return tko_channel.lastSequence > (tko_state?.lastReadSeq ?? 0) || Boolean(tko_state?.unreadMentions);
  });
  const tko_channelList = (tko_channels.data ?? []).filter(tko_channel => tko_channel.kind === "public" || tko_channel.kind === "private");
  const tko_directList = (tko_channels.data ?? []).filter(tko_channel => tko_channel.kind === "dm" || tko_channel.kind === "group_dm");
  const tko_mentionMatch = /(^|\s)@([A-Za-z0-9_-]*)$/.exec(tko_draft);
  const tko_mentionSearch = tko_mentionMatch?.[2].toLocaleLowerCase() ?? "";
  const tko_mentionChoices = (tko_channelMembers.data ?? []).filter(tko_member => tko_member.isActive && tko_member.id !== tko_tenant.data?.memberId && tko_member.displayName.toLocaleLowerCase().includes(tko_mentionSearch));
  const tko_hasQueryError = Boolean(tko_channels.error || tko_messages.error || tko_channelMembers.error || tko_readStates.error || tko_saved.error || tko_mentions.error || tko_pins.error);

  const tko_refreshConversation = async () => {
    await Promise.all([
      tko_channels.refetch(),
      tko_utils.chat.messages.invalidate(),
      tko_utils.chat.readStates.invalidate(),
      tko_utils.chat.savedEntries.invalidate(),
      tko_utils.chat.mentionedMessages.invalidate(),
      tko_utils.chat.pinnedMessages.invalidate(),
    ]);
  };
  const tko_send = trpc.chat.sendMessage.useMutation({
    onSuccess: async () => {
      tko_setDraft("");
      tko_setAttachments([]);
      tko_setReplyToMessageId(null);
      tko_setQuotedMessageId(null);
      tko_setSelectedMentionIds([]);
      await tko_refreshConversation();
    },
    onError: tko_error => toast.error(tko_error.message.includes("MENTION") ? "Người được nhắc không còn thuộc hội thoại này." : "Không thể gửi tin nhắn. Vui lòng thử lại."),
  });
  const tko_react = trpc.chat.toggleReaction.useMutation({ onSuccess: () => void tko_utils.chat.messages.invalidate(), onError: () => toast.error("Không thể cập nhật phản ứng.") });
  const tko_save = trpc.chat.saveMessage.useMutation({ onSuccess: () => { void tko_utils.chat.savedEntries.invalidate(); toast.success("Đã lưu vào danh sách xử lý sau."); }, onError: () => toast.error("Không thể lưu tin nhắn.") });
  const tko_createReminder = trpc.chat.createReminder.useMutation({ onSuccess: () => { tko_setReminderDraft(null); void tko_utils.chat.reminders.invalidate(); toast.success("Đã đặt reminder cá nhân."); }, onError: () => toast.error("Không thể tạo reminder.") });
  const tko_updateReminder = trpc.chat.setReminderStatus.useMutation({ onSuccess: () => void tko_utils.chat.reminders.invalidate(), onError: () => toast.error("Không thể cập nhật reminder.") });
  const tko_forward = trpc.chat.forwardMessage.useMutation({ onSuccess: async () => { tko_setForwardDraft(null); await tko_refreshConversation(); toast.success("Đã chuyển tiếp tin nhắn."); }, onError: () => toast.error("Không thể chuyển tiếp tới channel này.") });
  const tko_togglePin = trpc.chat.togglePin.useMutation({ onSuccess: tko_result => { void tko_utils.chat.pinnedMessages.invalidate(); toast.success(tko_result.pinned ? "Đã ghim tin nhắn vào channel." : "Đã bỏ ghim tin nhắn."); }, onError: () => toast.error("Bạn không có quyền ghim tin nhắn trong channel này.") });
  const tko_edit = trpc.chat.editMessage.useMutation({ onSuccess: async () => { tko_setEditingMessageId(null); await tko_refreshConversation(); toast.success("Đã cập nhật tin nhắn."); }, onError: () => toast.error("Bạn không thể sửa tin nhắn này.") });
  const tko_delete = trpc.chat.deleteMessage.useMutation({ onSuccess: () => { void tko_utils.chat.messages.invalidate(); toast.success("Đã xóa tin nhắn."); }, onError: () => toast.error("Bạn không thể xóa tin nhắn này.") });
  const tko_markRead = trpc.chat.markRead.useMutation({ onSuccess: () => void tko_utils.chat.readStates.invalidate() });
  const tko_setNotification = trpc.chat.setNotificationPreference.useMutation({ onError: () => toast.error("Không thể thay đổi thiết lập thông báo.") });
  const tko_setPresence = trpc.chat.setPresence.useMutation();
  const tko_setTyping = trpc.chat.setTyping.useMutation();
  const tko_updateChannel = trpc.chat.updateChannel.useMutation({ onSuccess: async () => { await tko_channels.refetch(); tko_setChannelSettingsOpen(false); toast.success("Đã cập nhật thông tin channel."); }, onError: () => toast.error("Bạn không có quyền thay đổi channel này.") });
  const tko_archiveChannel = trpc.chat.archiveChannel.useMutation({ onSuccess: async () => { tko_setActiveChannelId(null); tko_setChannelSettingsOpen(false); await tko_channels.refetch(); toast.success("Đã lưu trữ channel."); }, onError: () => toast.error("Không thể lưu trữ channel.") });

  useEffect(() => {
    const tko_syncHash = () => tko_setView(tko_hashToView());
    window.addEventListener("hashchange", tko_syncHash);
    return () => window.removeEventListener("hashchange", tko_syncHash);
  }, []);
  useEffect(() => {
    if (!tko_channelId || !tko_shouldSyncReadCursor({ channelId: tko_channelId, lastMessageSequence: tko_lastSequence, lastReadSequence: tko_readState?.lastReadSeq, lastAttemptKey: tko_lastReadAttempt.current })) return;
    tko_lastReadAttempt.current = tko_readCursorAttemptKey(tko_channelId, tko_lastSequence);
    tko_markRead.mutate({ channelId: tko_channelId, lastReadSeq: tko_lastSequence });
  }, [tko_channelId, tko_lastSequence, tko_readState?.lastReadSeq]);
  useEffect(() => {
    if (tko_readState) tko_setNotificationLevel(tko_readState.notificationLevel);
  }, [tko_readState?.channelId, tko_readState?.notificationLevel]);
  useEffect(() => {
    if (!isAuthenticated) return;
    tko_setPresence.mutate({ status: "online" });
    const tko_interval = window.setInterval(() => tko_setPresence.mutate({ status: "online" }), 60_000);
    return () => window.clearInterval(tko_interval);
  }, [isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated || !tko_channelId) return;
    const tko_timeout = window.setTimeout(() => tko_setTyping.mutate({ channelId: tko_channelId, isTyping: Boolean(tko_draft.trim()) }), 500);
    return () => window.clearTimeout(tko_timeout);
  }, [isAuthenticated, tko_channelId, tko_draft]);
  useEffect(() => {
    tko_setChannelName(tko_activeChannel?.name ?? "");
    tko_setChannelTopic(tko_activeChannel?.topic ?? "");
  }, [tko_activeChannel?.id]);
  useEffect(() => {
    const tko_handleShortcut = (tko_event: KeyboardEvent) => {
      if ((tko_event.metaKey || tko_event.ctrlKey) && tko_event.key.toLowerCase() === "k") {
        tko_event.preventDefault();
        tko_setSearchOpen(true);
        window.setTimeout(() => document.getElementById("tko-chat-search")?.focus(), 0);
      }
      if ((tko_event.metaKey || tko_event.ctrlKey) && tko_event.key.toLowerCase() === "n") {
        tko_event.preventDefault();
        tko_setCreateChannelOpen(true);
      }
      if (tko_event.key === "Escape") {
        tko_setSearchOpen(false);
        tko_setMessageMenuId(null);
        tko_setInfoOpen(false);
        tko_setLightbox(null);
        tko_setReminderDraft(null);
        tko_setForwardDraft(null);
      }
    };
    window.addEventListener("keydown", tko_handleShortcut);
    return () => window.removeEventListener("keydown", tko_handleShortcut);
  }, []);

  const tko_setChatView = (tko_nextView: TkoChatView) => {
    tko_setView(tko_nextView);
    tko_setSidebarOpen(false);
    const tko_hash = tko_nextView === "channel" ? "" : `#${tko_nextView}`;
    window.history.replaceState(null, "", `/chat${tko_hash}`);
  };
  const tko_selectChannel = (tko_nextChannelId: string) => {
    tko_setActiveChannelId(tko_nextChannelId);
    tko_setSelectedMessageId(null);
    tko_setReplyToMessageId(null);
    tko_setView("channel");
    tko_setSidebarOpen(false);
    window.history.replaceState(null, "", "/chat");
  };
  const tko_addAttachment = (tko_file: File) => {
    if (tko_file.size > 5_000_000) {
      toast.error("Mỗi tệp tối đa 5 MB.");
      return;
    }
    const tko_reader = new FileReader();
    tko_reader.onload = () => {
      const tko_base64 = String(tko_reader.result ?? "").split(",")[1];
      if (tko_base64) tko_setAttachments(tko_current => {
        if (tko_current.length >= 5) { toast.error("Tối đa 5 tệp cho một tin nhắn."); return tko_current; }
        return [...tko_current, { filename: tko_file.name, contentType: tko_file.type || "application/octet-stream", dataBase64: tko_base64 }];
      });
    };
    tko_reader.readAsDataURL(tko_file);
  };
  const tko_addAttachments = (tko_files: FileList | File[]) => Array.from(tko_files).forEach(tko_addAttachment);
  const tko_openAttachment = async (tko_messageId: string, tko_attachmentId: string) => {
    try {
      const { url } = await tko_utils.chat.attachmentUrl.fetch({ messageId: tko_messageId, attachmentId: tko_attachmentId });
      const tko_attachment = tko_liveMessages.find(tko_message => tko_message.id === tko_messageId)?.attachments.find(tko_item => tko_item.id === tko_attachmentId);
      if (tko_attachment && tko_isImage(tko_attachment.contentType)) tko_setLightbox({ url, filename: tko_attachment.filename });
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Không thể mở tệp đính kèm.");
    }
  };
  const tko_submit = () => {
    if (!tko_channelId || (!tko_draft.trim() && !tko_attachments.length) || tko_send.isPending) return;
    const tko_broadcastMention = /(^|\s)@channel\b/i.test(tko_draft) ? "channel" : /(^|\s)@here\b/i.test(tko_draft) ? "here" : undefined;
    const tko_explicitMentions = (tko_channelMembers.data ?? []).filter(tko_member => tko_member.isActive && tko_selectedMentionIds.includes(tko_member.id) && new RegExp(`@${tko_member.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(tko_draft)).map(tko_member => tko_member.id);
    tko_send.mutate({
      channelId: tko_channelId,
      clientMessageId: crypto.randomUUID(),
      parentMessageId: tko_replyToMessageId,
      body: { type: "text", text: tko_draft.trim(), mentions: tko_explicitMentions, broadcastMention: tko_broadcastMention, quotedMessageId: tko_quotedMessageId },
      attachments: tko_attachments,
    });
  };
  const tko_insertMention = (tko_member: { id: string; displayName: string }) => {
    tko_setDraft(tko_current => tko_current.replace(/(^|\s)@[A-Za-z0-9_-]*$/, (_tko_full, tko_prefix: string) => `${tko_prefix}@${tko_member.displayName} `));
    tko_setSelectedMentionIds(tko_current => Array.from(new Set([...tko_current, tko_member.id])));
    tko_composerInput.current?.focus();
  };
  const tko_insertFormatting = (tko_prefix: string, tko_suffix = tko_prefix) => {
    const tko_input = tko_composerInput.current;
    const tko_start = tko_input?.selectionStart ?? tko_draft.length;
    const tko_end = tko_input?.selectionEnd ?? tko_start;
    const tko_selected = tko_draft.slice(tko_start, tko_end);
    tko_setDraft(`${tko_draft.slice(0, tko_start)}${tko_prefix}${tko_selected || "văn bản"}${tko_suffix}${tko_draft.slice(tko_end)}`);
    window.setTimeout(() => tko_composerInput.current?.focus(), 0);
  };
  useEffect(() => {
    const tko_handleAttachment = (tko_event: Event) => { const tko_detail = (tko_event as CustomEvent<{ messageId: string; attachmentId: string }>).detail; if (tko_detail) void tko_openAttachment(tko_detail.messageId, tko_detail.attachmentId); };
    const tko_handleReaction = (tko_event: Event) => { const tko_detail = (tko_event as CustomEvent<{ messageId: string; emoji: string }>).detail; if (tko_detail) tko_react.mutate(tko_detail); };
    const tko_handleReminder = (tko_event: Event) => { const tko_message = (tko_event as CustomEvent<any>).detail; if (tko_message) { tko_setReminderDraft({ messageId: tko_message.id, title: tko_message.body.text?.slice(0, 500) || "Xem lại tệp đính kèm", note: "", reminderAt: tko_defaultReminderAt() }); tko_setMessageMenuId(null); } };
    const tko_handleForward = (tko_event: Event) => { const tko_message = (tko_event as CustomEvent<any>).detail; if (tko_message && tko_channelId) { tko_setForwardDraft({ messageId: tko_message.id, targetChannelId: tko_channelId, note: "" }); tko_setMessageMenuId(null); } };
    window.addEventListener("tasko-chat-attachment", tko_handleAttachment);
    window.addEventListener("tasko-chat-react", tko_handleReaction);
    window.addEventListener("tasko-chat-reminder", tko_handleReminder);
    window.addEventListener("tasko-chat-forward", tko_handleForward);
    return () => { window.removeEventListener("tasko-chat-attachment", tko_handleAttachment); window.removeEventListener("tasko-chat-react", tko_handleReaction); window.removeEventListener("tasko-chat-reminder", tko_handleReminder); window.removeEventListener("tasko-chat-forward", tko_handleForward); };
  }, [tko_channelId, tko_liveMessages]);
  useEffect(() => {
    const tko_hasFiles = (tko_event: DragEvent) => Array.from(tko_event.dataTransfer?.types ?? []).includes("Files");
    const tko_dragOver = (tko_event: DragEvent) => { if (!tko_hasFiles(tko_event)) return; tko_event.preventDefault(); if (tko_channelId) tko_setDraggingFiles(true); };
    const tko_drop = (tko_event: DragEvent) => { if (!tko_hasFiles(tko_event)) return; tko_event.preventDefault(); tko_setDraggingFiles(false); if (tko_channelId && tko_event.dataTransfer?.files?.length) tko_addAttachments(tko_event.dataTransfer.files); };
    const tko_dragEnd = () => tko_setDraggingFiles(false);
    window.addEventListener("dragover", tko_dragOver);
    window.addEventListener("drop", tko_drop);
    window.addEventListener("dragleave", tko_dragEnd);
    return () => { window.removeEventListener("dragover", tko_dragOver); window.removeEventListener("drop", tko_drop); window.removeEventListener("dragleave", tko_dragEnd); };
  }, [tko_channelId]);
  useEffect(() => {
    for (const tko_reminder of tko_reminders.data ?? []) {
      if (new Date(tko_reminder.reminderAt).getTime() > Date.now() || tko_announcedReminderIds.current.has(tko_reminder.id)) continue;
      tko_announcedReminderIds.current.add(tko_reminder.id);
      toast.message("Reminder đến hạn", { description: tko_reminder.title, action: { label: "Xem", onClick: () => tko_setChatView("saved") } });
    }
  }, [tko_reminders.data]);

  if (!isAuthenticated && !tko_authLoading) {
    return <div className="grid min-h-[calc(100vh-56px)] place-items-center bg-[#f7f7f9] p-6"><div className="w-full max-w-md rounded-2xl border border-[#e6e4eb] bg-white p-8 text-center shadow-[0_18px_45px_rgba(27,24,44,0.12)]"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#4a154b] text-white"><MessageSquareText className="h-6 w-6" /></span><h1 className="mt-5 text-xl font-bold tracking-[-.03em] text-[#1d1c1d]">Tasko Chat</h1><p className="mt-2 text-sm leading-6 text-[#616061]">Một không gian trao đổi theo channel, thread và ngữ cảnh công việc của bạn.</p><button onClick={startLogin} className="mt-6 rounded-lg bg-[#4a154b] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#611f69] active:scale-[.97]">Đăng nhập để tiếp tục</button></div></div>;
  }

  const tko_sidebar = (
    <aside className={`z-30 flex h-full min-h-0 w-[292px] shrink-0 flex-col border-r border-[#e6e4eb] bg-[#f8f8fa] ${tko_sidebarOpen ? "fixed inset-y-0 left-0 top-14 shadow-2xl lg:static lg:shadow-none" : "hidden lg:flex"}`}>
      <div className="border-b border-[#e6e4eb] bg-white px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => tko_setSidebarOpen(false)} className="flex min-w-0 items-center gap-2 text-left" aria-label="Đóng danh sách hội thoại">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#4a154b] text-sm font-black text-white">T</span>
            <span className="min-w-0"><span className="block truncate text-sm font-bold text-[#1d1c1d]">Tasko workspace</span><span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#616061]"><span className="h-1.5 w-1.5 rounded-full bg-[#2eb67d]" />Đang hoạt động</span></span>
            <ChevronDown className="ml-auto h-4 w-4 text-[#616061]" />
          </button>
          <button onClick={() => tko_setCreateChannelOpen(true)} className="grid h-8 w-8 place-items-center rounded-lg text-[#4a154b] transition hover:bg-[#f3edf4]" aria-label="Soạn tin nhắn mới"><Plus className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <button onClick={() => tko_setChatView("threads")} className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition ${tko_view === "threads" ? "bg-[#e9e3f5] font-semibold text-[#4a154b]" : "text-[#454245] hover:bg-[#efedf0]"}`}><MessageCircleMore className="h-4 w-4" /><span>Threads</span>{tko_rootMessages.filter(tko_message => tko_message.replyCount).length ? <span className="ml-auto text-[11px] font-bold">{tko_rootMessages.filter(tko_message => tko_message.replyCount).length}</span> : null}</button>
        <button onClick={() => tko_setChatView("mentions")} className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition ${tko_view === "mentions" ? "bg-[#e9e3f5] font-semibold text-[#4a154b]" : "text-[#454245] hover:bg-[#efedf0]"}`}><AtSign className="h-4 w-4" /><span>Nhắc tên</span>{tko_mentions.data?.length ? <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-[#4a154b] px-1.5 text-[10px] font-bold leading-5 text-white">{tko_mentions.data.length > 99 ? "99+" : tko_mentions.data.length}</span> : null}</button>
        <button onClick={() => tko_setChatView("saved")} className={`mb-4 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition ${tko_view === "saved" ? "bg-[#e9e3f5] font-semibold text-[#4a154b]" : "text-[#454245] hover:bg-[#efedf0]"}`}><Bookmark className="h-4 w-4" /><span>Đã lưu</span>{tko_saved.data?.length ? <span className="ml-auto text-[11px] font-semibold text-[#616061]">{tko_saved.data.length}</span> : null}</button>
        <div className="mb-4 border-t border-[#e6e4eb] pt-3">
          <div className="mb-1 flex items-center justify-between px-3"><span className="text-[11px] font-bold uppercase tracking-[.08em] text-[#777477]">Kênh</span><button onClick={() => tko_setCreateChannelOpen(true)} className="text-[#616061] hover:text-[#4a154b]" aria-label="Tạo kênh"><Plus className="h-4 w-4" /></button></div>
          <div className="space-y-0.5">{tko_channelList.map(tko_channel => <TkoChannelRow key={tko_channel.id} channel={tko_channel} active={tko_channelId === tko_channel.id && tko_view === "channel"} readState={tko_readStates.data?.find(tko_state => tko_state.channelId === tko_channel.id)} onClick={() => tko_selectChannel(tko_channel.id)} />)}</div>
        </div>
        {tko_directList.length ? <div className="border-t border-[#e6e4eb] pt-3"><div className="mb-1 px-3 text-[11px] font-bold uppercase tracking-[.08em] text-[#777477]">Tin nhắn trực tiếp</div><div className="space-y-0.5">{tko_directList.map(tko_channel => <TkoChannelRow key={tko_channel.id} channel={tko_channel} active={tko_channelId === tko_channel.id && tko_view === "channel"} readState={tko_readStates.data?.find(tko_state => tko_state.channelId === tko_channel.id)} onClick={() => tko_selectChannel(tko_channel.id)} />)}</div></div> : null}
      </div>
      <div className="border-t border-[#e6e4eb] bg-white p-3"><button onClick={() => tko_setChatView("channel")} className="flex w-full items-center gap-2 rounded-lg bg-[#f5f1f6] px-3 py-2 text-left text-[12px] font-medium text-[#4a154b] transition hover:bg-[#eee7f0]"><Clock3 className="h-4 w-4" />{tko_unreadChannels.length ? `${tko_unreadChannels.length} hội thoại chưa đọc` : "Bạn đã theo kịp mọi cập nhật"}</button></div>
    </aside>
  );

  return (
    <div className="h-[calc(100vh-56px)] min-h-[640px] overflow-hidden bg-white text-[#1d1c1d]">
      <div className="flex h-full min-w-0">
        {tko_sidebar}
        <ChatMemberInvite channelId={tko_view === "channel" ? tko_channelId : null} channelKind={tko_activeChannel?.kind} channelName={tko_activeChannel?.name ?? null} />
        <ChatCreateChannelDialog open={tko_createChannelOpen} onClose={() => tko_setCreateChannelOpen(false)} onCreated={tko_channelId => { tko_setCreateChannelOpen(false); tko_setActiveChannelId(tko_channelId); tko_setView("channel"); }} />
        {tko_sidebarOpen ? <button className="fixed inset-0 z-20 bg-[#1d1c1d]/30 lg:hidden" onClick={() => tko_setSidebarOpen(false)} aria-label="Đóng lớp phủ danh sách hội thoại" /> : null}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="relative z-10 flex min-h-[68px] shrink-0 items-center gap-3 border-b border-[#e6e4eb] bg-white px-4 sm:px-6">
            <button onClick={() => tko_setSidebarOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#e6e4eb] text-[#454245] lg:hidden" aria-label="Mở danh sách channel"><Hash className="h-4 w-4" /></button>
            <div className="min-w-0 flex-1">
              {tko_searchOpen ? <div className="relative max-w-xl"><div className="flex h-9 items-center gap-2 rounded-lg border border-[#4a154b] bg-white px-2.5 shadow-sm"><Search className="h-4 w-4 text-[#4a154b]" /><input id="tko-chat-search" autoFocus value={tko_searchText} onChange={tko_event => tko_setSearchText(tko_event.target.value)} placeholder="Tìm tin nhắn trong workspace…" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none" /><button onClick={() => { tko_setSearchOpen(false); tko_setSearchText(""); }} className="rounded p-1 text-[#777477] hover:bg-[#efedf0]" aria-label="Đóng tìm kiếm"><X className="h-3.5 w-3.5" /></button></div><div className="absolute left-0 top-11 z-50 max-h-[340px] w-full overflow-y-auto rounded-xl border border-[#e6e4eb] bg-white p-1.5 shadow-[0_16px_36px_rgba(29,28,29,.18)]">{tko_searchText.trim().length < 2 ? <p className="px-3 py-4 text-[12px] text-[#777477]">Nhập ít nhất hai ký tự để tìm trong lịch sử trao đổi.</p> : tko_search.isLoading ? <p className="px-3 py-4 text-[12px] text-[#777477]">Đang tìm kiếm…</p> : tko_search.data?.length ? tko_search.data.map(tko_result => <button type="button" key={tko_result.message.id} onClick={() => { tko_selectChannel(tko_result.channel.id); tko_setSelectedMessageId(tko_result.message.id); tko_setSearchOpen(false); tko_setSearchText(""); }} className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-[#f5f1f6]"><span className="flex items-center gap-1 text-[10px] font-bold text-[#4a154b]"><Hash className="h-3 w-3" />{tko_result.channel.name ?? "Tin nhắn trực tiếp"}</span><span className="mt-1 block line-clamp-2 text-[12px] leading-5 text-[#454245]">{tko_result.snippet}</span></button>) : <p className="px-3 py-4 text-[12px] text-[#777477]">Không có kết quả trong các hội thoại bạn được phép xem.</p>}</div></div> : <><button onClick={() => tko_setInfoOpen(tko_open => !tko_open)} className="flex max-w-full items-center gap-1.5 text-left"><span className="flex min-w-0 items-center gap-1.5"><span className="grid h-6 w-6 place-items-center rounded-md bg-[#f3edf4] text-[#4a154b]">{tko_activeChannel?.kind === "private" ? <LockKeyhole className="h-3.5 w-3.5" /> : <Hash className="h-4 w-4" />}</span><span className="truncate text-[15px] font-bold tracking-[-.01em]">{tko_view === "mentions" ? "Nhắc tên" : tko_view === "saved" ? "Đã lưu để xử lý sau" : tko_view === "threads" ? `Threads${tko_activeChannel?.name ? ` trong #${tko_activeChannel.name}` : ""}` : (tko_activeChannel?.name ?? "Chọn một channel")}</span></span><ChevronDown className="h-4 w-4 shrink-0 text-[#777477]" /></button><p className="mt-0.5 truncate text-[12px] text-[#777477]">{tko_view === "channel" ? (tko_typing.data?.length ? "Có người đang nhập…" : (tko_activeChannel?.topic || "Trao đổi cùng đội ngũ trong một không gian tập trung.")) : tko_view === "saved" ? "Các tin nhắn bạn muốn quay lại sau này." : tko_view === "mentions" ? "Những điểm cần bạn chú ý." : "Theo dõi các trao đổi có chiều sâu mà không làm loãng luồng chính."}</p></>}
            </div>
            {tko_view === "channel" ? <div className="flex items-center gap-1.5"><button onClick={() => tko_setSearchOpen(true)} className="grid h-8 w-8 place-items-center rounded-md text-[#616061] transition hover:bg-[#f3edf4] hover:text-[#4a154b]" aria-label="Tìm kiếm tin nhắn"><Search className="h-4 w-4" /></button><button onClick={() => tko_setInfoOpen(tko_open => !tko_open)} className="hidden items-center gap-1 rounded-md border border-[#e6e4eb] px-2.5 py-1.5 text-[12px] text-[#454245] transition hover:bg-[#f8f8fa] sm:flex"><UsersRound className="h-3.5 w-3.5" />{tko_channelMembers.data?.length ?? 0}</button><button onClick={() => tko_setChannelSettingsOpen(true)} className="grid h-8 w-8 place-items-center rounded-md text-[#616061] transition hover:bg-[#f3edf4] hover:text-[#4a154b]" aria-label="Thông tin channel"><Info className="h-4 w-4" /></button></div> : null}
            {tko_view === "saved" ? <button type="button" onClick={() => tko_setReminderDraft({ messageId: null, title: "", note: "", reminderAt: tko_defaultReminderAt() })} className="rounded-lg bg-[#4a154b] px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-[#611f69]"><Plus className="mr-1 inline h-3.5 w-3.5" />Nhắc việc</button> : null}
            {tko_infoOpen && tko_activeChannel ? <div className="absolute right-4 top-[58px] z-50 w-[300px] rounded-xl border border-[#e6e4eb] bg-white p-4 shadow-[0_16px_38px_rgba(29,28,29,.18)]"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-[#1d1c1d]">{tko_activeChannel.kind === "private" ? "Kênh riêng tư" : "Kênh công khai"}</p><p className="mt-1 text-xs leading-5 text-[#616061]">{tko_activeChannel.topic || "Chưa có mô tả cho channel này."}</p></div><button onClick={() => tko_setInfoOpen(false)} className="text-[#777477]"><X className="h-4 w-4" /></button></div><div className="mt-4 border-t border-[#e6e4eb] pt-3"><p className="text-[11px] font-bold uppercase tracking-[.08em] text-[#777477]">Thành viên</p><div className="mt-2 flex -space-x-1.5">{(tko_channelMembers.data ?? []).slice(0, 7).map(tko_member => <TkoAvatar key={tko_member.id} name={tko_member.displayName} small online={tko_onlineMemberIds.has(tko_member.id)} />)}{(tko_channelMembers.data?.length ?? 0) > 7 ? <span className="grid h-7 w-7 place-items-center rounded-lg border-2 border-white bg-[#edeaed] text-[10px] font-bold text-[#616061]">+{(tko_channelMembers.data?.length ?? 0) - 7}</span> : null}</div></div><div className="mt-4 border-t border-[#e6e4eb] pt-3"><label className="flex items-center justify-between text-[12px] text-[#454245]"><span className="flex items-center gap-2"><Bell className="h-3.5 w-3.5" />Thông báo</span><select value={tko_notificationLevel} onChange={tko_event => { const tko_next = tko_event.target.value as "all" | "mentions" | "none"; tko_setNotificationLevel(tko_next); tko_setNotification.mutate({ channelId: tko_activeChannel.id, notificationLevel: tko_next }); }} className="rounded border border-[#e6e4eb] bg-white px-1.5 py-1 text-[11px] outline-none"><option value="all">Tất cả</option><option value="mentions">Nhắc tên</option><option value="none">Tắt</option></select></label></div></div> : null}
          </header>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <section className="min-w-0 flex-1 overflow-y-auto bg-white" aria-live="polite">
              {tko_hasQueryError ? <TkoChatLoadError onRetry={() => void tko_refreshConversation()} /> : null}
              {!tko_hasQueryError ? <>
              {tko_view === "saved" ? <><TkoReminderPanel reminders={tko_reminders.data ?? []} onUpdate={(tko_reminderId, tko_status) => tko_updateReminder.mutate({ reminderId: tko_reminderId, status: tko_status })} /><TkoSavedView entries={tko_saved.data ?? []} onOpen={tko_entry => { tko_selectChannel(tko_entry.channel.id); tko_setSelectedMessageId(tko_entry.message.id); }} /></> : null}
              {tko_view === "mentions" ? <TkoMentionsView entries={tko_mentions.data ?? []} onOpen={tko_entry => { tko_selectChannel(tko_entry.channel.id); tko_setSelectedMessageId(tko_entry.message.id); }} /> : null}
              {tko_view === "threads" ? <TkoThreadListView messages={tko_rootMessages.filter(tko_message => tko_message.replyCount > 0)} onOpen={tko_message => { tko_setSelectedMessageId(tko_message.id); }} /> : null}
              {tko_view === "channel" ? <div className="mx-auto max-w-4xl px-4 pb-8 pt-5 sm:px-7"><div className="mb-6 rounded-xl border border-[#ebe8ed] bg-gradient-to-r from-[#faf8fb] to-white p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#4a154b] text-white">{tko_activeChannel?.kind === "private" ? <LockKeyhole className="h-4 w-4" /> : <Hash className="h-5 w-5" />}</span><div><p className="text-sm font-bold">Đây là phần đầu của <span className="text-[#4a154b]">#{tko_activeChannel?.name ?? "channel"}</span></p><p className="mt-1 text-[12px] leading-5 text-[#616061]">{tko_activeChannel?.topic || "Chia sẻ quyết định, tiến độ và bối cảnh công việc. Hãy dùng thread để giữ luồng trao đổi chính gọn gàng."}</p>{tko_pins.data?.length ? <button onClick={() => tko_setSelectedMessageId(tko_pins.data?.[0]?.message.id ?? null)} className="mt-2 flex items-center gap-1.5 rounded-md bg-[#f3edf4] px-2 py-1 text-[10px] font-semibold text-[#4a154b] hover:bg-[#eadfee]"><Pin className="h-3 w-3" fill="currentColor" />{tko_pins.data.length} tin đã ghim</button> : null}</div></div></div>{tko_messages.isLoading ? <TkoLoadingMessages /> : null}{!tko_messages.isLoading && tko_rootMessages.length === 0 ? <TkoEmptyChannel onCreate={() => tko_setCreateChannelOpen(true)} /> : null}{tko_rootMessages.map((tko_message, tko_index) => <TkoMessageRow key={tko_message.id} message={tko_message} previous={tko_rootMessages[tko_index - 1]} currentMemberId={tko_tenant.data?.memberId} saved={tko_savedIds.has(tko_message.id)} pinned={tko_pinnedIds.has(tko_message.id)} menuOpen={tko_messageMenuId === tko_message.id} editing={tko_editingMessageId === tko_message.id} editDraft={tko_editDraft} onEditDraft={tko_setEditDraft} onToggleMenu={() => tko_setMessageMenuId(tko_current => tko_current === tko_message.id ? null : tko_message.id)} onReact={tko_emoji => tko_react.mutate({ messageId: tko_message.id, emoji: tko_emoji })} onOpenThread={() => tko_setSelectedMessageId(tko_message.id)} onReply={() => { tko_setSelectedMessageId(tko_message.id); tko_setReplyToMessageId(tko_message.id); tko_setQuotedMessageId(null); tko_composerInput.current?.focus(); }} onSave={() => tko_save.mutate({ messageId: tko_message.id, status: "open" })} onPin={() => { tko_setMessageMenuId(null); tko_togglePin.mutate({ messageId: tko_message.id }); }} onQuote={() => { tko_setQuotedMessageId(tko_message.id); tko_setReplyToMessageId(null); tko_setMessageMenuId(null); tko_composerInput.current?.focus(); }} onStartEdit={() => { tko_setEditingMessageId(tko_message.id); tko_setEditDraft(tko_message.body.text); tko_setMessageMenuId(null); }} onCancelEdit={() => tko_setEditingMessageId(null)} onSaveEdit={() => tko_edit.mutate({ messageId: tko_message.id, text: tko_editDraft })} onDelete={() => { tko_setMessageMenuId(null); if (window.confirm("Xóa tin nhắn này?")) tko_delete.mutate({ messageId: tko_message.id }); }} onOpenAttachment={tko_attachment => tko_openAttachment(tko_message.id, tko_attachment.id)} />)}</div> : null}
              </> : null}
            </section>
            {tko_threadRoot ? <aside className="hidden w-[360px] shrink-0 border-l border-[#e6e4eb] bg-[#fbfafc] xl:flex xl:flex-col"><div className="flex items-center justify-between border-b border-[#e6e4eb] px-4 py-4"><div className="flex items-center gap-2"><MessageCircleMore className="h-4 w-4 text-[#4a154b]" /><span className="text-sm font-bold">Thread</span><span className="rounded-full bg-[#ede7f6] px-2 py-0.5 text-[10px] font-bold text-[#4a154b]">{tko_threadReplies.length}</span></div><button onClick={() => tko_setSelectedMessageId(null)} className="rounded-md p-1 text-[#616061] hover:bg-[#efedf0]" aria-label="Đóng thread"><X className="h-4 w-4" /></button></div><div className="min-h-0 flex-1 overflow-y-auto p-4"><TkoThreadMessage message={tko_threadRoot} currentMemberId={tko_tenant.data?.memberId} root /><div className="my-4 flex items-center gap-2 text-[11px] font-medium text-[#777477]"><span className="h-px flex-1 bg-[#e6e4eb]" />{tko_threadReplies.length ? `${tko_threadReplies.length} phản hồi` : "Chưa có phản hồi"}<span className="h-px flex-1 bg-[#e6e4eb]" /></div>{tko_threadReplies.map(tko_reply => <TkoThreadMessage key={tko_reply.id} message={tko_reply} currentMemberId={tko_tenant.data?.memberId} />)}</div><div className="border-t border-[#e6e4eb] bg-white p-3"><button onClick={() => { tko_setReplyToMessageId(tko_threadRoot.id); tko_setQuotedMessageId(null); tko_composerInput.current?.focus(); }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#4a154b] px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-[#611f69]"><MessageCircleMore className="h-3.5 w-3.5" />Trả lời trong thread</button><button onClick={() => { tko_setQuotedMessageId(tko_threadRoot.id); tko_setReplyToMessageId(null); tko_composerInput.current?.focus(); }} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#d9d5da] px-3 py-2 text-[12px] font-semibold text-[#4a154b] transition hover:bg-[#f5f1f6]"><Link2 className="h-3.5 w-3.5" />Trích dẫn vào kênh</button></div></aside> : null}
          </div>

          {tko_view === "channel" ? <footer className="relative shrink-0 border-t border-[#e6e4eb] bg-white px-4 pb-4 pt-3 sm:px-7"><div className="mx-auto max-w-4xl">{tko_replyRoot || tko_quotedMessage ? <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[#d8cce1] bg-[#f6f1f7] px-3 py-2 text-[11px] text-[#4a154b]"><span className="min-w-0 truncate">{tko_replyRoot ? <><MessageCircleMore className="mr-1 inline h-3.5 w-3.5" />Trả lời thread: {tko_replyRoot.body.text || "Tệp đính kèm"}</> : <><Link2 className="mr-1 inline h-3.5 w-3.5" />Đang trích: {tko_quotedMessage?.body.text || "Tệp đính kèm"}</>}</span><button onClick={() => { tko_setReplyToMessageId(null); tko_setQuotedMessageId(null); }} className="rounded p-0.5 hover:bg-white" aria-label="Hủy thao tác trả lời hoặc trích dẫn"><X className="h-3.5 w-3.5" /></button></div> : null}<div className="relative rounded-xl border border-[#bdb7bf] bg-white shadow-[0_2px_4px_rgba(29,28,29,.08)] transition focus-within:border-[#4a154b] focus-within:ring-2 focus-within:ring-[#e7dcec]"><textarea ref={tko_composerInput} value={tko_draft} onChange={tko_event => tko_setDraft(tko_event.target.value)} onKeyDown={tko_event => { if (tko_event.key === "Enter" && !tko_event.shiftKey) { tko_event.preventDefault(); tko_submit(); } }} placeholder={tko_replyRoot ? "Trả lời thread…" : `Gửi tin đến #${tko_activeChannel?.name ?? "channel"}`} className="h-[78px] w-full resize-none rounded-t-xl border-0 px-3.5 py-3 text-[14px] leading-5 outline-none placeholder:text-[#8d898e]" disabled={!tko_channelId} />{tko_mentionMatch && tko_mentionChoices.length ? <div className="absolute bottom-[108px] left-0 z-30 w-[270px] overflow-hidden rounded-xl border border-[#e6e4eb] bg-white py-1 shadow-[0_16px_36px_rgba(29,28,29,.18)]"><p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.09em] text-[#777477]">Nhắc thành viên</p>{tko_mentionChoices.slice(0, 6).map(tko_member => <button type="button" key={tko_member.id} onClick={() => tko_insertMention(tko_member)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f1f6]"><TkoAvatar name={tko_member.displayName} small /><span><span className="block text-[12px] font-semibold text-[#1d1c1d]">{tko_member.displayName}</span><span className="block text-[10px] text-[#777477]">{tko_member.role}</span></span></button>)}</div> : null}{tko_attachments.length ? <div className="flex flex-wrap gap-1.5 px-3 pb-2">{tko_attachments.map(tko_attachment => <button type="button" key={tko_attachment.filename} onClick={() => tko_setAttachments(tko_current => tko_current.filter(tko_item => tko_item !== tko_attachment))} className="flex items-center gap-1 rounded-md border border-[#dbd3df] bg-[#f6f1f7] px-2 py-1 text-[10px] text-[#4a154b]"><FileText className="h-3 w-3" />{tko_attachment.filename}<X className="h-3 w-3" /></button>)}</div> : null}<div className="flex items-center justify-between gap-2 border-t border-[#edeaed] px-2.5 py-2"><div className="flex items-center gap-0.5"><input ref={tko_fileInput} type="file" className="hidden" onChange={tko_event => { const tko_file = tko_event.target.files?.[0]; if (tko_file) tko_addAttachment(tko_file); tko_event.target.value = ""; }} /><TkoComposerButton label="Đính kèm" onClick={() => tko_fileInput.current?.click()}><Paperclip className="h-4 w-4" /></TkoComposerButton><TkoComposerButton label="In đậm" onClick={() => tko_insertFormatting("**")}><strong className="text-sm">B</strong></TkoComposerButton><TkoComposerButton label="In nghiêng" onClick={() => tko_insertFormatting("_")}><Italic className="h-4 w-4" /></TkoComposerButton><TkoComposerButton label="Chèn mã" onClick={() => tko_insertFormatting("`")}><Code2 className="h-4 w-4" /></TkoComposerButton><TkoComposerButton label="Nhắc thành viên" onClick={() => tko_setDraft(tko_current => `${tko_current}${tko_current && !tko_current.endsWith(" ") ? " " : ""}@`)}><AtSign className="h-4 w-4" /></TkoComposerButton><TkoComposerButton label="Emoji" onClick={() => tko_setDraft(tko_current => `${tko_current} ✨`)}><SmilePlus className="h-4 w-4" /></TkoComposerButton></div><div className="flex items-center gap-2"><span className="hidden text-[10px] text-[#8d898e] sm:block"><kbd className="rounded border border-[#e6e4eb] bg-[#faf9fa] px-1">↵</kbd> gửi</span><button onClick={tko_submit} disabled={!tko_channelId || ((!tko_draft.trim() && !tko_attachments.length) || tko_send.isPending)} className="flex items-center gap-1.5 rounded-lg bg-[#007a5a] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#006c4f] disabled:cursor-not-allowed disabled:opacity-40"><span>Gửi</span><SendHorizontal className="h-3.5 w-3.5" /></button></div></div></div></div></footer> : null}
        </main>
      </div>
      {false && tko_createChannelOpen ? <div /> : null}
      {tko_draggingFiles ? <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-[#4a154b]/10 p-5"><div className="rounded-2xl border-2 border-dashed border-[#4a154b] bg-white px-8 py-6 text-center shadow-xl"><Paperclip className="mx-auto h-7 w-7 text-[#4a154b]" /><p className="mt-2 text-sm font-bold text-[#4a154b]">Thả tệp để đính kèm</p><p className="mt-1 text-[11px] text-[#616061]">Tối đa 5 tệp, 5 MB mỗi tệp</p></div></div> : null}
      {tko_lightbox ? <div className="fixed inset-0 z-[80] grid place-items-center bg-[#111]/90 p-4" role="dialog" aria-modal="true" aria-label={`Xem ảnh ${tko_lightbox.filename}`} onClick={() => tko_setLightbox(null)}><button type="button" onClick={() => tko_setLightbox(null)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25" aria-label="Đóng ảnh"><X className="h-5 w-5" /></button><img src={tko_lightbox.url} alt={tko_lightbox.filename} onClick={tko_event => tko_event.stopPropagation()} className="max-h-[88vh] max-w-[94vw] rounded-lg object-contain shadow-2xl" /><p className="absolute bottom-4 max-w-[90vw] truncate rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white">{tko_lightbox.filename}</p></div> : null}
      {tko_reminderDraft ? <div className="fixed inset-0 z-[75] grid place-items-center bg-[#1d1c1d]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="tko-reminder-title"><form onSubmit={tko_event => { tko_event.preventDefault(); tko_createReminder.mutate({ title: tko_reminderDraft.title, note: tko_reminderDraft.note || null, reminderAt: new Date(tko_reminderDraft.reminderAt), messageId: tko_reminderDraft.messageId }); }} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(29,28,29,.3)]"><div className="flex items-start justify-between gap-4"><div><h3 id="tko-reminder-title" className="text-lg font-bold">Tạo reminder</h3><p className="mt-1 text-[12px] leading-5 text-[#616061]">{tko_reminderDraft.messageId ? "Nhắc lại về một tin nhắn đã chọn." : "Tạo một nhắc việc cá nhân, không cần liên kết tin nhắn."}</p></div><button type="button" onClick={() => tko_setReminderDraft(null)} className="rounded-md p-1 text-[#616061] hover:bg-[#efedf0]" aria-label="Đóng reminder"><X className="h-4 w-4" /></button></div><label className="mt-5 block text-[12px] font-semibold text-[#454245]">Việc cần nhắc<input required value={tko_reminderDraft.title} onChange={tko_event => tko_setReminderDraft(tko_current => tko_current ? { ...tko_current, title: tko_event.target.value } : null)} className="mt-1.5 w-full rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b]" placeholder="Ví dụ: Gọi lại cho khách hàng" /></label><label className="mt-3 block text-[12px] font-semibold text-[#454245]">Thời điểm nhắc<input required type="datetime-local" value={tko_reminderDraft.reminderAt} onChange={tko_event => tko_setReminderDraft(tko_current => tko_current ? { ...tko_current, reminderAt: tko_event.target.value } : null)} className="mt-1.5 w-full rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b]" /></label><label className="mt-3 block text-[12px] font-semibold text-[#454245]">Ghi chú <span className="font-normal text-[#8d898e]">(tùy chọn)</span><textarea value={tko_reminderDraft.note} onChange={tko_event => tko_setReminderDraft(tko_current => tko_current ? { ...tko_current, note: tko_event.target.value } : null)} className="mt-1.5 min-h-20 w-full resize-none rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b]" placeholder="Bối cảnh hoặc bước tiếp theo…" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => tko_setReminderDraft(null)} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[#616061] hover:bg-[#efedf0]">Hủy</button><button disabled={tko_createReminder.isPending} className="rounded-lg bg-[#4a154b] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Đặt reminder</button></div></form></div> : null}
      {tko_forwardDraft ? <div className="fixed inset-0 z-[75] grid place-items-center bg-[#1d1c1d]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="tko-forward-title"><form onSubmit={tko_event => { tko_event.preventDefault(); tko_forward.mutate({ messageId: tko_forwardDraft.messageId, targetChannelId: tko_forwardDraft.targetChannelId, note: tko_forwardDraft.note || undefined }); }} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(29,28,29,.3)]"><div className="flex items-start justify-between gap-4"><div><h3 id="tko-forward-title" className="text-lg font-bold">Chuyển tiếp tin nhắn</h3><p className="mt-1 text-[12px] leading-5 text-[#616061]">Nội dung và tệp đính kèm sẽ được gửi tới channel bạn chọn.</p></div><button type="button" onClick={() => tko_setForwardDraft(null)} className="rounded-md p-1 text-[#616061] hover:bg-[#efedf0]" aria-label="Đóng chuyển tiếp"><X className="h-4 w-4" /></button></div><label className="mt-5 block text-[12px] font-semibold text-[#454245]">Gửi tới channel<select value={tko_forwardDraft.targetChannelId} onChange={tko_event => tko_setForwardDraft(tko_current => tko_current ? { ...tko_current, targetChannelId: tko_event.target.value } : null)} className="mt-1.5 h-10 w-full rounded-lg border border-[#bdb7bf] bg-white px-3 text-sm outline-none focus:border-[#4a154b]">{(tko_channels.data ?? []).map(tko_channel => <option key={tko_channel.id} value={tko_channel.id}>{tko_channel.kind === "dm" || tko_channel.kind === "group_dm" ? "Tin nhắn trực tiếp" : `#${tko_channel.name}`}</option>)}</select></label><label className="mt-3 block text-[12px] font-semibold text-[#454245]">Lời nhắn <span className="font-normal text-[#8d898e]">(tùy chọn)</span><textarea value={tko_forwardDraft.note} onChange={tko_event => tko_setForwardDraft(tko_current => tko_current ? { ...tko_current, note: tko_event.target.value } : null)} className="mt-1.5 min-h-20 w-full resize-none rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b]" placeholder="Thêm bối cảnh cho người nhận…" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => tko_setForwardDraft(null)} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[#616061] hover:bg-[#efedf0]">Hủy</button><button disabled={tko_forward.isPending || !tko_forwardDraft.targetChannelId} className="rounded-lg bg-[#4a154b] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Chuyển tiếp</button></div></form></div> : null}
      {tko_channelSettingsOpen && tko_activeChannel ? <div className="fixed inset-0 z-50 grid place-items-center bg-[#1d1c1d]/45 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(29,28,29,.3)]"><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold">Thông tin channel</h3><p className="mt-1 text-[12px] text-[#616061]">Cập nhật thông tin hoặc quản lý vòng đời channel.</p></div><button onClick={() => tko_setChannelSettingsOpen(false)} className="rounded-md p-1.5 text-[#616061] hover:bg-[#efedf0]"><X className="h-4 w-4" /></button></div><label className="mt-5 block text-[12px] font-semibold text-[#454245]">Tên channel<input value={tko_channelName} onChange={tko_event => tko_setChannelName(tko_event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b]" /></label><label className="mt-3 block text-[12px] font-semibold text-[#454245]">Mục đích<input value={tko_channelTopic} onChange={tko_event => tko_setChannelTopic(tko_event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bdb7bf] px-3 py-2 text-sm outline-none focus:border-[#4a154b]" /></label><div className="mt-5 flex justify-end gap-2"><button onClick={() => tko_updateChannel.mutate({ channelId: tko_activeChannel.id, name: tko_channelName.trim() || undefined, topic: tko_channelTopic || null })} disabled={tko_updateChannel.isPending} className="rounded-lg bg-[#4a154b] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40">Lưu thay đổi</button></div><div className="mt-6 border-t border-[#e6e4eb] pt-4"><button onClick={() => { if (window.confirm("Lưu trữ channel này? Bạn vẫn có thể giữ lịch sử, nhưng channel sẽ biến khỏi danh sách hoạt động.")) tko_archiveChannel.mutate({ channelId: tko_activeChannel.id }); }} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-[#b33a3a] hover:bg-[#fff3f2]"><Archive className="h-3.5 w-3.5" />Lưu trữ channel</button></div></div></div> : null}
    </div>
  );
}

function TkoChannelRow({ channel, active, readState, onClick }: { channel: { id: string; name: string | null; kind: string; lastSequence: number }; active: boolean; readState: { lastReadSeq: number; unreadMentions: number } | undefined; onClick: () => void }) {
  const tko_unread = Math.max(channel.lastSequence - (readState?.lastReadSeq ?? 0), 0);
  const tko_private = channel.kind === "private";
  return <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition ${active ? "bg-[#e9e3f5] font-semibold text-[#4a154b]" : tko_unread ? "font-semibold text-[#1d1c1d] hover:bg-[#efedf0]" : "text-[#4f4b4f] hover:bg-[#efedf0]"}`}><span className="text-[#777477]">{tko_private ? <LockKeyhole className="h-3.5 w-3.5" /> : <Hash className="h-4 w-4" />}</span><span className="min-w-0 flex-1 truncate">{channel.name ?? "Tin nhắn trực tiếp"}</span>{readState?.unreadMentions ? <AtSign className="h-3.5 w-3.5 text-[#d72c0d]" /> : tko_unread ? <span className="h-2 w-2 rounded-full bg-[#611f69]" /> : null}</button>;
}

function TkoLegacyMessageRow({ message, previous, currentMemberId, saved, pinned, menuOpen, editing, editDraft, onEditDraft, onToggleMenu, onReact, onOpenThread, onReply, onSave, onPin, onQuote, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onOpenAttachment }: { message: any; previous: any; currentMemberId: string | undefined; saved: boolean; pinned: boolean; menuOpen: boolean; editing: boolean; editDraft: string; onEditDraft: (value: string) => void; onToggleMenu: () => void; onReact: (emoji: string) => void; onOpenThread: () => void; onReply: () => void; onSave: () => void; onPin: () => void; onQuote: () => void; onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: () => void; onDelete: () => void; onOpenAttachment: (attachment: any) => void }) {
  const tko_sameAuthor = previous?.authorMemberId === message.authorMemberId && Math.abs(new Date(message.createdAt).getTime() - new Date(previous?.createdAt ?? 0).getTime()) < 5 * 60_000;
  const tko_authorName = message.author?.displayName ?? `Thành viên ${message.authorMemberId.slice(0, 5)}`;
  const tko_quote = message.body.quotedMessageId;
  const tko_own = currentMemberId === message.authorMemberId;
  return <article className={`group relative -mx-3 px-3 py-2 transition hover:bg-[#faf9fa] sm:-mx-5 sm:px-5 ${tko_sameAuthor ? "mt-0" : "mt-3"}`}><div className="flex gap-3">{tko_sameAuthor ? <span className="w-9 shrink-0 pt-0.5 text-center text-[10px] text-transparent group-hover:text-[#777477]">{tko_time(message.createdAt)}</span> : <TkoAvatar name={tko_authorName} online={false} />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2">{!tko_sameAuthor ? <><button onClick={onOpenThread} className="text-[13px] font-bold text-[#1d1c1d] hover:underline">{tko_authorName}</button><span className="text-[10px] text-[#777477]">{tko_time(message.createdAt)}</span>{message.editedAt ? <span className="text-[10px] text-[#8d898e]">(đã sửa)</span> : null}</> : null}</div>{pinned ? <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#4a154b]"><Pin className="h-3 w-3" fill="currentColor" />Đã ghim vào channel</span> : null}{tko_quote ? <button onClick={onOpenThread} className="mt-1.5 flex max-w-xl items-center gap-1.5 rounded-r-md border-l-2 border-[#8a6ba7] bg-[#f8f6f8] px-2 py-1 text-left text-[11px] text-[#616061]"><Link2 className="h-3 w-3 shrink-0" />Đã trích dẫn một tin nhắn trong channel</button> : null}{editing ? <div className="mt-1.5 rounded-lg border border-[#bdb7bf] bg-white p-2"><textarea autoFocus value={editDraft} onChange={tko_event => onEditDraft(tko_event.target.value)} className="min-h-[74px] w-full resize-none text-[13px] outline-none" /><div className="mt-2 flex justify-end gap-2"><button onClick={onCancelEdit} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[#616061] hover:bg-[#efedf0]">Hủy</button><button onClick={onSaveEdit} className="rounded-md bg-[#4a154b] px-2.5 py-1 text-[11px] font-semibold text-white">Lưu</button></div></div> : message.body.text ? <p className="mt-0.5 max-w-3xl whitespace-pre-wrap text-[13px] leading-5 text-[#373438]">{message.body.text}</p> : null}{message.attachments.map((attachment: any) => <button type="button" key={attachment.id} onClick={() => onOpenAttachment(attachment)} className="mt-2 flex max-w-xs items-center gap-2 rounded-lg border border-[#dfdbe0] bg-white px-3 py-2 text-left shadow-sm transition hover:border-[#bdb7bf]"><span className="grid h-7 w-7 place-items-center rounded-md bg-[#f1eef2] text-[#4a154b]"><FileText className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-[#373438]">{attachment.filename}</span><span className="block text-[10px] text-[#777477]">Tệp đính kèm</span></span></button>)}<div className="mt-1.5 flex flex-wrap items-center gap-1">{message.reactions.map((reaction: any) => { const tko_selected = currentMemberId ? reaction.memberIds.includes(currentMemberId) : false; return <button key={reaction.emoji} onClick={() => onReact(reaction.emoji)} title={`${reaction.count} phản ứng ${reaction.emoji}`} className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition ${tko_selected ? "border-[#1264a3] bg-[#e8f5fa] text-[#1264a3]" : "border-[#dfdbe0] bg-white hover:border-[#8d898e]"}`}><span>{reaction.emoji}</span><span>{reaction.count}</span></button>; })}{message.replyCount ? <button onClick={onOpenThread} className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[#1264a3] hover:bg-[#e8f5fa]"><MessageCircleMore className="h-3.5 w-3.5" />{message.replyCount} phản hồi</button> : null}</div></div></div><div className="absolute right-5 top-1 hidden rounded-lg border border-[#dedade] bg-white p-0.5 shadow-[0_2px_8px_rgba(29,28,29,.14)] group-hover:flex">{tko_reactionChoices.slice(0, 3).map(tko_emoji => <button key={tko_emoji} onClick={() => onReact(tko_emoji)} className="rounded-md p-1.5 text-[#616061] hover:bg-[#f3edf4]" aria-label={`Thêm phản ứng ${tko_emoji}`}>{tko_emoji}</button>)}<button onClick={onReply} className="rounded-md p-1.5 text-[#616061] hover:bg-[#f3edf4]" aria-label="Trả lời thread"><MessageCircleMore className="h-3.5 w-3.5" /></button><button onClick={onSave} className={`rounded-md p-1.5 ${saved ? "text-[#4a154b]" : "text-[#616061]"} hover:bg-[#f3edf4]`} aria-label="Lưu để xử lý sau"><Bookmark className="h-3.5 w-3.5" fill={saved ? "currentColor" : "none"} /></button><button onClick={onPin} className={`rounded-md p-1.5 ${pinned ? "text-[#4a154b]" : "text-[#616061]"} hover:bg-[#f3edf4]`} aria-label={pinned ? "Bỏ ghim tin nhắn" : "Ghim tin nhắn"}><Pin className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} /></button><button onClick={onToggleMenu} className="rounded-md p-1.5 text-[#616061] hover:bg-[#f3edf4]" aria-label="Thêm thao tác"><MoreHorizontal className="h-3.5 w-3.5" /></button></div>{menuOpen ? <div className="absolute right-5 top-9 z-20 w-48 rounded-lg border border-[#e6e4eb] bg-white py-1 shadow-[0_12px_30px_rgba(29,28,29,.18)]"><button onClick={onQuote} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Link2 className="h-3.5 w-3.5" />Trích dẫn vào channel</button><button onClick={onSave} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Bookmark className="h-3.5 w-3.5" />{saved ? "Cập nhật đã lưu" : "Lưu để xử lý sau"}</button><button onClick={onPin} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Pin className="h-3.5 w-3.5" />{pinned ? "Bỏ ghim tin nhắn" : "Ghim vào channel"}</button>{tko_own ? <><button onClick={onStartEdit} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#454245] hover:bg-[#f5f1f6]"><Pencil className="h-3.5 w-3.5" />Chỉnh sửa tin nhắn</button><button onClick={onDelete} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#b33a3a] hover:bg-[#fff3f2]"><Trash2 className="h-3.5 w-3.5" />Xóa tin nhắn</button></> : null}</div> : null}</article>;
}

function TkoThreadAttachment({ messageId, attachment }: { messageId: string; attachment: any }) {
  const tko_image = tko_isImage(attachment.contentType ?? "");
  const tko_url = trpc.chat.attachmentUrl.useQuery({ messageId, attachmentId: attachment.id }, { enabled: tko_image, staleTime: 300_000 });
  const tko_open = () => window.dispatchEvent(new CustomEvent("tasko-chat-attachment", { detail: { messageId, attachmentId: attachment.id } }));
  if (!tko_image) return <button type="button" onClick={tko_open} className="mt-2 flex max-w-full items-center gap-2 rounded-lg border border-[#dfdbe0] bg-white px-2.5 py-2 text-left"><FileText className="h-3.5 w-3.5 text-[#4a154b]" /><span className="truncate text-[11px] font-semibold text-[#454245]">{attachment.filename}</span></button>;
  return <button type="button" onClick={tko_open} className="mt-2 block overflow-hidden rounded-lg border border-[#dfdbe0] bg-white text-left"><>{tko_url.data?.url ? <img src={tko_url.data.url} alt={attachment.filename} className="max-h-48 w-full object-cover" /> : <span className="grid h-20 w-40 place-items-center text-[10px] text-[#777477]">{tko_url.isError ? "Không tải được ảnh" : "Đang tải ảnh…"}</span>}</><span className="block truncate px-2 py-1 text-[10px] font-semibold text-[#616061]">{attachment.filename}</span></button>;
}

function TkoThreadMessage({ message, currentMemberId, root = false }: { message: any; currentMemberId: string | undefined; root?: boolean }) {
  const tko_name = message.author?.displayName ?? `Thành viên ${message.authorMemberId.slice(0, 5)}`;
  return <article className={root ? "rounded-xl border border-[#e6e4eb] bg-white p-3" : "mt-4 flex gap-2.5"}><TkoAvatar name={tko_name} small /><div className="min-w-0 flex-1"><div className="flex items-baseline gap-1.5"><span className="text-[12px] font-bold">{tko_name}</span><span className="text-[10px] text-[#777477]">{tko_time(message.createdAt)}</span>{currentMemberId === message.authorMemberId ? <span className="text-[10px] text-[#8d898e]">bạn</span> : null}</div>{message.body.text ? <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[#454245]">{message.body.text}</p> : null}{(message.attachments ?? []).map((tko_attachment: any) => <TkoThreadAttachment key={tko_attachment.id} messageId={message.id} attachment={tko_attachment} />)}<div className="mt-2 flex flex-wrap gap-1">{(message.reactions ?? []).map((tko_reaction: any) => <button type="button" key={tko_reaction.emoji} onClick={() => window.dispatchEvent(new CustomEvent("tasko-chat-react", { detail: { messageId: message.id, emoji: tko_reaction.emoji } }))} className={`rounded-md border px-1.5 py-0.5 text-[10px] ${currentMemberId && tko_reaction.memberIds.includes(currentMemberId) ? "border-[#1264a3] bg-[#e8f5fa] text-[#1264a3]" : "border-[#dfdbe0] bg-white text-[#616061]"}`}>{tko_reaction.emoji} {tko_reaction.count}</button>)}{tko_reactionChoices.map(tko_emoji => <button type="button" key={tko_emoji} onClick={() => window.dispatchEvent(new CustomEvent("tasko-chat-react", { detail: { messageId: message.id, emoji: tko_emoji } }))} className="rounded-md border border-transparent px-1 py-0.5 text-[11px] hover:border-[#dfdbe0] hover:bg-white" aria-label={`Thả cảm xúc ${tko_emoji}`}>{tko_emoji}</button>)}</div></div></article>;
}

function TkoReminderPanel({ reminders, onUpdate }: { reminders: any[]; onUpdate: (reminderId: string, status: "done" | "dismissed") => void }) {
  const tko_now = Date.now();
  return <section className="mx-auto max-w-3xl px-5 pb-1 pt-8 sm:px-8"><div className="rounded-2xl border border-[#dfd6e1] bg-[#fcfaff] p-4 shadow-[0_1px_2px_rgba(29,28,29,.04)]"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#4a154b] text-white"><Bell className="h-4 w-4" /></span><div><h2 className="text-sm font-bold text-[#1d1c1d]">Reminder của tôi</h2><p className="text-[11px] text-[#777477]">Các nhắc việc chỉ hiển thị với bạn.</p></div></div>{reminders.length ? <div className="mt-3 space-y-2">{reminders.map(tko_reminder => { const tko_due = new Date(tko_reminder.reminderAt).getTime() <= tko_now; return <article key={tko_reminder.id} className={`rounded-xl border p-3 ${tko_due ? "border-[#e8b4ab] bg-[#fff7f5]" : "border-[#e8e2eb] bg-white"}`}><div className="flex gap-3"><button type="button" onClick={() => onUpdate(tko_reminder.id, "done")} className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[#8a6ba7] text-transparent transition hover:bg-[#4a154b] hover:text-white" aria-label={`Hoàn thành ${tko_reminder.title}`}><Check className="h-3 w-3" /></button><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-[#373438]">{tko_reminder.title}</p>{tko_reminder.note ? <p className="mt-1 text-[11px] leading-4 text-[#616061]">{tko_reminder.note}</p> : null}<p className={`mt-2 flex items-center gap-1 text-[10px] font-semibold ${tko_due ? "text-[#b42318]" : "text-[#777477]"}`}><Clock3 className="h-3 w-3" />{tko_due ? "Đến hạn" : "Nhắc lúc"} {tko_fullTime(tko_reminder.reminderAt)}{tko_reminder.messageId ? <span className="ml-1 text-[#4a154b]">· từ tin nhắn</span> : null}</p></div><button type="button" onClick={() => onUpdate(tko_reminder.id, "dismissed")} className="shrink-0 rounded px-1.5 py-1 text-[10px] font-semibold text-[#777477] hover:bg-[#efedf0]">Bỏ qua</button></div></article>; })}</div> : <p className="mt-3 rounded-lg bg-white px-3 py-3 text-[11px] text-[#777477]">Chưa có reminder. Dùng nút <span className="font-semibold text-[#4a154b]">Nhắc việc</span> để thêm một mục mới hoặc chọn <span className="font-semibold text-[#4a154b]">Nhắc tôi</span> từ menu tin nhắn.</p>}</div></section>;
}

function TkoSavedView({ entries, onOpen }: { entries: any[]; onOpen: (entry: any) => void }) {
  return <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8"><div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f3edf4] text-[#4a154b]"><Bookmark className="h-5 w-5" /></span><div><h2 className="text-lg font-bold">Đã lưu để xử lý sau</h2><p className="mt-1 text-[13px] leading-5 text-[#616061]">Biến cuộc trao đổi thành một hàng đợi cá nhân. Các mục này chỉ hiển thị với bạn.</p></div></div>{entries.length ? <div className="mt-6 space-y-3">{entries.map(tko_entry => <button key={tko_entry.message.id} onClick={() => onOpen(tko_entry)} className="block w-full rounded-xl border border-[#e6e4eb] bg-white p-4 text-left transition hover:border-[#bdb7bf] hover:shadow-sm"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#4a154b]"><Hash className="h-3.5 w-3.5" />{tko_entry.channel.name ?? "Tin nhắn trực tiếp"}<span className="text-[#8d898e]">•</span><span className="text-[#777477]">{tko_entry.message.author?.displayName ?? "Thành viên"}</span></div><p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[#373438]">{tko_entry.message.body.text || "Tệp đính kèm"}</p><div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#777477]"><Clock3 className="h-3 w-3" />Đã lưu {tko_time(tko_entry.saved.createdAt)}</div></button>)}</div> : <TkoQueueEmpty icon={<Bookmark className="h-6 w-6" />} title="Chưa có tin nhắn nào được lưu" description="Dùng biểu tượng đánh dấu trên tin nhắn để đưa các việc cần theo dõi vào đây." />}</div>;
}

function TkoMentionsView({ entries, onOpen }: { entries: any[]; onOpen: (entry: any) => void }) {
  return <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8"><div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff3e0] text-[#b35300]"><AtSign className="h-5 w-5" /></span><div><h2 className="text-lg font-bold">Nhắc tên</h2><p className="mt-1 text-[13px] leading-5 text-[#616061]">Tập trung vào những trao đổi có yêu cầu trực tiếp dành cho bạn.</p></div></div>{entries.length ? <div className="mt-6 space-y-3">{entries.map(tko_entry => <button key={tko_entry.message.id} onClick={() => onOpen(tko_entry)} className="block w-full rounded-xl border border-[#e6e4eb] bg-white p-4 text-left transition hover:border-[#bdb7bf] hover:shadow-sm"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#4a154b]"><Hash className="h-3.5 w-3.5" />{tko_entry.channel.name ?? "Tin nhắn trực tiếp"}<span className="text-[#8d898e]">•</span><span className="text-[#777477]">{tko_entry.message.author?.displayName ?? "Thành viên"}</span></div><p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[#373438]">{tko_entry.message.body.text || "Tệp đính kèm"}</p></button>)}</div> : <TkoQueueEmpty icon={<AtSign className="h-6 w-6" />} title="Không có nhắc tên mới" description="Khi một thành viên nhắc bạn trong channel, tin đó sẽ xuất hiện ở đây." />}</div>;
}

function TkoThreadListView({ messages, onOpen }: { messages: any[]; onOpen: (message: any) => void }) {
  return <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8"><div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f5fa] text-[#1264a3]"><MessageCircleMore className="h-5 w-5" /></span><div><h2 className="text-lg font-bold">Threads trong channel</h2><p className="mt-1 text-[13px] leading-5 text-[#616061]">Theo dõi những cuộc thảo luận sâu hơn trong <span className="font-semibold text-[#4a154b]">channel đang mở</span>.</p></div></div>{messages.length ? <div className="mt-6 space-y-3">{messages.map(tko_message => <button key={tko_message.id} onClick={() => onOpen(tko_message)} className="block w-full rounded-xl border border-[#e6e4eb] bg-white p-4 text-left transition hover:border-[#bdb7bf] hover:shadow-sm"><div className="flex items-center gap-2"><TkoAvatar name={tko_message.author?.displayName ?? "Thành viên"} small /><span className="text-[12px] font-semibold">{tko_message.author?.displayName ?? "Thành viên"}</span><span className="text-[10px] text-[#777477]">{tko_time(tko_message.createdAt)}</span><span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-[#1264a3]"><MessageCircleMore className="h-3.5 w-3.5" />{tko_message.replyCount}</span></div><p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[#373438]">{tko_message.body.text || "Tệp đính kèm"}</p></button>)}</div> : <TkoQueueEmpty icon={<MessageCircleMore className="h-6 w-6" />} title="Chưa có thread nào trong channel" description="Khi một tin có phản hồi, bạn sẽ thấy thread trao đổi ở đây." />}</div>;
}

function TkoQueueEmpty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="mt-12 rounded-2xl border border-dashed border-[#d9d5da] bg-[#faf9fa] px-6 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-white text-[#777477] shadow-sm">{icon}</span><h3 className="mt-4 text-sm font-bold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-[#777477]">{description}</p></div>;
}

function TkoEmptyChannel({ onCreate }: { onCreate: () => void }) {
  return <div className="py-16 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#f3edf4] text-[#4a154b]"><Sparkles className="h-6 w-6" /></span><h3 className="mt-4 text-sm font-bold">Cuộc trao đổi bắt đầu từ đây</h3><p className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-[#777477]">Chia sẻ cập nhật, quyết định hoặc câu hỏi đầu tiên. Dùng thread khi cần mở rộng một chủ đề cụ thể.</p><button onClick={onCreate} className="mt-5 rounded-lg border border-[#4a154b] px-3 py-2 text-[12px] font-semibold text-[#4a154b] transition hover:bg-[#f5f1f6]">Tạo channel khác</button></div>;
}

function TkoLoadingMessages() {
  return <div className="space-y-5 py-5">{[1, 2, 3].map(tko_item => <div key={tko_item} className="flex gap-3"><span className="h-9 w-9 animate-pulse rounded-lg bg-[#efedf0]" /><div className="flex-1"><span className="block h-3 w-32 animate-pulse rounded bg-[#efedf0]" /><span className="mt-2 block h-3 w-4/5 animate-pulse rounded bg-[#f3f1f4]" /><span className="mt-2 block h-3 w-2/5 animate-pulse rounded bg-[#f3f1f4]" /></div></div>)}</div>;
}

function TkoChatLoadError({ onRetry }: { onRetry: () => void }) {
  return <div className="mx-auto grid min-h-[420px] max-w-lg place-items-center px-6 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#fff3f2] text-[#b33a3a]"><Info className="h-6 w-6" /></span><h3 className="mt-4 text-sm font-bold text-[#1d1c1d]">Không thể tải hội thoại</h3><p className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-[#777477]">Kết nối hoặc quyền truy cập có thể đã thay đổi. Thử tải lại dữ liệu trước khi tiếp tục.</p><button onClick={onRetry} className="mt-5 rounded-lg bg-[#4a154b] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-[#611f69]">Thử lại</button></div></div>;
}

function TkoComposerButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="grid h-7 w-7 place-items-center rounded-md text-[#616061] transition hover:bg-[#f3edf4] hover:text-[#4a154b]">{children}</button>;
}
