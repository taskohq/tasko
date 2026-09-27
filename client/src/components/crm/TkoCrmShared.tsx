import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { CalendarClock, FileText, Handshake, Link2, Mail, MessageSquare, Phone, StickyNote, X } from "lucide-react";
import React, { type ChangeEvent, type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

// ---- shared structural types (keep components pure and testable; trpc results conform) ----
export type TkoCrmMember = { id: string; displayName?: string | null };
export type TkoCrmLead = {
  id: string; firstName: string; lastName: string; companyName: string; jobTitle: string; email: string; phone: string; website: string; country: string; source: string; status: string; score: number | null; tags: string[]; notes: string; nextFollowUpAt: Date | string | null; ownerMemberId: string; convertedAt: Date | string | null; convertedCompanyId: string | null; convertedContactId: string | null; convertedDealId: string | null; updatedAt: Date | string;
};
export type TkoCrmCompany = { id: string; name: string; domain: string; website: string; industry: string; employeeRange: string; country: string; ownerMemberId: string; lifecycleStatus: string; tags: string[]; updatedAt: Date | string };
export type TkoCrmContact = { id: string; companyId: string | null; firstName: string; lastName: string; title: string; emails: string[]; phones: string[]; ownerMemberId: string; tags: string[]; updatedAt: Date | string };
export type TkoCrmPipeline = { id: string; name: string; active: boolean };
export type TkoCrmStage = { id: string; pipelineId: string; name: string; sortOrder: number; probabilityDefault: number; category: "open" | "won" | "lost" };
export type TkoCrmDeal = {
  id: string; companyId: string | null; pipelineId: string; stageId: string; name: string; amountCents: number | null; currency: string; probability: number; ownerMemberId: string; expectedCloseDate: Date | string | null; source: string; nextStep: string; wonAt: Date | string | null; lostAt: Date | string | null; lossReason: string; updatedAt: Date | string;
};
export type TkoCrmActivity = { id: string; entityType: string; entityId: string; activityType: string; subject: string; body: string; createdByMemberId: string; createdAt: Date | string };
export type TkoCrmLink = { id: string; targetType: string; targetId: string; relationType: string; createdAt: Date | string };

export const tko_leadStatuses = ["new", "contacted", "qualified", "nurture", "disqualified", "converted"] as const;
export const tko_leadStatusLabel: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", nurture: "Nurture", disqualified: "Disqualified", converted: "Converted" };
export const tko_lossReasons = ["Price", "Lost to competitor", "No budget", "No decision", "Timing", "Other"] as const;

// ---- pure helpers ----
export function tko_crmMoney(tko_cents: number | null | undefined, tko_currency?: string | null): string {
  if (tko_cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: tko_currency || "USD", maximumFractionDigits: 0 }).format(tko_cents / 100);
}
export function tko_crmDate(tko_value: Date | string | null | undefined): string {
  if (!tko_value) return "—";
  const tko_parsed = typeof tko_value === "string" ? new Date(tko_value) : tko_value;
  if (Number.isNaN(tko_parsed.getTime())) return "—";
  return tko_parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function tko_crmMemberLabel(tko_memberId: string | null | undefined, tko_members: TkoCrmMember[]): string {
  if (!tko_memberId) return "Unassigned";
  const tko_found = tko_members.find(tko_member => tko_member.id === tko_memberId);
  if (tko_found?.displayName) return tko_found.displayName;
  return tko_memberId.slice(0, 2).toUpperCase();
}
export function tko_leadDisplayName(tko_lead: Pick<TkoCrmLead, "firstName" | "lastName">): string { return `${tko_lead.firstName} ${tko_lead.lastName}`.trim(); }
export function tko_leadFollowUpDue(tko_lead: Pick<TkoCrmLead, "nextFollowUpAt" | "status">): boolean {
  if (!tko_lead.nextFollowUpAt || tko_lead.status === "converted" || tko_lead.status === "disqualified") return false;
  const tko_due = typeof tko_lead.nextFollowUpAt === "string" ? new Date(tko_lead.nextFollowUpAt) : tko_lead.nextFollowUpAt;
  return !Number.isNaN(tko_due.getTime()) && tko_due.getTime() <= Date.now() + 7 * 86_400_000;
}
export function tko_leadStatusClass(tko_status: string): string {
  switch (tko_status) {
    case "qualified": return "bg-[#deebff] text-[#0052cc]";
    case "contacted": return "bg-[#eae6ff] text-[#403294]";
    case "nurture": return "bg-[#fff7d6] text-[#7a5d00]";
    case "disqualified": return "bg-[#ffedfa] text-[#ae2a84]";
    case "converted": return "bg-[#e3fcef] text-[#006644]";
    default: return "bg-[#f4f5f7] text-[#42526e]";
  }
}
export function tko_filterDeals(tko_deals: TkoCrmDeal[], tko_filters: { ownerMemberId: string; companyId: string; closeWindow: "all" | "overdue" | "thisMonth" | "next30" }): TkoCrmDeal[] {
  const tko_now = Date.now();
  return tko_deals.filter(tko_deal => {
    if (tko_filters.ownerMemberId && tko_deal.ownerMemberId !== tko_filters.ownerMemberId) return false;
    if (tko_filters.companyId && (tko_deal.companyId ?? "") !== tko_filters.companyId) return false;
    if (tko_filters.closeWindow !== "all") {
      if (tko_deal.expectedCloseDate == null) return false;
      const tko_close = typeof tko_deal.expectedCloseDate === "string" ? new Date(tko_deal.expectedCloseDate) : tko_deal.expectedCloseDate;
      if (Number.isNaN(tko_close.getTime())) return false;
      if (tko_filters.closeWindow === "overdue" && tko_close.getTime() >= tko_now) return false;
      if (tko_filters.closeWindow === "thisMonth" && (tko_close.getMonth() !== new Date(tko_now).getMonth() || tko_close.getFullYear() !== new Date(tko_now).getFullYear())) return false;
      if (tko_filters.closeWindow === "next30" && (tko_close.getTime() < tko_now || tko_close.getTime() > tko_now + 30 * 86_400_000)) return false;
    }
    return true;
  });
}

// Deterministic idempotency key per (member, lead): stable across dialogs and reloads so
// double-submitting a conversion replays the same conversionKey and the backend dedupes.
function tko_hash32(tko_value: string, tko_seed: number): string {
  let tko_hash = tko_seed >>> 0;
  for (let tko_index = 0; tko_index < tko_value.length; tko_index++) { tko_hash ^= tko_value.charCodeAt(tko_index); tko_hash = Math.imul(tko_hash, 0x01000193) >>> 0; }
  return tko_hash.toString(16).padStart(8, "0");
}
export function tko_conversionKey(tko_memberId: string, tko_leadId: string): string {
  const tko_basis = `${tko_memberId}:${tko_leadId}`;
  const tko_raw = `${tko_hash32(tko_basis, 0x811c9dc5)}${tko_hash32(tko_basis, 0x9e3779b9)}${tko_hash32(tko_basis, 0x85ebca6b)}${tko_hash32(tko_basis, 0xc2b2ae35)}`;
  return `${tko_raw.slice(0, 8)}-${tko_raw.slice(8, 12)}-4${tko_raw.slice(13, 16)}-8${tko_raw.slice(17, 20)}-${tko_raw.slice(20, 32)}`;
}

// ---- shared chrome ----
export function TkoCrmModal({ tko_eyebrow, tko_title, tko_onClose, children: tko_children, tko_wide }: { tko_eyebrow: string; tko_title: string; tko_onClose: () => void; children?: ReactNode; tko_wide?: boolean }) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#091e42]/25 p-4" role="dialog" aria-modal="true" aria-label={tko_title}><div className={`flex max-h-[90vh] w-full flex-col overflow-y-auto border border-[#dfe1e6] bg-white p-5 shadow-xl ${tko_wide ? "max-w-2xl" : "max-w-md"}`}><div className="mb-5 flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.11em] text-[#5e6c84]">{tko_eyebrow}</p><h2 className="mt-1 text-lg font-semibold tracking-[-.03em] text-[#172b4d]">{tko_title}</h2></div><button type="button" onClick={tko_onClose} aria-label="Close dialog"><X className="h-4 w-4 text-[#5e6c84]" /></button></div>{tko_children}</div></div>;
}
export function TkoCrmDrawer({ tko_eyebrow, tko_title, tko_subtitle, tko_onClose, children: tko_children }: { tko_eyebrow: string; tko_title: ReactNode; tko_subtitle?: ReactNode; tko_onClose: () => void; children?: ReactNode }) {
  return <div className="fixed inset-0 z-[60] flex justify-end bg-[#091e42]/20" role="dialog" aria-modal="true" aria-label={typeof tko_title === "string" ? tko_title : tko_eyebrow}><aside className="h-full w-full max-w-[460px] overflow-y-auto border-l border-[#dfe1e6] bg-white shadow-[-16px_0_38px_rgba(9,30,66,.2)]"><div className="sticky top-0 z-10 border-b border-[#dfe1e6] bg-white p-5"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.11em] text-[#5e6c84]">{tko_eyebrow}</span><button type="button" onClick={tko_onClose} aria-label="Close panel" className="grid h-8 w-8 place-items-center rounded-sm text-[#5e6c84] hover:bg-[#f4f5f7]"><X className="h-4 w-4" /></button></div><h2 className="mt-3 text-xl font-semibold tracking-[-.03em] text-[#172b4d]">{tko_title}</h2>{tko_subtitle ? <div className="mt-1 text-[13px] text-[#5e6c84]">{tko_subtitle}</div> : null}</div><div className="space-y-6 p-5">{tko_children}</div></aside></div>;
}
export function TkoCrmEmpty({ tko_message }: { tko_message: string }) { return <div className="border border-dashed border-[#dfe1e6] bg-white p-6 text-center text-xs text-[#5e6c84]">{tko_message}</div>; }
export function TkoCrmField({ tko_label, children: tko_children, tko_className }: { tko_label: string; children?: ReactNode; tko_className?: string }) { return <label className={`block text-xs font-medium text-[#42526e] ${tko_className ?? ""}`}>{tko_label}{tko_children}</label>; }
export function TkoCrmSectionTitle({ children: tko_children }: { children?: ReactNode }) { return <p className="text-[10px] font-bold uppercase tracking-[.11em] text-[#5e6c84]">{tko_children}</p>; }
export function TkoCrmTimeline({ tko_activities }: { tko_activities: TkoCrmActivity[] }) {
  const tko_icons: Record<string, typeof StickyNote> = { note: StickyNote, call: Phone, meeting: Handshake, email_reference: Mail, status_change: MessageSquare, file: FileText, linked_work_event: Link2 };
  if (!tko_activities.length) return <TkoCrmEmpty tko_message="No activity recorded yet." />;
  return <ol className="space-y-2">{tko_activities.map(tko_activity => { const TkoIcon = tko_icons[tko_activity.activityType] ?? StickyNote; return <li key={tko_activity.id} className="flex items-start gap-2.5 border border-[#dfe1e6] bg-white p-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center bg-[#f4f5f7] text-[#0052cc]"><TkoIcon className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#172b4d]">{tko_activity.subject || tko_activity.activityType}</p>{tko_activity.body ? <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[#5e6c84]">{tko_activity.body}</p> : null}<p className="mt-1 flex items-center gap-1 text-[10px] text-[#97a0af]"><CalendarClock className="h-3 w-3" />{tko_crmDate(tko_activity.createdAt)} · {tko_activity.activityType.replace(/_/g, " ")}</p></div></li>; })}</ol>;
}

export function TkoCrmSelect({ tko_value, tko_onChange, children: tko_children, tko_ariaLabel }: { tko_value: string; tko_onChange: (tko_value: string) => void; children?: ReactNode; tko_ariaLabel?: string }) {
  return <select aria-label={tko_ariaLabel} value={tko_value} onChange={(tko_event: ChangeEvent<HTMLSelectElement>) => tko_onChange(tko_event.target.value)} className="mt-1 h-9 w-full border border-[#dfe1e6] bg-white px-2 text-xs text-[#172b4d] outline-none focus:border-[#4c9aff]">{tko_children}</select>;
}
export function tko_localDateTimeValue(tko_value: Date | string | null | undefined): string {
  if (!tko_value) return "";
  const tko_parsed = typeof tko_value === "string" ? new Date(tko_value) : tko_value;
  if (Number.isNaN(tko_parsed.getTime())) return "";
  const tko_pad = (tko_part: number) => String(tko_part).padStart(2, "0");
  return `${tko_parsed.getFullYear()}-${tko_pad(tko_parsed.getMonth() + 1)}-${tko_pad(tko_parsed.getDate())}T${tko_pad(tko_parsed.getHours())}:${tko_pad(tko_parsed.getMinutes())}`;
}
export function TkoCrmTagInput({ tko_tags, tko_onChange }: { tko_tags: string; tko_onChange: (tko_value: string) => void }) {
  return <Input value={tko_tags} onChange={tko_event => tko_onChange(tko_event.target.value)} className="mt-1 rounded-sm" placeholder="comma, separated, tags" />;
}
export function tko_parseTags(tko_value: string): string[] { return tko_value.split(",").map(tko_tag => tko_tag.trim()).filter(Boolean); }

// ---- follow-up (WorkItem) creation, reusable on every CRM entity ----
export function TkoCrmFollowUpButton({ tko_entityType, tko_entityId, tko_label = "Follow-up", tko_title }: { tko_entityType: "lead" | "company" | "contact" | "deal"; tko_entityId: string; tko_label?: string; tko_title?: string }) {
  const [tko_open, setTkoOpen] = useState(false);
  return <><Button type="button" size="sm" variant="outline" onClick={() => setTkoOpen(true)} className="h-8 rounded-sm border-[#dfe1e6] px-2.5 text-xs font-semibold text-[#0052cc] hover:bg-[#deebff]"><CalendarClock className="mr-1.5 h-3.5 w-3.5" />{tko_label}</Button>
    {tko_open ? <TkoCrmFollowUpDialog tko_entityType={tko_entityType} tko_entityId={tko_entityId} tko_entityLabel={tko_title ?? tko_entityId} tko_onClose={() => setTkoOpen(false)} /> : null}</>;
}

export function TkoCrmFollowUpDialog({ tko_entityType, tko_entityId, tko_entityLabel, tko_onClose }: { tko_entityType: "lead" | "company" | "contact" | "deal"; tko_entityId: string; tko_entityLabel: string; tko_onClose: () => void }) {
  const tko_utils = trpc.useUtils();
  const tko_projects = trpc.work.projects.useQuery(undefined, { retry: false });
  const tko_members = trpc.workspaceMembers.list.useQuery(undefined, { retry: false });
  const tko_me = trpc.platform.currentTenant.useQuery(undefined, { retry: false });
  const [tko_projectId, setTkoProjectId] = useState("");
  const [tko_title, setTkoTitle] = useState("");
  const [tko_dueAt, setTkoDueAt] = useState("");
  const [tko_assignee, setTkoAssignee] = useState("");
  const tko_resolvedProjectId = tko_projectId || tko_projects.data?.[0]?.id || "";
  const tko_create = trpc.crm.createFollowUp.useMutation({
    onSuccess: async tko_result => {
      toast.success(`Đã tạo follow-up ${tko_result.item.key}. Xem nó trong Work.`, { description: tko_result.item.title });
      await tko_utils.crm.overview.invalidate();
      tko_onClose();
    },
    onError: () => toast.error("Không thể tạo follow-up. Hãy thử lại."),
  });

  function tko_submit(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_resolvedProjectId) { toast.error("Chọn một dự án để gắn follow-up."); return; }
    if (!tko_title.trim()) { toast.error("Nhập tóm tắt follow-up."); return; }
    tko_create.mutate({ entityType: tko_entityType, entityId: tko_entityId, projectId: tko_resolvedProjectId, title: tko_title.trim(), dueAt: tko_dueAt ? new Date(tko_dueAt) : null, assigneeMemberIds: tko_assignee ? [tko_assignee] : undefined });
  }

  return <TkoCrmModal tko_eyebrow="CRM follow-up" tko_title="Create follow-up task" tko_onClose={tko_onClose}><form onSubmit={tko_submit} className="space-y-3"><p className="border border-[#b3d4ff] bg-[#deebff] px-2.5 py-1.5 text-[11px] text-[#0747a6]">Linked to {tko_entityType}: <strong>{tko_entityLabel}</strong>. Nó xuất hiện trong Work như một task bình thường.</p>
    <TkoCrmField tko_label="Project"><TkoCrmSelect tko_value={tko_resolvedProjectId} tko_onChange={setTkoProjectId} tko_ariaLabel="Project">{(tko_projects.data ?? []).map(tko_project => <option key={tko_project.id} value={tko_project.id}>{tko_project.key ? `${tko_project.key} · ` : ""}{tko_project.name}</option>)}{tko_projects.data?.length ? null : <option value="">Loading projects…</option>}</TkoCrmSelect></TkoCrmField>
    <TkoCrmField tko_label="Summary"><Input value={tko_title} onChange={tko_event => setTkoTitle(tko_event.target.value)} className="mt-1 rounded-sm" placeholder="Call to confirm scope" /></TkoCrmField>
    <div className="grid grid-cols-2 gap-3">
      <TkoCrmField tko_label="Due date"><Input type="datetime-local" value={tko_dueAt} onChange={tko_event => setTkoDueAt(tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField>
      <TkoCrmField tko_label="Assignee"><TkoCrmSelect tko_value={tko_assignee} tko_onChange={setTkoAssignee} tko_ariaLabel="Assignee"><option value="">Unassigned</option>{tko_me.data?.memberId ? <option value={tko_me.data.memberId}>Me</option> : null}{(tko_members.data ?? []).filter(tko_member => tko_member.id !== tko_me.data?.memberId).map(tko_member => <option key={tko_member.id} value={tko_member.id}>{tko_member.displayName || tko_member.id.slice(0, 8)}</option>)}</TkoCrmSelect></TkoCrmField>
    </div>
    <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_create.isPending} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">{tko_create.isPending ? "Creating…" : "Create follow-up"}</Button></div>
  </form></TkoCrmModal>;
}
