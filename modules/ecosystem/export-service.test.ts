import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { ExportService } from "./src/export-service";
import * as crmService from "../crm/src/crm-service";
import * as workService from "../work/src/work-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "export-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "export-test", ...tko_overrides };
}

describe("Tasko M5 module CSV exports", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_crm: MemoryCRMStore;
  let tko_work: MemoryWorkStore;
  let tko_exports: ExportService;

  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore(); tko_crm = new MemoryCRMStore(); tko_work = new MemoryWorkStore();
    setPlatformStoreForTests(tko_platform); setCRMStoreForTests(tko_crm); setWorkStoreForTests(tko_work);
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "export-owner", tenantSlug: "tasko-demo" });
    tko_exports = new ExportService();
  });
  afterEach(() => { setPlatformStoreForTests(null); setCRMStoreForTests(null); setWorkStoreForTests(null); });

  it("exports work items and time logs with statuses, assignees, labels and logged-minute summaries", async () => {
    const tko_owner = tko_actor();
    const tko_space = await tko_work.createSpace(tko_owner, { name: "Export space", slug: "export-space", visibility: "internal", correlationId: "seed-1" });
    const tko_project = await tko_work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Export project", key: "EXP", correlationId: "seed-1" });
    const tko_memberName = (await tko_platform.listTenantMembers(tko_owner.tenantId)).find(tko_member => tko_member.id === tko_owner.memberId)?.displayName ?? "Owner";
    await tko_work.createLabel({ actor: tko_owner, projectId: tko_project.id, name: "urgent, now", colorToken: "red", correlationId: "seed-2" });
    const tko_labels = await tko_work.listLabels(tko_owner.tenantId, tko_project.id);
    const tko_item = await workService.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Ship =Risk & \"Quote\"", priority: "high", assigneeMemberIds: [tko_owner.memberId], estimateMinutes: 120, correlationId: "seed-3" });
    await workService.setWorkItemLabels(tko_owner, { workItemId: tko_item.id, labelIds: [tko_labels[0]!.id], correlationId: "seed-6" });
    await workService.addWorkTimeLog(tko_owner, { workItemId: tko_item.id, minutes: 45, note: "setup", correlationId: "seed-4" });
    await workService.addWorkTimeLog(tko_owner, { workItemId: tko_item.id, minutes: 30, note: "review", correlationId: "seed-5" });

    const tko_itemsCsv = await tko_exports.exportCsv(tko_owner, { entityType: "work_items", correlationId: "export-1" });
    expect(tko_itemsCsv.filename).toContain("tasko-demo-work-items-");
    expect(tko_itemsCsv.rowCount).toBe(1);
    expect(tko_itemsCsv.csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    expect(tko_itemsCsv.csv).toContain('"Ship =Risk & ""Quote"""');
    expect(tko_itemsCsv.csv).toContain('"urgent, now"');
    expect(tko_itemsCsv.csv).toContain(tko_memberName);
    expect(tko_itemsCsv.csv).toContain(",75,"); // 45 + 30 logged minutes

    const tko_logsCsv = await tko_exports.exportCsv(tko_owner, { entityType: "time_logs", correlationId: "export-2" });
    expect(tko_logsCsv.rowCount).toBe(2);
    const [tko_header, ...tko_rows] = tko_logsCsv.csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(tko_header).toBe("item_key,item_title,member,minutes,started_at,note,logged_at");
    expect(tko_rows).toHaveLength(2);
    expect(tko_logsCsv.csv).toContain(",45,");
  });

  it("exports CRM leads, companies, contacts and deals with pipeline and loss fields", async () => {
    const tko_owner = tko_actor();
    await crmService.createLead({ actor: tko_owner, firstName: "Ada", lastName: "Lovelace", companyName: "Analytical Engines", email: "ada@example.test", phone: "+1-202-555-0100", source: "=cmd()", correlationId: "crm-1" });
    const tko_company = await crmService.createCompany(tko_owner, { name: "Analytical Engines", domain: "analytical.test", correlationId: "crm-2" });
    await crmService.createContact(tko_owner, { companyId: tko_company.id, firstName: "Grace", lastName: "Hopper", emails: ["grace@example.test"], correlationId: "crm-3" });
    const tko_pipeline = await crmService.createPipeline(tko_owner, { name: "New business", correlationId: "crm-4" });
    const tko_stages = await tko_crm.listStages(tko_owner.tenantId, tko_pipeline.pipeline.id);
    const tko_won = tko_stages.find(tko_stage => tko_stage.category === "won")!;
    await crmService.createDeal(tko_owner, { companyId: tko_company.id, pipelineId: tko_pipeline.pipeline.id, stageId: tko_won.id, name: "Engines renewal", amountCents: 123456, currency: "USD", expectedCloseDate: new Date("2026-12-01T00:00:00.000Z"), correlationId: "crm-5" });
    await tko_crm.moveDeal(tko_owner, { dealId: (await tko_crm.listDeals(tko_owner.tenantId))[0]!.id, stageId: tko_won.id, correlationId: "crm-6" });

    const tko_leadsCsv = await tko_exports.exportCsv(tko_owner, { entityType: "crm_leads", correlationId: "export-3" });
    expect(tko_leadsCsv.csv).toContain("Ada,Lovelace,Analytical Engines");
    expect(tko_leadsCsv.csv).toContain("'=cmd()"); // CSV-injection guard

    const tko_contactsCsv = await tko_exports.exportCsv(tko_owner, { entityType: "crm_contacts", correlationId: "export-4" });
    expect(tko_contactsCsv.csv).toContain("Grace,Hopper,Analytical Engines");
    expect(tko_contactsCsv.csv).toContain("grace@example.test");

    const tko_dealsCsv = await tko_exports.exportCsv(tko_owner, { entityType: "crm_deals", correlationId: "export-5" });
    expect(tko_dealsCsv.csv).toContain("Engines renewal,Analytical Engines");
    expect(tko_dealsCsv.csv).toContain(",123456,USD,");
    expect(tko_dealsCsv.csv).toContain(tko_won.name); // stage name
    expect(tko_dealsCsv.csv).toContain("2026-12-01"); // expected close

    const tko_companiesCsv = await tko_exports.exportCsv(tko_owner, { entityType: "crm_companies", correlationId: "export-6" });
    expect(tko_companiesCsv.csv).toContain("Analytical Engines,analytical.test");

    const tko_outbox = await tko_platform.listOutbox();
    expect(tko_outbox.filter(tko_row => tko_row.eventType === "data.exported.v1")).toHaveLength(4);
    expect((await tko_platform.listAuditLogs()).filter(tko_row => tko_row.action === "data.exported")).toHaveLength(4);
  });

  it("denies data.export to members, guests and service accounts", async () => {
    const tko_owner = tko_actor();
    await expect(tko_exports.exportCsv(tko_actor({ role: "member", memberId: "member-1" }), { entityType: "crm_leads", correlationId: "denied-1" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(tko_exports.exportCsv(tko_actor({ role: "guest", memberId: "guest-1" }), { entityType: "crm_leads", correlationId: "denied-2" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(tko_exports.exportCsv(tko_actor({ role: "service_account", memberId: "service-1" }), { entityType: "work_items", correlationId: "denied-3" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(tko_exports.exportCsv(tko_owner, { entityType: "crm_leads", correlationId: "ok-1" })).resolves.toMatchObject({ entityType: "crm_leads" });
    expect(await tko_crm.listLeads(tko_owner.tenantId)).toHaveLength(0);
  });

  it("escapes quotes, newlines and separators per RFC4180", async () => {
    const { tko_toCsv } = await import("./src/export-service");
    const tko_csv = tko_toCsv(["a", "b"], [["plain", 'say "hi", ok'], ["line\nbreak", "-cmd"]]);
    expect(tko_csv).toBe("\uFEFFa,b\r\nplain,\"say \"\"hi\"\", ok\"\r\n\"line\nbreak\",'-cmd\r\n");
  });
});
