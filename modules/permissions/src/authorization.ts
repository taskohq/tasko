import type {
  AuthorizationDecision,
  Capability,
  PlatformActor,
  TenantResource,
  TenantRole,
} from "../../../packages/contracts/src/platform";

const tko_roleCapabilities: Record<TenantRole, readonly Capability[]> = {
  owner: [
    "workspace.read", "workspace.settings.manage", "workspace.members.manage", "workspace.audit.read",
    "attachment.upload", "attachment.download", "realtime.connect", "job.enqueue",
    "work.space.read", "work.space.manage", "work.project.read", "work.project.manage", "work.item.read",
    "work.item.create", "work.item.update", "work.item.transition", "work.item.archive", "work.comment.create",
    "work.comment.moderate", "work.sprint.manage", "work.view.manage", "work.custom_field.manage",
    "chat.channel.read", "chat.channel.manage", "chat.message.read", "chat.message.send", "chat.message.edit_own",
    "chat.message.delete_own", "chat.message.moderate", "chat.reaction.toggle", "chat.read_cursor.update",
    "chat.notification.manage", "chat.saved_message.manage", "chat.search",
    "crm.read", "crm.lead.manage", "crm.lead.convert", "crm.company.manage", "crm.contact.manage",
    "crm.pipeline.manage", "crm.deal.manage", "crm.activity.manage", "crm.follow_up.create", "crm.deal.handoff",
    "workspace.search", "workspace.inbox.manage", "workspace.link.manage", "workspace.document.read", "workspace.document.manage",
    "workspace.form.read", "workspace.form.manage", "workspace.form.submit", "workspace.automation.manage",
    "saas.entitlement.read", "saas.entitlement.manage", "saas.usage.read", "saas.billing.manage", "saas.backup.manage", "saas.restore.manage", "saas.metrics.read",
    "ecosystem.import.read", "ecosystem.import.manage", "ecosystem.api_token.manage", "ecosystem.webhook.manage", "ecosystem.integration.manage",
    "ai.context.read", "ai.draft.create", "ai.action.propose", "ai.action.confirm", "mcp.connect",
  ],
  admin: [
    "workspace.read", "workspace.settings.manage", "workspace.members.manage", "workspace.audit.read",
    "attachment.upload", "attachment.download", "realtime.connect", "job.enqueue",
    "work.space.read", "work.space.manage", "work.project.read", "work.project.manage", "work.item.read",
    "work.item.create", "work.item.update", "work.item.transition", "work.item.archive", "work.comment.create",
    "work.comment.moderate", "work.sprint.manage", "work.view.manage", "work.custom_field.manage",
    "chat.channel.read", "chat.channel.manage", "chat.message.read", "chat.message.send", "chat.message.edit_own",
    "chat.message.delete_own", "chat.message.moderate", "chat.reaction.toggle", "chat.read_cursor.update",
    "chat.notification.manage", "chat.saved_message.manage", "chat.search",
    "crm.read", "crm.lead.manage", "crm.lead.convert", "crm.company.manage", "crm.contact.manage",
    "crm.pipeline.manage", "crm.deal.manage", "crm.activity.manage", "crm.follow_up.create", "crm.deal.handoff",
    "workspace.search", "workspace.inbox.manage", "workspace.link.manage", "workspace.document.read", "workspace.document.manage",
    "workspace.form.read", "workspace.form.manage", "workspace.form.submit", "workspace.automation.manage",
    "saas.entitlement.read", "saas.usage.read", "saas.billing.manage", "saas.backup.manage", "saas.restore.manage", "saas.metrics.read",
    "ecosystem.import.read", "ecosystem.import.manage", "ecosystem.api_token.manage", "ecosystem.webhook.manage", "ecosystem.integration.manage",
    "ai.context.read", "ai.draft.create", "ai.action.propose", "ai.action.confirm", "mcp.connect",
  ],
  member: [
    "workspace.read", "attachment.upload", "attachment.download", "realtime.connect",
    "work.space.read", "work.project.read", "work.item.read", "work.item.create", "work.item.update",
    "work.item.transition", "work.comment.create", "work.view.manage",
    "chat.channel.read", "chat.message.read", "chat.message.send", "chat.message.edit_own", "chat.message.delete_own",
    "chat.reaction.toggle", "chat.read_cursor.update", "chat.notification.manage", "chat.saved_message.manage", "chat.search",
    "crm.read", "crm.lead.manage", "crm.lead.convert", "crm.company.manage", "crm.contact.manage",
    "crm.deal.manage", "crm.activity.manage", "crm.follow_up.create",
    "workspace.search", "workspace.inbox.manage", "workspace.link.manage", "workspace.document.read", "workspace.document.manage",
    "workspace.form.read", "workspace.form.submit", "saas.entitlement.read", "saas.usage.read", "ecosystem.import.read",
    "ai.context.read", "ai.draft.create", "ai.action.propose", "mcp.connect",
  ],
  guest: [
    "workspace.read", "attachment.download", "realtime.connect",
    "work.space.read", "work.project.read", "work.item.read", "work.comment.create",
    "chat.channel.read", "chat.message.read", "chat.message.send", "chat.message.edit_own", "chat.message.delete_own",
    "chat.reaction.toggle", "chat.read_cursor.update", "chat.notification.manage", "chat.saved_message.manage", "chat.search",
    "workspace.search", "workspace.inbox.manage", "workspace.document.read", "workspace.form.read", "workspace.form.submit",
    "ai.context.read",
  ],
  service_account: [
    "workspace.read", "attachment.upload", "attachment.download", "job.enqueue", "job.process",
    "work.space.read", "work.space.manage", "work.project.read", "work.project.manage", "work.item.read", "work.item.create", "work.item.update", "work.item.transition",
    "chat.channel.read", "chat.channel.manage", "chat.message.read", "chat.message.send", "chat.reaction.toggle",
    "crm.read", "crm.deal.manage", "crm.activity.manage", "crm.follow_up.create", "crm.deal.handoff",
    "workspace.search", "workspace.inbox.manage", "workspace.link.manage", "workspace.document.read", "workspace.document.manage",
    "workspace.form.read", "workspace.form.manage", "workspace.form.submit", "workspace.automation.manage",
    "ecosystem.import.read", "ecosystem.import.manage", "ecosystem.webhook.manage", "ecosystem.integration.manage",
    "ai.context.read", "ai.draft.create", "ai.action.propose", "ai.action.confirm", "mcp.connect",
    "saas.entitlement.read", "saas.usage.read", "saas.backup.manage", "saas.restore.manage", "saas.metrics.read",
  ],
};

