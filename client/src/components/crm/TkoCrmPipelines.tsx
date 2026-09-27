import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Grid2X2, Plus, Trash2 } from "lucide-react";
import React, { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { TkoCrmEmpty, TkoCrmField, TkoCrmModal, TkoCrmSectionTitle, TkoCrmSelect, type TkoCrmStage } from "./TkoCrmShared";

type TkoStageDraft = { name: string; probability: string; category: "open" | "won" | "lost" };

export function TkoCrmPipelineFormModal({ tko_onClose }: { tko_onClose: () => void }) {
  const tko_utils = trpc.useUtils();
  const [tko_name, setTkoName] = useState("");
  const [tko_stages, setTkoStages] = useState<TkoStageDraft[]>([{ name: "Discovery", probability: "20", category: "open" }, { name: "Proposal", probability: "60", category: "open" }, { name: "Won", probability: "100", category: "won" }, { name: "Lost", probability: "0", category: "lost" }]);
  const tko_save = trpc.crm.createPipeline.useMutation({ onSuccess: async () => { toast.success("Đã tạo pipeline."); await tko_utils.crm.pipelines.invalidate(); tko_onClose(); }, onError: () => toast.error("Không thể tạo pipeline.") });
  function tko_setStage(tko_index: number, tko_patch: Partial<TkoStageDraft>) { setTkoStages(tko_current => tko_current.map((tko_stage, tko_i) => tko_i === tko_index ? { ...tko_stage, ...tko_patch } : tko_stage)); }
  function tko_submit(tko_event: FormEvent) {
    tko_event.preventDefault();
    if (!tko_name.trim()) { toast.error("Nhập tên pipeline."); return; }
    if (tko_stages.length < 2) { toast.error("Pipeline cần ít nhất 2 stage."); return; }
    if (tko_stages.some(tko_stage => !tko_stage.name.trim())) { toast.error("Mỗi stage cần tên."); return; }
    tko_save.mutate({ name: tko_name.trim(), stages: tko_stages.map(tko_stage => ({ name: tko_stage.name.trim(), probabilityDefault: Number(tko_stage.probability || 0), category: tko_stage.category })) });
  }
  return <TkoCrmModal tko_eyebrow="CRM setup" tko_title="New pipeline" tko_onClose={tko_onClose} tko_wide><form onSubmit={tko_submit} className="space-y-3">
    <TkoCrmField tko_label="Pipeline name"><Input value={tko_name} onChange={tko_event => setTkoName(tko_event.target.value)} className="mt-1 rounded-sm" placeholder="New business" /></TkoCrmField>
    <div><TkoCrmSectionTitle>Stages</TkoCrmSectionTitle><div className="mt-2 space-y-2">{tko_stages.map((tko_stage, tko_index) => <div key={tko_index} className="grid grid-cols-[1fr_90px_110px_36px] items-end gap-2">
      <TkoCrmField tko_label={tko_index === 0 ? "Name" : ""}><Input value={tko_stage.name} onChange={tko_event => tko_setStage(tko_index, { name: tko_event.target.value })} className="mt-1 rounded-sm" /></TkoCrmField>
      <TkoCrmField tko_label={tko_index === 0 ? "Prob %" : ""}><Input type="number" min={0} max={100} value={tko_stage.probability} onChange={tko_event => tko_setStage(tko_index, { probability: tko_event.target.value })} className="mt-1 rounded-sm" /></TkoCrmField>
      <TkoCrmField tko_label={tko_index === 0 ? "Category" : ""}><TkoCrmSelect tko_value={tko_stage.category} tko_onChange={tko_value => tko_setStage(tko_index, { category: tko_value as TkoStageDraft["category"] })} tko_ariaLabel={`Stage category ${tko_index + 1}`}>{["open", "won", "lost"].map(tko_category => <option key={tko_category} value={tko_category}>{tko_category}</option>)}</TkoCrmSelect></TkoCrmField>
      <Button type="button" variant="ghost" aria-label={`Remove stage ${tko_index + 1}`} disabled={tko_stages.length <= 2} onClick={() => setTkoStages(tko_current => tko_current.filter((_, tko_i) => tko_i !== tko_index))} className="h-9 text-[#5e6c84] hover:text-[#ca3521]"><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>)}</div>
      <Button type="button" variant="outline" onClick={() => setTkoStages(tko_current => [...tko_current, { name: "", probability: "50", category: "open" }])} className="mt-2 h-8 rounded-sm text-xs"><Plus className="mr-1.5 h-3.5 w-3.5" />Add stage</Button></div>
    <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={tko_onClose} className="h-8 rounded-sm text-xs">Cancel</Button><Button type="submit" disabled={tko_save.isPending} className="h-8 rounded-sm bg-[#0052cc] text-xs hover:bg-[#0747a6]">{tko_save.isPending ? "Saving…" : "Create pipeline"}</Button></div>
  </form></TkoCrmModal>;
}

function TkoCrmPipelineCard({ tko_pipeline }: { tko_pipeline: { id: string; name: string; active: boolean } }) {
  const tko_stages = trpc.crm.stages.useQuery({ pipelineId: tko_pipeline.id }, { retry: false });
  return <section className="border border-[#dfe1e6] bg-white p-4"><div className="flex items-center gap-2"><Grid2X2 className="h-4 w-4 text-[#0052cc]" /><h3 className="text-sm font-semibold text-[#172b4d]">{tko_pipeline.name}</h3><span className={`ml-auto px-2 py-0.5 text-[10px] font-semibold ${tko_pipeline.active ? "bg-[#e3fcef] text-[#006644]" : "bg-[#f4f5f7] text-[#5e6c84]"}`}>{tko_pipeline.active ? "Active" : "Inactive"}</span></div>
    {tko_stages.data?.length ? <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(tko_stages.data as TkoCrmStage[]).map(tko_stage => <li key={tko_stage.id} className="border border-[#dfe1e6] bg-[#f4f5f7] p-2.5 text-xs"><p className="font-semibold text-[#172b4d]">{tko_stage.name}</p><p className="mt-0.5 text-[10px] text-[#5e6c84]">{tko_stage.probabilityDefault}% · {tko_stage.category}</p></li>)}</ol> : <TkoCrmEmpty tko_message="Loading stages…" />}
  </section>;
}

