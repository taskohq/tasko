import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryChatStore, getChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryCRMStore, getCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryPlatformStore, getPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { MemoryWorkspaceStore, getWorkspaceStore, setWorkspaceStoreForTests } from "../../packages/database/src/workspace-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { processOutboxOnce } from "../worker/src/worker-service";
import * as chat from "../chat/src/chat-service";
import * as crm from "../crm/src/crm-service";
import * as work from "../work/src/work-service";
import * as publicForms from "./src/public-form-service";
import { registerWorkspaceWorker } from "./src/workspace-worker";
import * as workspace from "./src/workspace-service";

vi.mock("../../server/storage", () => ({
  storagePut: vi.fn(async (tko_key: string) => ({ key: tko_key, url: `/manus-storage/${tko_key}` })),
  storageGetSignedUrl: vi.fn(async (tko_key: string) => `https://signed.example.test/${encodeURIComponent(tko_key)}`),
}));

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "workspace-extras-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "workspace-extras-test", ...tko_overrides };
}

describe("Unified Workspace M4 extras", () => {
  let tko_platform: MemoryPlatformStore;
  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setWorkStoreForTests(new MemoryWorkStore());
    setCRMStoreForTests(new MemoryCRMStore());
    setChatStoreForTests(new MemoryChatStore());
    setWorkspaceStoreForTests(new MemoryWorkspaceStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "workspace-extras-owner", tenantSlug: "tasko-demo" });
    registerWorkspaceWorker();
  });

  async function tko_createProject(tko_owner: PlatformActor) {
    const tko_space = await work.createSpace(tko_owner, { name: "Extras operations", slug: `extras-operations-${Math.random().toString(36).slice(2, 8)}`, visibility: "internal", correlationId: "m4x-space" });
    return work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Extras", key: "EXX", methodology: "kanban", visibility: "internal", correlationId: "m4x-project" });
  }

  it("indexes CRM deals, companies, contacts, work item updates and document updates into search", async () => {
    const tko_owner = tko_actor();
    const tko_token = "extras-coverage-marker";
    const tko_company = await crm.createCompany(tko_owner, { name: `Company ${tko_token}`, domain: "extras.example", industry: "Logistics", correlationId: "m4x-company" });
    const tko_contact = await crm.createContact(tko_owner, { companyId: tko_company.id, firstName: "Ada", lastName: tko_token, emails: ["ada@extras.example"], correlationId: "m4x-contact" });
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: `Extras pipeline`, correlationId: "m4x-pipeline" });
    const tko_deal = await crm.createDeal(tko_owner, { pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, name: `Deal ${tko_token}`, amountCents: 420_000, source: "public_form:demo", correlationId: "m4x-deal" });
    const tko_project = await tko_createProject(tko_owner);
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: `Original ${tko_token}`, correlationId: "m4x-work" });
    const tko_document = await workspace.createDocument(tko_owner, { title: `Doc ${tko_token}`, bodyText: "First body", correlationId: "m4x-doc" });

    await processOutboxOnce(200);
    expect(await workspace.search(tko_owner, { query: tko_token, kind: "crm" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "crm_company", entityId: tko_company.id }),
      expect.objectContaining({ entityType: "crm_contact", entityId: tko_contact.id }),
      expect.objectContaining({ entityType: "crm_deal", entityId: tko_deal.id }),
    ]));

    await work.updateWorkItem({ actor: tko_owner, workItemId: tko_item.id, expectedVersion: 1, title: `Renamed ${tko_token} item`, correlationId: "m4x-work-update" });
    await workspace.updateDocumentContent(tko_owner, { documentId: tko_document.id, bodyText: `Revised ${tko_token} body`, correlationId: "m4x-doc-update" });
    await processOutboxOnce(200);
    const tko_workHits = await workspace.search(tko_owner, { query: "Renamed", kind: "work" });
    expect(tko_workHits).toEqual([expect.objectContaining({ entityId: tko_item.id })]);
    const tko_docHits = await workspace.search(tko_owner, { query: "Revised", kind: "doc" });
    expect(tko_docHits).toEqual([expect.objectContaining({ entityId: tko_document.id })]);
  });

  it("keeps document revision history and restores through a new non-destructive revision", async () => {
    const tko_owner = tko_actor();
    const tko_document = await workspace.createDocument(tko_owner, { title: "Runbook", bodyText: "v1 body", correlationId: "m4x-rev-create" });
    const tko_first = await workspace.updateDocumentContent(tko_owner, { documentId: tko_document.id, bodyText: "v2 body", correlationId: "m4x-rev-2" });
    const tko_second = await workspace.updateDocumentContent(tko_owner, { documentId: tko_document.id, title: "Runbook v3", bodyText: "v3 body", correlationId: "m4x-rev-3" });
    expect(tko_first.revision.version).toBe(1);
    expect(tko_second.revision.version).toBe(2);

    const tko_revisions = await workspace.documentRevisions(tko_owner, tko_document.id);
    expect(tko_revisions.map(tko_revision => tko_revision.version)).toEqual([2, 1]);
    expect(tko_revisions[1].snapshot.bodyText).toBe("v2 body");

    const tko_restored = await workspace.restoreDocumentRevision(tko_owner, { documentId: tko_document.id, revisionId: tko_revisions[1].id, correlationId: "m4x-rev-restore" });
    expect(tko_restored.document.bodyText).toBe("v2 body");
    expect(tko_restored.document.title).toBe("Runbook");
    const tko_afterRestore = await workspace.documentRevisions(tko_owner, tko_document.id);
    expect(tko_afterRestore.map(tko_revision => tko_revision.version)).toEqual([3, 2, 1]);
    expect(tko_afterRestore.find(tko_revision => tko_revision.version === 1)?.snapshot.bodyText).toBe("v2 body");
    expect(tko_afterRestore.find(tko_revision => tko_revision.version === 3)?.snapshot.bodyText).toBe("v2 body");
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["workspace.document.revision_created", "workspace.document.restored"]));

    const tko_nonReader = tko_actor({ authSubject: "workspace-extras-admin", memberId: "tko-member-tasko-demo-admin", role: "admin" });
    const tko_private = await workspace.createDocument(tko_owner, { title: "Private runbook", bodyText: "owner only", visibility: "private", correlationId: "m4x-rev-private" });
    await expect(workspace.documentRevisions(tko_nonReader, tko_private.id)).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(workspace.restoreDocumentRevision(tko_nonReader, { documentId: tko_private.id, revisionId: tko_first.revision.id, correlationId: "m4x-rev-restore-denied" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
  });

  it("shares a form publicly and creates a Work item from an unauthenticated submission", async () => {
    const tko_owner = tko_actor();
    const tko_project = await tko_createProject(tko_owner);
    const tko_form = await workspace.createForm(tko_owner, { name: "Public intake", fields: [{ id: "title", label: "Title", fieldType: "text", required: true }, { id: "description", label: "Description", fieldType: "textarea", required: false }], targetType: "work_item", targetConfig: { projectId: tko_project.id }, correlationId: "m4x-share-form" });
    await workspace.activateForm(tko_owner, { formId: tko_form.id, correlationId: "m4x-share-active" });
    const tko_member = tko_actor({ authSubject: "workspace-extras-member", memberId: "tko-member-tasko-demo-member", role: "member" });
    await expect(workspace.setFormSharing(tko_member, { formId: tko_form.id, isPublic: true, correlationId: "m4x-share-denied" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");

    const tko_shared = await workspace.setFormSharing(tko_owner, { formId: tko_form.id, isPublic: true, correlationId: "m4x-share-on" });
    expect(tko_shared.isPublic).toBe(true);
    expect(tko_shared.shareSlug).toMatch(/^[a-z0-9]{16}$/);

    const tko_definition = await publicForms.publicFormDefinition(tko_shared.shareSlug!);
    expect(tko_definition).toEqual(expect.objectContaining({ slug: tko_shared.shareSlug, name: "Public intake", targetType: "work_item" }));
    expect(JSON.stringify(tko_definition)).not.toContain("projectId");

    const tko_first = await publicForms.submitPublicForm({ slug: tko_shared.shareSlug!, values: { title: "Public bug report" }, honeypot: "", clientIp: "203.0.113.10", idempotencyKey: "1d59d5ee-6f01-4a44-9d20-1a6b4d0b3001" });
    expect(tko_first.duplicate).toBe(false);
    const tko_items = await getWorkStore().listWorkItems(tko_owner.tenantId, tko_project.id);
    expect(tko_items.map(tko_item => tko_item.id)).toContain(tko_first.targetEntityId);
    const tko_retry = await publicForms.submitPublicForm({ slug: tko_shared.shareSlug!, values: { title: "Public bug report" }, honeypot: "", clientIp: "203.0.113.10", idempotencyKey: "1d59d5ee-6f01-4a44-9d20-1a6b4d0b3001" });
    expect(tko_retry.submissionId).toBe(tko_first.submissionId);
    expect(tko_retry.duplicate).toBe(true);
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["workspace.form.sharing_changed", "workspace.form.submitted"]));

    await expect(publicForms.submitPublicForm({ slug: "missing-slug-000000", values: { title: "x" }, honeypot: "", clientIp: "203.0.113.11", idempotencyKey: "1d59d5ee-6f01-4a44-9d20-1a6b4d0b3002" })).rejects.toThrow("WORKSPACE_FORM_NOT_FOUND");
    await expect(publicForms.submitPublicForm({ slug: tko_shared.shareSlug!, values: { title: "bot" }, honeypot: "http://spam.example", clientIp: "203.0.113.12", idempotencyKey: "1d59d5ee-6f01-4a44-9d20-1a6b4d0b3003" })).rejects.toThrow("WORKSPACE_FORM_HONEYPOT_REJECTED");
    await expect(publicForms.submitPublicForm({ slug: tko_shared.shareSlug!, values: {}, honeypot: "", clientIp: "203.0.113.13", idempotencyKey: "1d59d5ee-6f01-4a44-9d20-1a6b4d0b3004" })).rejects.toThrow("WORKSPACE_FORM_REQUIRED_FIELD:title");
  });

  it("rate limits unauthenticated public submissions per slug and client IP", async () => {
    const tko_owner = tko_actor();
    const tko_project = await tko_createProject(tko_owner);
    const tko_form = await workspace.createForm(tko_owner, { name: "Rate limited intake", fields: [{ id: "title", label: "Title", fieldType: "text", required: true }], targetType: "work_item", targetConfig: { projectId: tko_project.id }, correlationId: "m4x-rate-form" });
    await workspace.activateForm(tko_owner, { formId: tko_form.id, correlationId: "m4x-rate-active" });
    const tko_shared = await workspace.setFormSharing(tko_owner, { formId: tko_form.id, isPublic: true, correlationId: "m4x-rate-share" });
    for (let tko_index = 0; tko_index < 10; tko_index += 1) {
      await expect(publicForms.submitPublicForm({ slug: tko_shared.shareSlug!, values: { title: `Burst ${tko_index}` }, honeypot: "", clientIp: "198.51.100.7", idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ duplicate: false });
    }
    await expect(publicForms.submitPublicForm({ slug: tko_shared.shareSlug!, values: { title: "Blocked" }, honeypot: "", clientIp: "198.51.100.7", idempotencyKey: crypto.randomUUID() })).rejects.toThrow("WORKSPACE_FORM_RATE_LIMITED");
    await expect(publicForms.submitPublicForm({ slug: tko_shared.shareSlug!, values: { title: "Other IP" }, honeypot: "", clientIp: "198.51.100.8", idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ duplicate: false });
  });

  it("runs v2 automations with AND-ed conditions, notify and channel message actions", async () => {
    const tko_owner = tko_actor();
    const { pipeline: tko_pipeline, stages: tko_stages } = await crm.createPipeline(tko_owner, { name: "Automation pipeline", correlationId: "m4x-auto-pipeline" });
    const tko_openStage = tko_stages.find(tko_stage => tko_stage.category === "open")!;
    const tko_wonStage = tko_stages.find(tko_stage => tko_stage.category === "won")!;
    const tko_channel = await chat.createChannel(tko_owner, { kind: "public", name: "automation-ops", topic: "Automation notices", memberIds: [] });
    const tko_deal = await crm.createDeal(tko_owner, { pipelineId: tko_pipeline.id, stageId: tko_openStage.id, name: "Enterprise rollout", amountCents: 100_000, correlationId: "m4x-auto-deal" });
    const tko_stageRule = await workspace.createAutomationRule(tko_owner, {
      name: "Notify discovery stage",
      triggerType: "crm.deal_stage_changed.v1",
      conditions: [{ field: "pipelineId", equals: tko_pipeline.id }, { field: "afterStageId", equals: tko_openStage.id }],
      actions: [{ type: "notify_user", config: { memberId: tko_owner.memberId, title: "Deal moved", body: "Check the open deal" } }, { type: "post_channel_message", config: { channelId: tko_channel.id, body: "Deal {{dealId}} moved stages" } }],
      correlationId: "m4x-auto-stage-rule",
    });
    const tko_proposalStage = tko_stages.filter(tko_stage => tko_stage.category === "open")[1];
    await crm.moveDeal(tko_owner, { dealId: tko_deal.id, stageId: tko_proposalStage.id, correlationId: "m4x-auto-move-wrong" });
    await processOutboxOnce(200);
    expect(await workspace.automationExecutions(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: tko_stageRule.id, status: "skipped", results: { reason: "condition_not_matched" } })]));
    expect((await workspace.inbox(tko_owner)).filter(tko_item => tko_item.kind === "automation")).toEqual([]);

    await crm.moveDeal(tko_owner, { dealId: tko_deal.id, stageId: tko_openStage.id, correlationId: "m4x-auto-move-open" });
    await processOutboxOnce(200);
    const tko_inbox = await workspace.inbox(tko_owner);
    expect(tko_inbox).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "automation", memberId: tko_owner.memberId, title: "Deal moved" })]));
    const tko_messages = await getChatStore().listMessages(tko_owner.tenantId, tko_channel.id);
    expect(tko_messages.map(tko_message => tko_message.body.text)).toContain(`Deal ${tko_deal.id} moved stages`);
  });

  it("executes deal_won and update_work_item actions exactly once", async () => {
    const tko_owner = tko_actor();
    const tko_project = await tko_createProject(tko_owner);
    const tko_statuses = await getWorkStore().listStatuses(tko_owner.tenantId, tko_project.workflowId);
    const tko_doneStatus = tko_statuses.find(tko_status => tko_status.category === "done")!;
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "Won pipeline", correlationId: "m4x-won-pipeline" });
    const tko_openStage = tko_pipeline.stages.find(tko_stage => tko_stage.category === "open")!;
    const tko_wonStage = tko_pipeline.stages.find(tko_stage => tko_stage.category === "won")!;
    const tko_dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Delivery task", correlationId: "m4x-won-item" });
    const tko_deal = await crm.createDeal(tko_owner, { pipelineId: tko_pipeline.pipeline.id, stageId: tko_openStage.id, name: "Big win", correlationId: "m4x-won-deal" });
    const tko_rule = await workspace.createAutomationRule(tko_owner, {
      name: "Won deal stamps delivery task",
      triggerType: "crm.deal_won.v1",
      actions: [{ type: "update_work_item", config: { workItemId: tko_item.id, statusId: tko_doneStatus.id, dueAt: tko_dueAt } }],
      correlationId: "m4x-won-rule",
    });
    await crm.moveDeal(tko_owner, { dealId: tko_deal.id, stageId: tko_wonStage.id, correlationId: "m4x-won-move" });
    await processOutboxOnce(200);
    await processOutboxOnce(200);
    const tko_updated = await getWorkStore().getWorkItem(tko_owner.tenantId, tko_item.id);
    expect(tko_updated?.statusId).toBe(tko_doneStatus.id);
    expect(tko_updated?.dueAt?.toISOString()).toBe(new Date(tko_dueAt).toISOString());
    const tko_executions = (await workspace.automationExecutions(tko_owner)).filter(tko_execution => tko_execution.ruleId === tko_rule.id && tko_execution.status === "completed");
    expect(tko_executions).toHaveLength(1);
  });

  it("does not retrigger automations from automation-sourced work item status events", async () => {
    const tko_owner = tko_actor();
    const tko_project = await tko_createProject(tko_owner);
    const tko_statuses = await getWorkStore().listStatuses(tko_owner.tenantId, tko_project.workflowId);
    const tko_inProgress = tko_statuses.find(tko_status => tko_status.category === "in_progress")!;
    const tko_done = tko_statuses.find(tko_status => tko_status.category === "done")!;
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Loop guard", correlationId: "m4x-loop-item" });
    const tko_rule = await workspace.createAutomationRule(tko_owner, {
      name: "Bounce to done",
      triggerType: "work.work_item_status_changed.v1",
      actions: [{ type: "update_work_item", config: { statusId: tko_done.id } }],
      correlationId: "m4x-loop-rule",
    });
    await work.transitionWorkItem({ actor: tko_owner, workItemId: tko_item.id, targetStatusId: tko_inProgress.id, expectedVersion: 1, correlationId: "m4x-loop-user-move" });
    await processOutboxOnce(200);
    await processOutboxOnce(200);
    await processOutboxOnce(200);
    const tko_final = await getWorkStore().getWorkItem(tko_owner.tenantId, tko_item.id);
    expect(tko_final?.statusId).toBe(tko_done.id);
    const tko_completed = (await workspace.automationExecutions(tko_owner)).filter(tko_execution => tko_execution.ruleId === tko_rule.id && tko_execution.status === "completed");
    expect(tko_completed).toHaveLength(1);
  });

  it("rejects automation rule creation for members without workspace.automation.manage", async () => {
    const tko_member = tko_actor({ authSubject: "workspace-extras-member", memberId: "tko-member-tasko-demo-member", role: "member" });
    await expect(workspace.createAutomationRule(tko_member, { name: "Member rule", triggerType: "work.work_item_status_changed.v1", actions: [{ type: "notify_user", config: { memberId: tko_member.memberId } }], correlationId: "m4x-member-rule" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
  });

  it("adds this-week activity, overdue work and open pipeline value to the overview", async () => {
    const tko_owner = tko_actor();
    const tko_project = await tko_createProject(tko_owner);
    await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Overdue item", dueAt: new Date(Date.now() - 2 * 86_400_000), correlationId: "m4x-kpi-overdue" });
    await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Future item", dueAt: new Date(Date.now() + 10 * 86_400_000), correlationId: "m4x-kpi-future" });
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "KPI pipeline", correlationId: "m4x-kpi-pipeline" });
    const tko_openStage = tko_pipeline.stages.find(tko_stage => tko_stage.category === "open")!;
    await crm.createDeal(tko_owner, { pipelineId: tko_pipeline.pipeline.id, stageId: tko_openStage.id, name: "Open deal A", amountCents: 150_000, correlationId: "m4x-kpi-deal-a" });
    await crm.createDeal(tko_owner, { pipelineId: tko_pipeline.pipeline.id, stageId: tko_openStage.id, name: "Open deal B", amountCents: 25_000, correlationId: "m4x-kpi-deal-b" });
    const tko_overview = await workspace.overview(tko_owner);
    expect(tko_overview.overdueWorkItemsCount).toBe(1);
    expect(tko_overview.openPipelineValueCents).toBe(175_000);
    expect(tko_overview.thisWeekActivityCount).toBeGreaterThanOrEqual(4);
  });
});
