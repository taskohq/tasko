import type { OutboxRecord, PlatformActor } from "../../../packages/contracts/src/platform";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getWorkspaceStore } from "../../../packages/database/src/workspace-store";
import { resolveWorkerServiceActor } from "../../tenancy/src/tenant-context";
import { registerOutboxConsumer } from "../../worker/src/worker-service";
import { createInboxItem, indexSearchDocument, processAutomationEvent } from "./workspace-service";

function tko_payloadId(tko_record: OutboxRecord, tko_name: string): string | null { const tko_value = tko_record.payload[tko_name]; return typeof tko_value === "string" ? tko_value : null; }
async function tko_actorFor(tko_record: OutboxRecord): Promise<PlatformActor> { const tko_actor = await resolveWorkerServiceActor({ tenantId: tko_record.tenantId, correlationId: tko_record.correlationId }); if (!tko_actor) throw new Error("WORKSPACE_SERVICE_ACTOR_MISSING"); return tko_actor; }

async function tko_indexWork(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "workItemId"); if (!tko_id) throw new Error("WORKSPACE_WORK_ITEM_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_id); if (!tko_item) return;
  await indexSearchDocument(tko_actor, { entityType: "work_item", entityId: tko_item.id, kind: "work", title: `${tko_item.key} · ${tko_item.title}`, bodyText: tko_item.description ?? "", href: `/work?item=${tko_item.id}`, visibility: tko_item.visibility, explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
  await processAutomationEvent(tko_actor, tko_record);
}

async function tko_indexLead(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "leadId"); if (!tko_id) throw new Error("WORKSPACE_LEAD_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_lead = await getCRMStore().getLead(tko_actor.tenantId, tko_id); if (!tko_lead) return;
  await indexSearchDocument(tko_actor, { entityType: "crm_lead", entityId: tko_lead.id, kind: "crm", title: `${tko_lead.firstName} ${tko_lead.lastName}`.trim(), bodyText: [tko_lead.companyName, tko_lead.email, tko_lead.notes].filter(Boolean).join(" · "), href: `/crm?lead=${tko_lead.id}`, visibility: tko_lead.visibility, explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
  await processAutomationEvent(tko_actor, tko_record);
}

async function tko_indexDocument(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "documentId"); if (!tko_id) throw new Error("WORKSPACE_DOCUMENT_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_id); if (!tko_document) return;
  await indexSearchDocument(tko_actor, { entityType: "document", entityId: tko_document.id, kind: "doc", title: tko_document.title, bodyText: tko_document.bodyText, href: `/docs?document=${tko_document.id}`, visibility: tko_document.visibility, explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_handleFormSubmission(tko_record: OutboxRecord): Promise<void> {
  const tko_actor = await tko_actorFor(tko_record); const tko_memberId = tko_payloadId(tko_record, "submittedByMemberId"); const tko_entityId = tko_payloadId(tko_record, "targetEntityId"); const tko_type = tko_payloadId(tko_record, "targetEntityType");
  if (!tko_memberId || !tko_entityId || (tko_type !== "work_item" && tko_type !== "crm_lead")) throw new Error("WORKSPACE_FORM_EVENT_INVALID");
  await createInboxItem(tko_actor, { memberId: tko_memberId, kind: "form", entityType: tko_type, entityId: tko_entityId, title: "Form submission created", body: "Your form created a linked record.", href: tko_type === "work_item" ? `/work?item=${tko_entityId}` : `/crm?lead=${tko_entityId}`, sourceEventId: tko_record.eventId, correlationId: `tko_materialize:${tko_record.eventId}` });
  await processAutomationEvent(tko_actor, tko_record);
}

export function registerWorkspaceWorker(): void {
  registerOutboxConsumer("work.item_created.v1", tko_indexWork, "job.process");
  registerOutboxConsumer("crm.lead_created.v1", tko_indexLead, "job.process");
  registerOutboxConsumer("workspace.document_created.v1", tko_indexDocument, "job.process");
  registerOutboxConsumer("workspace.form_submitted.v1", tko_handleFormSubmission, "job.process");
}
