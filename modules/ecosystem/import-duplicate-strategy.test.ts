import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryEcosystemStore, setEcosystemStoreForTests } from "../../packages/database/src/ecosystem-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { ImportService } from "./src/import-service";
import * as crmService from "../crm/src/crm-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "strategy-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "strategy-test", ...tko_overrides };
}

const tko_leadMappingFields = [
  { sourceField: "name", targetField: "name", transform: "split_name" as const, required: true },
  { sourceField: "email", targetField: "email", transform: "email" as const, required: false },
  { sourceField: "company", targetField: "companyName", transform: "identity" as const, required: false },
  { sourceField: "phone", targetField: "phone", transform: "identity" as const, required: false },
];

async function tko_runJob(tko_imports: ImportService, tko_owner: PlatformActor, tko_source: "skip" | "update" | "create_duplicate", tko_records: Array<{ sourceRecordId: string; payload: Record<string, unknown> }>): Promise<void> {
  const tko_job = await tko_imports.create(tko_owner, { source: "crm_csv", name: `Strategy ${tko_source}`, idempotencyKey: `job-${tko_source}-${Math.random().toString(36).slice(2)}`, correlationId: `job-${tko_source}` });
  await tko_imports.stage(tko_owner, { jobId: tko_job.id, records: tko_records.map(tko_record => ({ ...tko_record, sourceType: "crm_contact", status: "valid" as const })), correlationId: "stage" });
  await tko_imports.saveMapping(tko_owner, { jobId: tko_job.id, sourceType: "crm_contact", targetKind: "lead", duplicateStrategy: tko_source, fields: tko_leadMappingFields, correlationId: "mapping" });
  const [tko_batch] = await tko_imports.queue(tko_owner, { jobId: tko_job.id, idempotencyKey: `queue-${tko_source}-${Math.random().toString(36).slice(2)}`, correlationId: "queue" });
  await tko_imports.executeBatch(tko_owner, { batchId: tko_batch!.id, correlationId: "execute" });
}

