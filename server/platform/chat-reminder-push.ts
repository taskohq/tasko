import type { FastifyReply, FastifyRequest } from "fastify";
import webpush from "web-push";
import { tko_config } from "../../packages/config/src/tasko-config";
import { getChatStore } from "../../packages/database/src/chat-store";
import { sdk } from "../_core/sdk";

export async function deliverChatReminderPush(tko_request: FastifyRequest, tko_reply: FastifyReply) {
  let tko_taskUid = "";
  try {
    const tko_user = await sdk.authenticateRequest(tko_request);
    if (!tko_user.isCron || !tko_user.taskUid) return void tko_reply.code(403).send({ error: "cron-only" });
    tko_taskUid = tko_user.taskUid;
    if (!tko_config.vapidPublicKey || !tko_config.vapidPrivateKey) throw new Error("TASKO_VAPID_NOT_CONFIGURED");
    const tko_reminder = await getChatStore().claimReminderPushDelivery(tko_taskUid);
    if (!tko_reminder) return void tko_reply.send({ ok: true, skipped: "not_due_or_already_delivered" });
    const tko_subscriptions = await getChatStore().listPushSubscriptions(tko_reminder.tenantId, tko_reminder.memberId);
    if (!tko_subscriptions.length) { await getChatStore().releaseReminderPushDelivery(tko_taskUid); return void tko_reply.send({ ok: true, skipped: "no_active_device" }); }
    webpush.setVapidDetails("mailto:notifications@tasko.local", tko_config.vapidPublicKey, tko_config.vapidPrivateKey);
    const tko_payload = JSON.stringify({ title: "Reminder Tasko", body: tko_reminder.title, href: "/chat#saved", tag: `tasko-reminder-${tko_reminder.id}` });
    const tko_results = await Promise.allSettled(tko_subscriptions.map(async tko_subscription => {
      try { await webpush.sendNotification({ endpoint: tko_subscription.endpoint, keys: { p256dh: tko_subscription.p256dh, auth: tko_subscription.auth } }, tko_payload); return true; }
      catch (tko_error: any) { if (tko_error?.statusCode === 404 || tko_error?.statusCode === 410) await getChatStore().disablePushSubscription(tko_reminder.tenantId, tko_subscription.endpoint); throw tko_error; }
    }));
    const tko_delivered = tko_results.filter(tko_result => tko_result.status === "fulfilled").length;
    if (!tko_delivered) throw new Error("TASKO_WEB_PUSH_DELIVERY_FAILED");
    await getChatStore().completeReminderPushDelivery(tko_taskUid);
    return void tko_reply.send({ ok: true, delivered: tko_delivered });
  } catch (tko_error) {
    if (tko_taskUid) await getChatStore().releaseReminderPushDelivery(tko_taskUid).catch(() => undefined);
    return void tko_reply.code(500).send({ error: tko_error instanceof Error ? tko_error.message : String(tko_error), context: { taskUid: tko_taskUid, url: tko_request.url }, timestamp: new Date().toISOString() });
  }
}
