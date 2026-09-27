import type { CsvExportEntityType, CsvExportInput, CsvExportResult } from "../../../packages/contracts/src/ecosystem";
import type { PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { requireCapability } from "../../permissions/src/authorization";

/** Module CSV exports (spec 19 §7): pure, read-only, tenant-scoped. Every export is an audit
 * event (spec 18 §5) emitted through the transactional outbox as data.exported.v1. Cells that
 * begin with = + - or @ are prefixed with a single quote to defuse CSV/formula injection. */

const tko_entityTypes: readonly CsvExportEntityType[] = ["work_items", "time_logs", "crm_leads", "crm_companies", "crm_contacts", "crm_deals"];

export function isCsvExportEntityType(tko_value: string): tko_value is CsvExportEntityType {
  return (tko_entityTypes as readonly string[]).includes(tko_value);
}

const tko_text = (tko_value: unknown): string => {
  if (tko_value === null || tko_value === undefined) return "";
  if (tko_value instanceof Date) return tko_value.toISOString();
  if (typeof tko_value === "object") return JSON.stringify(tko_value);
  return String(tko_value);
};

const tko_safeCell = (tko_value: unknown): string => {
  const tko_raw = tko_text(tko_value);
  return /^[=+\-@]/.test(tko_raw) ? `'${tko_raw}` : tko_raw;
};

const tko_escapeField = (tko_value: unknown): string => {
  const tko_cell = tko_safeCell(tko_value);
  return /[",\r\n]/.test(tko_cell) ? `"${tko_cell.replaceAll('"', '""')}"` : tko_cell;
};

export function tko_toCsv(tko_headers: readonly string[], tko_rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const tko_lines = [tko_headers, ...tko_rows].map(tko_row => tko_row.map(tko_escapeField).join(","));
  // UTF-8 BOM keeps non-ASCII names intact when opened directly in spreadsheet tools.
  return `\uFEFF${tko_lines.join("\r\n")}\r\n`;
}

const tko_isoDate = (tko_value: Date | null): string => tko_value ? tko_value.toISOString() : "";
const tko_displayName = (tko_members: Map<string, string>, tko_memberId: string): string => tko_members.get(tko_memberId) ?? tko_memberId;

export class ExportService {
  async exportCsv(tko_actor: PlatformActor, tko_input: CsvExportInput & { correlationId: string }): Promise<CsvExportResult> {
    const tko_resource: TenantResource = { tenantId: tko_actor.tenantId, type: "tenant", id: tko_actor.tenantId, visibility: "internal" };
    requireCapability(tko_actor, "data.export", tko_resource);
    if (!isCsvExportEntityType(tko_input.entityType)) throw new Error("EXPORT_ENTITY_TYPE_INVALID");
    const tko_members = new Map<string, string>((await getPlatformStore().listTenantMembers(tko_actor.tenantId)).map(tko_member => [tko_member.id, tko_member.displayName]));
    const tko_day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const tko_filename = `${tko_actor.tenantSlug}-${tko_input.entityType.replaceAll("_", "-")}-${tko_day}.csv`;

    let tko_headers: readonly string[] = [];
    let tko_rows: Array<Array<unknown>> = [];

    if (tko_input.entityType === "work_items" || tko_input.entityType === "time_logs") {
      const tko_work = getWorkStore();
      const tko_projects = (await tko_work.listProjects(tko_actor.tenantId)).filter(tko_project => !tko_input.filters?.projectId || tko_project.id === tko_input.filters.projectId);
      if (tko_input.entityType === "work_items") {
        tko_headers = ["key", "title", "type", "status", "priority", "assignees", "labels", "start_at", "due_at", "estimate_minutes", "logged_minutes", "completed_at", "created_at"];
        for (const tko_project of tko_projects) {
          const [tko_statuses, tko_labels, tko_types] = await Promise.all([
            tko_work.listStatuses(tko_actor.tenantId, tko_project.workflowId),
            tko_work.listLabels(tko_actor.tenantId, tko_project.id),
            tko_work.listWorkTypes(tko_actor.tenantId, tko_project.id),
          ]);
          const tko_statusNames = new Map(tko_statuses.map(tko_status => [tko_status.id, tko_status.name]));
          const tko_labelNames = new Map(tko_labels.map(tko_label => [tko_label.id, tko_label.name]));
          const tko_typeNames = new Map(tko_types.map(tko_type => [tko_type.id, tko_type.name]));
          for (const tko_item of await tko_work.listWorkItems(tko_actor.tenantId, tko_project.id)) {
            const tko_logs = await tko_work.listTimeLogs(tko_actor.tenantId, tko_item.id);
            tko_rows.push([
              tko_item.key, tko_item.title, tko_typeNames.get(tko_item.workTypeId) ?? "", tko_statusNames.get(tko_item.statusId) ?? "",
              tko_item.priority, tko_item.assigneeMemberIds.map(tko_id => tko_displayName(tko_members, tko_id)).join("; "),
              tko_item.labelIds.map(tko_id => tko_labelNames.get(tko_id) ?? "").filter(Boolean).join("; "),
              tko_isoDate(tko_item.startAt), tko_isoDate(tko_item.dueAt), tko_item.estimateMinutes ?? "",
              tko_logs.reduce((tko_sum, tko_log) => tko_sum + tko_log.minutes, 0), tko_isoDate(tko_item.completedAt), tko_isoDate(tko_item.createdAt),
            ]);
          }
        }
      } else {
        tko_headers = ["item_key", "item_title", "member", "minutes", "started_at", "note", "logged_at"];
        for (const tko_project of tko_projects) {
          for (const tko_item of await tko_work.listWorkItems(tko_actor.tenantId, tko_project.id)) {
            for (const tko_log of await tko_work.listTimeLogs(tko_actor.tenantId, tko_item.id)) {
              tko_rows.push([tko_item.key, tko_item.title, tko_displayName(tko_members, tko_log.memberId), tko_log.minutes, tko_isoDate(tko_log.startedAt), tko_log.note, tko_isoDate(tko_log.createdAt)]);
            }
          }
        }
      }
    } else {
      const tko_crm = getCRMStore();
      if (tko_input.entityType === "crm_leads") {
        tko_headers = ["first_name", "last_name", "company", "job_title", "email", "phone", "website", "country", "source", "status", "score", "converted_at", "created_at"];
        for (const tko_lead of await tko_crm.listLeads(tko_actor.tenantId)) tko_rows.push([tko_lead.firstName, tko_lead.lastName, tko_lead.companyName, tko_lead.jobTitle, tko_lead.email, tko_lead.phone, tko_lead.website, tko_lead.country, tko_lead.source, tko_lead.status, tko_lead.score ?? "", tko_isoDate(tko_lead.convertedAt), tko_isoDate(tko_lead.createdAt)]);
      } else if (tko_input.entityType === "crm_companies") {
        tko_headers = ["name", "domain", "website", "industry", "employee_range", "country", "lifecycle_status", "created_at"];
        for (const tko_company of await tko_crm.listCompanies(tko_actor.tenantId)) tko_rows.push([tko_company.name, tko_company.domain, tko_company.website, tko_company.industry, tko_company.employeeRange, tko_company.country, tko_company.lifecycleStatus, tko_isoDate(tko_company.createdAt)]);
      } else if (tko_input.entityType === "crm_contacts") {
        const tko_companies = new Map((await tko_crm.listCompanies(tko_actor.tenantId)).map(tko_company => [tko_company.id, tko_company.name]));
        tko_headers = ["first_name", "last_name", "company", "title", "emails", "phones", "created_at"];
        for (const tko_contact of await tko_crm.listContacts(tko_actor.tenantId)) tko_rows.push([tko_contact.firstName, tko_contact.lastName, tko_contact.companyId ? tko_companies.get(tko_contact.companyId) ?? "" : "", tko_contact.title, tko_contact.emails.join("; "), tko_contact.phones.join("; "), tko_isoDate(tko_contact.createdAt)]);
      } else {
        const tko_stages = new Map((await tko_crm.listStages(tko_actor.tenantId, tko_input.filters?.pipelineId ?? "")).map(tko_stage => [tko_stage.id, tko_stage.name]));
        if (!tko_input.filters?.pipelineId) for (const tko_pipeline of await tko_crm.listPipelines(tko_actor.tenantId)) for (const tko_stage of await tko_crm.listStages(tko_actor.tenantId, tko_pipeline.id)) tko_stages.set(tko_stage.id, tko_stage.name);
        const tko_companies = new Map((await tko_crm.listCompanies(tko_actor.tenantId)).map(tko_company => [tko_company.id, tko_company.name]));
        tko_headers = ["name", "company", "stage", "amount_cents", "currency", "probability", "expected_close_date", "won_at", "lost_at", "loss_reason", "source", "next_step", "created_at"];
        for (const tko_deal of await tko_crm.listDeals(tko_actor.tenantId, tko_input.filters?.pipelineId ?? undefined)) tko_rows.push([
          tko_deal.name, tko_deal.companyId ? tko_companies.get(tko_deal.companyId) ?? "" : "", tko_stages.get(tko_deal.stageId) ?? "",
          tko_deal.amountCents ?? "", tko_deal.currency, tko_deal.probability, tko_isoDate(tko_deal.expectedCloseDate),
          tko_isoDate(tko_deal.wonAt), tko_isoDate(tko_deal.lostAt), tko_deal.lossReason, tko_deal.source, tko_deal.nextStep, tko_isoDate(tko_deal.createdAt),
        ]);
      }
    }

    const tko_csv = tko_toCsv(tko_headers, tko_rows);
    await getPlatformStore().writeDurableMutation({
      actor: tko_actor,
      tenantId: tko_actor.tenantId,
      eventType: "data.exported.v1",
      topic: "data.export",
      payload: { entityType: tko_input.entityType, rowCount: tko_rows.length, filename: tko_filename, filters: tko_input.filters ?? null },
      auditAction: "data.exported",
      resourceType: "tenant",
      resourceId: tko_actor.tenantId,
      correlationId: tko_input.correlationId,
    });
    return { filename: tko_filename, csv: tko_csv, rowCount: tko_rows.length, entityType: tko_input.entityType };
  }
}

let tko_exportService: ExportService | null = null;
export function getExportService(): ExportService { if (!tko_exportService) tko_exportService = new ExportService(); return tko_exportService; }
export function setExportServiceForTests(tko_service: ExportService | null): void { tko_exportService = tko_service; }
