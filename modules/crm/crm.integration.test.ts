import { beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryCRMStore, getCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { processOutboxOnce } from "../worker/src/worker-service";
import { registerCRMHandoffWorker } from "./src/crm-handoff-worker";
import * as crm from "./src/crm-service";
import * as work from "../work/src/work-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "crm-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-demo-owner", role: "owner", membershipStatus: "active", correlationId: "crm-test", ...tko_overrides };
}

describe("Slim CRM Alpha M3", () => {
  let tko_platform: MemoryPlatformStore;
  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setCRMStoreForTests(new MemoryCRMStore());
    setWorkStoreForTests(new MemoryWorkStore());
    setChatStoreForTests(new MemoryChatStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "crm-owner", tenantSlug: "tasko-demo" });
    registerCRMHandoffWorker();
  });

  it("converts a qualified lead idempotently and keeps the durable sales record", async () => {
    const tko_owner = tko_actor();
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "Sales", correlationId: "pipeline" });
    const tko_lead = await crm.createLead({ actor: tko_owner, firstName: "An", lastName: "Nguyen", companyName: "Tasko Pilot", email: "an@example.test", status: "qualified", correlationId: "lead" });
    const tko_input = { actor: tko_owner, leadId: tko_lead.id, conversionKey: "621ae93c-e414-49cf-8b09-9b06d611842d", createDeal: true, pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, dealName: "Tasko Pilot rollout", correlationId: "conversion" };

    const tko_first = await crm.convertLead(tko_input);
    const tko_retry = await crm.convertLead(tko_input);

    expect(tko_first.deal).not.toBeNull();
    expect(tko_retry.idempotent).toBe(true);
    expect(tko_retry.deal?.id).toBe(tko_first.deal?.id);
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toContain("crm.lead.converted");
  });

  it("denies CRM mutations to a guest actor", async () => {
    const tko_guest = tko_actor({ authSubject: "crm-guest", memberId: "crm-guest-member", role: "guest" });
    await expect(crm.createLead({ actor: tko_guest, firstName: "No", lastName: "Access", status: "new", correlationId: "guest-denial" })).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("creates a tenant-scoped follow-up WorkItem with durable CRM link, audit/outbox records, and guest denial", async () => {
    const tko_owner = tko_actor();
    const tko_space = await work.createSpace(tko_owner, { name: "Customer delivery", slug: "customer-delivery", visibility: "internal", correlationId: "follow-up-space" });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Northstar delivery", key: "NORTH", methodology: "kanban", visibility: "internal", correlationId: "follow-up-project" });
    const tko_lead = await crm.createLead({ actor: tko_owner, firstName: "Avery", lastName: "Nguyen", companyName: "Northstar Labs", status: "qualified", correlationId: "follow-up-lead" });
    const tko_dueAt = new Date("2026-09-10T09:00:00.000Z");

    const tko_followUp = await crm.createFollowUp(tko_owner, { entityType: "lead", entityId: tko_lead.id, projectId: tko_project.id, title: "Confirm Northstar launch scope", dueAt: tko_dueAt, correlationId: "follow-up-create" });

    expect(tko_followUp.item).toEqual(expect.objectContaining({ tenantId: tko_owner.tenantId, projectId: tko_project.id, title: "Confirm Northstar launch scope", dueAt: tko_dueAt }));
    expect(await getWorkStore().getWorkItem(tko_owner.tenantId, tko_followUp.item.id)).toEqual(expect.objectContaining({ id: tko_followUp.item.id, projectId: tko_project.id }));
    expect(tko_followUp.link).toEqual(expect.objectContaining({ tenantId: tko_owner.tenantId, sourceType: "lead", sourceId: tko_lead.id, targetType: "work_item", targetId: tko_followUp.item.id, relationType: "follow_up" }));
    expect(await getCRMStore().listLinks(tko_owner.tenantId, "lead", tko_lead.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_followUp.link.id, targetId: tko_followUp.item.id, relationType: "follow_up" })]));
    expect(await getCRMStore().listActivities(tko_owner.tenantId, "lead", tko_lead.id)).toEqual(expect.arrayContaining([expect.objectContaining({ activityType: "linked_work_event", metadata: expect.objectContaining({ workItemId: tko_followUp.item.id }) })]));

    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["work.work_item.created", "crm.entity.linked", "crm.activity.created"]));
    expect((await tko_platform.reserveOutbox(100)).map(tko_event => tko_event.eventType)).toEqual(expect.arrayContaining(["work.work_item_created.v1", "crm.entity_linked.v1", "crm.activity_created.v1"]));

    const tko_guest = tko_actor({ authSubject: "crm-guest", memberId: "crm-guest-member", role: "guest" });
    await expect(crm.createFollowUp(tko_guest, { entityType: "lead", entityId: tko_lead.id, projectId: tko_project.id, title: "Unauthorized follow-up", correlationId: "follow-up-guest-denial" })).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("rejects nonexistent CRM sources before creating any follow-up WorkItem or durable entity link", async () => {
    const tko_owner = tko_actor();
    const tko_space = await work.createSpace(tko_owner, { name: "Integrity", slug: "integrity", visibility: "internal", correlationId: "integrity-space" });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Integrity project", key: "INT", methodology: "kanban", visibility: "internal", correlationId: "integrity-project" });
    const tko_missingId = "00000000-0000-4000-8000-000000000003";
    const tko_workItemsBefore = await getWorkStore().listWorkItems(tko_owner.tenantId, tko_project.id);
    const tko_auditCountBefore = (await tko_platform.listAuditLogs()).length;

    for (const tko_entityType of ["lead", "company", "contact", "deal"] as const) {
      await expect(crm.createFollowUp(tko_owner, { entityType: tko_entityType, entityId: tko_missingId, projectId: tko_project.id, title: "Must not persist", correlationId: `missing-follow-up-${tko_entityType}` })).rejects.toThrow("CRM_ENTITY_NOT_FOUND");
      await expect(crm.link(tko_owner, { sourceType: tko_entityType, sourceId: tko_missingId, targetType: "project", targetId: tko_project.id, relationType: "context", correlationId: `missing-link-${tko_entityType}` })).rejects.toThrow("CRM_ENTITY_NOT_FOUND");
    }

    expect(await getWorkStore().listWorkItems(tko_owner.tenantId, tko_project.id)).toEqual(tko_workItemsBefore);
    expect((await tko_platform.listAuditLogs()).length).toBe(tko_auditCountBefore);
  });

  it("hands a won deal to delivery through the transactional outbox without duplicate projects or channels", async () => {
    const tko_owner = tko_actor();
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "Enterprise", correlationId: "pipeline" });
    const tko_deal = await crm.createDeal(tko_owner, { companyId: null, pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, name: "Delivery handoff", correlationId: "deal" });
    const tko_wonStage = tko_pipeline.stages.find(tko_stage => tko_stage.category === "won");
    expect(tko_wonStage).toBeDefined();
    await crm.moveDeal(tko_owner, { dealId: tko_deal.id, stageId: tko_wonStage!.id, correlationId: "won" });

    await processOutboxOnce(100);
    const tko_handoff = await getCRMStore().getDealHandoff(tko_owner.tenantId, tko_deal.id);
    expect(tko_handoff).toEqual(expect.objectContaining({ status: "completed", deliveryProjectId: expect.any(String), deliveryChannelId: expect.any(String) }));
    await processOutboxOnce(100);
    expect((await getWorkStore().listProjects(tko_owner.tenantId)).filter(tko_project => tko_project.name === "Delivery — Delivery handoff")).toHaveLength(1);
    expect((await getCRMStore().listLinks(tko_owner.tenantId, "deal", tko_deal.id)).map(tko_link => tko_link.relationType)).toEqual(expect.arrayContaining(["delivery_project", "delivery_channel"]));
  });
});
