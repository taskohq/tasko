import type { OutboxRecord, PlatformActor } from "../../../packages/contracts/src/platform";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getChatStore } from "../../../packages/database/src/chat-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getWorkspaceStore } from "../../../packages/database/src/workspace-store";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { resolveWorkerServiceActor } from "../../tenancy/src/tenant-context";
import { registerOutboxConsumer } from "../../worker/src/worker-service";
import { sendWorkspaceInvitationEmail } from "./invitation-email-service";
import { createInboxItem, materializeSearchDocument, processAutomationEvent } from "./workspace-service";

function tko_payloadId(tko_record: OutboxRecord, tko_name: string): string | null { const tko_value = tko_record.payload[tko_name]; return typeof tko_value === "string" ? tko_value : null; }
function tko_payloadIds(tko_record: OutboxRecord, tko_name: string): string[] { const tko_value = tko_record.payload[tko_name]; return Array.isArray(tko_value) ? Array.from(new Set(tko_value.filter((tko_id): tko_id is string => typeof tko_id === "string"))) : []; }
async function tko_actorFor(tko_record: OutboxRecord): Promise<PlatformActor> { const tko_actor = await resolveWorkerServiceActor({ tenantId: tko_record.tenantId, correlationId: tko_record.correlationId }); if (!tko_actor) throw new Error("WORKSPACE_SERVICE_ACTOR_MISSING"); return tko_actor; }

