import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { getChatStore, MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { MemoryWorkspaceStore, getWorkspaceStore, setWorkspaceStoreForTests } from "../../packages/database/src/workspace-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { processOutboxOnce } from "../worker/src/worker-service";
import { enqueueDurableEvent } from "../events/src/outbox-service";
import { registerWorkspaceWorker, tko_isInQuietHours } from "./src/workspace-worker";
import * as chat from "../chat/src/chat-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "inbox-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-demo-owner", role: "owner", membershipStatus: "active", correlationId: "inbox-test", ...tko_overrides };
}

function tko_hhmm(tko_date: Date): string {
  return `${String(tko_date.getUTCHours()).padStart(2, "0")}:${String(tko_date.getUTCMinutes()).padStart(2, "0")}`;
}

async function tko_drainOutbox(): Promise<void> {
  for (let tko_round = 0; tko_round < 20; tko_round += 1) {
    if ((await processOutboxOnce()) === 0) return;
  }
  throw new Error("outbox did not drain");
}

describe("Workspace worker chat notifications (M2)", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_owner: PlatformActor;
  let tko_memberId: string;
  let tko_otherMemberId: string;
  let tko_channelId: string;

  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setChatStoreForTests(new MemoryChatStore());
    setWorkStoreForTests(new MemoryWorkStore());
    setWorkspaceStoreForTests(new MemoryWorkspaceStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    const tko_tenant = await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "inbox-owner", tenantSlug: "tasko-demo" });
    const tko_members = await tko_platform.listTenantMembers(tko_tenant.id);
    const tko_ownerMembership = tko_members.find(tko_item => tko_item.role === "owner");
    expect(tko_ownerMembership).toBeDefined();
    tko_owner = tko_actor({ tenantId: tko_tenant.id, memberId: tko_ownerMembership!.id });
    const tko_memberMembership = tko_members.find(tko_item => tko_item.role === "member");
    expect(tko_memberMembership).toBeDefined();
    tko_memberId = tko_memberMembership!.id;
    const tko_otherMembership = tko_members.find(tko_item => tko_item.role !== "owner" && tko_item.id !== tko_memberId && tko_item.status === "active");
    expect(tko_otherMembership).toBeDefined();
    tko_otherMemberId = tko_otherMembership!.id;
    const tko_channel = await chat.createChannel(tko_owner, { kind: "private", name: "inbox-room", visibility: "private", memberIds: [tko_memberId, tko_otherMemberId] });
    tko_channelId = tko_channel.id;
    registerWorkspaceWorker();
  });

  afterEach(() => {
    setPlatformStoreForTests(null);
    setChatStoreForTests(null);
    setWorkStoreForTests(null);
    setWorkspaceStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("creates deduped mention inbox items for mentioned members but never for the sender", async () => {
    await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "a11aa5f2-9a52-4b3e-8d33-6dfcb0f3e001", body: { type: "text", text: "Please review the handoff.", mentions: [tko_memberId, tko_otherMemberId] } }, "mention-send");
    await tko_drainOutbox();

    const tko_memberInbox = await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_memberId);
    expect(tko_memberInbox).toEqual([expect.objectContaining({ kind: "mention", entityType: "message", href: expect.stringContaining(`/chat?channel=${tko_channelId}&message=`) })]);
    const tko_otherInbox = await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_otherMemberId);
    expect(tko_otherInbox).toEqual([expect.objectContaining({ kind: "mention" })]);
    // The sender is not notified about their own mention.
    expect(await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_owner.memberId)).toEqual([]);

    // Redelivery of the same source event must not duplicate (spec 11 §8, 24 M).
    const tko_sourceEventId = tko_memberInbox[0].sourceEventId;
    await getWorkspaceStore().createInboxItem(tko_owner, { memberId: tko_memberId, kind: "mention", entityType: "message", entityId: tko_memberInbox[0].entityId, title: "duplicate", body: "", href: "/chat", sourceEventId: tko_sourceEventId, correlationId: "dup" });
    expect(await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_memberId)).toHaveLength(1);
  });

  it("expands @team mentions to team members who are channel members only", async () => {
    const tko_teamId = "4b2d3e5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";
    (getChatStore() as MemoryChatStore).seedTeam(tko_owner.tenantId, tko_teamId, "Reviewers", "reviewers", [tko_memberId, "member-not-in-channel"]);
    await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "a11aa5f2-9a52-4b3e-8d33-6dfcb0f3e002", body: { type: "text", text: "@reviewers please look", teamMentions: [tko_teamId] } }, "team-send");
    await tko_drainOutbox();

    expect((await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_memberId)).map(tko_item => tko_item.kind)).toEqual(["mention"]);
    expect(await getWorkspaceStore().listInbox(tko_owner.tenantId, "member-not-in-channel")).toEqual([]);
  });

  it("respects per-channel mute, per-user defaults and quiet hours while unread mention counters still update", async () => {
    // Member A: channel muted → no inbox item at all.
    await chat.setNotificationPreference(tko_actor({ memberId: tko_memberId }), tko_channelId, "none", "mute-channel");
    // Member B: quiet hours spanning now → inbox suppressed, unread mention counter intact.
    const tko_quietStart = new Date(Date.now() - 5 * 60_000);
    const tko_quietEnd = new Date(Date.now() + 5 * 60_000);
    await chat.updateMemberNotificationPrefs(tko_actor({ memberId: tko_otherMemberId }), { defaultPolicy: "mentions", quietHoursStart: tko_hhmm(tko_quietStart), quietHoursEnd: tko_hhmm(tko_quietEnd) }, "quiet-hours");

    const tko_message = await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "a11aa5f2-9a52-4b3e-8d33-6dfcb0f3e003", body: { type: "text", text: "Both mentioned.", mentions: [tko_memberId, tko_otherMemberId] } }, "policy-send");
    await tko_drainOutbox();

    expect(await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_memberId)).toEqual([]);
    expect(await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_otherMemberId)).toEqual([]);
    expect((await chat.readStates(tko_actor({ memberId: tko_otherMemberId }))).find(tko_state => tko_state.channelId === tko_channelId)?.unreadMentions).toBe(1);
    void tko_message;
  });

  it("writes assignment inbox items for work item assignees", async () => {
    const tko_board = await getWorkStore().seedDemoWork(tko_owner);
    const tko_workItem = (await getWorkStore().listWorkItems(tko_owner.tenantId, tko_board.project.id))[0];
    await enqueueDurableEvent({ actor: tko_owner, tenantId: tko_owner.tenantId, eventType: "work.work_item_assigned.v1", topic: "work.item", payload: { workItemId: tko_workItem.id, assigneeMemberIds: [tko_memberId, tko_owner.memberId] }, action: "work.item.assigned", resourceType: "work_item", resourceId: tko_workItem.id, correlationId: "assignment-send" });
    await tko_drainOutbox();

    expect(await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_memberId)).toEqual([expect.objectContaining({ kind: "assignment", entityType: "work_item", entityId: tko_workItem.id, href: `/work?item=${tko_workItem.id}` })]);
    // The acting member is not self-notified.
    expect(await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_owner.memberId)).toEqual([]);
  });

  it("evaluates quiet-hour windows including the midnight-crossing case", () => {
    const tko_reference = new Date("2026-03-02T10:20:00.000Z");
    expect(tko_isInQuietHours("10:00", "10:30", tko_reference)).toBe(true);
    expect(tko_isInQuietHours("10:30", "11:00", tko_reference)).toBe(false);
    expect(tko_isInQuietHours("22:30", "07:00", new Date("2026-03-02T23:45:00.000Z"))).toBe(true);
    expect(tko_isInQuietHours("22:30", "07:00", new Date("2026-03-02T06:45:00.000Z"))).toBe(true);
    expect(tko_isInQuietHours("22:30", "07:00", new Date("2026-03-02T12:00:00.000Z"))).toBe(false);
    expect(tko_isInQuietHours(null, "07:00", tko_reference)).toBe(false);
    expect(tko_isInQuietHours("bad", "07:00", tko_reference)).toBe(false);
  });
});
