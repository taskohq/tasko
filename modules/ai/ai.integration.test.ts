import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryAIStore, setAIStoreForTests } from "../../packages/database/src/ai-store";
import { MemoryDeveloperStore, setDeveloperStoreForTests } from "../../packages/database/src/developer-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { can } from "../permissions/src/authorization";
import { DeveloperService } from "../ecosystem/src/developer-service";
import { confirmProposal, proposeAction } from "./src/ai-service";

const tko_tenantId = "tko-tenant-tasko-demo";
function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor { return { authSubject: "ai-owner", tenantId: tko_tenantId, tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "ai-test", ...tko_overrides }; }

describe("Tasko M7 AI and MCP controls", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_ai: MemoryAIStore;
  beforeEach(async () => { tko_platform = new MemoryPlatformStore(); tko_ai = new MemoryAIStore(); setPlatformStoreForTests(tko_platform); setAIStoreForTests(tko_ai); setDeveloperStoreForTests(new MemoryDeveloperStore()); await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "ai-owner", tenantSlug: "tasko-demo" }); });
  afterEach(() => { setPlatformStoreForTests(null); setAIStoreForTests(null); setDeveloperStoreForTests(null); });

  it("creates an idempotent write proposal without executing a durable tool", async () => {
    const tko_owner = tko_actor();
    const tko_proposal = await proposeAction(tko_owner, { toolName: "chat.message.send", input: { channelId: "3bb87408-3a4c-4cc1-92ff-d45ea930d5bd", text: "Release update", authorization: "Bearer should-never-persist" }, idempotencyKey: "proposal-once", correlationId: "proposal-once" });
    const tko_replay = await proposeAction(tko_owner, { toolName: "chat.message.send", input: { channelId: "3bb87408-3a4c-4cc1-92ff-d45ea930d5bd", text: "Changed replay" }, idempotencyKey: "proposal-once", correlationId: "proposal-replay" });
    expect(tko_replay.id).toBe(tko_proposal.id);
    expect(tko_proposal).toMatchObject({ status: "proposed", risk: "write", executedAt: null });
    expect(tko_proposal.input.authorization).toBe("[redacted]");
    expect((await tko_platform.listAuditLogs()).some(tko_row => tko_row.action === "ai.proposal.created")).toBe(true);
    const tko_events = await tko_platform.reserveOutbox(20);
    expect(tko_events.filter(tko_event => tko_event.eventType === "ai.proposal_created.v1")).toHaveLength(1);
    expect(tko_events.some(tko_event => tko_event.eventType === "ai.proposal_executed.v1")).toBe(false);
  });

  it("requires confirmation capability and keeps proposals tenant-isolated", async () => {
    const tko_owner = tko_actor();
    const tko_proposal = await proposeAction(tko_owner, { toolName: "chat.message.send", input: { channelId: "3bb87408-3a4c-4cc1-92ff-d45ea930d5bd", text: "Review before sending" }, correlationId: "confirm-proposal" });
    const tko_guest = tko_actor({ role: "guest", memberId: "guest-member" });
    expect(can(tko_guest, "ai.action.confirm", { tenantId: tko_guest.tenantId, type: "ai_tool_proposal", id: tko_proposal.id, visibility: "internal" })).toEqual({ allowed: false, reason: "capability_missing" });
    await expect(confirmProposal(tko_guest, { proposalId: tko_proposal.id, correlationId: "guest-confirm" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(tko_ai.getProposal("other-tenant", tko_proposal.id)).resolves.toBeNull();
    await expect(confirmProposal(tko_owner, { proposalId: tko_proposal.id, correlationId: "owner-confirm" })).resolves.toMatchObject({ status: "confirmed", confirmedByMemberId: tko_owner.memberId });
  });

  it("issues MCP-only developer access and refuses a token without the beta scope", async () => {
    const tko_developers = new DeveloperService();
    const tko_token = await tko_developers.issueToken(tko_actor(), { name: "Tasko MCP", scopes: ["mcp:connect"], correlationId: "mcp-token" });
    await expect(tko_developers.authenticatePublicToken(tko_token.secret, "mcp:connect", "mcp-auth")).resolves.toMatchObject({ tenantId: tko_tenantId });
    await expect(tko_developers.authenticatePublicToken(tko_token.secret, "work:read", "mcp-wrong-scope")).rejects.toThrow("PUBLIC_API_SCOPE_DENIED");
  });
});
