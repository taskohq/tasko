import { beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryCRMStore, getCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { tko_config } from "../../packages/config/src/tasko-config";
import { MemorySaaSStore, setSaaSStoreForTests } from "../../packages/database/src/saas-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { MemoryWorkspaceStore, getWorkspaceStore, setWorkspaceStoreForTests } from "../../packages/database/src/workspace-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { processOutboxOnce } from "../worker/src/worker-service";
import { registerWorkspaceWorker } from "./src/workspace-worker";
import * as crm from "../crm/src/crm-service";
import * as chat from "../chat/src/chat-service";
import * as work from "../work/src/work-service";
import * as workspace from "./src/workspace-service";
import { vi } from "vitest";

vi.mock("../../server/storage", () => ({
  storagePut: vi.fn(async (tko_key: string) => ({ key: tko_key, url: `/manus-storage/${tko_key}` })),
  storageGetSignedUrl: vi.fn(async (tko_key: string) => `https://signed.example.test/${encodeURIComponent(tko_key)}`),
}));

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "workspace-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-demo-owner", role: "owner", membershipStatus: "active", correlationId: "workspace-test", ...tko_overrides };
}

describe("Unified Workspace Beta M4", () => {
  let tko_platform: MemoryPlatformStore;
  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setWorkStoreForTests(new MemoryWorkStore());
    setCRMStoreForTests(new MemoryCRMStore());
    setChatStoreForTests(new MemoryChatStore());
    setWorkspaceStoreForTests(new MemoryWorkspaceStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "workspace-owner", tenantSlug: "tasko-demo" });
    registerWorkspaceWorker();
  });

  async function tko_createProject(tko_owner: PlatformActor) {
    const tko_space = await work.createSpace(tko_owner, { name: "Unified operations", slug: "unified-operations", visibility: "internal", correlationId: "m4-space" });
    return work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Operations", key: "OPS", methodology: "kanban", visibility: "internal", correlationId: "m4-project" });
  }

  it("creates a durable document and tenant-scoped Work context link", async () => {
    const tko_owner = tko_actor(); const tko_project = await tko_createProject(tko_owner);
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Launch playbook", correlationId: "m4-work" });
    const tko_document = await workspace.createDocument(tko_owner, { title: "Launch context", bodyText: "Decision log for the launch.", templateKey: "operating-note", correlationId: "m4-doc" });
    const tko_link = await workspace.linkDocument(tko_owner, { documentId: tko_document.id, entityType: "work_item", entityId: tko_item.id, correlationId: "m4-link" });

    expect(tko_link).toEqual(expect.objectContaining({ tenantId: tko_owner.tenantId, documentId: tko_document.id, entityType: "work_item", entityId: tko_item.id }));
    expect(await getWorkspaceStore().listDocumentLinksForEntity(tko_owner.tenantId, "work_item", tko_item.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_link.id, documentId: tko_document.id })]));
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["workspace.document.created", "workspace.document.linked"]));
  });

  it("stores project-scoped document files, signs authorized downloads and rejects unauthorized removal", async () => {
    const tko_owner = tko_actor(); const tko_project = await tko_createProject(tko_owner);
    const tko_file = await workspace.uploadDocumentFile(tko_owner, { projectId: tko_project.id, filename: "operations-plan.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from("spreadsheet-evidence").toString("base64"), correlationId: "m4-document-file-upload" });
    expect(tko_file).toMatchObject({ documentKind: "file", projectId: tko_project.id, filename: "operations-plan.xlsx", byteSize: 20, objectKey: expect.stringContaining(`/workspace-documents/${tko_project.id}/`) });
    await expect(workspace.documentDownloadUrl(tko_owner, tko_file.id)).resolves.toEqual(expect.objectContaining({ filename: "operations-plan.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", url: expect.stringContaining("signed.example.test") }));

    const tko_guest = tko_actor({ authSubject: "workspace-document-guest", memberId: "workspace-document-guest", role: "guest" });
    await expect(workspace.removeDocumentFile(tko_guest, tko_file.id, "m4-document-file-guest-remove")).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(workspace.documentDownloadUrl(tko_actor({ tenantId: "other-tenant", tenantSlug: "other", memberId: "other-member" }), tko_file.id)).rejects.toThrow("WORKSPACE_ENTITY_NOT_FOUND");

    await expect(workspace.removeDocumentFile(tko_owner, tko_file.id, "m4-document-file-remove")).resolves.toMatchObject({ id: tko_file.id });
    expect(await workspace.documents(tko_owner)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_file.id })]));
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["workspace.document.created", "workspace.document.deleted"]));
  });

  it("materializes and filters grouped Work, Chat, CRM and Docs search results", async () => {
    const tko_owner = tko_actor(); const tko_project = await tko_createProject(tko_owner);
    const tko_token = "cross-module-search-marker";
    const tko_work = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: `Work ${tko_token}`, correlationId: "m4-search-work" });
    const tko_lead = await crm.createLead({ actor: tko_owner, firstName: "CRM", lastName: tko_token, status: "new", correlationId: "m4-search-crm" });
    const tko_document = await workspace.createDocument(tko_owner, { title: `Doc ${tko_token}`, bodyText: "Search grouping evidence", correlationId: "m4-search-doc" });
    const tko_channel = await chat.createChannel(tko_owner, { kind: "public", name: `chat-${tko_token}`, topic: "Search grouping evidence", memberIds: [] });
    const tko_message = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "m4-search-message", body: { type: "text", text: `Chat ${tko_token}` } }, "m4-search-chat");

    await processOutboxOnce(100);
    const tko_all = await workspace.search(tko_owner, { query: tko_token });
    expect(tko_all).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: tko_work.id, kind: "work" }),
      expect.objectContaining({ entityId: tko_lead.id, kind: "crm" }),
      expect.objectContaining({ entityId: tko_document.id, kind: "doc" }),
      expect.objectContaining({ entityId: tko_channel.id, kind: "chat" }),
      expect.objectContaining({ entityId: tko_message.id, kind: "chat" }),
    ]));
    await expect(workspace.search(tko_owner, { query: tko_token, kind: "work" })).resolves.toEqual([expect.objectContaining({ entityId: tko_work.id, kind: "work" })]);
    await expect(workspace.search(tko_owner, { query: tko_token, kind: "crm" })).resolves.toEqual([expect.objectContaining({ entityId: tko_lead.id, kind: "crm" })]);
    await expect(workspace.search(tko_owner, { query: tko_token, kind: "doc" })).resolves.toEqual([expect.objectContaining({ entityId: tko_document.id, kind: "doc" })]);
    expect((await workspace.search(tko_owner, { query: tko_token, kind: "chat" })).map(tko_result => tko_result.entityId)).toEqual(expect.arrayContaining([tko_channel.id, tko_message.id]));
  });

  it("does not leak private Chat or any cross-tenant search result, count or snippet", async () => {
    const tko_owner = tko_actor(); const tko_token = "private-chat-search-marker";
    const tko_channel = await chat.createChannel(tko_owner, { kind: "private", name: `private-${tko_token}`, topic: `Topic ${tko_token}`, memberIds: [] });
    await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "m4-private-search-message", body: { type: "text", text: `Secret ${tko_token}` } }, "m4-private-search");
    const tko_project = await tko_createProject(tko_owner);
    await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: `Work ${tko_token}`, correlationId: "m4-private-search-work" });
    await crm.createLead({ actor: tko_owner, firstName: "Private", lastName: tko_token, status: "new", correlationId: "m4-private-search-crm" });
    await workspace.createDocument(tko_owner, { title: `Document ${tko_token}`, bodyText: `Body ${tko_token}`, correlationId: "m4-private-search-doc" });
    await processOutboxOnce(100);

    const tko_ownerCrm = await workspace.search(tko_owner, { query: tko_token, kind: "crm" });
    expect(tko_ownerCrm).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "crm" })]));

    const tko_nonMember = tko_actor({ authSubject: "workspace-admin", memberId: "tko-member-demo-admin", role: "admin" });
    const tko_nonMemberChat = await workspace.search(tko_nonMember, { query: tko_token, kind: "chat" });
    expect(tko_nonMemberChat).toEqual([]);
    expect(JSON.stringify(tko_nonMemberChat)).not.toContain(tko_token);

    const tko_otherTenant = tko_actor({ authSubject: "other-owner", tenantId: "tko-tenant-other", tenantSlug: "other", memberId: "tko-member-other", role: "owner" });
    const tko_crossTenant = await workspace.search(tko_otherTenant, { query: tko_token });
    expect(tko_crossTenant).toEqual([]);
    expect(JSON.stringify(tko_crossTenant)).not.toContain(tko_token);
    const tko_crossTenantCrm = await workspace.search(tko_otherTenant, { query: tko_token, kind: "crm" });
    expect(tko_crossTenantCrm).toEqual([]);
    expect(JSON.stringify(tko_crossTenantCrm)).not.toContain(tko_token);
  });

  it("does not leak same-tenant private Work or Docs search results, counts or snippets", async () => {
    const tko_owner = tko_actor(); const tko_token = "same-tenant-private-search-marker";
    const tko_space = await work.createSpace(tko_owner, { name: "Private search space", slug: "private-search-space", visibility: "internal", correlationId: "m4-private-work-space" });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Private search project", key: "PVT", methodology: "kanban", visibility: "private", correlationId: "m4-private-work-project" });
    await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: `Private work ${tko_token}`, correlationId: "m4-private-work-item" });
    await workspace.createDocument(tko_owner, { title: `Private doc ${tko_token}`, bodyText: `Private body ${tko_token}`, visibility: "private", correlationId: "m4-private-doc" });
    await processOutboxOnce(100);

    const tko_nonOwner = tko_actor({ authSubject: "workspace-admin", memberId: "tko-member-demo-admin", role: "admin" });
    const tko_hidden = await workspace.search(tko_nonOwner, { query: tko_token });
    expect(tko_hidden).toEqual([]);
    expect(JSON.stringify(tko_hidden)).not.toContain(tko_token);
    expect(await workspace.search(tko_owner, { query: tko_token })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "work" }), expect.objectContaining({ kind: "doc" })]));
  });

  it("projects tenant-scoped KPIs, cross-module activity, linked context and a Work graph", async () => {
    const tko_owner = tko_actor(); const tko_project = await tko_createProject(tko_owner);
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Overview launch task", dueAt: new Date(Date.now() + 86_400_000), correlationId: "m4-overview-work" });
    const tko_document = await workspace.createDocument(tko_owner, { title: "Overview launch context", bodyText: "Decision record", correlationId: "m4-overview-doc" });
    await workspace.linkDocument(tko_owner, { documentId: tko_document.id, entityType: "work_item", entityId: tko_item.id, correlationId: "m4-overview-link" });
    const tko_lead = await crm.createLead({ actor: tko_owner, firstName: "Overview", lastName: "Lead", status: "new", correlationId: "m4-overview-lead" });

    const tko_overview = await workspace.overview(tko_owner);
    expect(tko_overview).toEqual(expect.objectContaining({ openWorkCount: 1, dueSoonCount: 1, documentsCount: 1 }));
    expect(tko_overview.recentActivity).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_item.id, kind: "work" }), expect.objectContaining({ id: tko_document.id, kind: "document" }), expect.objectContaining({ id: tko_lead.id, kind: "crm" })]));
    expect(tko_overview.linkedObjects).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: tko_document.id, entityType: "work_item", entityId: tko_item.id, href: "/work" })]));
    expect(tko_overview.workGraph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: `work:${tko_item.id}` }), expect.objectContaining({ id: `document:${tko_document.id}` })]));
    expect(tko_overview.workGraph.edges).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: `document:${tko_document.id}`, targetId: `work:${tko_item.id}`, relation: "context" })]));
    const tko_otherTenant = tko_actor({ tenantId: "tko-tenant-other", memberId: "tko-member-other", tenantSlug: "other" });
    expect((await workspace.overview(tko_otherTenant)).workGraph.nodes).toEqual([]);
  });

  it("maps an active Form to one WorkItem and one Inbox item with retry-safe submission", async () => {
    const tko_owner = tko_actor(); const tko_project = await tko_createProject(tko_owner);
    const tko_form = await workspace.createForm(tko_owner, { name: "Request intake", fields: [{ id: "title", label: "Title", fieldType: "text", required: true }, { id: "description", label: "Description", fieldType: "textarea", required: false }], targetType: "work_item", targetConfig: { projectId: tko_project.id }, correlationId: "m4-form" });
    await workspace.activateForm(tko_owner, { formId: tko_form.id, correlationId: "m4-form-active" });
    const tko_input = { formId: tko_form.id, values: { title: "Triaged request", description: "Created from the form" }, idempotencyKey: "842e9c8d-1d85-4f6e-a5c2-55f59f91f111", correlationId: "m4-submit" };
    const tko_first = await workspace.submitForm(tko_owner, tko_input);
    const tko_retry = await workspace.submitForm(tko_owner, tko_input);
    expect(tko_retry.id).toBe(tko_first.id);
    expect((await getWorkStore().listWorkItems(tko_owner.tenantId, tko_project.id)).filter(tko_item => tko_item.title === "Triaged request")).toHaveLength(1);

    await processOutboxOnce(100);
    const tko_inbox = await workspace.inbox(tko_owner);
    expect(tko_inbox).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "form", entityType: "work_item", entityId: tko_first.targetEntityId, sourceEventId: expect.any(String) })]));
    await processOutboxOnce(100);
    expect((await workspace.inbox(tko_owner)).filter(tko_item => tko_item.sourceEventId !== null)).toHaveLength(1);
  });

  it("does not expose global search or automation mutation to a guest", async () => {
    const tko_guest = tko_actor({ authSubject: "workspace-guest", memberId: "workspace-guest-member", role: "guest" });
    await expect(workspace.search(tko_guest, { query: "operations" })).rejects.toThrow("AUTHORIZATION_DENIED");
    await expect(workspace.createAutomationRule(tko_guest, { name: "Forbidden", triggerType: "crm.lead_created.v1", actions: [{ type: "create_work_item", config: {} }], correlationId: "m4-guest-rule" })).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("runs an automation only once for a CRM lead-created outbox event", async () => {
    const tko_owner = tko_actor(); const tko_project = await tko_createProject(tko_owner);
    const tko_rule = await workspace.createAutomationRule(tko_owner, { name: "Triage new leads", triggerType: "crm.lead_created.v1", actions: [{ type: "create_work_item", config: { projectId: tko_project.id, title: "Triage {{leadId}}" } }], correlationId: "m4-rule" });
    const tko_lead = await crm.createLead({ actor: tko_owner, firstName: "Dana", lastName: "Ng", status: "new", correlationId: "m4-lead" });
    await processOutboxOnce(100);
    await processOutboxOnce(100);
    expect((await getWorkStore().listWorkItems(tko_owner.tenantId, tko_project.id)).filter(tko_item => tko_item.title.includes(tko_lead.id))).toHaveLength(1);
    const tko_executions = await workspace.automationExecutions(tko_owner);
    expect(tko_executions).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: tko_rule.id, status: "completed" })]));
  });

  it("runs a WorkItem-triggered CRM activity automation exactly once using the durable event name", async () => {
    const tko_owner = tko_actor(); const tko_project = await tko_createProject(tko_owner);
    const tko_lead = await crm.createLead({ actor: tko_owner, firstName: "Work", lastName: "Trigger", status: "new", correlationId: "m4-work-trigger-lead" });
    const tko_rule = await workspace.createAutomationRule(tko_owner, { name: "Log created work", triggerType: "work.work_item_created.v1", actions: [{ type: "create_crm_activity", config: { entityType: "lead", entityId: tko_lead.id, subject: "Created {{workItemId}}" } }], correlationId: "m4-work-trigger-rule" });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Create CRM activity", correlationId: "m4-work-trigger-item" });
    await processOutboxOnce(100);
    await processOutboxOnce(100);
    const tko_activities = await getCRMStore().listActivities(tko_owner.tenantId, "lead", tko_lead.id);
    expect(tko_activities.filter(tko_activity => tko_activity.subject.includes(tko_item.id))).toHaveLength(1);
    expect(await workspace.automationExecutions(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: tko_rule.id, status: "completed" })]));
  });

  it("enforces SaaS form and automation quotas before their durable target actions", async () => {
    const tko_runtimeConfig = tko_config as unknown as { deploymentProfile: "single_tenant" | "saas" };
    const tko_previousProfile = tko_runtimeConfig.deploymentProfile;
    tko_runtimeConfig.deploymentProfile = "saas";
    setSaaSStoreForTests(new MemorySaaSStore({ plans: [{ key: "quota-test", name: "Quota test", description: "Acceptance fixture", entitlements: { forms: true, automation: true }, quotas: { form_submissions: 1, automation_executions: 0 }, active: true }] }));
    try {
      const tko_owner = tko_actor();
      const tko_project = await tko_createProject(tko_owner);
      const tko_form = await workspace.createForm(tko_owner, { name: "Intake", fields: [{ id: "title", label: "Title", type: "text", required: true }], targetType: "work_item", targetConfig: { projectId: tko_project.id }, correlationId: "m5-form" });
      await workspace.activateForm(tko_owner, { formId: tko_form.id, correlationId: "m5-form-activate" });
      await workspace.submitForm(tko_owner, { formId: tko_form.id, values: { title: "Permitted intake" }, idempotencyKey: "m5-form-1", correlationId: "m5-form-1" });
      await expect(workspace.submitForm(tko_owner, { formId: tko_form.id, values: { title: "Blocked intake" }, idempotencyKey: "m5-form-2", correlationId: "m5-form-2" })).rejects.toThrow("TASKO_SAAS_QUOTA_EXCEEDED");
      expect(await getWorkspaceStore().getFormSubmission(tko_owner.tenantId, tko_form.id, "m5-form-2")).toBeNull();

      const tko_rule = await workspace.createAutomationRule(tko_owner, { name: "Quota automation", triggerType: "crm.lead_created.v1", actions: [{ type: "create_work_item", config: { projectId: tko_project.id, title: "Must not be created" } }], correlationId: "m5-rule" });
      await crm.createLead({ actor: tko_owner, firstName: "Quota", lastName: "Event", correlationId: "m5-automation-source" });
      const tko_record = (await tko_platform.reserveOutbox(50)).find(tko_event => tko_event.eventType === "crm.lead_created.v1");
      if (!tko_record) throw new Error("M5_AUTOMATION_SOURCE_EVENT_MISSING");
      await expect(workspace.processAutomationEvent(tko_owner, tko_record)).rejects.toThrow("TASKO_SAAS_QUOTA_EXCEEDED");
      expect((await getWorkspaceStore().getAutomationExecution(tko_owner.tenantId, tko_rule.id, tko_record.eventId, tko_rule.version))?.status).toBe("failed");
      expect((await getWorkStore().listWorkItems(tko_owner.tenantId, tko_project.id)).map(tko_item => tko_item.title)).not.toContain("Must not be created");
    } finally {
      tko_runtimeConfig.deploymentProfile = tko_previousProfile;
      setSaaSStoreForTests(null);
    }
  });

  it("returns Form submission history only to authorized tenant readers and rejects untrusted Work targets at configuration time", async () => {
    const tko_owner = tko_actor();
    const tko_project = await tko_createProject(tko_owner);
    const tko_form = await workspace.createForm(tko_owner, { name: "History intake", fields: [{ id: "title", label: "Title", fieldType: "text", required: true }], targetType: "work_item", targetConfig: { projectId: tko_project.id }, correlationId: "m8-history-form" });
    await workspace.activateForm(tko_owner, { formId: tko_form.id, correlationId: "m8-history-active" });
    const tko_submission = await workspace.submitForm(tko_owner, { formId: tko_form.id, values: { title: "Visible durable intake" }, idempotencyKey: "5ac43d15-fcc6-474f-974d-b9838a9db0a1", correlationId: "m8-history-submit" });
    await expect(workspace.formSubmissions(tko_owner, tko_form.id)).resolves.toEqual([expect.objectContaining({ id: tko_submission.id, targetEntityId: tko_submission.targetEntityId })]);

    const tko_guest = tko_actor({ authSubject: "workspace-guest", memberId: "workspace-guest-member", role: "guest" });
    await expect(workspace.formSubmissions(tko_guest, tko_form.id)).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    const tko_otherOwner = tko_actor({ authSubject: "workspace-other-owner", tenantId: "tko-tenant-other", tenantSlug: "other", memberId: "tko-member-other-owner", role: "owner" });
    const tko_otherProject = await tko_createProject(tko_otherOwner);
    await expect(workspace.createForm(tko_owner, { name: "Cross tenant target", fields: [{ id: "title", label: "Title", fieldType: "text", required: true }], targetType: "work_item", targetConfig: { projectId: tko_otherProject.id }, correlationId: "m8-cross-form" })).rejects.toThrow("WORKSPACE_FORM_WORK_PROJECT_NOT_FOUND");
    await expect(workspace.createAutomationRule(tko_owner, { name: "Missing target", triggerType: "crm.lead_created.v1", actions: [{ type: "create_work_item", config: {} }], correlationId: "m8-missing-target" })).rejects.toThrow("WORKSPACE_AUTOMATION_PROJECT_REQUIRED");
  });
});