const tko_viewerRestrictedCapabilities = new Set<Capability>([
  "work.project.manage",
  "work.item.create",
  "work.item.update",
  "work.item.transition",
  "work.item.archive",
  "work.sprint.manage",
  "work.custom_field.manage",
]);

function denied(tko_reason: AuthorizationDecision["reason"]): AuthorizationDecision {
  return { allowed: false, reason: tko_reason };
}

export function can(tko_actor: PlatformActor, tko_action: Capability, tko_resource: TenantResource): AuthorizationDecision {
  if (tko_actor.membershipStatus !== "active") return denied("actor_inactive");
  if (tko_actor.tenantId !== tko_resource.tenantId) return denied("tenant_mismatch");
  if (!tko_roleCapabilities[tko_actor.role].includes(tko_action)) return denied("capability_missing");
  if (tko_resource.visibility === "private") {
    const tko_explicitMembers = tko_resource.explicitMemberIds ?? [];
    const tko_privateManagementOverride = tko_action === "work.project.manage" && (tko_actor.role === "owner" || tko_actor.role === "admin");
    if (!tko_explicitMembers.includes(tko_actor.memberId) && tko_actor.role !== "owner" && !tko_privateManagementOverride) return denied("private_resource");
  }
  if (tko_actor.role === "guest") {
    const tko_granted = tko_resource.visibility === "guest_shared" || (tko_resource.explicitMemberIds ?? []).includes(tko_actor.memberId);
    if (!tko_granted) return denied("guest_scope_missing");
  }
  if (tko_resource.projectMemberRole === "viewer" && tko_actor.role !== "owner" && tko_actor.role !== "admin" && tko_viewerRestrictedCapabilities.has(tko_action)) {
    return denied("project_role_read_only");
  }
  return { allowed: true, reason: "allowed" };
}

export function requireCapability(tko_actor: PlatformActor, tko_action: Capability, tko_resource: TenantResource): void {
  const tko_decision = can(tko_actor, tko_action, tko_resource);
  if (!tko_decision.allowed) throw new Error(`TASKO_AUTHORIZATION_DENIED:${tko_decision.reason}`);
}
