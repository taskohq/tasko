import { beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { getAIStore, MemoryAIStore, setAIStoreForTests } from "../../packages/database/src/ai-store";
import { MemoryCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryDeveloperStore, setDeveloperStoreForTests } from "../../packages/database/src/developer-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { can } from "../permissions/src/authorization";
import * as crm from "../crm/src/crm-service";
import * as work from "../work/src/work-service";
import { confirmProposal, executeConfirmedProposal, proposeAction } from "./src/ai-service";
import { getAITool, listAITools } from "./src/tool-registry";

const tko_tenantId = "tko-tenant-tasko-demo";
function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor { return { authSubject: "ai-tools-owner", tenantId: tko_tenantId, tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "ai-tools-test", ...tko_overrides }; }
type TkoAuditMetadata = { toolName?: string; outcome?: string; proposalId?: string | null; entityRefs?: Record<string, string>; reason?: string };

describe("Tasko AI tool registry, proposal flow and durable audit", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_owner: PlatformActor;
  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setAIStoreForTests(new MemoryAIStore());
    setCRMStoreForTests(new MemoryCRMStore());
    setWorkStoreForTests(new MemoryWorkStore());
    setDeveloperStoreForTests(new MemoryDeveloperStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "ai-tools-owner", tenantSlug: "tasko-demo" });
    tko_owner = tko_actor();
  });

  it("registers the spec's Act tools as confirmation-required sensitive writes with input hints", () => {
    const tko_names = listAITools().map(tko_tool => tko_tool.name);
    expect(tko_names).toContain("work.transition_status");
    expect(tko_names).toContain("crm.update_deal_stage");
    for (const tko_name of ["work.transition_status", "crm.update_deal_stage"] as const) {
      const tko_tool = getAITool(tko_name);
      expect(tko_tool.risk).toBe("write");
      expect(tko_tool.requiresConfirmation).toBe(true);
      expect(tko_tool.capability).toBe("ai.action.propose");
      const tko_fields = tko_tool.inputFields ?? [];
      expect(tko_fields.length).toBeGreaterThan(0);
      for (const tko_field of tko_fields) if (tko_field.required) expect(tko_fields.map(tko_entry => tko_entry.name)).toContain(tko_field.name);
    }
    expect((getAITool("work.transition_status").inputFields ?? []).map(tko_field => tko_field.name)).toEqual(["workItemId", "targetStatusId", "expectedVersion"]);
    expect((getAITool("crm.update_deal_stage").inputFields ?? []).map(tko_field => tko_field.name)).toEqual(["dealId", "stageId", "note"]);
  });

  it("audits an allowed read-tool execution through the durable outbox pattern", async () => {
    const tko_result = await getAITool("context.read").execute(tko_owner, { entityRefs: [], intent: "summary" }, "corr-read-ok");
    expect(tko_result).toHaveProperty("context");
    const tko_executed = (await tko_platform.listAuditLogs()).filter(tko_row => tko_row.action === "ai.tool.executed");
    expect(tko_executed.some(tko_row => tko_row.resourceId === "context.read" && tko_row.correlationId === "corr-read-ok" && tko_row.actorAuthSubject === tko_owner.authSubject)).toBe(true);
    expect((await tko_platform.reserveOutbox(50)).some(tko_event => tko_event.eventType === "ai.tool_executed.v1")).toBe(true);
  });

  it("denies a member without crm capability, writes ai.tool.denied and never executes the handler", async () => {
    const tko_guest = tko_actor({ authSubject: "ai-tools-guest", memberId: "tko-member-tasko-demo-guest", role: "guest" });
    const tko_resource = { tenantId: tko_tenantId, type: "crm_deal" as const, id: "any-deal", visibility: "internal" as const };
    expect(can(tko_guest, "crm.deal.manage", tko_resource).allowed).toBe(false);
    await expect(crm.moveDeal(tko_guest, { dealId: "any-deal", stageId: "any-stage", correlationId: "deny-crm" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(getAITool("crm.update_deal_stage").execute(tko_guest, { dealId: "any-deal", stageId: "any-stage" }, "corr-deny")).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    const tko_denied = (await tko_platform.listAuditLogs()).filter(tko_row => tko_row.action === "ai.tool.denied");
    expect(tko_denied.some(tko_row => tko_row.resourceId === "crm.update_deal_stage" && tko_row.correlationId === "corr-deny" && ((tko_row.metadata as TkoAuditMetadata).reason ?? "").includes("capability_missing"))).toBe(true);
    const tko_events = (await tko_platform.reserveOutbox(50)).map(tko_event => tko_event.eventType);
    expect(tko_events).toContain("ai.tool_denied.v1");
    expect(tko_events).not.toContain("crm.deal_stage_changed.v1");
  });

  it("moves a CRM deal stage through propose → confirm → execute and audits each step", async () => {
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "Sales", correlationId: "pipeline" });
    const tko_deal = await crm.createDeal(tko_owner, { pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, name: "Pilot rollout", correlationId: "deal" });
    const tko_targetStage = tko_pipeline.stages[1];
    const tko_proposal = await proposeAction(tko_owner, { toolName: "crm.update_deal_stage", input: { dealId: tko_deal.id, stageId: tko_targetStage.id, note: "Customer asked to fast-track", authorization: "Bearer should-never-persist" }, idempotencyKey: "stage-once", correlationId: "stage-flow" });
    expect(tko_proposal.preview).toMatchObject({ dealId: tko_deal.id, stageId: tko_targetStage.id });
    expect(tko_proposal.input.authorization).toBe("[redacted]");
    await expect(executeConfirmedProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "stage-early" })).rejects.toThrow("AI_PROPOSAL_NOT_EXECUTABLE");
    const tko_confirmed = await confirmProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "stage-confirm" });
    expect(tko_confirmed.status).toBe("confirmed");
    const tko_execution = await executeConfirmedProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "stage-execute" });
    expect(tko_execution.result).toMatchObject({ dealId: tko_deal.id, stageId: tko_targetStage.id });
    expect((await crm.dealDetails(tko_owner, tko_deal.id)).deal.stageId).toBe(tko_targetStage.id);
    const tko_activities = await crm.entityActivities(tko_owner, "deal", tko_deal.id);
    expect(tko_activities.some(tko_activity => tko_activity.activityType === "note" && tko_activity.body === "Customer asked to fast-track")).toBe(true);
    const tko_auditLogs = await tko_platform.listAuditLogs();
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.proposal.confirmed" && tko_row.resourceId === tko_proposal.id)).toBe(true);
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.proposal.executed" && tko_row.resourceId === tko_proposal.id)).toBe(true);
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.tool.executed" && tko_row.resourceId === "crm.update_deal_stage" && (tko_row.metadata as TkoAuditMetadata).proposalId === tko_proposal.id && (tko_row.metadata as TkoAuditMetadata).entityRefs?.dealId === tko_deal.id && tko_row.correlationId === "stage-execute")).toBe(true);
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.proposal.denied" && tko_row.correlationId === "stage-early")).toBe(true);
    const tko_events = (await tko_platform.reserveOutbox(100)).map(tko_event => tko_event.eventType);
    expect(tko_events).toContain("ai.proposal_lifecycle.v1");
    expect(tko_events).toContain("ai.tool_executed.v1");
  });

  it("transitions a work item status through the proposal flow with a durable audit trail", async () => {
    const tko_space = await work.createSpace(tko_owner, { name: "Operations", slug: "operations", visibility: "internal", correlationId: "space" });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Delivery", key: "DLV", methodology: "simple", visibility: "internal", correlationId: "project" });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Prepare kickoff", correlationId: "item" });
    const tko_created = await getWorkStore().getWorkItem(tko_tenantId, tko_item.id);
    expect(tko_created).not.toBeNull();
    const tko_statuses = await getWorkStore().listStatuses(tko_tenantId, tko_created!.workflowId);
    const tko_targetStatus = tko_statuses.find(tko_status => tko_status.id !== tko_created!.statusId);
    expect(tko_targetStatus).toBeDefined();
    const tko_proposal = await proposeAction(tko_owner, { toolName: "work.transition_status", input: { workItemId: tko_created!.id, targetStatusId: tko_targetStatus!.id, expectedVersion: tko_created!.version }, correlationId: "transition-flow" });
    expect(tko_proposal.preview).toMatchObject({ workItemId: tko_created!.id, targetStatusId: tko_targetStatus!.id, expectedVersion: tko_created!.version });
    await confirmProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "transition-confirm" });
    const tko_execution = await executeConfirmedProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "transition-execute" });
    expect(tko_execution.result).toMatchObject({ workItemId: tko_created!.id, statusId: tko_targetStatus!.id });
    const tko_after = await getWorkStore().getWorkItem(tko_tenantId, tko_created!.id);
    expect(tko_after?.statusId).toBe(tko_targetStatus!.id);
    const tko_auditLogs = await tko_platform.listAuditLogs();
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.tool.executed" && tko_row.resourceId === "work.transition_status" && (tko_row.metadata as TkoAuditMetadata).proposalId === tko_proposal.id)).toBe(true);
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.proposal.confirmed" && tko_row.resourceId === tko_proposal.id)).toBe(true);
  });

  it("audits ai.tool.failed and ai.proposal.execute_failed when a confirmed proposal cannot run", async () => {
    const tko_proposal = await proposeAction(tko_owner, { toolName: "work_item.create", input: { projectId: "00000000-0000-0000-0000-000000000000", title: "Ghost item" }, correlationId: "failed-flow" });
    await confirmProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "failed-confirm" });
    await expect(executeConfirmedProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "failed-execute" })).rejects.toThrow();
    const tko_stored = await getAIStore().getProposal(tko_tenantId, tko_proposal.id);
    expect(tko_stored?.status).toBe("failed");
    const tko_auditLogs = await tko_platform.listAuditLogs();
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.tool.failed" && tko_row.resourceId === "work_item.create" && (tko_row.metadata as TkoAuditMetadata).proposalId === tko_proposal.id)).toBe(true);
    expect(tko_auditLogs.some(tko_row => tko_row.action === "ai.proposal.execute_failed" && tko_row.resourceId === tko_proposal.id)).toBe(true);
    const tko_events = (await tko_platform.reserveOutbox(100)).map(tko_event => tko_event.eventType);
    expect(tko_events).toContain("ai.tool_failed.v1");
  });
});
