import { useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, FileUp, Layers3, Play, Plus, TableProperties, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { tko_parseCsvText, type TkoCsvParseResult } from "@/lib/csv-parse";

const tko_sources = ["crm_csv", "jira", "clickup", "slack"] as const;
const tko_targets = ["lead", "work_item", "channel", "message"] as const;
const tko_exportEntities = ["work_items", "time_logs", "crm_leads", "crm_companies", "crm_contacts", "crm_deals"] as const;
const tko_duplicateStrategies = ["skip", "update", "create_duplicate"] as const;
const tko_label = (tko_value: string) => tko_value.replaceAll("_", " ");
const tko_statusTone = (tko_status: string) => tko_status === "completed" ? "bg-[#ecfdf3] text-[#027a48]" : tko_status === "failed" || tko_status === "error" ? "bg-[#fef3f2] text-[#b42318]" : "bg-[#f4f3ff] text-[#5b51e8]";

type TkoImportField = { sourceField: string; targetField: string; transform: "identity" | "lowercase" | "email" | "date" | "split_name"; required: boolean };
const tko_transformFor = (tko_targetField: string): TkoImportField["transform"] => tko_targetField === "email" ? "email" : tko_targetField === "name" ? "split_name" : "identity";

export default function Imports() {
  const tko_utils = trpc.useUtils();
  const tko_fileInput = useRef<HTMLInputElement | null>(null);
  const tko_imports = trpc.ecosystem.imports.useQuery(undefined, { retry: false });
  const [tko_source, tko_setSource] = useState<(typeof tko_sources)[number]>("crm_csv");
  const [tko_name, tko_setName] = useState("Customer data migration");
  const [tko_selectedJobId, tko_setSelectedJobId] = useState<string | null>(null);
  const [tko_stageMode, tko_setStageMode] = useState<"csv" | "json">("csv");
  const [tko_csvParsed, tko_setCsvParsed] = useState<TkoCsvParseResult | null>(null);
  const [tko_csvFilename, tko_setCsvFilename] = useState<string | null>(null);
  const [tko_columnMap, tko_setColumnMap] = useState<Record<string, string>>({});
  const [tko_sourceRecordId, tko_setSourceRecordId] = useState("row-001");
  const [tko_sourceType, tko_setSourceType] = useState("crm_contact");
  const [tko_payload, tko_setPayload] = useState('{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.test","companyName":"Analytical Engines"}');
  const [tko_target, tko_setTarget] = useState<(typeof tko_targets)[number]>("lead");
  const [tko_duplicateStrategy, tko_setDuplicateStrategy] = useState<(typeof tko_duplicateStrategies)[number]>("skip");
  const [tko_batchIds, tko_setBatchIds] = useState<string[]>([]);
  const [tko_exportEntity, tko_setExportEntity] = useState<(typeof tko_exportEntities)[number]>("crm_leads");
  const tko_selectedJob = tko_selectedJobId ?? tko_imports.data?.[0]?.id ?? null;
  const tko_preview = trpc.ecosystem.previewImport.useQuery({ jobId: tko_selectedJob ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(tko_selectedJob), retry: false });

  const tko_create = trpc.ecosystem.createImport.useMutation({
    onSuccess: tko_job => { tko_setSelectedJobId(tko_job.id); void tko_utils.ecosystem.imports.invalidate(); toast.success("Import job created. Stage source records before execution."); },
    onError: tko_error => toast.error(tko_error.message),
  });
  const tko_stage = trpc.ecosystem.stageImport.useMutation({
    onSuccess: () => { void tko_preview.refetch(); void tko_utils.ecosystem.imports.invalidate(); },
    onError: tko_error => { toast.error(tko_error.message); throw tko_error; },
  });
  const tko_mapping = trpc.ecosystem.saveImportMapping.useMutation({
    onSuccess: () => { void tko_preview.refetch(); toast.success("Mapping saved. The job is ready to queue."); },
    onError: tko_error => toast.error(tko_error.message),
  });
  const tko_queue = trpc.ecosystem.queueImport.useMutation({
    onSuccess: tko_batches => { tko_setBatchIds(tko_batches.map(tko_batch => tko_batch.id)); void tko_preview.refetch(); toast.success(`${tko_batches.length} batch${tko_batches.length === 1 ? "" : "es"} queued.`); },
    onError: tko_error => toast.error(tko_error.message),
  });
  const tko_execute = trpc.ecosystem.executeImportBatch.useMutation({
    onSuccess: () => { void tko_preview.refetch(); void tko_utils.ecosystem.imports.invalidate(); toast.success("Batch materialized with source mappings recorded."); },
    onError: tko_error => toast.error(tko_error.message),
  });
  const tko_export = trpc.ecosystem.exportCsv.useMutation({
    onSuccess: tko_result => {
      const tko_blob = new Blob([tko_result.csv], { type: "text/csv;charset=utf-8" });
      const tko_url = URL.createObjectURL(tko_blob);
      const tko_anchor = document.createElement("a");
      tko_anchor.href = tko_url;
      tko_anchor.download = tko_result.filename;
      document.body.appendChild(tko_anchor);
      tko_anchor.click();
      tko_anchor.remove();
      URL.revokeObjectURL(tko_url);
      toast.success(`Exported ${tko_result.rowCount} row${tko_result.rowCount === 1 ? "" : "s"} to ${tko_result.filename}.`);
    },
    onError: tko_error => toast.error(tko_error.message),
  });

  const tko_defaultFields = useMemo<TkoImportField[]>(() => tko_target === "lead"
    ? [{ sourceField: "firstName", targetField: "firstName", transform: "identity", required: true }, { sourceField: "lastName", targetField: "lastName", transform: "identity", required: false }, { sourceField: "email", targetField: "email", transform: "email", required: false }, { sourceField: "companyName", targetField: "companyName", transform: "identity", required: false }]
    : [{ sourceField: tko_target === "work_item" ? "title" : "name", targetField: tko_target === "work_item" ? "title" : "name", transform: "identity", required: true }], [tko_target]);

  // Suggested column → target field mapping for a parsed CSV: exact header matches win,
  // common CRM aliases fall back to the default mapping (implemented in tko_suggestedMapFor).

  const tko_loadCsvFile = async (tko_file: File | null | undefined) => {
    if (!tko_file) return;
    if (!/\.(csv|txt)$/i.test(tko_file.name) && !tko_file.type.includes("csv")) { toast.error("Choose a .csv file for the CRM CSV source."); return; }
    if (tko_file.size > 5_000_000) { toast.error("CSV files up to 5 MB are supported in the browser preview."); return; }
    const tko_text = await tko_file.text();
    const tko_parsed = tko_parseCsvText(tko_text);
    if (!tko_parsed.headers.length || !tko_parsed.records.length) { toast.error("No rows were detected in that CSV file."); return; }
    tko_setCsvParsed(tko_parsed);
    tko_setCsvFilename(tko_file.name);
    tko_setColumnMap(tko_suggestedMapFor(tko_parsed.headers));
    tko_setStageMode("csv");
  };
  const tko_suggestedMapFor = (tko_headers: string[]): Record<string, string> => {
    const tko_alias: Record<string, string> = { name: "name", full_name: "name", firstname: "firstName", first_name: "firstName", lastname: "lastName", last_name: "lastName", email: "email", "e-mail": "email", company: "companyName", companyname: "companyName", "company name": "companyName", phone: "phone" };
    const tko_result: Record<string, string> = {};
    for (const tko_header of tko_headers) {
      const tko_directTarget = tko_defaultFields.find(tko_field => tko_field.targetField.toLowerCase() === tko_header)?.targetField;
      const tko_aliasTarget = tko_alias[tko_header];
      tko_result[tko_header] = tko_directTarget ?? (tko_aliasTarget && tko_defaultFields.some(tko_field => tko_field.targetField === tko_aliasTarget) ? tko_aliasTarget : "");
    }
    return tko_result;
  };

  const tko_stageRecord = () => {
    if (!tko_selectedJob) return toast.error("Create or select an import job first.");
    try {
      const tko_parsed = JSON.parse(tko_payload) as Record<string, unknown>;
      void tko_stage.mutateAsync({ jobId: tko_selectedJob, records: [{ sourceRecordId: tko_sourceRecordId, sourceType: tko_sourceType, payload: tko_parsed, status: "valid" }] }).then(() => toast.success("Record staged for validation and preview."));
    } catch { toast.error("Payload must be valid JSON."); }
  };

  const tko_stageCsv = async () => {
    if (!tko_selectedJob) return toast.error("Create or select an import job first.");
    if (!tko_csvParsed) return toast.error("Upload a CSV file first.");
    const tko_mappedFields: TkoImportField[] = Object.entries(tko_columnMap).filter(([, tko_targetField]) => tko_targetField).map(([tko_sourceField, tko_targetField]) => ({ sourceField: tko_sourceField, targetField: tko_targetField, transform: tko_transformFor(tko_targetField), required: tko_defaultFields.some(tko_field => tko_field.targetField === tko_targetField && tko_field.required) }));
    if (!tko_mappedFields.length) return toast.error("Map at least one CSV column to a target field.");
    try {
      const tko_records = tko_csvParsed.records.map((tko_record, tko_index) => ({ sourceRecordId: tko_record.id || tko_record.id?.trim() || `csv-${tko_index + 1}`, sourceType: tko_sourceType, payload: tko_record, status: "valid" as const }));
      for (let tko_start = 0; tko_start < tko_records.length; tko_start += 500) {
        await tko_stage.mutateAsync({ jobId: tko_selectedJob, records: tko_records.slice(tko_start, tko_start + 500) });
      }
      toast.success(`${tko_records.length} record${tko_records.length === 1 ? "" : "s"} staged from ${tko_csvFilename ?? "CSV"}.`);
      await tko_mapping.mutateAsync({ jobId: tko_selectedJob, sourceType: tko_sourceType, targetKind: tko_target, duplicateStrategy: tko_duplicateStrategy, fields: tko_mappedFields });
      tko_setCsvParsed(null);
      tko_setCsvFilename(null);
      tko_setColumnMap({});
    } catch { toast.error("Staging failed; nothing was queued."); }
  };

  return <main className="mx-auto max-w-7xl p-5 sm:p-6 lg:p-10">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#766df0]">Import center</p><h1 className="mt-1 text-3xl font-bold tracking-[-.05em] text-[#182230]">Staged, reviewable imports</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">Parse and validate source data before mapping it into Tasko. Executions remain resumable and record source mappings for idempotency.</p></div><span className="rounded-full bg-[#ecfdf3] px-3 py-1.5 text-xs font-semibold text-[#027a48]">Tenant scoped</span></header>

    <section className="mt-7 grid gap-5 xl:grid-cols-[.85fr_1.15fr]"><article className="rounded-2xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f0efff] text-[#5b51e8]"><Plus className="h-5 w-5" /></span><div><h2 className="font-semibold text-[#182230]">Start an import</h2><p className="text-xs text-[#667085]">Create an idempotent import job.</p></div></div><label className="mt-5 block text-xs font-semibold text-[#475467]">Source<select value={tko_source} onChange={tko_event => { tko_setSource(tko_event.target.value as typeof tko_source); tko_setStageMode(tko_event.target.value === "crm_csv" ? "csv" : "json"); }} className="mt-1.5 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 py-2.5 text-sm font-medium text-[#344054]">{tko_sources.map(tko_option => <option key={tko_option} value={tko_option}>{tko_label(tko_option)}</option>)}</select></label><label className="mt-4 block text-xs font-semibold text-[#475467]">Job name<input value={tko_name} onChange={tko_event => tko_setName(tko_event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#d0d5dd] px-3 py-2.5 text-sm text-[#344054]" maxLength={240} /></label><button type="button" disabled={tko_create.isPending} onClick={() => tko_create.mutate({ source: tko_source, name: tko_name, idempotencyKey: crypto.randomUUID() })} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5b51e8] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4d43da] disabled:opacity-60 active:scale-[.97]"><FileUp className="h-4 w-4" />{tko_create.isPending ? "Creating…" : "Create import job"}</button></article>
      <article className="rounded-2xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-[#182230]">Import jobs</h2><p className="mt-1 text-xs text-[#667085]">Select a job to inspect staged records and execution state.</p></div><Layers3 className="h-5 w-5 text-[#766df0]" /></div><div className="mt-4 divide-y divide-[#f2f4f7]">{tko_imports.data?.length ? tko_imports.data.map(tko_job => <button key={tko_job.id} type="button" onClick={() => { tko_setSelectedJobId(tko_job.id); tko_setBatchIds([]); }} className={`flex w-full items-center gap-3 px-2 py-3 text-left transition hover:bg-[#fcfcfd] ${tko_job.id === tko_selectedJob ? "bg-[#f7f7ff]" : ""}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f4f3ff] text-xs font-bold text-[#5b51e8]">{tko_job.source.slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#344054]">{tko_job.name}</span><span className="mt-0.5 block text-xs text-[#98a2b3]">{tko_job.importedRecords} / {tko_job.totalRecords} imported</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tko_statusTone(tko_job.status)}`}>{tko_label(tko_job.status)}</span><ArrowRight className="h-4 w-4 text-[#98a2b3]" /></button>) : <p className="py-10 text-center text-sm text-[#667085]">No import jobs yet. Create one to begin a controlled migration.</p>}</div></article></section>

    {tko_selectedJob ? <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
      <article className="rounded-2xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#eef4ff] text-[#175cd3]"><TableProperties className="h-5 w-5" /></span><div><h2 className="font-semibold text-[#182230]">1. Stage source data</h2><p className="text-xs text-[#667085]">Upload a CSV (crm_csv source) or paste JSON records. The backend validates ownership and source-record idempotency.</p></div></div>
        {tko_source === "crm_csv" ? <div className="mt-4 flex gap-2 text-xs font-semibold"><button type="button" onClick={() => tko_setStageMode("csv")} className={`rounded-full px-3 py-1.5 ${tko_stageMode === "csv" ? "bg-[#5b51e8] text-white" : "bg-[#f2f4f7] text-[#667085]"}`}>CSV upload</button><button type="button" onClick={() => tko_setStageMode("json")} className={`rounded-full px-3 py-1.5 ${tko_stageMode === "json" ? "bg-[#5b51e8] text-white" : "bg-[#f2f4f7] text-[#667085]"}`}>Paste JSON</button></div> : null}
        {tko_source === "crm_csv" && tko_stageMode === "csv" ? <div>
          <div onDragOver={tko_event => tko_event.preventDefault()} onDrop={tko_event => { tko_event.preventDefault(); void tko_loadCsvFile(tko_event.dataTransfer.files?.[0]); }} className="mt-4 grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-[#c7d7fe] bg-[#fcfcff] px-4 py-8 text-center transition hover:bg-[#f5f5ff]" onClick={() => tko_fileInput.current?.click()}>
            <UploadCloud className="h-8 w-8 text-[#766df0]" /><p className="mt-2 text-sm font-semibold text-[#344054]">{tko_csvFilename ?? "Drop a CSV file here or click to browse"}</p><p className="mt-1 text-xs text-[#98a2b3]">Parsed entirely in your browser; headers are normalized for mapping.</p>
            <input ref={tko_fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={tko_event => void tko_loadCsvFile(tko_event.target.files?.[0])} />
          </div>
          {tko_csvParsed ? <div className="mt-4 rounded-xl border border-[#f2f4f7] bg-[#fcfcfd] p-3">
            <p className="text-xs font-semibold text-[#475467]">Column mapping preview <span className="font-normal text-[#98a2b3]">({tko_csvParsed.records.length} rows detected)</span></p>
            <div className="mt-2 grid gap-2">{tko_csvParsed.headers.map(tko_header => <div key={tko_header} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#344054]" title={tko_csvParsed?.records[0]?.[tko_header] ?? ""}>{tko_header}</span><span className="text-[#98a2b3]">→</span><select aria-label={`Target field for column ${tko_header}`} value={tko_columnMap[tko_header] ?? ""} onChange={tko_event => tko_setColumnMap(tko_current => ({ ...tko_current, [tko_header]: tko_event.target.value }))} className="w-40 rounded-md border border-[#d0d5dd] bg-white px-2 py-1.5 text-xs font-semibold text-[#344054]"><option value="">(ignore)</option>{Array.from(new Set(tko_defaultFields.map(tko_field => tko_field.targetField))).map(tko_targetField => <option key={tko_targetField} value={tko_targetField}>{tko_targetField}</option>)}</select></div>)}</div>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase tracking-wide text-[#98a2b3]"><tr>{tko_csvParsed.headers.slice(0, 5).map(tko_header => <th key={tko_header} className="pb-1 pr-3">{tko_header}</th>)}</tr></thead><tbody>{tko_csvParsed.records.slice(0, 3).map((tko_record, tko_index) => <tr key={tko_index} className="border-t border-[#f2f4f7]">{tko_csvParsed.headers.slice(0, 5).map(tko_header => <td key={tko_header} className="max-w-[180px] truncate py-1 pr-3 text-[#475467]">{tko_record[tko_header]}</td>)}</tr>)}</tbody></table></div>
            <button type="button" disabled={tko_stage.isPending || tko_mapping.isPending} onClick={() => void tko_stageCsv()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#5b51e8] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4d43da] disabled:opacity-60"><FileSpreadsheet className="h-4 w-4" />{tko_stage.isPending || tko_mapping.isPending ? "Staging…" : `Stage ${tko_csvParsed.records.length} records & save mapping`}</button>
          </div> : null}
        </div> : <div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[#475467]">Source record ID<input value={tko_sourceRecordId} onChange={tko_event => tko_setSourceRecordId(tko_event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#d0d5dd] px-3 py-2.5 text-sm" /></label><label className="text-xs font-semibold text-[#475467]">Source type<input value={tko_sourceType} onChange={tko_event => tko_setSourceType(tko_event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#d0d5dd] px-3 py-2.5 text-sm" /></label></div><label className="mt-3 block text-xs font-semibold text-[#475467]">JSON payload<textarea value={tko_payload} onChange={tko_event => tko_setPayload(tko_event.target.value)} className="mt-1.5 min-h-32 w-full rounded-lg border border-[#d0d5dd] p-3 font-mono text-xs leading-5 text-[#344054]" /></label><button type="button" disabled={tko_stage.isPending} onClick={tko_stageRecord} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#c7d7fe] bg-[#eef4ff] px-3 py-2.5 text-sm font-semibold text-[#175cd3] transition hover:bg-[#dbe8ff] disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{tko_stage.isPending ? "Staging…" : "Validate & stage"}</button>
        </div>}
      </article>
      <article className="rounded-2xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#ecfdf3] text-[#027a48]"><Layers3 className="h-5 w-5" /></span><div><h2 className="font-semibold text-[#182230]">2. Map &amp; execute</h2><p className="text-xs text-[#667085]">Persisted mappings are required before batch materialization.</p></div></div><label className="mt-5 block text-xs font-semibold text-[#475467]">Target model<select value={tko_target} onChange={tko_event => tko_setTarget(tko_event.target.value as typeof tko_target)} className="mt-1.5 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 py-2.5 text-sm font-medium text-[#344054]">{tko_targets.map(tko_option => <option key={tko_option} value={tko_option}>{tko_label(tko_option)}</option>)}</select></label><label className="mt-4 block text-xs font-semibold text-[#475467]">Duplicate strategy<select value={tko_duplicateStrategy} onChange={tko_event => tko_setDuplicateStrategy(tko_event.target.value as typeof tko_duplicateStrategy)} className="mt-1.5 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 py-2.5 text-sm font-medium text-[#344054]">{tko_duplicateStrategies.map(tko_option => <option key={tko_option} value={tko_option}>{tko_label(tko_option)}</option>)}</select><span className="mt-1 block text-[11px] font-normal leading-4 text-[#98a2b3]">skip creates a new record per source row · update matches existing leads by email (else name+company) and refreshes fields · create_duplicate always inserts.</span></label><div className="mt-4 rounded-xl border border-[#f2f4f7] bg-[#fcfcfd] p-3"><p className="text-xs font-semibold text-[#475467]">Suggested fields</p><div className="mt-2 space-y-1">{tko_defaultFields.map(tko_field => <p key={tko_field.targetField} className="font-mono text-[11px] text-[#667085]">{tko_field.sourceField} <span className="text-[#98a2b3]">→</span> {tko_field.targetField}{tko_field.required ? " · required" : ""}</p>)}</div></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={tko_mapping.isPending} onClick={() => tko_mapping.mutate({ jobId: tko_selectedJob, sourceType: tko_sourceType, targetKind: tko_target, duplicateStrategy: tko_duplicateStrategy, fields: tko_defaultFields })} className="rounded-lg border border-[#c7d7fe] bg-[#eef4ff] px-3 py-2.5 text-sm font-semibold text-[#175cd3] disabled:opacity-60">{tko_mapping.isPending ? "Saving…" : "Save mapping"}</button><button type="button" disabled={tko_queue.isPending || !tko_preview.data?.records.length} onClick={() => tko_queue.mutate({ jobId: tko_selectedJob, idempotencyKey: crypto.randomUUID() })} className="rounded-lg bg-[#5b51e8] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4d43da] disabled:opacity-60">Queue batches</button>{tko_batchIds.map(tko_batchId => <button key={tko_batchId} type="button" disabled={tko_execute.isPending} onClick={() => tko_execute.mutate({ batchId: tko_batchId })} className="inline-flex items-center gap-2 rounded-lg bg-[#027a48] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Play className="h-4 w-4" />Run batch</button>)}</div></article></section> : null}

    {tko_selectedJob ? <section className="mt-5 rounded-2xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-[#182230]">Preview &amp; validation</h2><p className="mt-1 text-xs text-[#667085]">Records never materialize until a mapping is saved and a queued batch is intentionally run.</p></div><span className="rounded-full bg-[#f4f3ff] px-3 py-1 text-xs font-bold text-[#5b51e8]">{tko_preview.data?.records.length ?? 0} staged</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-[#eaecf0] text-xs uppercase tracking-wide text-[#98a2b3]"><tr><th className="pb-3">Source record</th><th className="pb-3">Type</th><th className="pb-3">Status</th><th className="pb-3">Target</th><th className="pb-3">Validation</th></tr></thead><tbody>{tko_preview.data?.records.length ? tko_preview.data.records.map(tko_record => <tr key={tko_record.id} className="border-b border-[#f2f4f7] last:border-0"><td className="py-3 font-mono text-xs text-[#475467]">{tko_record.sourceRecordId}</td><td className="py-3 text-[#475467]">{tko_record.sourceType}</td><td className="py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tko_statusTone(tko_record.status)}`}>{tko_record.status}</span></td><td className="py-3 text-[#475467]">{tko_record.targetKind ?? "Not mapped"}</td><td className="py-3 text-xs text-[#667085]">{Object.keys(tko_record.validation).length ? JSON.stringify(tko_record.validation) : "No issues"}</td></tr>) : <tr><td colSpan={5} className="py-8 text-center text-sm text-[#667085]">Stage a source record to inspect validation and mapping readiness.</td></tr>}</tbody></table></div></section> : null}

    <section className="mt-5 rounded-2xl border border-[#eaecf0] bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.05)]"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fffaeb] text-[#b54708]"><Download className="h-5 w-5" /></span><div><h2 className="font-semibold text-[#182230]">Export CSV</h2><p className="mt-1 text-xs text-[#667085]">Owner/admin only. Tenant-scoped, RFC4180-quoted and audited as a data export event.</p></div></div><span className="rounded-full bg-[#f9fafb] px-3 py-1 text-[11px] font-semibold text-[#667085]">data.exported.v1</span></div><div className="mt-4 flex flex-wrap items-center gap-2"><select value={tko_exportEntity} onChange={tko_event => tko_setExportEntity(tko_event.target.value as typeof tko_exportEntity)} className="rounded-lg border border-[#d0d5dd] bg-white px-3 py-2.5 text-sm font-medium text-[#344054]">{tko_exportEntities.map(tko_option => <option key={tko_option} value={tko_option}>{tko_label(tko_option)}</option>)}</select><button type="button" disabled={tko_export.isPending} onClick={() => tko_export.mutate({ entityType: tko_exportEntity })} className="inline-flex items-center gap-2 rounded-lg bg-[#5b51e8] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4d43da] disabled:opacity-60 active:scale-[.97]"><Download className="h-4 w-4" />{tko_export.isPending ? "Exporting…" : "Download CSV"}</button></div></section>
  </main>;
}
