import { beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryCRMStore, getCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { MemoryWorkspaceStore, getWorkspaceStore, setWorkspaceStoreForTests } from "../../packages/database/src/workspace-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { processOutboxOnce } from "../worker/src/worker-service";
import { registerWorkspaceWorker } from "./src/workspace-worker";
import * as crm from "../crm/src/crm-service";
import * as work from "../work/src/work-service";
import * as workspace from "./src/workspace-service";

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
});
