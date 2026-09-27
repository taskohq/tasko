import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryChatStore, getChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";

const { tko_authenticateRequest, tko_sendNotification } = vi.hoisted(() => ({ tko_authenticateRequest: vi.fn(), tko_sendNotification: vi.fn() }));
vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: tko_authenticateRequest } }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: tko_sendNotification } }));

import { deliverChatReminderPush } from "./chat-reminder-push";

const tko_actor: PlatformActor = { authSubject: "chat-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-demo-owner", role: "owner", membershipStatus: "active", correlationId: "push-test" };
const tko_response = () => {
  const tko_send = vi.fn();
  const tko_code = vi.fn(() => ({ send: tko_send }));
  return { code: tko_code, send: tko_send } as any;
};

describe("chat reminder Web Push callback", () => {
  beforeEach(async () => {
    const tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setChatStoreForTests(new MemoryChatStore());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "chat-owner", tenantSlug: "tasko-demo" });
    tko_authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "cron-push-test" });
    tko_sendNotification.mockReset();
  });

  it("delivers once and records the completed idempotency claim", async () => {
    const tko_reminder = await getChatStore().createReminder(tko_actor, { title: "Check launch", reminderAt: new Date(Date.now() - 60_000) }, "create");
    await getChatStore().setReminderSchedule(tko_actor, tko_reminder.id, "cron-push-test");
    await getChatStore().upsertPushSubscription(tko_actor, { endpoint: "https://fcm.googleapis.com/fcm/send/tasko-push", p256dh: "test-p256dh-key-material", auth: "test-auth-key-material" }, "sub");
    tko_sendNotification.mockResolvedValue(undefined);
    const tko_res = tko_response();

    await deliverChatReminderPush({ url: "/api/scheduled/chat-reminder-push" } as any, tko_res);

    expect(tko_sendNotification).toHaveBeenCalledTimes(1);
    expect(tko_res.send).toHaveBeenCalledWith({ ok: true, delivered: 1 });
    expect(await getChatStore().claimReminderPushDelivery("cron-push-test")).toBeNull();
  });

  it("disables a 410 subscription and releases the reminder claim for retry", async () => {
    const tko_reminder = await getChatStore().createReminder(tko_actor, { title: "Retry push", reminderAt: new Date(Date.now() - 60_000) }, "create");
    await getChatStore().setReminderSchedule(tko_actor, tko_reminder.id, "cron-push-test");
    await getChatStore().upsertPushSubscription(tko_actor, { endpoint: "https://fcm.googleapis.com/fcm/send/tasko-expired", p256dh: "test-p256dh-key-material", auth: "test-auth-key-material" }, "sub");
    tko_sendNotification.mockRejectedValue({ statusCode: 410 });
    const tko_res = tko_response();

    await deliverChatReminderPush({ url: "/api/scheduled/chat-reminder-push" } as any, tko_res);

    expect(await getChatStore().listPushSubscriptions(tko_actor.tenantId, tko_actor.memberId)).toEqual([]);
    expect(await getChatStore().claimReminderPushDelivery("cron-push-test")).toEqual(expect.objectContaining({ id: tko_reminder.id }));
    expect(tko_res.code).toHaveBeenCalledWith(500);
  });
});
