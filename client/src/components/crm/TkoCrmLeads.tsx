import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Building2, CheckCircle2, Search, Zap } from "lucide-react";
import React, { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { TkoCrmDrawer, TkoCrmEmpty, TkoCrmField, TkoCrmFollowUpButton, TkoCrmModal, TkoCrmSectionTitle, TkoCrmSelect, TkoCrmTagInput, TkoCrmTimeline, tko_crmDate, tko_crmMemberLabel, tko_conversionKey as tko_conversionKeyFor, tko_leadDisplayName, tko_leadFollowUpDue, tko_leadStatusClass, tko_leadStatusLabel, tko_leadStatuses, tko_localDateTimeValue, tko_parseTags, type TkoCrmCompany, type TkoCrmLead } from "./TkoCrmShared";

export function TkoCrmLeadStatusChips({ tko_value, tko_counts, tko_onChange }: { tko_value: string; tko_counts: Record<string, number>; tko_onChange: (tko_value: string) => void }) {
  return <div className="flex flex-wrap gap-1.5">{["all", ...tko_leadStatuses].map(tko_status => <button type="button" key={tko_status} onClick={() => tko_onChange(tko_status)} className={`border px-2.5 py-1 text-[11px] font-medium transition ${tko_value === tko_status ? "border-[#0052cc] bg-[#deebff] text-[#0052cc]" : "border-[#dfe1e6] bg-white text-[#5e6c84] hover:border-[#4c9aff]"}`}>{tko_status === "all" ? "All" : tko_leadStatusLabel[tko_status]}<span className="ml-1.5 text-[10px] text-[#97a0af]">{tko_counts[tko_status] ?? 0}</span></button>)}</div>;
}

export function TkoCrmLeadTable({ tko_leads, tko_members, tko_onOpen }: { tko_leads: TkoCrmLead[]; tko_members: { id: string; displayName?: string | null }[]; tko_onOpen: (tko_lead: TkoCrmLead) => void }) {
  if (!tko_leads.length) return <TkoCrmEmpty tko_message="No leads match the current filters." />;
  return <div className="overflow-x-auto border border-[#dfe1e6] bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="border-b border-[#dfe1e6] bg-[#fafbfc] text-[10px] uppercase tracking-[.08em] text-[#6b778c]"><th className="px-3 py-2 font-semibold">Lead</th><th className="px-3 py-2 font-semibold">Company</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">Owner</th><th className="px-3 py-2 font-semibold">Score</th><th className="px-3 py-2 font-semibold">Follow-up</th><th className="px-3 py-2 font-semibold">Updated</th></tr></thead><tbody>{tko_leads.map(tko_lead => <tr key={tko_lead.id} onClick={() => tko_onOpen(tko_lead)} className="cursor-pointer border-b border-[#f4f5f7] last:border-0 hover:bg-[#f7fbff]"><td className="px-3 py-2"><span className="font-semibold text-[#172b4d]">{tko_leadDisplayName(tko_lead)}</span>{tko_lead.email ? <span className="ml-2 text-[11px] text-[#5e6c84]">{tko_lead.email}</span> : null}</td><td className="px-3 py-2 text-[#42526e]">{tko_lead.companyName || "—"}</td><td className="px-3 py-2"><span className={`px-2 py-0.5 text-[10px] font-semibold ${tko_leadStatusClass(tko_lead.status)}`}>{tko_leadStatusLabel[tko_lead.status] ?? tko_lead.status}</span></td><td className="px-3 py-2 text-[#42526e]">{tko_crmMemberLabel(tko_lead.ownerMemberId, tko_members)}</td><td className="px-3 py-2 text-[#42526e]">{tko_lead.score ?? "—"}</td><td className="px-3 py-2"><span className={tko_leadFollowUpDue(tko_lead) ? "font-semibold text-[#ca3521]" : "text-[#5e6c84]"}>{tko_lead.nextFollowUpAt ? tko_crmDate(tko_lead.nextFollowUpAt) : "—"}</span></td><td className="px-3 py-2 text-[#5e6c84]">{tko_crmDate(tko_lead.updatedAt)}</td></tr>)}</tbody></table></div>;
}

export function TkoCrmLeadFormModal({ tko_lead, tko_onClose }: { tko_lead: TkoCrmLead | null; tko_onClose: () => void }) {
  const tko_utils = trpc.useUtils();
  const [tko_draft, setTkoDraft] = useState({
    firstName: tko_lead?.firstName ?? "", lastName: tko_lead?.lastName ?? "", companyName: tko_lead?.companyName ?? "", jobTitle: tko_lead?.jobTitle ?? "", email: tko_lead?.email ?? "", phone: tko_lead?.phone ?? "", website: tko_lead?.website ?? "", country: tko_lead?.country ?? "", source: tko_lead?.source ?? "", status: (tko_lead?.status ?? "new") as string, score: tko_lead?.score != null ? String(tko_lead.score) : "", tags: (tko_lead?.tags ?? []).join(", "), notes: tko_lead?.notes ?? "", nextFollowUpAt: tko_localDateTimeValue(tko_lead?.nextFollowUpAt),
  });
  const tko_save = trpc.crm.createLead.useMutation({ onSuccess: async () => { toast.success("Lead đã được thêm vào CRM."); await tko_utils.crm.overview.invalidate(); tko_onClose(); }, onError: () => toast.error("Không thể tạo lead. Hãy thử lại.") });
  const tko_update = trpc.crm.updateLead.useMutation({ onSuccess: async () => { toast.success("Đã cập nhật lead."); await Promise.all([tko_utils.crm.overview.invalidate(), tko_utils.crm.lead.invalidate(), tko_utils.crm.entityActivities.invalidate()]); tko_onClose(); }, onError: tko_error => toast.error(tko_error.message === "CRM_LEAD_STATUS_CONVERTED_REQUIRES_CONVERSION" ? "Không thể đặt lead về converted — hãy dùng Convert." : "Không thể cập nhật lead.") });

  function tko_set<K extends keyof typeof tko_draft>(tko_key: K, tko_value: string) { setTkoDraft(tko_current => ({ ...tko_current, [tko_key]: tko_value })); }
  function tko_submit(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_draft.firstName.trim() || !tko_draft.lastName.trim()) { toast.error("Nhập họ và tên lead trước khi lưu."); return; }
    const tko_common = { firstName: tko_draft.firstName.trim(), lastName: tko_draft.lastName.trim(), companyName: tko_draft.companyName.trim(), jobTitle: tko_draft.jobTitle.trim(), email: tko_draft.email.trim(), phone: tko_draft.phone.trim(), website: tko_draft.website.trim(), country: tko_draft.country.trim(), source: tko_draft.source.trim(), status: tko_draft.status as Exclude<typeof tko_leadStatuses[number], "converted">, score: tko_draft.score === "" ? null : Number(tko_draft.score), tags: tko_parseTags(tko_draft.tags), notes: tko_draft.notes, nextFollowUpAt: tko_draft.nextFollowUpAt ? new Date(tko_draft.nextFollowUpAt) : null };
    if (tko_lead) tko_update.mutate({ leadId: tko_lead.id, ...tko_common }); else tko_save.mutate(tko_common);
  }

  return <TkoCrmModal tko_eyebrow="CRM intake" tko_title={tko_lead ? "Edit lead" : "New lead"} tko_onClose={tko_onClose} tko_wide><form onSubmit={tko_submit} className="space-y-3">
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="First name"><Input value={tko_draft.firstName} onChange={tko_event => tko_set("firstName", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Last name"><Input value={tko_draft.lastName} onChange={tko_event => tko_set("lastName", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField></div>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Company name"><Input value={tko_draft.companyName} onChange={tko_event => tko_set("companyName", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Job title"><Input value={tko_draft.jobTitle} onChange={tko_event => tko_set("jobTitle", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField></div>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Email"><Input type="email" value={tko_draft.email} onChange={tko_event => tko_set("email", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Phone"><Input value={tko_draft.phone} onChange={tko_event => tko_set("phone", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField></div>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Website"><Input value={tko_draft.website} onChange={tko_event => tko_set("website", tko_event.target.value)} className="mt-1 rounded-sm" placeholder="https://" /></TkoCrmField><TkoCrmField tko_label="Country"><Input value={tko_draft.country} onChange={tko_event => tko_set("country", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField></div>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Source"><Input value={tko_draft.source} onChange={tko_event => tko_set("source", tko_event.target.value)} className="mt-1 rounded-sm" placeholder="referral, outbound…" /></TkoCrmField><TkoCrmField tko_label="Status"><TkoCrmSelect tko_value={tko_draft.status} tko_onChange={tko_value => tko_set("status", tko_value)} tko_ariaLabel="Lead status">{tko_leadStatuses.filter(tko_status => tko_status !== "converted").map(tko_status => <option key={tko_status} value={tko_status}>{tko_leadStatusLabel[tko_status]}</option>)}</TkoCrmSelect></TkoCrmField></div>
    <div className="grid grid-cols-3 gap-3"><TkoCrmField tko_label="Score (0-100)"><Input type="number" min={0} max={100} value={tko_draft.score} onChange={tko_event => tko_set("score", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Next follow-up"><Input type="datetime-local" value={tko_draft.nextFollowUpAt} onChange={tko_event => tko_set("nextFollowUpAt", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Tags"><TkoCrmTagInput tko_tags={tko_draft.tags} tko_onChange={tko_value => tko_set("tags", tko_value)} /></TkoCrmField></div>
    <TkoCrmField tko_label="Notes"><textarea value={tko_draft.notes} onChange={tko_event => tko_set("notes", tko_event.target.value)} className="mt-1 min-h-20 w-full border border-[#dfe1e6] p-2 text-xs outline-none focus:border-[#4c9aff]" /></TkoCrmField>
    <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_save.isPending || tko_update.isPending} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">{tko_save.isPending || tko_update.isPending ? "Saving…" : "Save lead"}</Button></div>
  </form></TkoCrmModal>;
}

export function TkoCrmConvertDialog({ tko_lead, tko_companies, tko_onClose }: { tko_lead: TkoCrmLead; tko_companies: TkoCrmCompany[]; tko_onClose: () => void }) {
  const tko_utils = trpc.useUtils();
  const tko_me = trpc.platform.currentTenant.useQuery(undefined, { retry: false });
  const tko_pipelines = trpc.crm.pipelines.useQuery(undefined, { retry: false });
  const tko_contacts = trpc.crm.contacts.useQuery({}, { retry: false });
  const [tko_companyMode, setTkoCompanyMode] = useState<"existing" | "new">(tko_companies.length ? "existing" : "new");
  const [tko_companyId, setTkoCompanyId] = useState(tko_companies[0]?.id ?? "");
  const [tko_newCompanyName, setTkoNewCompanyName] = useState(tko_lead.companyName || `${tko_lead.firstName} ${tko_lead.lastName} Company`);
  const [tko_contactMode, setTkoContactMode] = useState<"existing" | "new">("new");
  const [tko_contactId, setTkoContactId] = useState("");
  const [tko_createDeal, setTkoCreateDeal] = useState(true);
  const [tko_pipelineId, setTkoPipelineId] = useState("");
  const [tko_stageId, setTkoStageId] = useState("");
  const [tko_dealName, setTkoDealName] = useState(`${tko_lead.companyName || `${tko_lead.firstName} ${tko_lead.lastName}`} opportunity`);
  const [tko_dealAmount, setTkoDealAmount] = useState("");
  const [tko_outcome, setTkoOutcome] = useState<{ company: string; contact: string; deal: string | null; idempotent: boolean } | null>(null);
  const tko_resolvedPipelineId = tko_pipelineId || tko_pipelines.data?.[0]?.id || "";
  const tko_stages = trpc.crm.stages.useQuery({ pipelineId: tko_resolvedPipelineId || "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(tko_resolvedPipelineId), retry: false });
  const tko_resolvedStageId = tko_stageId || tko_stages.data?.find(tko_stage => tko_stage.category === "open")?.id || "";
  const tko_conversionKeyValue = tko_me.data?.memberId ? tko_conversionKeyFor(tko_me.data.memberId, tko_lead.id) : "";
  const tko_convert = trpc.crm.convertLead.useMutation({
    onSuccess: async tko_result => {
      setTkoOutcome({ company: tko_result.company.name, contact: `${tko_result.contact.firstName} ${tko_result.contact.lastName}`.trim(), deal: tko_result.deal?.name ?? null, idempotent: tko_result.idempotent });
      await Promise.all([tko_utils.crm.overview.invalidate(), tko_utils.crm.lead.invalidate(), tko_utils.crm.companies.invalidate(), tko_utils.crm.contacts.invalidate()]);
      toast.success(tko_result.idempotent ? "Lead đã được convert trước đó — kết quả giữ nguyên." : "Lead converted thành công.");
    },
    onError: () => toast.error("Không thể convert lead. Chỉ lead Qualified mới convert được."),
  });

  function tko_submit(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_conversionKeyValue) { toast.error("Đang tải định danh workspace — thử lại sau giây lát."); return; }
    if (tko_companyMode === "existing" && !tko_companyId) { toast.error("Chọn company hiện có hoặc chuyển sang tạo mới."); return; }
    if (tko_contactMode === "existing" && !tko_contactId) { toast.error("Chọn contact hiện có hoặc chuyển sang tạo mới."); return; }
    if (tko_createDeal && (!tko_resolvedPipelineId || !tko_resolvedStageId)) { toast.error("Chọn pipeline và stage cho deal."); return; }
    tko_convert.mutate({ leadId: tko_lead.id, conversionKey: tko_conversionKeyValue, companyId: tko_companyMode === "existing" ? tko_companyId : undefined, contactId: tko_contactMode === "existing" ? tko_contactId : undefined, createDeal: tko_createDeal, pipelineId: tko_createDeal ? tko_resolvedPipelineId : undefined, stageId: tko_createDeal ? tko_resolvedStageId : undefined, dealName: tko_createDeal ? tko_dealName.trim() || undefined : undefined, dealAmountCents: tko_createDeal && tko_dealAmount !== "" ? Math.round(Number(tko_dealAmount) * 100) : null });
  }

  if (tko_outcome) return <TkoCrmModal tko_eyebrow="Lead conversion" tko_title="Lead converted" tko_onClose={tko_onClose}><div className="space-y-3"><div className="flex items-center gap-2 border border-[#abf5d1] bg-[#e3fcef] px-3 py-2.5 text-xs font-semibold text-[#006644]"><CheckCircle2 className="h-4 w-4" />{tko_outcome.idempotent ? "Idempotent replay — this lead was already converted." : "Conversion completed."}</div>
    <ul className="space-y-2 text-xs"><li className="border border-[#dfe1e6] bg-[#f4f5f7] p-2.5"><span className="text-[#5e6c84]">Company</span><strong className="ml-2 text-[#172b4d]">{tko_outcome.company}</strong></li><li className="border border-[#dfe1e6] bg-[#f4f5f7] p-2.5"><span className="text-[#5e6c84]">Contact</span><strong className="ml-2 text-[#172b4d]">{tko_outcome.contact}</strong></li><li className="border border-[#dfe1e6] bg-[#f4f5f7] p-2.5"><span className="text-[#5e6c84]">Deal</span><strong className="ml-2 text-[#172b4d]">{tko_outcome.deal ?? "Not created"}</strong></li></ul>
    <p className="text-[11px] text-[#5e6c84]">Activities, source and history stay on the lead record and were linked through conversion.</p>
    <div className="flex justify-end"><Button type="button" onClick={tko_onClose} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">Done</Button></div></div></TkoCrmModal>;

  return <TkoCrmModal tko_eyebrow="Lead conversion" tko_title={`Convert ${tko_leadDisplayName(tko_lead)}`} tko_onClose={tko_onClose}><form onSubmit={tko_submit} className="space-y-4">
    <section><TkoCrmSectionTitle>Company</TkoCrmSectionTitle><div className="mt-2 flex gap-2">{(["existing", "new"] as const).map(tko_mode => <button type="button" key={tko_mode} onClick={() => setTkoCompanyMode(tko_mode)} className={`border px-2.5 py-1 text-[11px] font-medium ${tko_companyMode === tko_mode ? "border-[#0052cc] bg-[#deebff] text-[#0052cc]" : "border-[#dfe1e6] text-[#5e6c84]"}`}>{tko_mode === "existing" ? "Existing" : "New"}</button>)}</div>{tko_companyMode === "existing" ? <TkoCrmSelect tko_value={tko_companyId} tko_onChange={setTkoCompanyId} tko_ariaLabel="Existing company">{tko_companies.map(tko_company => <option key={tko_company.id} value={tko_company.id}>{tko_company.name}</option>)}{tko_companies.length ? null : <option value="">No companies yet</option>}</TkoCrmSelect> : <TkoCrmField tko_label="New company name" tko_className="mt-2"><Input value={tko_newCompanyName} onChange={tko_event => setTkoNewCompanyName(tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField>}</section>
    <section><TkoCrmSectionTitle>Contact</TkoCrmSectionTitle><div className="mt-2 flex gap-2">{(["existing", "new"] as const).map(tko_mode => <button type="button" key={tko_mode} onClick={() => setTkoContactMode(tko_mode)} className={`border px-2.5 py-1 text-[11px] font-medium ${tko_contactMode === tko_mode ? "border-[#0052cc] bg-[#deebff] text-[#0052cc]" : "border-[#dfe1e6] text-[#5e6c84]"}`}>{tko_mode === "existing" ? "Existing" : "New from lead"}</button>)}</div>{tko_contactMode === "existing" ? <TkoCrmSelect tko_value={tko_contactId} tko_onChange={setTkoContactId} tko_ariaLabel="Existing contact">{(tko_contacts.data ?? []).map(tko_contact => <option key={tko_contact.id} value={tko_contact.id}>{tko_contact.firstName} {tko_contact.lastName}</option>)}{(tko_contacts.data ?? []).length ? null : <option value="">No contacts yet</option>}</TkoCrmSelect> : <p className="mt-2 text-[11px] text-[#5e6c84]">A contact will be created from the lead name, title, email and phone.</p>}</section>
    <section><TkoCrmSectionTitle>Deal</TkoCrmSectionTitle><label className="mt-2 flex items-center gap-2 text-xs font-medium text-[#42526e]"><input type="checkbox" checked={tko_createDeal} onChange={tko_event => setTkoCreateDeal(tko_event.target.checked)} />Create a deal</label>{tko_createDeal ? <div className="mt-2 space-y-3">
      <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Pipeline"><TkoCrmSelect tko_value={tko_resolvedPipelineId} tko_onChange={tko_value => { setTkoPipelineId(tko_value); setTkoStageId(""); }} tko_ariaLabel="Pipeline">{(tko_pipelines.data ?? []).map(tko_pipeline => <option key={tko_pipeline.id} value={tko_pipeline.id}>{tko_pipeline.name}</option>)}{tko_pipelines.data?.length ? null : <option value="">No pipelines yet</option>}</TkoCrmSelect></TkoCrmField><TkoCrmField tko_label="Stage"><TkoCrmSelect tko_value={tko_resolvedStageId} tko_onChange={setTkoStageId} tko_ariaLabel="Stage">{(tko_stages.data ?? []).map(tko_stage => <option key={tko_stage.id} value={tko_stage.id}>{tko_stage.name}</option>)}</TkoCrmSelect></TkoCrmField></div>
      <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Deal name"><Input value={tko_dealName} onChange={tko_event => setTkoDealName(tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Amount (USD)"><Input type="number" min={0} step="0.01" value={tko_dealAmount} onChange={tko_event => setTkoDealAmount(tko_event.target.value)} className="mt-1 rounded-sm" placeholder="0.00" /></TkoCrmField></div>
    </div> : null}</section>
    <p className="text-[11px] text-[#5e6c84]">Conversion is idempotent — retrying reuses conversion key <span className="font-mono">{tko_conversionKeyValue ? `${tko_conversionKeyValue.slice(0, 8)}…` : "…"}</span>.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_convert.isPending || !tko_conversionKeyValue} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]"><Zap className="mr-1.5 h-3.5 w-3.5" />{tko_convert.isPending ? "Converting…" : "Convert lead"}</Button></div>
  </form></TkoCrmModal>;
}

function TkoCrmLeadDrawer({ tko_lead, tko_companies, tko_members, tko_onClose, tko_onEdit, tko_onConvert }: { tko_lead: TkoCrmLead; tko_companies: TkoCrmCompany[]; tko_members: { id: string; displayName?: string | null }[]; tko_onClose: () => void; tko_onEdit: () => void; tko_onConvert: () => void }) {
  const tko_utils = trpc.useUtils();
  const tko_detail = trpc.crm.lead.useQuery({ leadId: tko_lead.id }, { retry: false });
  const tko_statusChange = trpc.crm.updateLead.useMutation({ onSuccess: async () => { toast.success("Đã đổi trạng thái lead."); await Promise.all([tko_utils.crm.overview.invalidate(), tko_utils.crm.lead.invalidate(), tko_utils.crm.entityActivities.invalidate()]); }, onError: () => toast.error("Không thể đổi trạng thái lead.") });
  const tko_activities = tko_detail.data?.activities ?? [];
  const tko_links = tko_detail.data?.links ?? [];
  const tko_companyName = tko_lead.convertedCompanyId ? tko_companies.find(tko_company => tko_company.id === tko_lead.convertedCompanyId)?.name ?? "Converted company" : tko_lead.companyName;

  return <TkoCrmDrawer tko_eyebrow="Lead details" tko_title={tko_leadDisplayName(tko_lead)} tko_subtitle={<span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />{tko_companyName || "No company"}</span>} tko_onClose={tko_onClose}>
    {tko_lead.status === "converted" ? <div className="flex items-center gap-2 border border-[#abf5d1] bg-[#e3fcef] px-3 py-2 text-xs font-semibold text-[#006644]"><CheckCircle2 className="h-4 w-4" />Converted {tko_lead.convertedAt ? `on ${tko_crmDate(tko_lead.convertedAt)}` : ""}</div> : null}
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Status</span><TkoCrmSelect tko_value={tko_lead.status} tko_onChange={tko_value => tko_statusChange.mutate({ leadId: tko_lead.id, status: tko_value as "new" })} tko_ariaLabel="Change status">{tko_leadStatuses.map(tko_status => <option key={tko_status} value={tko_status}>{tko_leadStatusLabel[tko_status]}</option>)}</TkoCrmSelect></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Owner</span><strong className="mt-1 block text-[#172b4d]">{tko_crmMemberLabel(tko_lead.ownerMemberId, tko_members)}</strong><span className="mt-1 block text-[10px] text-[#5e6c84]">Score {tko_lead.score ?? "—"}</span></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Email</span><strong className="mt-1 block break-all text-[#172b4d]">{tko_lead.email || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Phone</span><strong className="mt-1 block text-[#172b4d]">{tko_lead.phone || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Website</span><strong className="mt-1 block break-all text-[#172b4d]">{tko_lead.website || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Source · Country</span><strong className="mt-1 block text-[#172b4d]">{tko_lead.source || "—"} · {tko_lead.country || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Job title</span><strong className="mt-1 block text-[#172b4d]">{tko_lead.jobTitle || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Next follow-up</span><strong className={`mt-1 block ${tko_leadFollowUpDue(tko_lead) ? "text-[#ca3521]" : "text-[#172b4d]"}`}>{tko_lead.nextFollowUpAt ? tko_crmDate(tko_lead.nextFollowUpAt) : "—"}</strong></div>
    </div>
    {tko_lead.tags.length ? <div className="flex flex-wrap gap-1.5">{tko_lead.tags.map(tko_tag => <span key={tko_tag} className="bg-[#f4f5f7] px-2 py-0.5 text-[10px] text-[#42526e]">{tko_tag}</span>)}</div> : null}
    {tko_lead.notes ? <div><TkoCrmSectionTitle>Notes</TkoCrmSectionTitle><p className="mt-2 whitespace-pre-wrap text-xs text-[#42526e]">{tko_lead.notes}</p></div> : null}
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={tko_onEdit} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">Edit</Button>{tko_lead.status === "qualified" ? <Button type="button" size="sm" onClick={tko_onConvert} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]"><Zap className="mr-1.5 h-3.5 w-3.5" />Convert</Button> : <Button type="button" size="sm" disabled title="Lead must be Qualified before conversion" className="h-8 rounded-sm bg-[#f4f5f7] text-xs text-[#97a0af]"><Zap className="mr-1.5 h-3.5 w-3.5" />Convert</Button>}<TkoCrmFollowUpButton tko_entityType="lead" tko_entityId={tko_lead.id} tko_title={tko_leadDisplayName(tko_lead)} /></div>
    <div><TkoCrmSectionTitle>Activity timeline</TkoCrmSectionTitle><div className="mt-2"><TkoCrmTimeline tko_activities={tko_activities} /></div></div>
    <div><TkoCrmSectionTitle>Linked objects</TkoCrmSectionTitle>{tko_links.length ? <ul className="mt-2 space-y-1.5">{tko_links.map(tko_link => <li key={tko_link.id} className="flex items-center justify-between border border-[#dfe1e6] bg-[#f4f5f7] px-2.5 py-1.5 text-xs"><span className="text-[#42526e]">{tko_link.targetType.replace(/_/g, " ")} · {tko_link.targetId.slice(0, 8)}</span><span className="text-[10px] text-[#5e6c84]">{tko_link.relationType.replace(/_/g, " ")}</span></li>)}</ul> : <TkoCrmEmpty tko_message="No work items or channels linked yet." />}</div>
  </TkoCrmDrawer>;
}

export function TkoCrmLeadsView({ tko_isAuthenticated }: { tko_isAuthenticated: boolean }) {
  const tko_utils = trpc.useUtils();
  const [tko_status, setTkoStatus] = useState("all");
  const [tko_owner, setTkoOwner] = useState("");
  const [tko_followUpOnly, setTkoFollowUpOnly] = useState(false);
  const [tko_search, setTkoSearch] = useState("");
  const [tko_selectedId, setTkoSelectedId] = useState<string | null>(null);
  const [tko_editOpen, setTkoEditOpen] = useState(false);
  const [tko_editing, setTkoEditing] = useState<TkoCrmLead | null>(null);
  const [tko_convertId, setTkoConvertId] = useState<string | null>(null);
  const tko_overview = trpc.crm.overview.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_members = trpc.workspaceMembers.list.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_leads = tko_overview.data?.leads ?? [];
  const tko_companies = tko_overview.data?.companies ?? [];
  const tko_selected = tko_leads.find(tko_lead => tko_lead.id === tko_selectedId) ?? null;
  const tko_convertLead = tko_leads.find(tko_lead => tko_lead.id === tko_convertId) ?? null;

  const tko_counts = useMemo(() => { const tko_map: Record<string, number> = { all: tko_leads.length }; for (const tko_lead of tko_leads) tko_map[tko_lead.status] = (tko_map[tko_lead.status] ?? 0) + 1; return tko_map; }, [tko_leads]);
  const tko_filtered = useMemo(() => {
    const tko_query = tko_search.trim().toLowerCase();
    return tko_leads.filter(tko_lead => {
      if (tko_status !== "all" && tko_lead.status !== tko_status) return false;
      if (tko_owner && tko_lead.ownerMemberId !== tko_owner) return false;
      if (tko_followUpOnly && !tko_leadFollowUpDue(tko_lead)) return false;
      if (tko_query && !`${tko_lead.firstName} ${tko_lead.lastName} ${tko_lead.companyName} ${tko_lead.email} ${tko_lead.source}`.toLowerCase().includes(tko_query)) return false;
      return true;
    });
  }, [tko_leads, tko_status, tko_owner, tko_followUpOnly, tko_search]);
  const tko_ownerOptions = useMemo(() => Array.from(new Set(tko_leads.map(tko_lead => tko_lead.ownerMemberId))), [tko_leads]);

  if (!tko_isAuthenticated) return <TkoCrmEmpty tko_message="Sign in to view and manage leads." />;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 border border-[#dfe1e6] bg-white px-2.5"><Search className="h-3.5 w-3.5 text-[#5e6c84]" /><input value={tko_search} onChange={tko_event => setTkoSearch(tko_event.target.value)} placeholder="Search name, company, email…" className="w-full bg-transparent text-xs outline-none" /></div>
      <TkoCrmSelect tko_value={tko_owner} tko_onChange={setTkoOwner} tko_ariaLabel="Owner filter"><option value="">All owners</option>{tko_ownerOptions.map(tko_ownerId => <option key={tko_ownerId} value={tko_ownerId}>{tko_crmMemberLabel(tko_ownerId, tko_members.data ?? [])}</option>)}</TkoCrmSelect>
      <label className="flex h-9 items-center gap-2 border border-[#dfe1e6] bg-white px-2.5 text-xs text-[#42526e]"><input type="checkbox" checked={tko_followUpOnly} onChange={tko_event => setTkoFollowUpOnly(tko_event.target.checked)} />Follow-up due</label>
      <Button type="button" onClick={() => setTkoEditing(null)} className="h-9 rounded-sm bg-[#0052cc] px-3.5 text-xs font-semibold hover:bg-[#0747a6]">New lead</Button>
    </div>
    <TkoCrmLeadStatusChips tko_value={tko_status} tko_counts={tko_counts} tko_onChange={setTkoStatus} />
    {tko_overview.isLoading ? <TkoCrmEmpty tko_message="Loading leads…" /> : <TkoCrmLeadTable tko_leads={tko_filtered} tko_members={tko_members.data ?? []} tko_onOpen={tko_lead => setTkoSelectedId(tko_lead.id)} />}
    {tko_editOpen ? <TkoCrmLeadFormModal tko_lead={tko_editing} tko_onClose={() => setTkoEditOpen(false)} /> : null}
    {tko_selected ? <TkoCrmLeadDrawer tko_lead={tko_selected} tko_companies={tko_companies} tko_members={tko_members.data ?? []} tko_onClose={() => setTkoSelectedId(null)} tko_onEdit={() => { setTkoEditing(tko_selected); setTkoEditOpen(true); }} tko_onConvert={() => setTkoConvertId(tko_selected.id)} /> : null}
    {tko_convertLead ? <TkoCrmConvertDialog tko_lead={tko_convertLead} tko_companies={tko_companies} tko_onClose={() => setTkoConvertId(null)} /> : null}
  </div>;
}
