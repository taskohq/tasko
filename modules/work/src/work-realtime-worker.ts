import type { OutboxRecord } from "../../../packages/contracts/src/platform";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { resolveWorkerServiceActor } from "../../tenancy/src/tenant-context";
import { registerOutboxConsumer } from "../../worker/src/worker-service";
import { createInboxItem } from "../../workspace/src/workspace-service";

const tko_notifiableEvents = [
  "work.work_item_created.v1",
  "work.work_item_status_changed.v1",
  "work.work_item_moved.v1",
  "work.work_item_updated.v1",
  "work.comment_created.v1",
] as const;

function tko_getWorkItemId(tko_record: OutboxRecord): string | null {
  const tko_value = tko_record.payload.workItemId;
  return typeof tko_value === "string" ? tko_value : null;
}

function tko_notificationCopy(tko_eventType: string, tko_key: string): { kind: "assignment" | "comment"; title: string; body: string } {
  if (tko_eventType === "work.work_item_created.v1") return { kind: "assignment", title: `Assigned: ${tko_key}`, body: "You were assigned a new work item." };
  if (tko_eventType === "work.comment_created.v1") return { kind: "comment", title: `New comment: ${tko_key}`, body: "A teammate added a comment to a work item assigned to you." };
  if (tko_eventType === "work.work_item_status_changed.v1" || tko_eventType === "work.work_item_moved.v1") return { kind: "assignment", title: `Board updated: ${tko_key}`, body: "A teammate moved a work item assigned to you." };
  return { kind: "assignment", title: `Work updated: ${tko_key}`, body: "A teammate updated a work item assigned to you." };
}

async function tko_notifyAssignees(tko_record: OutboxRecord): Promise<void> {
  const tko_workItemId = tko_getWorkItemId(tko_record);
  if (!tko_workItemId) throw new Error("WORK_REALTIME_WORK_ITEM_ID_REQUIRED");
  const tko_item = await getWorkStore().getWorkItem(tko_record.tenantId, tko_workItemId);
  if (!tko_item || tko_item.archivedAt) return;

  const tko_serviceActor = await resolveWorkerServiceActor({
    tenantId: tko_record.tenantId,
    correlationId: `tko_work_notification:${tko_record.eventId}`,
  });
  if (!tko_serviceActor) throw new Error("WORK_REALTIME_SERVICE_ACTOR_MISSING");

  const tko_actorMembership = tko_record.actorAuthSubject
    ? (await getPlatformStore().listMemberships(tko_record.actorAuthSubject)).find(tko_membership => tko_membership.tenant.id === tko_record.tenantId && tko_membership.status === "active")
    : null;
  const tko_members = await getPlatformStore().listTenantMembers(tko_record.tenantId);
  const tko_activeMemberIds = new Set(tko_members.map(tko_member => tko_member.id));
  const tko_recipients = Array.from(new Set(tko_item.assigneeMemberIds))
    .filter(tko_memberId => tko_activeMemberIds.has(tko_memberId) && tko_memberId !== tko_actorMembership?.id);
  const tko_copy = tko_notificationCopy(tko_record.eventType, tko_item.key);

  for (const tko_memberId of tko_recipients) {
    await createInboxItem(tko_serviceActor, {
      memberId: tko_memberId,
      kind: tko_copy.kind,
      entityType: "work_item",
      entityId: tko_item.id,
      title: tko_copy.title,
      body: tko_copy.body,
      href: `/work?item=${tko_item.id}`,
      sourceEventId: tko_record.eventId,
      correlationId: `tko_work_notification:${tko_record.eventId}`,
    });
  }
}

export function registerWorkRealtimeWorker(): void {
  for (const tko_eventType of tko_notifiableEvents) registerOutboxConsumer(tko_eventType, tko_notifyAssignees, "job.process");
}
