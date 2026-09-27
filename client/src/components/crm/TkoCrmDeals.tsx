import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Building2, CheckCircle2, CirclePlus, ExternalLink, Handshake, Plus, Search } from "lucide-react";
import React, { type DragEvent, type FormEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { TkoCrmDrawer, TkoCrmEmpty, TkoCrmField, TkoCrmFollowUpButton, TkoCrmModal, TkoCrmSectionTitle, TkoCrmSelect, TkoCrmTimeline, tko_crmDate, tko_crmMemberLabel, tko_crmMoney, tko_filterDeals, tko_localDateTimeValue, type TkoCrmCompany, type TkoCrmDeal, type TkoCrmStage } from "./TkoCrmShared";

type TkoWonLostTarget = { tko_deal: TkoCrmDeal; tko_stage: TkoCrmStage; tko_category: "won" | "lost" };

// Pure confirmation dialog for won/lost stage moves (spec §8). Lost requires a loss reason.
export function TkoCrmWonLostDialog({ tko_stageName, tko_category, tko_pending, tko_onConfirm, tko_onClose }: { tko_stageName: string; tko_category: "won" | "lost"; tko_pending: boolean; tko_onConfirm: (tko_input: { tko_lossReason?: string; tko_nextStepNote?: string }) => void; tko_onClose: () => void }) {
  const [tko_reason, setTkoReason] = useState("Price");
  const [tko_freeText, setTkoFreeText] = useState("");
  const [tko_note, setTkoNote] = useState("");
  const tko_isLost = tko_category === "lost";
  const tko_reasonInvalid = tko_isLost && tko_reason === "Other" && !tko_freeText.trim();
  return <TkoCrmModal tko_eyebrow="Stage confirmation" tko_title={`Move to ${tko_stageName}?`} tko_onClose={tko_onClose}><form onSubmit={tko_event => { tko_event.preventDefault(); if (tko_reasonInvalid) return; tko_onConfirm(tko_isLost ? { tko_lossReason: tko_reason === "Other" ? tko_freeText.trim() : tko_reason } : { tko_nextStepNote: tko_note.trim() || undefined }); }} className="space-y-3">
    {tko_isLost ? <>
      <p className="text-xs text-[#5e6c84]">A loss reason is required before the deal can be closed as lost.</p>
      <TkoCrmField tko_label="Loss reason"><TkoCrmSelect tko_value={tko_reason} tko_onChange={setTkoReason} tko_ariaLabel="Loss reason">{["Price", "Lost to competitor", "No budget", "No decision", "Timing", "Other"].map(tko_option => <option key={tko_option} value={tko_option}>{tko_option}</option>)}</TkoCrmSelect></TkoCrmField>
      {tko_reason === "Other" ? <TkoCrmField tko_label="Describe the reason"><Input value={tko_freeText} onChange={tko_event => setTkoFreeText(tko_event.target.value)} className="mt-1 rounded-sm" placeholder="Tell the team why this deal slipped" /></TkoCrmField> : null}
    </> : <>
      <p className="flex items-center gap-2 text-xs text-[#5e6c84]"><CheckCircle2 className="h-4 w-4 text-[#36b37e]" />Closing as won. Optionally capture the next step for delivery.</p>
      <TkoCrmField tko_label="Next step note (optional)"><textarea value={tko_note} onChange={tko_event => setTkoNote(tko_event.target.value)} className="mt-1 min-h-16 w-full border border-[#dfe1e6] p-2 text-xs outline-none focus:border-[#4c9aff]" placeholder="Kickoff scheduling, contract signed, handoff scope…" /></TkoCrmField>
    </>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_pending || tko_reasonInvalid} className={`h-8 rounded-sm text-xs text-white ${tko_isLost ? "bg-[#ca3521] hover:bg-[#ae2a19]" : "bg-[#006644] hover:bg-[#00553a]"}`}>{tko_pending ? "Moving…" : `Confirm ${tko_stageName}`}</Button></div>
  </form></TkoCrmModal>;
}

export function TkoCrmDealFormModal({ tko_stages, tko_companies, tko_defaultStageId, tko_defaultPipelineId, tko_onClose }: { tko_stages: TkoCrmStage[]; tko_companies: TkoCrmCompany[]; tko_defaultStageId?: string | null; tko_defaultPipelineId?: string; tko_onClose: () => void }) {
  const tko_utils = trpc.useUtils();
  const [tko_draft, setTkoDraft] = useState({ name: "", companyId: "", amount: "", expectedCloseDate: tko_localDateTimeValue(new Date(Date.now() + 30 * 86_400_000)).slice(0, 10), stageId: tko_defaultStageId ?? "" });
  const tko_save = trpc.crm.createDeal.useMutation({ onSuccess: async () => { toast.success("Đã tạo deal."); await Promise.all([tko_utils.crm.board.invalidate(), tko_utils.crm.companies.invalidate()]); tko_onClose(); }, onError: () => toast.error("Không thể tạo deal.") });
  function tko_submit(tko_event: FormEvent) {
    tko_event.preventDefault();
    const tko_stage = tko_stages.find(tko_candidate => tko_candidate.id === (tko_draft.stageId || tko_defaultStageId));
    if (!tko_draft.name.trim() || !tko_stage) { toast.error("Nhập tên deal và chọn stage."); return; }
    tko_save.mutate({ name: tko_draft.name.trim(), pipelineId: tko_defaultPipelineId ?? tko_stage.pipelineId, stageId: tko_stage.id, companyId: tko_draft.companyId || null, amountCents: tko_draft.amount === "" ? null : Math.round(Number(tko_draft.amount) * 100), currency: "USD", expectedCloseDate: tko_draft.expectedCloseDate ? new Date(tko_draft.expectedCloseDate) : null });
  }
  return <TkoCrmModal tko_eyebrow="Pipeline" tko_title="New deal" tko_onClose={tko_onClose}><form onSubmit={tko_submit} className="space-y-3">
    <TkoCrmField tko_label="Deal name"><Input value={tko_draft.name} onChange={tko_event => setTkoDraft(tko_current => ({ ...tko_current, name: tko_event.target.value }))} className="mt-1 rounded-sm" placeholder="Acme rollout" /></TkoCrmField>
    <TkoCrmField tko_label="Company"><TkoCrmSelect tko_value={tko_draft.companyId} tko_onChange={tko_value => setTkoDraft(tko_current => ({ ...tko_current, companyId: tko_value }))} tko_ariaLabel="Company"><option value="">No company</option>{tko_companies.map(tko_company => <option key={tko_company.id} value={tko_company.id}>{tko_company.name}</option>)}</TkoCrmSelect></TkoCrmField>
    <div className="grid grid-cols-2 gap-3"><TkoCrmField tko_label="Amount (USD)"><Input type="number" min={0} step="0.01" value={tko_draft.amount} onChange={tko_event => setTkoDraft(tko_current => ({ ...tko_current, amount: tko_event.target.value }))} className="mt-1 rounded-sm" /></TkoCrmField><TkoCrmField tko_label="Expected close date"><Input type="date" value={tko_draft.expectedCloseDate} onChange={tko_event => setTkoDraft(tko_current => ({ ...tko_current, expectedCloseDate: tko_event.target.value }))} className="mt-1 rounded-sm" /></TkoCrmField></div>
    <TkoCrmField tko_label="Stage"><TkoCrmSelect tko_value={tko_draft.stageId || tko_defaultStageId || ""} tko_onChange={tko_value => setTkoDraft(tko_current => ({ ...tko_current, stageId: tko_value }))} tko_ariaLabel="Stage">{tko_stages.map(tko_stage => <option key={tko_stage.id} value={tko_stage.id}>{tko_stage.name}</option>)}</TkoCrmSelect></TkoCrmField>
    <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_save.isPending} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">{tko_save.isPending ? "Saving…" : "Create deal"}</Button></div>
  </form></TkoCrmModal>;
}

