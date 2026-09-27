import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Building2, Search, Users } from "lucide-react";
import React, { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { TkoCrmDrawer, TkoCrmEmpty, TkoCrmField, TkoCrmFollowUpButton, TkoCrmModal, TkoCrmSectionTitle, TkoCrmSelect, TkoCrmTagInput, TkoCrmTimeline, tko_crmDate, tko_crmMemberLabel, tko_crmMoney, tko_parseTags, type TkoCrmCompany } from "./TkoCrmShared";

export function TkoCrmCompanyFormModal({ tko_company, tko_onClose }: { tko_company: TkoCrmCompany | null; tko_onClose: () => void }) {
  const tko_utils = trpc.useUtils();
  const [tko_draft, setTkoDraft] = useState({ name: tko_company?.name ?? "", domain: tko_company?.domain ?? "", website: tko_company?.website ?? "", industry: tko_company?.industry ?? "", employeeRange: tko_company?.employeeRange ?? "", country: tko_company?.country ?? "", lifecycleStatus: tko_company?.lifecycleStatus ?? "prospect", tags: (tko_company?.tags ?? []).join(", ") });
  const tko_save = trpc.crm.createCompany.useMutation({ onSuccess: async () => { toast.success("Đã tạo company."); await Promise.all([tko_utils.crm.companies.invalidate(), tko_utils.crm.overview.invalidate()]); tko_onClose(); }, onError: () => toast.error("Không thể tạo company.") });
  const tko_update = trpc.crm.updateCompany.useMutation({ onSuccess: async () => { toast.success("Đã cập nhật company."); await Promise.all([tko_utils.crm.companies.invalidate(), tko_utils.crm.company.invalidate(), tko_utils.crm.overview.invalidate()]); tko_onClose(); }, onError: () => toast.error("Không thể cập nhật company.") });
  function tko_set(tko_key: keyof typeof tko_draft, tko_value: string) { setTkoDraft(tko_current => ({ ...tko_current, [tko_key]: tko_value })); }
  function tko_submit(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_draft.name.trim()) { toast.error("Nhập tên company."); return; }
    const tko_payload = { name: tko_draft.name.trim(), domain: tko_draft.domain.trim(), website: tko_draft.website.trim(), industry: tko_draft.industry.trim(), employeeRange: tko_draft.employeeRange.trim(), country: tko_draft.country.trim(), lifecycleStatus: tko_draft.lifecycleStatus.trim(), tags: tko_parseTags(tko_draft.tags) };
    if (tko_company) tko_update.mutate({ companyId: tko_company.id, ...tko_payload }); else tko_save.mutate(tko_payload);
  }
  return <TkoCrmModal tko_eyebrow="CRM accounts" tko_title={tko_company ? "Edit company" : "New company"} tko_onClose={tko_onClose}><form onSubmit={tko_submit} className="space-y-3">
    <TkoCrmField tko_label="Name"><Input value={tko_draft.name} onChange={tko_event => tko_set("name", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Domain"><Input value={tko_draft.domain} onChange={tko_event => tko_set("domain", tko_event.target.value)} className="mt-1 rounded-sm" placeholder="acme.com" /></TkoCrmField><TkoCrmField tko_label="Website"><Input value={tko_draft.website} onChange={tko_event => tko_set("website", tko_event.target.value)} className="mt-1 rounded-sm" placeholder="https://" /></TkoCrmField></div>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Industry"><Input value={tko_draft.industry} onChange={tko_event => tko_set("industry", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Employee range"><Input value={tko_draft.employeeRange} onChange={tko_event => tko_set("employeeRange", tko_event.target.value)} className="mt-1 rounded-sm" placeholder="11-50" /></TkoCrmField></div>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Country"><Input value={tko_draft.country} onChange={tko_event => tko_set("country", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Lifecycle status"><TkoCrmSelect tko_value={tko_draft.lifecycleStatus} tko_onChange={tko_value => tko_set("lifecycleStatus", tko_value)} tko_ariaLabel="Lifecycle status">{["prospect", "qualified", "customer", "churned"].map(tko_status => <option key={tko_status} value={tko_status}>{tko_status}</option>)}</TkoCrmSelect></TkoCrmField></div>
    <TkoCrmField tko_label="Tags"><TkoCrmTagInput tko_tags={tko_draft.tags} tko_onChange={tko_value => tko_set("tags", tko_value)} /></TkoCrmField>
    <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_save.isPending || tko_update.isPending} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">{tko_save.isPending || tko_update.isPending ? "Saving…" : "Save company"}</Button></div>
  </form></TkoCrmModal>;
}

export function TkoCrmCompanyTable({ tko_companies, tko_members, tko_onOpen }: { tko_companies: TkoCrmCompany[]; tko_members: { id: string; displayName?: string | null }[]; tko_onOpen: (tko_company: TkoCrmCompany) => void }) {
  if (!tko_companies.length) return <TkoCrmEmpty tko_message="No companies match the current filters." />;
  return <div className="overflow-x-auto border border-[#dfe1e6] bg-white"><table className="w-full min-w-[720px] text-left text-xs"><thead><tr className="border-b border-[#dfe1e6] bg-[#fafbfc] text-[10px] uppercase tracking-[.08em] text-[#6b778c]"><th className="px-3 py-2 font-semibold">Company</th><th className="px-3 py-2 font-semibold">Domain</th><th className="px-3 py-2 font-semibold">Industry</th><th className="px-3 py-2 font-semibold">Lifecycle</th><th className="px-3 py-2 font-semibold">Owner</th><th className="px-3 py-2 font-semibold">Updated</th></tr></thead><tbody>{tko_companies.map(tko_company => <tr key={tko_company.id} onClick={() => tko_onOpen(tko_company)} className="cursor-pointer border-b border-[#f4f5f7] last:border-0 hover:bg-[#f7fbff]"><td className="px-3 py-2 font-semibold text-[#172b4d]">{tko_company.name}</td><td className="px-3 py-2 text-[#42526e]">{tko_company.domain || "—"}</td><td className="px-3 py-2 text-[#42526e]">{tko_company.industry || "—"}</td><td className="px-3 py-2"><span className="bg-[#deebff] px-2 py-0.5 text-[10px] font-semibold text-[#0052cc]">{tko_company.lifecycleStatus || "prospect"}</span></td><td className="px-3 py-2 text-[#42526e]">{tko_crmMemberLabel(tko_company.ownerMemberId, tko_members)}</td><td className="px-3 py-2 text-[#5e6c84]">{tko_crmDate(tko_company.updatedAt)}</td></tr>)}</tbody></table></div>;
}

const tko_companyTabs = ["contacts", "deals", "activities", "linked"] as const;

export function TkoCrmCompanyPanel({ tko_companyId, tko_members, tko_onClose, tko_onEdit, tko_onOpenContact }: { tko_companyId: string; tko_members: { id: string; displayName?: string | null }[]; tko_onClose: () => void; tko_onEdit: () => void; tko_onOpenContact?: (tko_contactId: string) => void }) {
  const [tko_tab, setTkoTab] = useState<(typeof tko_companyTabs)[number]>("contacts");
  const tko_detail = trpc.crm.company.useQuery({ companyId: tko_companyId }, { retry: false });
  const tko_workspaceLinks = trpc.workspace.entityLinks.useQuery({ entityType: "crm_company", entityId: tko_companyId }, { retry: false });
  const tko_company = tko_detail.data?.company;
  const tko_contacts = tko_detail.data?.contacts ?? [];
  const tko_deals = tko_detail.data?.deals ?? [];
  const tko_activities = tko_detail.data?.activities ?? [];
  const tko_links = tko_detail.data?.links ?? [];

  return <TkoCrmDrawer tko_eyebrow="Company 360" tko_title={tko_company?.name ?? "Company"} tko_subtitle={<span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />{tko_company ? `${tko_company.industry || "Unknown industry"} · ${tko_company.lifecycleStatus || "prospect"}` : "Loading…"}</span>} tko_onClose={tko_onClose}>
    {tko_company ? <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Domain</span><strong className="mt-1 block text-[#172b4d]">{tko_company.domain || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Website</span><strong className="mt-1 block break-all text-[#172b4d]">{tko_company.website || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Employees</span><strong className="mt-1 block text-[#172b4d]">{tko_company.employeeRange || "—"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Country · Owner</span><strong className="mt-1 block text-[#172b4d]">{tko_company.country || "—"} · {tko_crmMemberLabel(tko_company.ownerMemberId, tko_members)}</strong></div>
    </div> : <TkoCrmEmpty tko_message="Loading company…" />}
    {tko_company?.tags.length ? <div className="flex flex-wrap gap-1.5">{tko_company.tags.map(tko_tag => <span key={tko_tag} className="bg-[#f4f5f7] px-2 py-0.5 text-[10px] text-[#42526e]">{tko_tag}</span>)}</div> : null}
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={tko_onEdit} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">Edit</Button>{tko_company ? <TkoCrmFollowUpButton tko_entityType="company" tko_entityId={tko_company.id} tko_title={tko_company.name} /> : null}</div>
    <div className="flex gap-1.5 border-b border-[#dfe1e6] pb-2">{tko_companyTabs.map(tko_tabId => <button type="button" key={tko_tabId} onClick={() => setTkoTab(tko_tabId)} className={`px-2.5 py-1 text-[11px] font-semibold capitalize ${tko_tab === tko_tabId ? "border-b-2 border-[#0052cc] text-[#0052cc]" : "text-[#5e6c84] hover:text-[#172b4d]"}`}>{tko_tabId}</button>)}</div>
    {tko_tab === "contacts" ? <div>{tko_contacts.length ? <ul className="space-y-1.5">{tko_contacts.map(tko_contact => <li key={tko_contact.id}><button type="button" onClick={() => tko_onOpenContact?.(tko_contact.id)} className="flex w-full items-center justify-between border border-[#dfe1e6] bg-[#f4f5f7] px-2.5 py-2 text-left text-xs hover:border-[#4c9aff]"><span className="flex items-center gap-2 font-semibold text-[#172b4d]"><Users className="h-3.5 w-3.5 text-[#0052cc]" />{tko_contact.firstName} {tko_contact.lastName}{tko_contact.title ? <span className="font-normal text-[#5e6c84]">· {tko_contact.title}</span> : null}</span><span className="text-[10px] text-[#5e6c84]">{tko_contact.emails[0] ?? ""}</span></button></li>)}</ul> : <TkoCrmEmpty tko_message="No contacts connected to this company yet." />}</div> : null}
    {tko_tab === "deals" ? <div>{tko_deals.length ? <ul className="space-y-1.5">{tko_deals.map(tko_deal => <li key={tko_deal.id} className="flex items-center justify-between border border-[#dfe1e6] bg-[#f4f5f7] px-2.5 py-2 text-xs"><span className="font-semibold text-[#172b4d]">{tko_deal.name}</span><span className="text-[#5e6c84]">{tko_crmMoney(tko_deal.amountCents, tko_deal.currency)} · {tko_deal.probability}%</span></li>)}</ul> : <TkoCrmEmpty tko_message="No deals for this company yet." />}</div> : null}
    {tko_tab === "activities" ? <TkoCrmTimeline tko_activities={tko_activities} /> : null}
    {tko_tab === "linked" ? <div>
      <TkoCrmSectionTitle>CRM entity links</TkoCrmSectionTitle>{tko_links.length ? <ul className="mt-2 space-y-1.5">{tko_links.map(tko_link => <li key={tko_link.id} className="flex items-center justify-between border border-[#dfe1e6] bg-[#f4f5f7] px-2.5 py-1.5 text-xs"><span className="text-[#42526e]">{tko_link.targetType.replace(/_/g, " ")} · {tko_link.targetId.slice(0, 8)}</span><span className="text-[10px] text-[#5e6c84]">{tko_link.relationType.replace(/_/g, " ")}</span></li>)}</ul> : <TkoCrmEmpty tko_message="No linked work items, channels or documents yet." />}
      <div className="mt-4"><TkoCrmSectionTitle>Workspace links</TkoCrmSectionTitle>{(tko_workspaceLinks.data ?? []).length ? <ul className="mt-2 space-y-1.5">{(tko_workspaceLinks.data ?? []).map(tko_link => <li key={tko_link.id} className="flex items-center justify-between border border-[#dfe1e6] bg-white px-2.5 py-1.5 text-xs"><span className="text-[#42526e]">{tko_link.targetType.replace(/_/g, " ")} · {tko_link.targetId.slice(0, 8)}</span><span className="text-[10px] text-[#5e6c84]">{tko_link.relationType}</span></li>)}</ul> : <TkoCrmEmpty tko_message="Projects, work items, channels and documents linked from the workspace appear here without duplicating their data." />}</div>
    </div> : null}
  </TkoCrmDrawer>;
}

export function TkoCrmCompaniesView({ tko_isAuthenticated, tko_focusCompanyId, tko_onOpenContact }: { tko_isAuthenticated: boolean; tko_focusCompanyId?: string | null; tko_onOpenContact?: (tko_contactId: string) => void }) {
  const [tko_search, setTkoSearch] = useState("");
  const [tko_lifecycle, setTkoLifecycle] = useState("");
  const [tko_editOpen, setTkoEditOpen] = useState(false);
  const [tko_editing, setTkoEditing] = useState<TkoCrmCompany | null>(null);
  const [tko_selectedId, setTkoSelectedId] = useState<string | null>(tko_focusCompanyId ?? null);
  const tko_companiesQuery = trpc.crm.companies.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_members = trpc.workspaceMembers.list.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_companies = tko_companiesQuery.data ?? [];
  const tko_lifecycles = useMemo(() => Array.from(new Set(tko_companies.map(tko_company => tko_company.lifecycleStatus || "prospect"))), [tko_companies]);
  const tko_filtered = useMemo(() => {
    const tko_query = tko_search.trim().toLowerCase();
    return tko_companies.filter(tko_company => {
      if (tko_lifecycle && (tko_company.lifecycleStatus || "prospect") !== tko_lifecycle) return false;
      if (tko_query && !`${tko_company.name} ${tko_company.domain} ${tko_company.industry} ${tko_company.country}`.toLowerCase().includes(tko_query)) return false;
      return true;
    });
  }, [tko_companies, tko_lifecycle, tko_search]);

  if (!tko_isAuthenticated) return <TkoCrmEmpty tko_message="Sign in to view and manage companies." />;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 border border-[#dfe1e6] bg-white px-2.5"><Search className="h-3.5 w-3.5 text-[#5e6c84]" /><input value={tko_search} onChange={tko_event => setTkoSearch(tko_event.target.value)} placeholder="Search company, domain, industry…" className="w-full bg-transparent text-xs outline-none" /></div>
      <TkoCrmSelect tko_value={tko_lifecycle} tko_onChange={setTkoLifecycle} tko_ariaLabel="Lifecycle filter"><option value="">All lifecycle</option>{tko_lifecycles.map(tko_status => <option key={tko_status} value={tko_status}>{tko_status}</option>)}</TkoCrmSelect>
      <Button type="button" onClick={() => { setTkoEditing(null); setTkoEditOpen(true); }} className="h-9 rounded-sm bg-[#0052cc] px-3.5 text-xs font-semibold hover:bg-[#0747a6]">New company</Button>
    </div>
    {tko_companiesQuery.isLoading ? <TkoCrmEmpty tko_message="Loading companies…" /> : <TkoCrmCompanyTable tko_companies={tko_filtered} tko_members={tko_members.data ?? []} tko_onOpen={tko_company => setTkoSelectedId(tko_company.id)} />}
    {tko_editOpen ? <TkoCrmCompanyFormModal tko_company={tko_editing} tko_onClose={() => setTkoEditOpen(false)} /> : null}
    {tko_selectedId ? <TkoCrmCompanyPanel tko_companyId={tko_selectedId} tko_members={tko_members.data ?? []} tko_onClose={() => setTkoSelectedId(null)} tko_onEdit={() => { const tko_found = tko_companies.find(tko_company => tko_company.id === tko_selectedId); if (tko_found) { setTkoEditing(tko_found); setTkoEditOpen(true); } }} tko_onOpenContact={tko_contactId => tko_onOpenContact?.(tko_contactId)} /> : null}
  </div>;
}