describe("Tasko M5 import duplicate strategies", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_crm: MemoryCRMStore;
  let tko_store: MemoryEcosystemStore;
  let tko_imports: ImportService;

  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore(); tko_crm = new MemoryCRMStore(); tko_store = new MemoryEcosystemStore();
    setPlatformStoreForTests(tko_platform); setCRMStoreForTests(tko_crm); setEcosystemStoreForTests(tko_store); setWorkStoreForTests(new MemoryWorkStore());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "strategy-owner", tenantSlug: "tasko-demo" });
    tko_imports = new ImportService(tko_store);
  });
  afterEach(() => { setPlatformStoreForTests(null); setCRMStoreForTests(null); setEcosystemStoreForTests(null); setWorkStoreForTests(null); });

  it("update matches an existing lead by email, keeps the original id and updates mutable fields", async () => {
    const tko_owner = tko_actor();
    const tko_existing = await crmService.createLead({ actor: tko_owner, firstName: "Ada", lastName: "Lovelace", companyName: "Old Company", email: "shared@example.test", phone: "+1-000-000-0000", correlationId: "seed" });
    await tko_runJob(tko_imports, tko_owner, "update", [{ sourceRecordId: "src-1", payload: { name: "Ada King", email: "SHARED@example.test", company: "Analytical Engines", phone: "+1-202-555-0100" } }]);
    const tko_leads = await tko_crm.listLeads(tko_owner.tenantId);
    expect(tko_leads).toHaveLength(1);
    expect(tko_leads[0]!.id).toBe(tko_existing.id); // original id/history preserved
    expect(tko_leads[0]!.lastName).toBe("King");
    expect(tko_leads[0]!.companyName).toBe("Analytical Engines");
    expect(tko_leads[0]!.phone).toBe("+1-202-555-0100");
    expect((await tko_store.listSourceMappings(tko_owner.tenantId, (await tko_imports.list(tko_owner))[0]!.id)).some(tko_mapping => tko_mapping.targetEntityId === tko_existing.id)).toBe(true);
    expect((await tko_platform.listAuditLogs()).some(tko_row => tko_row.action === "crm.lead.updated")).toBe(true);
  });

  it("create_duplicate always inserts a new lead while re-runs stay idempotent", async () => {
    const tko_owner = tko_actor();
    await crmService.createLead({ actor: tko_owner, firstName: "Ada", lastName: "Lovelace", email: "dup@example.test", correlationId: "seed" });
    await tko_runJob(tko_imports, tko_owner, "create_duplicate", [
      { sourceRecordId: "src-1", payload: { name: "Ada Lovelace", email: "dup@example.test" } },
      { sourceRecordId: "src-2", payload: { name: "Ada Lovelace", email: "dup@example.test" } },
    ]);
    expect(await tko_crm.listLeads(tko_owner.tenantId)).toHaveLength(3); // seeded + two intentional duplicates
    // Re-running the completed batch is a no-op: no additional rows are created.
    const tko_job = (await tko_imports.list(tko_owner))[0]!;
    const tko_batch = await tko_imports.executeBatch(tko_owner, { batchId: (await tko_store.listImportBatches(tko_owner.tenantId, tko_job.id))[0]!.id, correlationId: "re-run" });
    expect(tko_batch.status).toBe("completed");
    expect(await tko_crm.listLeads(tko_owner.tenantId)).toHaveLength(3);
  });

  it("skip keeps staged-import semantics and stays idempotent across re-runs", async () => {
    const tko_owner = tko_actor();
    await tko_runJob(tko_imports, tko_owner, "skip", [
      { sourceRecordId: "src-1", payload: { name: "First Lead", email: "first@example.test" } },
      { sourceRecordId: "src-2", payload: { name: "First Lead", email: "first@example.test" } },
    ]);
    expect(await tko_crm.listLeads(tko_owner.tenantId)).toHaveLength(2); // skip creates one row per source record
    const tko_job = (await tko_imports.list(tko_owner))[0]!;
    await tko_imports.executeBatch(tko_owner, { batchId: (await tko_store.listImportBatches(tko_owner.tenantId, tko_job.id))[0]!.id, correlationId: "re-run" });
    expect(await tko_crm.listLeads(tko_owner.tenantId)).toHaveLength(2);
  });

  it("update falls back to name+company matching when no email is present", async () => {
    const tko_owner = tko_actor();
    await crmService.createLead({ actor: tko_owner, firstName: "No", lastName: "Email", companyName: "Acme", correlationId: "seed" });
    await tko_runJob(tko_imports, tko_owner, "update", [{ sourceRecordId: "src-1", payload: { name: "No Email", company: "Acme", phone: "+1-222-333-4455" } }]);
    const tko_leads = await tko_crm.listLeads(tko_owner.tenantId);
    expect(tko_leads).toHaveLength(1);
    expect(tko_leads[0]!.phone).toBe("+1-222-333-4455");
  });

  it("denies import mutation for members and keeps tenant data isolated", async () => {
    const tko_owner = tko_actor();
    const tko_job = await tko_imports.create(tko_owner, { source: "crm_csv", name: "Guarded", idempotencyKey: "guarded-1", correlationId: "guarded" });
    await expect(tko_imports.saveMapping(tko_actor({ role: "member", memberId: "member-1" }), { jobId: tko_job.id, sourceType: "crm_contact", targetKind: "lead", duplicateStrategy: "update", fields: tko_leadMappingFields, correlationId: "denied" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(tko_imports.executeBatch(tko_actor({ role: "guest", memberId: "guest-1" }), { batchId: "00000000-0000-0000-0000-000000000000", correlationId: "denied-2" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    expect(await tko_store.getImportJob("another-tenant", tko_job.id)).toBeNull();
  });
});
