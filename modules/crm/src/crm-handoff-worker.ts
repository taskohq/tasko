import type { OutboxRecord } from "../../../packages/contracts/src/platform";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { resolveWorkerServiceActor } from "../../tenancy/src/tenant-context";
import { createChannel, listChannels } from "../../chat/src/chat-service";
import { createProject, createSpace } from "../../work/src/work-service";
import { registerOutboxConsumer } from "../../worker/src/worker-service";
import { completeDealHandoff, link, requestDealHandoff } from "./crm-service";

function tko_deliveryKey(tko_dealId: string): string {
  return `DLV${tko_dealId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function tko_deliveryChannelName(tko_dealId: string): string {
  return `delivery-${tko_dealId.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
}

async function tko_handleWonDeal(tko_record: OutboxRecord): Promise<void> {
  const tko_dealId = typeof tko_record.payload.dealId === "string" ? tko_record.payload.dealId : null;
  if (!tko_dealId) throw new Error("CRM_HANDOFF_DEAL_ID_REQUIRED");
  const tko_actor = await resolveWorkerServiceActor({ tenantId: tko_record.tenantId, correlationId: tko_record.correlationId });
  if (!tko_actor) throw new Error("CRM_HANDOFF_SERVICE_ACTOR_MISSING");

  const tko_store = getCRMStore();
  const tko_existingHandoff = await requestDealHandoff(tko_actor, { dealId: tko_dealId, correlationId: tko_record.correlationId });
  if (tko_existingHandoff.status === "completed") return;
  const tko_deal = await tko_store.getDeal(tko_actor.tenantId, tko_dealId);
  if (!tko_deal) throw new Error("CRM_DEAL_NOT_FOUND");

  const tko_spaces = await getWorkStore().listSpaces(tko_actor.tenantId);
  const tko_space = tko_spaces.find(tko_item => tko_item.slug === "delivery")
    ?? tko_spaces[0]
    ?? await createSpace(tko_actor, { name: "Delivery", slug: "delivery", visibility: "internal", correlationId: tko_record.correlationId });
  const tko_projectKey = tko_deliveryKey(tko_deal.id);
  const tko_existingProject = (await getWorkStore().listProjects(tko_actor.tenantId)).find(tko_project => tko_project.key === tko_projectKey);
  const tko_project = tko_existingProject ?? await createProject({ actor: tko_actor, spaceId: tko_space.id, key: tko_projectKey, name: `Delivery — ${tko_deal.name}`, description: `Delivery handoff for CRM deal ${tko_deal.id}`, methodology: "kanban", visibility: "internal", correlationId: tko_record.correlationId });

  const tko_channelName = tko_deliveryChannelName(tko_deal.id);
  const tko_existingChannel = (await listChannels(tko_actor)).find(tko_channel => tko_channel.name === tko_channelName);
  const tko_channel = tko_existingChannel ?? await createChannel(tko_actor, { kind: "private", name: tko_channelName, topic: `Delivery handoff for ${tko_deal.name}`, memberIds: [tko_actor.memberId], visibility: "private" });

  await link(tko_actor, { sourceType: "deal", sourceId: tko_deal.id, targetType: "project", targetId: tko_project.id, relationType: "delivery_project", correlationId: tko_record.correlationId });
  await link(tko_actor, { sourceType: "deal", sourceId: tko_deal.id, targetType: "channel", targetId: tko_channel.id, relationType: "delivery_channel", correlationId: tko_record.correlationId });
  await completeDealHandoff(tko_actor, { dealId: tko_deal.id, deliveryProjectId: tko_project.id, deliveryChannelId: tko_channel.id, correlationId: tko_record.correlationId });
}

export function registerCRMHandoffWorker(): void {
  registerOutboxConsumer("crm.deal_won.v1", tko_handleWonDeal);
  registerOutboxConsumer("crm.deal_handoff_requested.v1", tko_handleWonDeal);
}