function TkoCrmDealDrawer({ tko_deal, tko_stages, tko_members, tko_onClose, tko_onMoveStage }: { tko_deal: TkoCrmDeal; tko_stages: TkoCrmStage[]; tko_members: { id: string; displayName?: string | null }[]; tko_onClose: () => void; tko_onMoveStage: (tko_deal: TkoCrmDeal, tko_stage: TkoCrmStage) => void }) {
  const tko_detail = trpc.crm.deal.useQuery({ dealId: tko_deal.id }, { retry: false, refetchInterval: 5_000 });
  const tko_activities = trpc.crm.entityActivities.useQuery({ entityType: "deal", entityId: tko_deal.id }, { retry: false });
  const tko_contacts = trpc.crm.contacts.useQuery({ companyId: tko_deal.companyId }, { enabled: Boolean(tko_deal.companyId), retry: false });
  const tko_companiesQuery = trpc.crm.companies.useQuery(undefined, { retry: false });
  const tko_companyName = tko_companiesQuery.data?.find(tko_company => tko_company.id === tko_deal.companyId)?.name;
  const tko_stage = tko_stages.find(tko_candidate => tko_candidate.id === tko_deal.stageId);
  const tko_handoff = tko_detail.data?.handoff;

  return <TkoCrmDrawer tko_eyebrow="Deal details" tko_title={tko_deal.name} tko_subtitle={<span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />{tko_companyName ?? "No company connected"}{tko_stage ? <span className="bg-[#deebff] px-2 py-0.5 text-[10px] font-medium text-[#0052cc]">{tko_stage.name}</span> : null}</span>} tko_onClose={tko_onClose}>
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Amount</span><strong className="mt-1 block text-[#172b4d]">{tko_crmMoney(tko_deal.amountCents, tko_deal.currency)}</strong><span className="mt-1 block text-[10px] text-[#5e6c84]">{tko_deal.probability}% likely</span></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Expected close</span><strong className="mt-1 block text-[#172b4d]">{tko_crmDate(tko_deal.expectedCloseDate)}</strong><span className="mt-1 block text-[10px] text-[#5e6c84]">Owner {tko_crmMemberLabel(tko_deal.ownerMemberId, tko_members)}</span></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Next step</span><strong className="mt-1 block text-[#172b4d]">{tko_deal.nextStep || "Add next step"}</strong></div>
      <div className="bg-[#f4f5f7] p-2.5"><span className="block text-[10px] text-[#5e6c84]">Source</span><strong className="mt-1 block text-[#172b4d]">{tko_deal.source || "—"}</strong></div>
      {tko_deal.lostAt ? <div className="bg-[#ffedfa] p-2.5"><span className="block text-[10px] text-[#ae2a84]">Lost {tko_crmDate(tko_deal.lostAt)}</span><strong className="mt-1 block text-[#ae2a84]">{tko_deal.lossReason || "No reason recorded"}</strong></div> : null}
      {tko_deal.wonAt ? <div className="bg-[#e3fcef] p-2.5"><span className="block text-[10px] text-[#006644]">Won</span><strong className="mt-1 block text-[#006644]">{tko_crmDate(tko_deal.wonAt)}</strong></div> : null}
    </div>
    <div><TkoCrmSectionTitle>Move stage</TkoCrmSectionTitle><div className="mt-2 flex flex-wrap gap-2">{tko_stages.map(tko_candidate => <button type="button" key={tko_candidate.id} disabled={tko_candidate.id === tko_deal.stageId} onClick={() => tko_onMoveStage(tko_deal, tko_candidate)} className={`border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50 ${tko_candidate.id === tko_deal.stageId ? "border-[#0052cc] bg-[#deebff] text-[#0052cc]" : "border-[#dfe1e6] text-[#5e6c84] hover:border-[#4c9aff]"}`}>{tko_candidate.name}</button>)}</div></div>
    <div><TkoCrmSectionTitle>Contacts</TkoCrmSectionTitle>{tko_deal.companyId ? ((tko_contacts.data ?? []).length ? <ul className="mt-2 space-y-1.5">{(tko_contacts.data ?? []).map(tko_contact => <li key={tko_contact.id} className="border border-[#dfe1e6] bg-[#f4f5f7] px-2.5 py-1.5 text-xs"><strong className="text-[#172b4d]">{tko_contact.firstName} {tko_contact.lastName}</strong>{tko_contact.title ? <span className="text-[#5e6c84]"> · {tko_contact.title}</span> : null}</li>)}</ul> : <TkoCrmEmpty tko_message="No contacts on the connected company." />) : <TkoCrmEmpty tko_message="Deal is not connected to a company yet." />}</div>
    <TkoCrmFollowUpButton tko_entityType="deal" tko_entityId={tko_deal.id} tko_title={tko_deal.name} />
    <section className="border-y border-[#dfe1e6] py-4"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.11em] text-[#5e6c84]"><Handshake className="h-3.5 w-3.5 text-[#0052cc]" />Connected delivery</p><p className="mt-1 text-xs text-[#5e6c84]">{tko_detail.isLoading ? "Loading delivery handoff…" : tko_handoff?.status === "completed" ? "Delivery project and customer channel are ready." : tko_handoff?.status === "pending" ? "Handoff is queued for delivery materialization." : "Win the deal to materialize delivery work and a customer channel."}</p></div></div>
      {tko_detail.data?.deliveryProject ? <div className="mt-3 flex items-center justify-between border border-[#dfe1e6] bg-[#f4f5f7] p-2.5 text-xs"><span className="text-[#42526e]">Delivery project</span><Link href="/work" className="flex items-center gap-1 font-semibold text-[#0052cc] hover:underline">{tko_detail.data.deliveryProject.key} · {tko_detail.data.deliveryProject.name}<ExternalLink className="h-3 w-3" /></Link></div> : null}
      {tko_detail.data?.deliveryChannel ? <div className="mt-2 flex items-center justify-between border border-[#dfe1e6] bg-[#f4f5f7] p-2.5 text-xs"><span className="text-[#42526e]">Customer channel</span><Link href="/chat" className="flex items-center gap-1 font-semibold text-[#0052cc] hover:underline">#{tko_detail.data.deliveryChannel.name}<ExternalLink className="h-3 w-3" /></Link></div> : null}
    </section>
    <div><TkoCrmSectionTitle>Activity timeline</TkoCrmSectionTitle><div className="mt-2"><TkoCrmTimeline tko_activities={tko_activities.data ?? []} /></div></div>
  </TkoCrmDrawer>;
}

export function TkoCrmDealsView({ tko_isAuthenticated, tko_onNewPipeline }: { tko_isAuthenticated: boolean; tko_onNewPipeline?: () => void }) {
  const tko_utils = trpc.useUtils();
  const [tko_pipelineId, setTkoPipelineId] = useState("");
  const [tko_ownerFilter, setTkoOwnerFilter] = useState("");
  const [tko_companyFilter, setTkoCompanyFilter] = useState("");
  const [tko_closeWindow, setTkoCloseWindow] = useState<"all" | "overdue" | "thisMonth" | "next30">("all");
  const [tko_search, setTkoSearch] = useState("");
  const [tko_draggedDealId, setTkoDraggedDealId] = useState<string | null>(null);
  const [tko_dragOverStageId, setTkoDragOverStageId] = useState<string | null>(null);
  const [tko_selectedDealId, setTkoSelectedDealId] = useState<string | null>(null);
  const [tko_createStageId, setTkoCreateStageId] = useState<string | null>(null);
  const [tko_createOpen, setTkoCreateOpen] = useState(false);
  const [tko_wonLostTarget, setTkoWonLostTarget] = useState<TkoWonLostTarget | null>(null);
  const tko_pipelines = trpc.crm.pipelines.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_resolvedPipelineId = tko_pipelineId || tko_pipelines.data?.[0]?.id || "";
  const tko_board = trpc.crm.board.useQuery({ pipelineId: tko_resolvedPipelineId || "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(tko_isAuthenticated && tko_resolvedPipelineId), retry: false });
  const tko_companiesQuery = trpc.crm.companies.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_members = trpc.workspaceMembers.list.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_stages: TkoCrmStage[] = tko_board.data?.stages ?? [];
  const tko_deals: TkoCrmDeal[] = tko_board.data?.deals ?? [];
  const tko_companies = tko_companiesQuery.data ?? [];
  const tko_selectedDeal = tko_deals.find(tko_deal => tko_deal.id === tko_selectedDealId) ?? null;
  const tko_moveDeal = trpc.crm.moveDeal.useMutation({ onSuccess: async () => { toast.success("Deal stage đã được cập nhật."); await Promise.all([tko_utils.crm.board.invalidate(), tko_utils.crm.deal.invalidate(), tko_utils.crm.entityActivities.invalidate()]); }, onError: () => toast.error("Không thể cập nhật stage của deal.") });
  const tko_addNote = trpc.crm.addActivity.useMutation({ onSuccess: () => { toast.success("Đã ghi nhận next step."); tko_utils.crm.entityActivities.invalidate(); }, onError: () => toast.error("Không thể ghi next step.") });

  const tko_filtered = useMemo(() => {
    const tko_query = tko_search.trim().toLowerCase();
    return tko_filterDeals(tko_deals, { ownerMemberId: tko_ownerFilter, companyId: tko_companyFilter, closeWindow: tko_closeWindow }).filter(tko_deal => !tko_query || tko_deal.name.toLowerCase().includes(tko_query));
  }, [tko_deals, tko_ownerFilter, tko_companyFilter, tko_closeWindow, tko_search]);
  const tko_ownerOptions = useMemo(() => Array.from(new Set(tko_deals.map(tko_deal => tko_deal.ownerMemberId))), [tko_deals]);

  function tko_requestStageMove(tko_deal: TkoCrmDeal, tko_stage: TkoCrmStage) {
    if (tko_deal.stageId === tko_stage.id) return;
    if (tko_stage.category === "won" || tko_stage.category === "lost") { setTkoWonLostTarget({ tko_deal, tko_stage, tko_category: tko_stage.category }); return; }
    tko_moveDeal.mutate({ dealId: tko_deal.id, stageId: tko_stage.id });
  }
  function tko_dropOnColumn(tko_event: DragEvent<HTMLElement>, tko_stageId: string | undefined) {
    tko_event.preventDefault();
    const tko_deal = tko_deals.find(tko_candidate => tko_candidate.id === tko_draggedDealId);
    setTkoDraggedDealId(null);
    setTkoDragOverStageId(null);
    if (!tko_deal || !tko_stageId) return;
    const tko_stage = tko_stages.find(tko_candidate => tko_candidate.id === tko_stageId);
    if (tko_stage) tko_requestStageMove(tko_deal, tko_stage);
  }

  if (!tko_isAuthenticated) {
    return <div className="space-y-4"><TkoCrmEmpty tko_message="Sign in and initialize the controlled-pilot workspace to view the live pipeline." />
      <div className="grid min-w-[900px] grid-cols-3 gap-3">{[{ tko_id: "preview-open", tko_name: "Discovery", tko_deals: [{ tko_name: "Expansion workspace", tko_company: "Northstar Labs", tko_amount: "$24,000" }] }, { tko_id: "preview-mid", tko_name: "Proposal", tko_deals: [{ tko_name: "Operations rollout", tko_company: "Aster Studio", tko_amount: "$18,500" }] }, { tko_id: "preview-won", tko_name: "Closed won", tko_deals: [{ tko_name: "Team pilot", tko_company: "Cedar & Co.", tko_amount: "$9,200" }] }].map(tko_column => <section key={tko_column.tko_id} className="border border-[#dfe1e6] bg-[#ebecf0] p-2.5"><div className="mb-3 px-1 text-xs font-semibold text-[#172b4d]">{tko_column.tko_name}</div>{tko_column.tko_deals.map(tko_deal => <div key={tko_deal.tko_name} className="mb-2 border border-[#dfe1e6] bg-white p-3 text-xs shadow-[0_1px_1px_rgba(9,30,66,.12)]"><p className="font-semibold text-[#172b4d]">{tko_deal.tko_name}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-[#5e6c84]"><Building2 className="h-3 w-3" />{tko_deal.tko_company}</p><p className="mt-2 font-semibold text-[#172b4d]">{tko_deal.tko_amount}</p></div>)}</section>)}</div>
    </div>;
  }
  if (!tko_resolvedPipelineId) return <div className="space-y-3"><TkoCrmEmpty tko_message="No pipelines yet. Create your first pipeline to start moving deals." />{tko_onNewPipeline ? <Button type="button" onClick={tko_onNewPipeline} className="h-9 rounded-sm bg-[#0052cc] px-3.5 text-xs font-semibold hover:bg-[#0747a6]"><Plus className="mr-1.5 h-4 w-4" />New pipeline</Button> : null}</div>;

  const tko_totals = tko_board.data?.totalsByStage ?? {};
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <TkoCrmSelect tko_value={tko_resolvedPipelineId} tko_onChange={setTkoPipelineId} tko_ariaLabel="Pipeline selector"><>{tko_pipelines.data?.map(tko_pipeline => <option key={tko_pipeline.id} value={tko_pipeline.id}>{tko_pipeline.name}</option>)}</></TkoCrmSelect>
      <TkoCrmSelect tko_value={tko_ownerFilter} tko_onChange={setTkoOwnerFilter} tko_ariaLabel="Owner filter"><option value="">All owners</option>{tko_ownerOptions.map(tko_ownerId => <option key={tko_ownerId} value={tko_ownerId}>{tko_crmMemberLabel(tko_ownerId, tko_members.data ?? [])}</option>)}</TkoCrmSelect>
      <TkoCrmSelect tko_value={tko_companyFilter} tko_onChange={setTkoCompanyFilter} tko_ariaLabel="Company filter"><option value="">All companies</option>{tko_companies.map(tko_company => <option key={tko_company.id} value={tko_company.id}>{tko_company.name}</option>)}<option value="__none">No company</option></TkoCrmSelect>
      <TkoCrmSelect tko_value={tko_closeWindow} tko_onChange={tko_value => setTkoCloseWindow(tko_value as typeof tko_closeWindow)} tko_ariaLabel="Close date filter">{[["all", "Any close date"], ["overdue", "Overdue"], ["thisMonth", "Closing this month"], ["next30", "Next 30 days"]].map(([tko_value, tko_label]) => <option key={tko_value} value={tko_value}>{tko_label}</option>)}</TkoCrmSelect>
      <div className="flex h-9 min-w-[180px] flex-1 items-center gap-2 border border-[#dfe1e6] bg-white px-2.5"><Search className="h-3.5 w-3.5 text-[#5e6c84]" /><input value={tko_search} onChange={tko_event => setTkoSearch(tko_event.target.value)} placeholder="Search deals…" className="w-full bg-transparent text-xs outline-none" /></div>
      <Button type="button" onClick={() => { setTkoCreateStageId(null); setTkoCreateOpen(true); }} className="h-9 rounded-sm bg-[#0052cc] px-3.5 text-xs font-semibold hover:bg-[#0747a6]"><Plus className="mr-1.5 h-4 w-4" />New deal</Button>
    </div>
    {tko_board.isLoading ? <TkoCrmEmpty tko_message="Loading pipeline…" /> : <div className="overflow-x-auto pb-4"><div className="grid min-w-[900px] grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">{tko_stages.map(tko_stage => {
      const tko_stageDeals = tko_filtered.filter(tko_deal => tko_deal.stageId === tko_stage.id);
      const tko_total = tko_totals[tko_stage.id] ?? { amountCents: 0, weightedAmountCents: 0 };
      const tko_accent = tko_stage.category === "won" ? "bg-[#36b37e]" : tko_stage.category === "lost" ? "bg-[#f87168]" : "bg-[#ffab00]";
      return <section key={tko_stage.id} onDragEnter={() => setTkoDragOverStageId(tko_stage.id)} onDragOver={tko_event => { tko_event.preventDefault(); setTkoDragOverStageId(tko_stage.id); }} onDragLeave={tko_event => { if (tko_event.currentTarget === tko_event.target) setTkoDragOverStageId(null); }} onDrop={tko_event => tko_dropOnColumn(tko_event, tko_stage.id)} className={`min-h-[380px] border border-[#dfe1e6] bg-[#ebecf0] p-2.5 transition-colors ${tko_draggedDealId ? "ring-1 ring-inset ring-[#dfe1e6]" : ""} ${tko_dragOverStageId === tko_stage.id ? "bg-[#deebff] ring-2 ring-inset ring-[#0c66e4]" : ""}`}>
        <div className="mb-2 px-1"><div className="flex items-center gap-2 text-xs font-semibold text-[#172b4d]"><span className={`h-2 w-2 ${tko_accent}`} />{tko_stage.name}<span className="grid h-5 min-w-5 place-items-center bg-white px-1 text-[10px] text-[#5e6c84]">{tko_stageDeals.length}</span><button type="button" aria-label={`Quick add to ${tko_stage.name}`} onClick={() => { setTkoCreateStageId(tko_stage.id); setTkoCreateOpen(true); }} className="ml-auto grid h-6 w-6 place-items-center text-[#626f86] hover:bg-[#dfe1e6] hover:text-[#0c66e4]"><Plus className="h-3.5 w-3.5" /></button></div>
          <p className="mt-1 pl-4 text-[10px] text-[#5e6c84]">{tko_crmMoney(tko_total.amountCents, "USD")} · weighted {tko_crmMoney(tko_total.weightedAmountCents, "USD")} · {tko_stage.probabilityDefault}%</p></div>
        <div className="space-y-2">{tko_stageDeals.map(tko_deal => <button type="button" key={tko_deal.id} draggable onDragStart={() => setTkoDraggedDealId(tko_deal.id)} onDragEnd={() => { setTkoDraggedDealId(null); setTkoDragOverStageId(null); }} onClick={() => setTkoSelectedDealId(tko_deal.id)} className={`block w-full cursor-grab border border-[#dfe1e6] bg-white p-3 text-left shadow-[0_1px_1px_rgba(9,30,66,.12)] transition hover:border-[#4c9aff] active:cursor-grabbing ${tko_draggedDealId === tko_deal.id ? "scale-[.98] opacity-45" : ""}`}>
          <p className="text-[13px] font-semibold leading-5 text-[#172b4d]">{tko_deal.name}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-[#5e6c84]"><Building2 className="h-3 w-3" />{tko_companies.find(tko_company => tko_company.id === tko_deal.companyId)?.name ?? "No company"}</p>
          <div className="mt-3 flex items-center justify-between"><span className="text-[12px] font-semibold text-[#172b4d]">{tko_crmMoney(tko_deal.amountCents, tko_deal.currency)}</span><span className="bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] text-[#5e6c84]">{tko_crmMemberLabel(tko_deal.ownerMemberId, tko_members.data ?? [])}</span></div>
          {tko_deal.nextStep ? <p className="mt-2 flex items-center gap-1 text-[10px] text-[#0052cc]"><CirclePlus className="h-3 w-3" />{tko_deal.nextStep}</p> : null}
          {tko_deal.expectedCloseDate ? <p className="mt-1 text-[10px] text-[#97a0af]">Close {tko_crmDate(tko_deal.expectedCloseDate)}</p> : null}
        </button>)}</div>
      </section>;
    })}</div></div>}
    {tko_createOpen ? <TkoCrmDealFormModal tko_stages={tko_stages} tko_companies={tko_companies} tko_defaultStageId={tko_createStageId} tko_defaultPipelineId={tko_resolvedPipelineId} tko_onClose={() => setTkoCreateOpen(false)} /> : null}
    {tko_selectedDeal ? <TkoCrmDealDrawer tko_deal={tko_selectedDeal} tko_stages={tko_stages} tko_members={tko_members.data ?? []} tko_onClose={() => setTkoSelectedDealId(null)} tko_onMoveStage={tko_requestStageMove} /> : null}
    {tko_wonLostTarget ? <TkoCrmWonLostDialog tko_stageName={tko_wonLostTarget.tko_stage.name} tko_category={tko_wonLostTarget.tko_category} tko_pending={tko_moveDeal.isPending} tko_onClose={() => setTkoWonLostTarget(null)} tko_onConfirm={tko_input => {
      const tko_target = tko_wonLostTarget;
      tko_moveDeal.mutate({ dealId: tko_target.tko_deal.id, stageId: tko_target.tko_stage.id, lossReason: tko_input.tko_lossReason }, { onSuccess: () => { if (tko_input.tko_nextStepNote) tko_addNote.mutate({ entityType: "deal", entityId: tko_target.tko_deal.id, activityType: "note", subject: tko_input.tko_nextStepNote }); setTkoWonLostTarget(null); } });
    }} /> : null}
  </div>;
}