export function TkoCrmPipelinesView({ tko_isAuthenticated, tko_createOpen, tko_onCreateHandled }: { tko_isAuthenticated: boolean; tko_createOpen?: boolean; tko_onCreateHandled?: () => void }) {
  const [tko_localCreate, setTkoLocalCreate] = useState(false);
  const tko_pipelines = trpc.crm.pipelines.useQuery(undefined, { enabled: tko_isAuthenticated, retry: false });
  const tko_createVisible = tko_createOpen || tko_localCreate;
  const tko_closeCreate = () => { setTkoLocalCreate(false); tko_onCreateHandled?.(); };
  if (!tko_isAuthenticated) return <TkoCrmEmpty tko_message="Sign in to configure pipelines." />;
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><p className="text-xs text-[#5e6c84]">Pipelines define the stages and default probabilities used by the deal board and lead conversion.</p><Button type="button" onClick={() => setTkoLocalCreate(true)} className="h-9 rounded-sm bg-[#0052cc] px-3.5 text-xs font-semibold hover:bg-[#0747a6]"><Plus className="mr-1.5 h-4 w-4" />New pipeline</Button></div>
    {tko_pipelines.isLoading ? <TkoCrmEmpty tko_message="Loading pipelines…" /> : tko_pipelines.data?.length ? <div className="space-y-3">{tko_pipelines.data.map(tko_pipeline => <TkoCrmPipelineCard key={tko_pipeline.id} tko_pipeline={tko_pipeline} />)}</div> : <TkoCrmEmpty tko_message="No pipelines yet. Create one to start moving deals." />}
    {tko_createVisible ? <TkoCrmPipelineFormModal tko_onClose={tko_closeCreate} /> : null}
  </div>;
}
