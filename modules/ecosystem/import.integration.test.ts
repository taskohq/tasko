import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryCRMStore, setCRMStoreForTests } from "../../packages/database/src/crm-store";
import { MemoryEcosystemStore, setEcosystemStoreForTests } from "../../packages/database/src/ecosystem-store";
import { MemoryDeveloperStore, setDeveloperStoreForTests } from "../../packages/database/src/developer-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { parseClickUpTasks, parseCrmCsv, parseJiraIssues, parseSlackExport } from "./src/import-adapters";
import { ImportService } from "./src/import-service";
import { DeveloperService } from "./src/developer-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "ecosystem-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "ecosystem-test", ...tko_overrides };
}

describe("Tasko M6 staged import pipeline", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_crm: MemoryCRMStore;
  let tko_store: MemoryEcosystemStore;
  let tko_imports: ImportService;
  let tko_developers: DeveloperService;

  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore(); tko_crm = new MemoryCRMStore(); tko_store = new MemoryEcosystemStore();
    setPlatformStoreForTests(tko_platform); setCRMStoreForTests(tko_crm); setEcosystemStoreForTests(tko_store); setDeveloperStoreForTests(new MemoryDeveloperStore());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "ecosystem-owner", tenantSlug: "tasko-demo" }); tko_imports = new ImportService(tko_store); tko_developers = new DeveloperService();
  });
  afterEach(() => { setPlatformStoreForTests(null); setCRMStoreForTests(null); setEcosystemStoreForTests(null); setDeveloperStoreForTests(null); });

  it("stages, maps, previews and imports a CRM CSV batch idempotently with source mappings", async () => {
    const tko_owner = tko_actor();
    const tko_job = await tko_imports.create(tko_owner, { source: "crm_csv", name: "CRM migration", idempotencyKey: "crm-import-1", correlationId: "crm-import-1" });
    const tko_replay = await tko_imports.create(tko_owner, { source: "crm_csv", name: "CRM migration replay", idempotencyKey: "crm-import-1", correlationId: "crm-import-1" });
    expect(tko_replay.id).toBe(tko_job.id);
    await tko_imports.stage(tko_owner, { jobId: tko_job.id, records: [{ sourceRecordId: "legacy-001", sourceType: "crm_contact", status: "valid", payload: { full_name: "Ada Lovelace", email: "ADA@EXAMPLE.TEST", company: "Analytical Engines" } }], correlationId: "stage-1" });
    await tko_imports.saveMapping(tko_owner, { jobId: tko_job.id, sourceType: "crm_contact", targetKind: "lead", duplicateStrategy: "skip", fields: [{ sourceField: "full_name", targetField: "name", transform: "split_name", required: true }, { sourceField: "email", targetField: "email", transform: "email", required: true }, { sourceField: "company", targetField: "companyName", transform: "identity", required: false }], correlationId: "mapping-1" });
    const tko_preview = await tko_imports.preview(tko_owner, tko_job.id);
    expect(tko_preview.summary.valid).toBe(1); expect(tko_preview.mappings).toHaveLength(1);
    const [tko_batch] = await tko_imports.queue(tko_owner, { jobId: tko_job.id, idempotencyKey: "queue-1", batchSize: 25, correlationId: "queue-1" });
    const tko_batchReplay = await tko_imports.queue(tko_owner, { jobId: tko_job.id, idempotencyKey: "queue-1", batchSize: 25, correlationId: "queue-replay" });
    expect(tko_batchReplay[0]?.id).toBe(tko_batch.id);
    const tko_completed = await tko_imports.executeBatch(tko_owner, { batchId: tko_batch.id, correlationId: "execute-1" });
    await tko_imports.executeBatch(tko_owner, { batchId: tko_batch.id, correlationId: "execute-replay" });
    expect(tko_completed.status).toBe("completed"); expect(await tko_crm.listLeads(tko_owner.tenantId)).toHaveLength(1); expect((await tko_store.listSourceMappings(tko_owner.tenantId, tko_job.id))[0]?.sourceRecordId).toBe("legacy-001");
    expect((await tko_platform.listAuditLogs()).some(tko_row => tko_row.action === "ecosystem.import_batch.completed")).toBe(true);
  });

  it("denies guest import mutation and never returns records across tenants", async () => {
    const tko_owner = tko_actor(); const tko_job = await tko_imports.create(tko_owner, { source: "crm_csv", name: "Private migration", idempotencyKey: "private-1", correlationId: "private-1" });
    await expect(tko_imports.stage(tko_actor({ role: "guest", memberId: "guest-member" }), { jobId: tko_job.id, records: [{ sourceRecordId: "forbidden", sourceType: "crm_contact", payload: {} }], correlationId: "forbidden" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    expect(await tko_store.getImportJob("another-tenant", tko_job.id)).toBeNull(); expect(await tko_store.listStagingRecords(tko_owner.tenantId, tko_job.id)).toHaveLength(0);
  });

  it("normalizes Jira, ClickUp, CSV CRM and immutable Slack export records into explicit staging mappings", () => {
    const tko_jira = parseJiraIssues([{ id: "J-1", key: "OPS-1", fields: { summary: "Ship release", description: "Validate" } }], "tasko-project");
    const tko_clickup = parseClickUpTasks([{ id: "C-1", name: "Migrate backlog", description: "Keep source URL", url: "https://clickup.test/t/C-1" }], "tasko-project");
    const tko_csv = parseCrmCsv('name,email,company\n"Ada Lovelace",ADA@EXAMPLE.TEST,"Analytical, Inc."');
    const tko_slack = parseSlackExport({ channels: [{ id: "CH-1", name: "release", topic: { value: "Ship safely" } }], messages: [{ ts: "1710000000.001", channel: "CH-1", text: "Deployment started", user: "U-1" }] });
    expect(tko_jira.records[0]?.payload.summary).toBe("Ship release"); expect(tko_jira.suggestedMappings[0]?.targetKind).toBe("work_item");
    expect(tko_clickup.records[0]?.payload.sourceUrl).toBe("https://clickup.test/t/C-1"); expect(tko_csv.records[0]?.payload.company).toBe("Analytical, Inc.");
    expect(tko_slack.records.map(tko_record => tko_record.sourceType)).toEqual(["channel", "message"]); expect(tko_slack.records[1]?.payload.originalTs).toBe("1710000000.001"); expect(tko_slack.warnings[0]).toContain("identity");
  });

  it("issues scoped public tokens, rejects absent scopes and protects webhook/Git connections", async () => {
    const tko_owner = tko_actor();
    const tko_issued = await tko_developers.issueToken(tko_owner, { name: "Import reader", scopes: ["imports:read"], correlationId: "token-1" });
    await expect(tko_developers.authenticatePublicToken(tko_issued.secret, "imports:read", "api-1")).resolves.toMatchObject({ tenantId: tko_owner.tenantId, memberId: tko_owner.memberId });
    await expect(tko_developers.authenticatePublicToken(tko_issued.secret, "work:write", "api-2")).rejects.toThrow("PUBLIC_API_SCOPE_DENIED");
    await expect(tko_developers.createWebhook(tko_owner, { name: "Invalid", endpointUrl: "http://127.0.0.1/hook", eventTypes: ["work.work_item_created.v1"] })).rejects.toThrow("WEBHOOK_ENDPOINT_NOT_ALLOWED");
    const tko_webhook = await tko_developers.createWebhook(tko_owner, { name: "Events", endpointUrl: "https://hooks.example.test/tasko", eventTypes: ["work.work_item_created.v1"], correlationId: "webhook-1" });
    expect(tko_webhook.signingSecret).toHaveLength(32); expect((await tko_developers.listWebhooks(tko_owner))[0]?.id).toBe(tko_webhook.subscription.id);
    await tko_developers.connect(tko_owner, { provider: "github", displayName: "Tasko GitHub", correlationId: "github-1" }); await tko_developers.connect(tko_owner, { provider: "gitlab", displayName: "Tasko GitLab", correlationId: "gitlab-1" });
    const tko_connections = await tko_developers.listConnections(tko_owner);
    expect(tko_connections.map(tko_item => tko_item.provider)).toEqual(["github", "gitlab"]);
    expect(tko_connections).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "github", status: "pending", externalAccountId: null, encryptedSecretRef: null, config: {} })]));
    await expect(tko_developers.listTokens(tko_actor({ role: "guest", memberId: "guest-member" }))).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
  });
});
