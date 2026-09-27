import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Building2, Search } from "lucide-react";
import React, { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { TkoCrmDrawer, TkoCrmEmpty, TkoCrmField, TkoCrmFollowUpButton, TkoCrmModal, TkoCrmSectionTitle, TkoCrmSelect, TkoCrmTagInput, TkoCrmTimeline, tko_crmDate, tko_crmMemberLabel, tko_localDateTimeValue, tko_parseTags, type TkoCrmCompany, type TkoCrmContact } from "./TkoCrmShared";

export function TkoCrmContactFormModal({ tko_contact, tko_companies, tko_defaultCompanyId, tko_onClose }: { tko_contact: TkoCrmContact | null; tko_companies: TkoCrmCompany[]; tko_defaultCompanyId?: string | null; tko_onClose: () => void }) {
  const tko_utils = trpc.useUtils();
  const [tko_draft, setTkoDraft] = useState({ firstName: tko_contact?.firstName ?? "", lastName: tko_contact?.lastName ?? "", title: tko_contact?.title ?? "", email: tko_contact?.emails[0] ?? "", phone: tko_contact?.phones[0] ?? "", companyId: tko_contact?.companyId ?? tko_defaultCompanyId ?? "", tags: (tko_contact?.tags ?? []).join(", ") });
  const tko_save = trpc.crm.createContact.useMutation({ onSuccess: async () => { toast.success("Đã tạo contact."); await Promise.all([tko_utils.crm.contacts.invalidate(), tko_utils.crm.company.invalidate()]); tko_onClose(); }, onError: () => toast.error("Không thể tạo contact.") });
  const tko_update = trpc.crm.updateContact.useMutation({ onSuccess: async () => { toast.success("Đã cập nhật contact."); await Promise.all([tko_utils.crm.contacts.invalidate(), tko_utils.crm.contact.invalidate(), tko_utils.crm.company.invalidate()]); tko_onClose(); }, onError: () => toast.error("Không thể cập nhật contact.") });
  function tko_set(tko_key: keyof typeof tko_draft, tko_value: string) { setTkoDraft(tko_current => ({ ...tko_current, [tko_key]: tko_value })); }
  function tko_submit(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_draft.firstName.trim() || !tko_draft.lastName.trim()) { toast.error("Nhập họ và tên contact."); return; }
    const tko_payload = { firstName: tko_draft.firstName.trim(), lastName: tko_draft.lastName.trim(), title: tko_draft.title.trim(), emails: tko_draft.email.trim() ? [tko_draft.email.trim()] : [], phones: tko_draft.phone.trim() ? [tko_draft.phone.trim()] : [], companyId: tko_draft.companyId || null, tags: tko_parseTags(tko_draft.tags) };
    if (tko_contact) tko_update.mutate({ contactId: tko_contact.id, ...tko_payload }); else tko_save.mutate(tko_payload);
  }
  return <TkoCrmModal tko_eyebrow="CRM people" tko_title={tko_contact ? "Edit contact" : "New contact"} tko_onClose={tko_onClose}><form onSubmit={tko_submit} className="space-y-3">
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="First name"><Input value={tko_draft.firstName} onChange={tko_event => tko_set("firstName", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Last name"><Input value={tko_draft.lastName} onChange={tko_event => tko_set("lastName", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField></div>
    <TkoCrmField tko_label="Job title"><Input value={tko_draft.title} onChange={tko_event => tko_set("title", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Email"><Input type="email" value={tko_draft.email} onChange={tko_event => tko_set("email", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Phone"><Input value={tko_draft.phone} onChange={tko_event => tko_set("phone", tko_event.target.value)} className="mt-1 rounded-sm" /></TkoCrmField></div>
    <TkoCrmField tko_label="Primary company"><TkoCrmSelect tko_value={tko_draft.companyId} tko_onChange={tko_value => tko_set("companyId", tko_value)} tko_ariaLabel="Primary company"><option value="">No company</option>{tko_companies.map(tko_company => <option key={tko_company.id} value={tko_company.id}>{tko_company.name}</option>)}</TkoCrmSelect></TkoCrmField>
    <TkoCrmField tko_label="Tags"><TkoCrmTagInput tko_tags={tko_draft.tags} tko_onChange={tko_value => tko_set("tags", tko_value)} /></TkoCrmField>
    <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_save.isPending || tko_update.isPending} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">{tko_save.isPending || tko_update.isPending ? "Saving…" : "Save contact"}</Button></div>
  </form></TkoCrmModal>;
}

export function TkoCrmContactTable({ tko_contacts, tko_companies, tko_members, tko_onOpen }: { tko_contacts: TkoCrmContact[]; tko_companies: TkoCrmCompany[]; tko_members: { id: string; displayName?: string | null }[]; tko_onOpen: (tko_contact: TkoCrmContact) => void }) {
  if (!tko_contacts.length) return <TkoCrmEmpty tko_message="No contacts match the current search." />;
  return <div className="overflow-x-auto border border-[#dfe1e6] bg-white"><table className="w-full min-w-[720px] text-left text-xs"><thead><tr className="border-b border-[#dfe1e6] bg-[#fafbfc] text-[10px] uppercase tracking-[.08em] text-[#6b778c]"><th className="px-3 py-2 font-semibold">Contact</th><th className="px-3 py-2 font-semibold">Title</th><th className="px-3 py-2 font-semibold">Email</th><th className="px-3 py-2 font-semibold">Phone</th><th className="px-3 py-2 font-semibold">Company</th><th className="px-3 py-2 font-semibold">Owner</th><th className="px-3 py-2 font-semibold">Updated</th></tr></thead><tbody>{tko_contacts.map(tko_contact => <tr key={tko_contact.id} onClick={() => tko_onOpen(tko_contact)} className="cursor-pointer border-b border-[#f4f5f7] last:border-0 hover:bg-[#f7fbff]"><td className="px-3 py-2 font-semibold text-[#172b4d]">{tko_contact.firstName} {tko_contact.lastName}</td><td className="px-3 py-2 text-[#42526e]">{tko_contact.title || "—"}</td><td className="px-3 py-2 text-[#42526e]">{tko_contact.emails[0] ?? "—"}</td><td className="px-3 py-2 text-[#42526e]">{tko_contact.phones[0] ?? "—"}</td><td className="px-3 py-2 text-[#42526e]">{tko_companies.find(tko_company => tko_company.id === tko_contact.companyId)?.name ?? "—"}</td><td className="px-3 py-2 text-[#42526e]">{tko_crmMemberLabel(tko_contact.ownerMemberId, tko_members)}</td><td className="px-3 py-2 text-[#5e6c84]">{tko_crmDate(tko_contact.updatedAt)}</td></tr>)}</tbody></table></div>;
}

export function TkoCrmContactDrawer({ tko_contactId, tko_companies, tko_members, tko_onClose, tko_onEdit }: { tko_contactId: string; tko_companies: TkoCrmCompany[]; tko_members: { id: string; displayName?: string | null }[]; tko_onClose: () => void; tko_onEdit: () => void }) {
  const tko_detail = trpc.crm.contact.useQuery({ contactId: tko_contactId }, { retry: false });
  const tko_contact = tko_detail.data?.contact;
  const tko_companyName = tko_contact ? tko_companies.find(tko_company => tko_company.id === tko_contact.companyId)?.name ?? "" : "";
  return <TkoCrmDrawer tko_eyebrow="Contact details" tko_title={tko_contact ? `${tko_contact.firstName} ${tko_contact.lastName}` : "Contact"} tko_subtitle={<span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />{tko_companyName || "No company"}</span>} tko_onClose={tko_onClose}>
    {tko_contact ? <>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Email</span><strong className="mt-1 block break-all text-[#172b4d]">{tko_contact.emails[0] ?? "—"}</strong></div>
        <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Phone</span><strong className="mt-1 block text-[#172b4d]">{tko_contact.phones[0] ?? "—"}</strong></div>
        <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Title</span><strong className="mt-1 block text-[#172b4d]">{tko_contact.title || "—"}</strong></div>
        <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Owner</span><strong className="mt-1 block text-[#172b4d]">{tko_crmMemberLabel(tko_contact.ownerMemberId, tko_members)}</strong></div>
      </div>
      {tko_contact.tags.length ? <div className="flex flex-wrap gap-1.5">{tko_contact.tags.map(tko_tag => <span key={tko_tag} className="bg-[#f4f5f7] px-2 py-0.5 text-[10px] text-[#42526e]">{tko_tag}</span>)}</div> : null}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={tko_onEdit} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">Edit</Button><TkoCrmFollowUpButton tko_entityType="contact" tko_entityId={tko_contact.id} tko_title={`${tko_contact.firstName} ${tko_contact.lastName}`} /></div>
      <div><TkoCrmSectionTitle>Activity timeline</TkoCrmSectionTitle><div className="mt-2"><TkoCrmTimeline tko_activities={tko_detail.data?.activities ?? []} /></div></div>
      <div><TkoCrmSectionTitle>Linked objects</TkoCrmSectionTitle>{(tko_detail.data?.links ?? []).length ? <ul className="mt-2 space-y-1.5">{(tko_detail.data?.links ?? []).map(tko_link => <li key={tko_link.id} className="flex items-center justify-between border border-[#dfe1e6] bg-[#f4f5f7] px-2.5 py-1.5 text-xs"><span className="text-[#42526e]">{tko_link.targetType.replace(/_/g, " ")} · {tko_link.targetId.slice(0, 8)}</span><span className="text-[10px] text-[#5e6c84]">{tko_link.relationType.replace(/_/g, " ")}</span></li>)}</ul> : <TkoCrmEmpty tko_message="No linked objects yet." />}</div>
    </> : <TkoCrmEmpty tko_message="Loading contact…" />}
  </TkoCrmDrawer>;
}

export function TkoCrmContactsView({ tko_isAuthenticated, tko_focusContactId, tko_onNavigateCompanies }: { tko_isAuthenticated: boolean; tko_focusContactId?: string | null; tko_onNavigateCompanies?: () => void }) {
  const [tko_search, setTkoSearch] = useState("");
  const [tko_editOpen, setTkoEditOpen] = useState(false);
  const [tko_editing, setTkoEditing] = useState<TkoCrmContact | null>(null);
  const [tko_selectedId, setTkoSelectedId] = useState<string | null>(tko_focusContactId ?? null);
  const tko_contactsQuery = trpc.crm.contacts.useQuery({}, { enabled: tko_isAuthenticated, retry: false });
  const tko_companiesQuery = trpc.crm.companies.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_members = trpc.workspaceMembers.list.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_contacts = tko_contactsQuery.data ?? [];
  const tko_companies = tko_companiesQuery.data ?? [];
  const tko_filtered = useMemo(() => {
    const tko_query = tko_search.trim().toLowerCase();
    if (!tko_query) return tko_contacts;
    return tko_contacts.filter(tko_contact => `${tko_contact.firstName} ${tko_contact.lastName} ${tko_contact.title} ${tko_contact.emails.join(" ")} ${tko_companies.find(tko_company => tko_company.id === tko_contact.companyId)?.name ?? ""}`.toLowerCase().includes(tko_query));
  }, [tko_contacts, tko_companies, tko_search]);

  if (!tko_isAuthenticated) return <TkoCrmEmpty tko_message="Sign in to view and manage contacts." />;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 border border-[#dfe1e6] bg-white px-2.5"><Search className="h-3.5 w-3.5 text-[#5e6c84]" /><input value={tko_search} onChange={tko_event => setTkoSearch(tko_event.target.value)} placeholder="Search contacts…" className="w-full bg-transparent text-xs outline-none" /></div>
      <Button type="button" onClick={() => { setTkoEditing(null); setTkoEditOpen(true); }} className="h-9 rounded-sm bg-[#0052cc] px-3.5 text-xs font-semibold hover:bg-[#0747a6]">New contact</Button>
    </div>
    {tko_contactsQuery.isLoading ? <TkoCrmEmpty tko_message="Loading contacts…" /> : <TkoCrmContactTable tko_contacts={tko_filtered} tko_companies={tko_companies} tko_members={tko_members.data ?? []} tko_onOpen={tko_contact => setTkoSelectedId(tko_contact.id)} />}
    {tko_editOpen ? <TkoCrmContactFormModal tko_contact={tko_editing} tko_companies={tko_companies} tko_onClose={() => setTkoEditOpen(false)} /> : null}
    {tko_selectedId ? <TkoCrmContactDrawer tko_contactId={tko_selectedId} tko_companies={tko_companies} tko_members={tko_members.data ?? []} tko_onClose={() => setTkoSelectedId(null)} tko_onEdit={() => { const tko_found = tko_contacts.find(tko_contact => tko_contact.id === tko_selectedId); if (tko_found) { setTkoEditing(tko_found); setTkoEditOpen(true); } }} /> : null}
    {tko_onNavigateCompanies ? <button type="button" onClick={tko_onNavigateCompanies} className="text-xs font-semibold text-[#0052cc] hover:underline">Open a company to see its connected contacts →</button> : null}
  </div>;
}
