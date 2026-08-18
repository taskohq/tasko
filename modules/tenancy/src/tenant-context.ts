import { tko_config } from "../../../packages/config/src/tasko-config";
import type { PlatformActor, TenantMembership } from "../../../packages/contracts/src/platform";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { createCorrelationId } from "../../../packages/observability/src/logger";

export interface TenantRequestContext {
  actor: PlatformActor;
  membership: TenantMembership;
}

export async function resolveTenantRequestContext(tko_input: {
  authSubject: string;
  candidateTenantSlug?: string | null;
  correlationId?: string;
}): Promise<TenantRequestContext | null> {
  const tko_store = getPlatformStore();
  const tko_memberships = await tko_store.listMemberships(tko_input.authSubject);
  const tko_requestedSlug =
    tko_config.deploymentProfile === "single_tenant"
      ? tko_config.singleTenantSlug
      : tko_input.candidateTenantSlug?.trim() || tko_memberships[0]?.tenant.slug;

  if (!tko_requestedSlug) return null;

  // The browser-provided slug is only a membership-filtered candidate. It is never a tenant authority.
  const tko_membership = tko_memberships.find(
    tko_item => tko_item.tenant.slug === tko_requestedSlug && tko_item.status === "active",
  );
  if (!tko_membership) return null;

  return {
    membership: tko_membership,
    actor: {
      authSubject: tko_input.authSubject,
      tenantId: tko_membership.tenant.id,
      tenantSlug: tko_membership.tenant.slug,
      memberId: tko_membership.id,
      role: tko_membership.role,
      membershipStatus: tko_membership.status,
      correlationId: createCorrelationId(tko_input.correlationId),
    },
  };
}
