import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { TkoCrmCompaniesView } from "@/components/crm/TkoCrmCompanies";
import { TkoCrmContactsView } from "@/components/crm/TkoCrmContacts";
import { TkoCrmDealsView } from "@/components/crm/TkoCrmDeals";
import { TkoCrmLeadsView } from "@/components/crm/TkoCrmLeads";
import { TkoCrmPipelinesView } from "@/components/crm/TkoCrmPipelines";
import { BriefcaseBusiness, Building2, Grid2X2, Sparkles, UsersRound } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type TkoCrmMode = "deals" | "leads" | "companies" | "contacts" | "pipelines";
const tko_modes: Array<{ tko_id: TkoCrmMode; tko_hash: string; tko_label: string; tko_icon: typeof BriefcaseBusiness }> = [
  { tko_id: "deals", tko_hash: "", tko_label: "Deals", tko_icon: BriefcaseBusiness },
  { tko_id: "leads", tko_hash: "#leads", tko_label: "Leads", tko_icon: UsersRound },
  { tko_id: "companies", tko_hash: "#companies", tko_label: "Companies", tko_icon: Building2 },
  { tko_id: "contacts", tko_hash: "#contacts", tko_label: "Contacts", tko_icon: UsersRound },
  { tko_id: "pipelines", tko_hash: "#pipelines", tko_label: "Pipelines", tko_icon: Grid2X2 },
];

function tko_modeFromHash(): TkoCrmMode {
  const tko_hash = window.location.hash.replace(/^#\/?/, "");
  const tko_match = tko_modes.find(tko_mode => tko_mode.tko_hash === `#${tko_hash}`);
  return tko_match?.tko_id ?? "deals";
}

export default function CRM() {
  const { isAuthenticated, loading: tko_authLoading } = useAuth();
  const [tko_mode, setTkoMode] = useState<TkoCrmMode>(() => (typeof window === "undefined" ? "deals" : tko_modeFromHash()));
  const [tko_focusCompanyId, setTkoFocusCompanyId] = useState<string | null>(null);
  const [tko_focusContactId, setTkoFocusContactId] = useState<string | null>(null);

  useEffect(() => {
    const tko_onHashChange = () => setTkoMode(tko_modeFromHash());
    window.addEventListener("hashchange", tko_onHashChange);
    return () => window.removeEventListener("hashchange", tko_onHashChange);
  }, []);

  function tko_goToMode(tko_next: TkoCrmMode) {
    const tko_hash = tko_modes.find(tko_mode => tko_mode.tko_id === tko_next)?.tko_hash ?? "";
    const tko_base = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", `${tko_base}${tko_hash}`);
    setTkoMode(tko_next);
    setTkoFocusCompanyId(null);
    setTkoFocusContactId(null);
  }

  const tko_headerTitle: Record<TkoCrmMode, { tko_title: string; tko_hint: string }> = {
    deals: { tko_title: "Sales pipeline", tko_hint: "Move customer context from qualification to delivery without losing the work around it." },
    leads: { tko_title: "Leads", tko_hint: "Qualify inbound and outbound demand, then convert with full history intact." },
    companies: { tko_title: "Companies", tko_hint: "One connected view of contacts, deals, activities and linked workspace objects." },
    contacts: { tko_title: "Contacts", tko_hint: "The people behind every account, ready for follow-up work." },
    pipelines: { tko_title: "Pipelines", tko_hint: "Stages, probabilities and categories powering the board and forecasting." },
  };

  return <div className="min-w-0 bg-[#f4f5f7]">
    <header className="border-b border-[#dfe1e6] bg-white px-5 py-5 lg:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-[21px] font-semibold tracking-[-.035em] text-[#172b4d]">{tko_headerTitle[tko_mode].tko_title}</h1><span className="rounded-sm bg-[#deebff] px-2 py-0.5 text-[11px] font-medium text-[#0052cc]">Slim CRM</span></div>
          <p className="mt-1 text-[13px] text-[#5e6c84]">{tko_headerTitle[tko_mode].tko_hint}</p>
        </div>
        {isAuthenticated ? null : <Button onClick={startLogin} className="h-9 rounded-sm bg-[#0052cc] px-3.5 text-xs font-semibold hover:bg-[#0747a6]">Sign in</Button>}
      </div>
      <nav aria-label="CRM sections" className="mt-4 flex flex-wrap gap-1.5">{tko_modes.map(tko_modeItem => {
        const TkoIcon = tko_modeItem.tko_icon;
        return <button type="button" key={tko_modeItem.tko_id} onClick={() => tko_goToMode(tko_modeItem.tko_id)} aria-current={tko_mode === tko_modeItem.tko_id ? "page" : undefined} className={`flex items-center gap-1.5 border px-3 py-1.5 text-xs font-semibold transition ${tko_mode === tko_modeItem.tko_id ? "border-[#0052cc] bg-[#deebff] text-[#0052cc]" : "border-[#dfe1e6] bg-white text-[#5e6c84] hover:border-[#4c9aff] hover:text-[#172b4d]"}`}><TkoIcon className="h-3.5 w-3.5" />{tko_modeItem.tko_label}</button>;
      })}</nav>
    </header>
    <main className="px-5 py-5 lg:px-7">
      {!tko_authLoading && !isAuthenticated ? <div className="mb-4 flex flex-wrap items-center gap-2 rounded-sm border border-[#ffe380] bg-[#fff7d6] px-3 py-2.5 text-xs text-[#7a5d00]"><Sparkles className="h-4 w-4" />CRM Alpha preview. Sign in and initialize the controlled-pilot workspace to view durable records.<button onClick={startLogin} className="ml-auto font-semibold underline">Sign in</button></div> : null}
      {tko_mode === "deals" ? <TkoCrmDealsView tko_isAuthenticated={isAuthenticated} tko_onNewPipeline={() => tko_goToMode("pipelines")} /> : null}
      {tko_mode === "leads" ? <TkoCrmLeadsView tko_isAuthenticated={isAuthenticated} /> : null}
      {tko_mode === "companies" ? <TkoCrmCompaniesView tko_isAuthenticated={isAuthenticated} tko_focusCompanyId={tko_focusCompanyId} tko_onOpenContact={tko_contactId => { setTkoFocusContactId(tko_contactId); tko_goToMode("contacts"); }} /> : null}
      {tko_mode === "contacts" ? <TkoCrmContactsView tko_isAuthenticated={isAuthenticated} tko_focusContactId={tko_focusContactId} tko_onNavigateCompanies={() => tko_goToMode("companies")} /> : null}
      {tko_mode === "pipelines" ? <TkoCrmPipelinesView tko_isAuthenticated={isAuthenticated} /> : null}
    </main>
  </div>;
}