async function tko_indexWork(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "workItemId"); if (!tko_id) throw new Error("WORKSPACE_WORK_ITEM_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_id); if (!tko_item) return;
  await materializeSearchDocument(tko_actor, { entityType: "work_item", entityId: tko_item.id, kind: "work", title: `${tko_item.key} · ${tko_item.title}`, bodyText: tko_item.description ?? "", href: `/work?item=${tko_item.id}`, visibility: tko_item.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
  await processAutomationEvent(tko_actor, tko_record);
}

/** Work item updates re-project the search document without re-running automations. */
async function tko_reindexWork(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "workItemId"); if (!tko_id) return;
  const tko_actor = await tko_actorFor(tko_record); const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_id); if (!tko_item) return;
  await materializeSearchDocument(tko_actor, { entityType: "work_item", entityId: tko_item.id, kind: "work", title: `${tko_item.key} · ${tko_item.title}`, bodyText: tko_item.description ?? "", href: `/work?item=${tko_item.id}`, visibility: tko_item.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_indexLead(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "leadId"); if (!tko_id) throw new Error("WORKSPACE_LEAD_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_lead = await getCRMStore().getLead(tko_actor.tenantId, tko_id); if (!tko_lead) return;
  await materializeSearchDocument(tko_actor, { entityType: "crm_lead", entityId: tko_lead.id, kind: "crm", title: `${tko_lead.firstName} ${tko_lead.lastName}`.trim(), bodyText: [tko_lead.companyName, tko_lead.email, tko_lead.notes].filter(Boolean).join(" · "), href: `/crm?lead=${tko_lead.id}`, visibility: tko_lead.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
  await processAutomationEvent(tko_actor, tko_record);
}

async function tko_indexChannel(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "channelId"); if (!tko_id) throw new Error("WORKSPACE_CHANNEL_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_id); if (!tko_channel) return;
  await materializeSearchDocument(tko_actor, { entityType: "channel", entityId: tko_channel.id, kind: "chat", title: tko_channel.name ?? "Direct conversation", bodyText: tko_channel.topic ?? "", href: `/chat?channel=${tko_channel.id}`, visibility: tko_channel.visibility, explicitMemberIds: tko_channel.memberIds, correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_indexMessage(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "messageId"); if (!tko_id) throw new Error("WORKSPACE_MESSAGE_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_message = await getChatStore().getMessage(tko_actor.tenantId, tko_id); if (!tko_message || tko_message.deletedAt) return;
  const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_message.channelId); if (!tko_channel) return;
  await materializeSearchDocument(tko_actor, { entityType: "message", entityId: tko_message.id, kind: "chat", title: `${tko_channel.name ?? "Conversation"} · ${tko_message.plainText.slice(0, 96)}`, bodyText: tko_message.plainText, href: `/chat?channel=${tko_channel.id}&message=${tko_message.id}`, visibility: tko_channel.visibility, explicitMemberIds: tko_channel.memberIds, correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_indexDocument(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "documentId"); if (!tko_id) throw new Error("WORKSPACE_DOCUMENT_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_id); if (!tko_document) return;
  await materializeSearchDocument(tko_actor, { entityType: "document", entityId: tko_document.id, kind: "doc", title: tko_document.title, bodyText: tko_document.bodyText, href: `/docs?document=${tko_document.id}`, visibility: tko_document.visibility, explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

/** CRM deal created / stage-changed / won (the handoff worker consumes the same event) → the deal
 * search projection is refreshed and deal-triggered automations run. */
async function tko_indexDeal(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "dealId"); if (!tko_id) throw new Error("WORKSPACE_DEAL_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_deal = await getCRMStore().getDeal(tko_actor.tenantId, tko_id); if (!tko_deal) return;
  await materializeSearchDocument(tko_actor, { entityType: "crm_deal", entityId: tko_deal.id, kind: "crm", title: tko_deal.name, bodyText: [tko_deal.amountCents !== null ? `${(tko_deal.amountCents / 100).toFixed(2)} ${tko_deal.currency}` : "", tko_deal.source, tko_deal.nextStep].filter(Boolean).join(" · "), href: `/crm?deal=${tko_deal.id}`, visibility: tko_deal.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
  await processAutomationEvent(tko_actor, tko_record);
}

async function tko_indexCompany(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "companyId"); if (!tko_id) throw new Error("WORKSPACE_COMPANY_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_company = await getCRMStore().getCompany(tko_actor.tenantId, tko_id); if (!tko_company) return;
  await materializeSearchDocument(tko_actor, { entityType: "crm_company", entityId: tko_company.id, kind: "crm", title: tko_company.name, bodyText: [tko_company.domain, tko_company.industry, tko_company.country].filter(Boolean).join(" · "), href: `/crm?company=${tko_company.id}`, visibility: tko_company.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

/** CRM company/contact/lead updates re-project their search documents; no automations run on them. */
async function tko_reindexCompany(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "companyId"); if (!tko_id) return;
  const tko_actor = await tko_actorFor(tko_record); const tko_company = await getCRMStore().getCompany(tko_actor.tenantId, tko_id); if (!tko_company) return;
  await materializeSearchDocument(tko_actor, { entityType: "crm_company", entityId: tko_company.id, kind: "crm", title: tko_company.name, bodyText: [tko_company.domain, tko_company.industry, tko_company.country].filter(Boolean).join(" · "), href: `/crm?company=${tko_company.id}`, visibility: tko_company.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_reindexContact(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "contactId"); if (!tko_id) return;
  const tko_actor = await tko_actorFor(tko_record); const tko_contact = (await getCRMStore().listContacts(tko_actor.tenantId)).find(tko_candidate => tko_candidate.id === tko_id); if (!tko_contact) return;
  await materializeSearchDocument(tko_actor, { entityType: "crm_contact", entityId: tko_contact.id, kind: "crm", title: `${tko_contact.firstName} ${tko_contact.lastName}`.trim(), bodyText: [tko_contact.title, ...tko_contact.emails, ...tko_contact.phones].filter(Boolean).join(" · "), href: `/crm?contact=${tko_contact.id}`, visibility: tko_contact.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_reindexLead(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "leadId"); if (!tko_id) return;
  const tko_actor = await tko_actorFor(tko_record); const tko_lead = await getCRMStore().getLead(tko_actor.tenantId, tko_id); if (!tko_lead) return;
  await materializeSearchDocument(tko_actor, { entityType: "crm_lead", entityId: tko_lead.id, kind: "crm", title: `${tko_lead.firstName} ${tko_lead.lastName}`.trim(), bodyText: [tko_lead.companyName, tko_lead.email, tko_lead.notes].filter(Boolean).join(" · "), href: `/crm?lead=${tko_lead.id}`, visibility: tko_lead.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_indexContact(tko_record: OutboxRecord): Promise<void> {
  const tko_id = tko_payloadId(tko_record, "contactId"); if (!tko_id) throw new Error("WORKSPACE_CONTACT_ID_REQUIRED");
  const tko_actor = await tko_actorFor(tko_record); const tko_contact = (await getCRMStore().listContacts(tko_actor.tenantId)).find(tko_candidate => tko_candidate.id === tko_id); if (!tko_contact) return;
  await materializeSearchDocument(tko_actor, { entityType: "crm_contact", entityId: tko_contact.id, kind: "crm", title: `${tko_contact.firstName} ${tko_contact.lastName}`.trim(), bodyText: [tko_contact.title, ...tko_contact.emails, ...tko_contact.phones].filter(Boolean).join(" · "), href: `/crm?contact=${tko_contact.id}`, visibility: tko_contact.visibility ?? "internal", explicitMemberIds: [], correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_handleFormSubmission(tko_record: OutboxRecord): Promise<void> {
  const tko_actor = await tko_actorFor(tko_record); const tko_memberId = tko_payloadId(tko_record, "submittedByMemberId"); const tko_entityId = tko_payloadId(tko_record, "targetEntityId"); const tko_type = tko_payloadId(tko_record, "targetEntityType");
  if (!tko_memberId || !tko_entityId || (tko_type !== "work_item" && tko_type !== "crm_lead")) throw new Error("WORKSPACE_FORM_EVENT_INVALID");
  await createInboxItem(tko_actor, { memberId: tko_memberId, kind: "form", entityType: tko_type, entityId: tko_entityId, title: "Form submission created", body: "Your form created a linked record.", href: tko_type === "work_item" ? `/work?item=${tko_entityId}` : `/crm?lead=${tko_entityId}`, sourceEventId: tko_record.eventId, correlationId: `tko_materialize:${tko_record.eventId}` });
  await processAutomationEvent(tko_actor, tko_record);
}

async function tko_handleCommentMention(tko_record: OutboxRecord): Promise<void> {
  const tko_workItemId = tko_payloadId(tko_record, "workItemId");
  const tko_recipients = tko_payloadIds(tko_record, "mentionMemberIds");
  if (!tko_workItemId || !tko_recipients.length) return;
  const tko_actor = await tko_actorFor(tko_record);
  const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_workItemId);
  if (!tko_item) return;
  await Promise.all(tko_recipients.map(tko_memberId => createInboxItem(tko_actor, { memberId: tko_memberId, kind: "mention", entityType: "work_item", entityId: tko_item.id, title: "You were mentioned in a work comment", body: `${tko_item.key} · ${tko_item.title}`, href: `/work?item=${tko_item.id}`, sourceEventId: tko_record.eventId, correlationId: `tko_materialize:${tko_record.eventId}` })));
}

/** Quiet hours are "HH:MM" 24h clock windows evaluated on the server clock (UTC); a window whose
 * start is greater than its end crosses midnight. Suppresses the inbox item only — unread mention
 * counters are maintained by the chat store at message insert time and are unaffected. */
export function tko_isInQuietHours(tko_start: string | null, tko_end: string | null, tko_now = new Date()): boolean {
  const tko_parseMinutes = (tko_value: string): number | null => { const tko_match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(tko_value.trim()); return tko_match ? Number(tko_match[1]) * 60 + Number(tko_match[2]) : null; };
  if (!tko_start || !tko_end) return false;
  const tko_startMinutes = tko_parseMinutes(tko_start);
  const tko_endMinutes = tko_parseMinutes(tko_end);
  if (tko_startMinutes === null || tko_endMinutes === null || tko_startMinutes === tko_endMinutes) return false;
  const tko_nowMinutes = tko_now.getUTCHours() * 60 + tko_now.getUTCMinutes();
  return tko_startMinutes < tko_endMinutes ? tko_nowMinutes >= tko_startMinutes && tko_nowMinutes < tko_endMinutes : tko_nowMinutes >= tko_startMinutes || tko_nowMinutes < tko_endMinutes;
}

/** chat.message_created.v1 → mention inbox items (spec 08 §8, 11 §7). The store already excludes
 * the sender and maintains unread mention counters; this consumer resolves per-channel policy,
 * per-user defaults and quiet hours, then writes deduped inbox items. Inbox items are written
 * through the trusted worker path (resources were loaded tenant-scoped), mirroring
 * `materializeSearchDocument`. */
async function tko_handleChatMentions(tko_record: OutboxRecord): Promise<void> {
  const tko_messageId = tko_payloadId(tko_record, "messageId");
  const tko_channelId = tko_payloadId(tko_record, "channelId");
  if (!tko_messageId || !tko_channelId) return;
  const tko_mentionedMemberIds = tko_payloadIds(tko_record, "mentionMemberIds");
  const tko_mentionedTeamIds = tko_payloadIds(tko_record, "teamMentionIds");
  if (!tko_mentionedMemberIds.length && !tko_mentionedTeamIds.length) return;
  const tko_actor = await tko_actorFor(tko_record);
  const tko_message = await getChatStore().getMessage(tko_actor.tenantId, tko_messageId);
  if (!tko_message || tko_message.deletedAt) return;
  const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_channelId);
  if (!tko_channel) return;
  const tko_recipients = new Set(tko_mentionedMemberIds);
  for (const tko_teamId of tko_mentionedTeamIds) {
    const tko_teamMemberIds = await getChatStore().listTeamMemberIds(tko_actor.tenantId, tko_teamId);
    for (const tko_teamMemberId of tko_teamMemberIds) if (tko_channel.memberIds.includes(tko_teamMemberId)) tko_recipients.add(tko_teamMemberId);
  }
  tko_recipients.delete(tko_message.authorMemberId);
  if (!tko_recipients.size) return;
  const tko_settings = await getChatStore().listChannelMemberSettings(tko_actor.tenantId, tko_channelId);
  const tko_levelByMember = new Map(tko_settings.map(tko_setting => [tko_setting.memberId, tko_setting.notificationLevel]));
  const tko_channelLabel = tko_channel.name ? `#${tko_channel.name}` : "a conversation";
  const tko_href = `/chat?channel=${tko_channel.id}&message=${tko_message.id}`;
  for (const tko_memberId of Array.from(tko_recipients)) {
    if ((tko_levelByMember.get(tko_memberId) ?? "mentions") === "none") continue;
    const tko_prefs = await getChatStore().getMemberNotificationPrefs(tko_actor.tenantId, tko_memberId);
    if (tko_prefs.defaultPolicy === "none") continue;
    if (tko_isInQuietHours(tko_prefs.quietHoursStart, tko_prefs.quietHoursEnd)) continue;
    await getWorkspaceStore().createInboxItem(tko_actor, {
      memberId: tko_memberId,
      kind: "mention",
      entityType: "message",
      entityId: tko_message.id,
      title: `You were mentioned in ${tko_channelLabel}`,
      body: tko_message.plainText.slice(0, 280),
      href: tko_href,
      sourceEventId: tko_record.eventId,
      correlationId: `tko_materialize:${tko_record.eventId}`,
    });
  }
}

/** work.work_item_assigned.v1 → assignment inbox items for the new assignees (spec 11 §7). */
async function tko_handleWorkAssignment(tko_record: OutboxRecord): Promise<void> {
  const tko_workItemId = tko_payloadId(tko_record, "workItemId");
  if (!tko_workItemId) return;
  const tko_assigneeMemberIds = new Set(tko_payloadIds(tko_record, "assigneeMemberIds"));
  const tko_singleAssignee = tko_payloadId(tko_record, "assigneeMemberId");
  if (tko_singleAssignee) tko_assigneeMemberIds.add(tko_singleAssignee);
  if (!tko_assigneeMemberIds.size) return;
  // Self-assignment is not notified: resolve the acting member from the realtime payload first,
  // then fall back to the outbox actor's tenant membership.
  let tko_actorMemberId = tko_payloadId(tko_record, "actorMemberId");
  if (!tko_actorMemberId && tko_record.actorAuthSubject) {
    const tko_membership = (await getPlatformStore().listMemberships(tko_record.actorAuthSubject)).find(tko_item => tko_item.tenant.id === tko_record.tenantId);
    tko_actorMemberId = tko_membership?.id ?? null;
  }
  if (tko_actorMemberId) tko_assigneeMemberIds.delete(tko_actorMemberId);
  if (!tko_assigneeMemberIds.size) return;
  const tko_actor = await tko_actorFor(tko_record);
  const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_workItemId);
  if (!tko_item) return;
  for (const tko_memberId of Array.from(tko_assigneeMemberIds)) {
    await getWorkspaceStore().createInboxItem(tko_actor, {
      memberId: tko_memberId,
      kind: "assignment",
      entityType: "work_item",
      entityId: tko_item.id,
      title: "A work item was assigned to you",
      body: `${tko_item.key} · ${tko_item.title}`,
      href: `/work?item=${tko_item.id}`,
      sourceEventId: tko_record.eventId,
      correlationId: `tko_materialize:${tko_record.eventId}`,
    });
  }
}

async function tko_handleCommentReaction(tko_record: OutboxRecord): Promise<void> {
  const tko_workItemId = tko_payloadId(tko_record, "workItemId");
  const tko_recipientMemberId = tko_payloadId(tko_record, "recipientMemberId");
  if (!tko_workItemId || !tko_recipientMemberId) return;
  const tko_actor = await tko_actorFor(tko_record);
  const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_workItemId);
  if (!tko_item) return;
  await createInboxItem(tko_actor, { memberId: tko_recipientMemberId, kind: "comment", entityType: "work_item", entityId: tko_item.id, title: "Your comment received a reaction", body: `${tko_item.key} · ${tko_item.title}`, href: `/work?item=${tko_item.id}`, sourceEventId: tko_record.eventId, correlationId: `tko_materialize:${tko_record.eventId}` });
}

async function tko_deliverWorkspaceInvitation(tko_record: OutboxRecord): Promise<void> {
  const tko_invitationId = tko_payloadId(tko_record, "invitationId");
  const tko_email = tko_payloadId(tko_record, "email");
  const tko_deliveryToken = tko_payloadId(tko_record, "deliveryToken");
  const tko_expiresAt = tko_payloadId(tko_record, "expiresAt");
  const tko_role = tko_payloadId(tko_record, "role") ?? "member";
  if (!tko_invitationId || !tko_email || !tko_deliveryToken || !tko_expiresAt) throw new Error("WORKSPACE_INVITATION_DELIVERY_PAYLOAD_INVALID");
  const tko_tenant = (await getPlatformStore().listTenants()).find(tko_candidate => tko_candidate.id === tko_record.tenantId);
  if (!tko_tenant) throw new Error("WORKSPACE_INVITATION_TENANT_NOT_FOUND");
  await sendWorkspaceInvitationEmail({ recipientEmail: tko_email, recipientRole: tko_role, tenantName: tko_tenant.name, deliveryToken: tko_deliveryToken, expiresAt: tko_expiresAt, idempotencyKey: `tasko-workspace-invitation-${tko_record.eventId}` });
}

export function registerWorkspaceWorker(): void {
  registerOutboxConsumer("work.work_item_created.v1", tko_indexWork, "job.process");
  registerOutboxConsumer("work.work_item_updated.v1", tko_reindexWork, "job.process");
  registerOutboxConsumer("work.work_item_status_changed.v1", tko_indexWork, "job.process");
  registerOutboxConsumer("crm.lead_created.v1", tko_indexLead, "job.process");
  registerOutboxConsumer("crm.lead_updated.v1", tko_reindexLead, "job.process");
  registerOutboxConsumer("crm.deal_created.v1", tko_indexDeal, "job.process");
  registerOutboxConsumer("crm.deal_stage_changed.v1", tko_indexDeal, "job.process");
  registerOutboxConsumer("crm.deal_won.v1", tko_indexDeal, "job.process");
  registerOutboxConsumer("crm.company_created.v1", tko_indexCompany, "job.process");
  registerOutboxConsumer("crm.company_updated.v1", tko_reindexCompany, "job.process");
  registerOutboxConsumer("crm.contact_created.v1", tko_indexContact, "job.process");
  registerOutboxConsumer("crm.contact_updated.v1", tko_reindexContact, "job.process");
  registerOutboxConsumer("chat.channel_created.v1", tko_indexChannel, "job.process");
  registerOutboxConsumer("chat.message_created.v1", tko_indexMessage, "job.process");
  registerOutboxConsumer("chat.message_created.v1", tko_handleChatMentions, "job.process");
  registerOutboxConsumer("work.work_item_assigned.v1", tko_handleWorkAssignment, "job.process");
  registerOutboxConsumer("workspace.document_created.v1", tko_indexDocument, "job.process");
  registerOutboxConsumer("workspace.document_updated.v1", tko_indexDocument, "job.process");
  registerOutboxConsumer("workspace.form_submitted.v1", tko_handleFormSubmission, "job.process");
  registerOutboxConsumer("work.comment_created.v1", tko_handleCommentMention, "job.process");
  registerOutboxConsumer("work.comment_reaction_added.v1", tko_handleCommentReaction, "job.process");
  registerOutboxConsumer("workspace.invitation.issued.v1", tko_deliverWorkspaceInvitation, "job.process");
  registerOutboxConsumer("workspace.invitation.resent.v1", tko_deliverWorkspaceInvitation, "job.process");
  registerOutboxConsumer("workspace.invitation.delivery_retried.v1", tko_deliverWorkspaceInvitation, "job.process");
}
