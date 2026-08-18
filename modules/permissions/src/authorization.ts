import type {
  AuthorizationDecision,
  Capability,
  PlatformActor,
  TenantResource,
  TenantRole,
} from "../../../packages/contracts/src/platform";

const tko_roleCapabilities: Record<TenantRole, readonly Capability[]> = {
  owner: [
    "workspace.read",
    "workspace.settings.manage",
    "workspace.members.manage",
    "workspace.audit.read",
    "attachment.upload",
    "attachment.download",
    "realtime.connect",
    "job.enqueue",
  ],
  admin: [
    "workspace.read",
    "workspace.settings.manage",
    "workspace.members.manage",
    "workspace.audit.read",
    "attachment.upload",
    "attachment.download",
    "realtime.connect",
    "job.enqueue",
  ],
  member: ["workspace.read", "attachment.upload", "attachment.download", "realtime.connect"],
  guest: ["workspace.read", "attachment.download", "realtime.connect"],
  service_account: ["workspace.read", "attachment.upload", "attachment.download", "job.enqueue", "job.process"],
};

function denied(tko_reason: AuthorizationDecision["reason"]): AuthorizationDecision {
  return { allowed: false, reason: tko_reason };
}

export function can(
  tko_actor: PlatformActor,
  tko_action: Capability,
  tko_resource: TenantResource,
): AuthorizationDecision {
  if (tko_actor.membershipStatus !== "active") return denied("actor_inactive");
  if (tko_actor.tenantId !== tko_resource.tenantId) return denied("tenant_mismatch");

  const tko_capabilities = tko_roleCapabilities[tko_actor.role];
  if (!tko_capabilities.includes(tko_action)) return denied("capability_missing");

  if (tko_resource.visibility === "private") {
    const tko_explicitMembers = tko_resource.explicitMemberIds ?? [];
    if (!tko_explicitMembers.includes(tko_actor.memberId) && tko_actor.role !== "owner") {
      return denied("private_resource");
    }
  }

  if (tko_actor.role === "guest") {
    const tko_granted = tko_resource.visibility === "guest_shared" ||
      (tko_resource.explicitMemberIds ?? []).includes(tko_actor.memberId);
    if (!tko_granted) return denied("guest_scope_missing");
  }

  return { allowed: true, reason: "allowed" };
}

export function requireCapability(
  tko_actor: PlatformActor,
  tko_action: Capability,
  tko_resource: TenantResource,
): void {
  const tko_decision = can(tko_actor, tko_action, tko_resource);
  if (!tko_decision.allowed) {
    throw new Error(`TASKO_AUTHORIZATION_DENIED:${tko_decision.reason}`);
  }
}
