import { beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryCRMStore, getCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import * as crm from "./src/crm-service";
import * as work from "../work/src/work-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "crm-ui-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-demo-owner", role: "owner", membershipStatus: "active", correlationId: "crm-ui-test", ...tko_overrides };
}

describe("Slim CRM M3 UI extras", () => {
  let tko_platform: MemoryPlatformStore;
  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setCRMStoreForTests(new MemoryCRMStore());
    setWorkStoreForTests(new MemoryWorkStore());
    setChatStoreForTests(new MemoryChatStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "crm-ui-owner", tenantSlug: "tasko-demo" });
  });

  it("updates a lead partially, records a status_change activity, and refuses the converted status", async () => {
    const tko_owner = tko_actor();
    const tko_lead = await crm.createLead({ actor: tko_owner, firstName: "Avery", lastName: "Nguyen", companyName: "Northstar Labs", status: "new", score: 10, correlationId: "lead-create" });

    const tko_updated = await crm.updateLead(tko_owner, { leadId: tko_lead.id, status: "qualified", score: 80, nextFollowUpAt: new Date("2026-10-01T09:00:00.000Z"), tags: [" enterprise ", "enterprise", ""], correlationId: "lead-update" });

    expect(tko_updated).toEqual(expect.objectContaining({ id: tko_lead.id, status: "qualified", score: 80, companyName: "Northstar Labs", nextFollowUpAt: new Date("2026-10-01T09:00:00.000Z"), tags: ["enterprise"] }));
    expect(await getCRMStore().listActivities(tko_owner.tenantId, "lead", tko_lead.id)).toEqual(expect.arrayContaining([expect.objectContaining({ activityType: "status_change", subject: "Status changed to qualified", metadata: expect.objectContaining({ beforeStatus: "new", afterStatus: "qualified" }) })]));
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toContain("crm.lead.updated");

    await expect(crm.updateLead(tko_owner, { leadId: tko_lead.id, status: "converted" as never, correlationId: "lead-converted-guard" })).rejects.toThrow("CRM_LEAD_STATUS_CONVERTED_REQUIRES_CONVERSION");
    await expect(crm.updateLead(tko_owner, { leadId: "00000000-0000-4000-8000-000000000004", status: "nurture", correlationId: "lead-missing" })).rejects.toThrow("CRM_LEAD_NOT_FOUND");

    const tko_guest = tko_actor({ authSubject: "crm-ui-guest", memberId: "crm-ui-guest-member", role: "guest" });
    await expect(crm.updateLead(tko_guest, { leadId: tko_lead.id, status: "nurture", correlationId: "lead-guest-denial" })).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("stores a loss reason when a deal is moved to a lost stage and clears it when reopened", async () => {
    const tko_owner = tko_actor();
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "UI Sales", correlationId: "pipeline" });
    const tko_openStage = tko_pipeline.stages[0];
    const tko_wonStage = tko_pipeline.stages.find(tko_stage => tko_stage.category === "won")!;
    const tko_lostStage = tko_pipeline.stages.find(tko_stage => tko_stage.category === "lost")!;
    const tko_deal = await crm.createDeal(tko_owner, { pipelineId: tko_pipeline.pipeline.id, stageId: tko_openStage.id, name: "Reopen candidate", correlationId: "deal-create" });

    const tko_lost = await crm.moveDeal(tko_owner, { dealId: tko_deal.id, stageId: tko_lostStage.id, lossReason: " Priced out ", correlationId: "deal-lost" });
    expect(tko_lost).toEqual(expect.objectContaining({ stageId: tko_lostStage.id, lossReason: "Priced out", lostAt: expect.any(Date) }));
    expect(await getCRMStore().listActivities(tko_owner.tenantId, "deal", tko_deal.id)).toEqual(expect.arrayContaining([expect.objectContaining({ activityType: "status_change", metadata: expect.objectContaining({ lossReason: "Priced out" }) })]));

    const tko_reopened = await crm.moveDeal(tko_owner, { dealId: tko_deal.id, stageId: tko_openStage.id, correlationId: "deal-reopen" });
    expect(tko_reopened.lossReason).toBe("");
    expect(tko_reopened.lostAt).toBeNull();

    const tko_won = await crm.moveDeal(tko_owner, { dealId: tko_deal.id, stageId: tko_wonStage.id, correlationId: "deal-won" });
    expect(tko_won).toEqual(expect.objectContaining({ stageId: tko_wonStage.id, wonAt: expect.any(Date) }));

    const tko_guest = tko_actor({ authSubject: "crm-ui-guest", memberId: "crm-ui-guest-member", role: "guest" });
    await expect(crm.moveDeal(tko_guest, { dealId: tko_deal.id, stageId: tko_lostStage.id, lossReason: "Nope", correlationId: "deal-guest-denial" })).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("filters deals by company and keeps pipelines isolated", async () => {
    const tko_owner = tko_actor();
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "Filter pipeline", correlationId: "pipeline" });
    const tko_companyA = await crm.createCompany(tko_owner, { name: "Alpha Co", correlationId: "company-a" });
    const tko_companyB = await crm.createCompany(tko_owner, { name: "Beta Co", correlationId: "company-b" });
    await crm.createDeal(tko_owner, { companyId: tko_companyA.id, pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, name: "Alpha deal", correlationId: "deal-a" });
    await crm.createDeal(tko_owner, { companyId: tko_companyB.id, pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, name: "Beta deal", correlationId: "deal-b" });
    await crm.createDeal(tko_owner, { companyId: null, pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, name: "Unattached deal", correlationId: "deal-c" });

    const tko_store = getCRMStore();
    expect((await tko_store.listDeals(tko_owner.tenantId, undefined, tko_companyA.id)).map(tko_deal => tko_deal.name)).toEqual(["Alpha deal"]);
    expect((await tko_store.listDeals(tko_owner.tenantId, tko_pipeline.pipeline.id, tko_companyB.id)).map(tko_deal => tko_deal.name)).toEqual(["Beta deal"]);
    expect(await tko_store.listDeals(tko_owner.tenantId, undefined, undefined)).toHaveLength(3);
  });

  it("updates companies and contacts with tenant scoping, validation and guest denials", async () => {
    const tko_owner = tko_actor();
    const tko_company = await crm.createCompany(tko_owner, { name: "Northstar Labs", lifecycleStatus: "prospect", correlationId: "company-create" });
    const tko_contact = await crm.createContact(tko_owner, { companyId: tko_company.id, firstName: "Riley", lastName: "Chen", title: "CTO", emails: ["riley@northstar.test"], correlationId: "contact-create" });

    const tko_updatedCompany = await crm.updateCompany(tko_owner, { companyId: tko_company.id, lifecycleStatus: "customer", industry: "Logistics", tags: [" strategic ", "strategic"], correlationId: "company-update" });
    expect(tko_updatedCompany).toEqual(expect.objectContaining({ id: tko_company.id, lifecycleStatus: "customer", industry: "Logistics", tags: ["strategic"] }));

    const tko_updatedContact = await crm.updateContact(tko_owner, { contactId: tko_contact.id, title: "Chief Technology Officer", companyId: null, phones: [" +1 555 0100 ", "+1 555 0100"], correlationId: "contact-update" });
    expect(tko_updatedContact).toEqual(expect.objectContaining({ id: tko_contact.id, title: "Chief Technology Officer", companyId: null, phones: ["+1 555 0100"] }));
    await expect(crm.updateContact(tko_owner, { contactId: tko_contact.id, companyId: "00000000-0000-4000-8000-000000000005", correlationId: "contact-bad-company" })).rejects.toThrow("CRM_COMPANY_NOT_FOUND");
    await expect(crm.updateCompany(tko_owner, { companyId: "00000000-0000-4000-8000-000000000006", name: "Ghost", correlationId: "company-missing" })).rejects.toThrow("CRM_COMPANY_NOT_FOUND");

    const tko_guest = tko_actor({ authSubject: "crm-ui-guest", memberId: "crm-ui-guest-member", role: "guest" });
    await expect(crm.updateCompany(tko_guest, { companyId: tko_company.id, name: "Hijack", correlationId: "company-guest-denial" })).rejects.toThrow("AUTHORIZATION_DENIED");
    await expect(crm.updateContact(tko_guest, { contactId: tko_contact.id, title: "Hijack", correlationId: "contact-guest-denial" })).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("exposes company/contact detail aggregators and entity activity/link readers with authorization", async () => {
    const tko_owner = tko_actor();
    const tko_pipeline = await crm.createPipeline(tko_owner, { name: "Aggregator pipeline", correlationId: "pipeline" });
    const tko_company = await crm.createCompany(tko_owner, { name: "Delta Works", correlationId: "company-create" });
    const tko_contact = await crm.createContact(tko_owner, { companyId: tko_company.id, firstName: "Sam", lastName: "Rivera", correlationId: "contact-create" });
    const tko_deal = await crm.createDeal(tko_owner, { companyId: tko_company.id, pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, name: "Delta rollout", correlationId: "deal-create" });
    await crm.addActivity(tko_owner, { entityType: "company", entityId: tko_company.id, activityType: "note", subject: "Kickoff notes", correlationId: "activity-create" });
    await crm.addActivity(tko_owner, { entityType: "deal", entityId: tko_deal.id, activityType: "call", subject: "Scoping call", correlationId: "activity-deal" });

    const tko_companyDetail = await crm.company(tko_owner, tko_company.id);
    expect(tko_companyDetail.company.id).toBe(tko_company.id);
    expect(tko_companyDetail.contacts.map(tko_item => tko_item.id)).toEqual([tko_contact.id]);
    expect(tko_companyDetail.deals.map(tko_item => tko_item.id)).toEqual([tko_deal.id]);
    expect(tko_companyDetail.activities).toEqual(expect.arrayContaining([expect.objectContaining({ subject: "Kickoff notes" })]));

    const tko_contactDetail = await crm.contact(tko_owner, tko_contact.id);
    expect(tko_contactDetail.contact.id).toBe(tko_contact.id);
    expect(await crm.entityActivities(tko_owner, "deal", tko_deal.id)).toEqual(expect.arrayContaining([expect.objectContaining({ activityType: "call", subject: "Scoping call" })]));
    expect(await crm.entityLinks(tko_owner, "company", tko_company.id)).toEqual([]);

    await expect(crm.company(tko_owner, "00000000-0000-4000-8000-000000000007")).rejects.toThrow("CRM_COMPANY_NOT_FOUND");
    await expect(crm.contact(tko_owner, "00000000-0000-4000-8000-000000000008")).rejects.toThrow("CRM_CONTACT_NOT_FOUND");
    await expect(crm.entityActivities(tko_owner, "deal", "00000000-0000-4000-8000-000000000009")).rejects.toThrow("CRM_ENTITY_NOT_FOUND");

    const tko_guest = tko_actor({ authSubject: "crm-ui-guest", memberId: "crm-ui-guest-member", role: "guest" });
    await expect(crm.company(tko_guest, tko_company.id)).rejects.toThrow("AUTHORIZATION_DENIED");
    await expect(crm.contacts(tko_guest)).rejects.toThrow("AUTHORIZATION_DENIED");
    await expect(crm.entityLinks(tko_guest, "company", tko_company.id)).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("creates assigned follow-ups that appear in normal work views", async () => {
    const tko_owner = tko_actor();
    const tko_space = await work.createSpace(tko_owner, { name: "Follow-up space", slug: "follow-up-space", visibility: "internal", correlationId: "follow-up-space" });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Follow-up project", key: "FOLLOW", methodology: "kanban", visibility: "internal", correlationId: "follow-up-project" });
    const tko_company = await crm.createCompany(tko_owner, { name: "Echo Systems", correlationId: "company-create" });
    const tko_assignee = "tko-member-demo-owner";

    const tko_followUp = await crm.createFollowUp(tko_owner, { entityType: "company", entityId: tko_company.id, projectId: tko_project.id, title: "Renewal check-in", dueAt: new Date("2026-10-05T09:00:00.000Z"), assigneeMemberIds: [tko_assignee], correlationId: "follow-up-assigned" });

    expect(tko_followUp.item.assigneeMemberIds).toEqual([tko_assignee]);
    expect(await getWorkStore().getWorkItem(tko_owner.tenantId, tko_followUp.item.id)).toEqual(expect.objectContaining({ title: "Renewal check-in", assigneeMemberIds: [tko_assignee] }));
  });
});
