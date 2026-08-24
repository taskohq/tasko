import type { PlatformActor, TenantMembership } from "../../../packages/contracts/src/platform";
import { tko_config } from "../../../packages/config/src/tasko-config";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { createCorrelationId } from "../../../packages/observability/src/logger";

export interface TenantRequestContext {
  actor: PlatformActor;
  membership: TenantMembership;
}

export function createPlatformActor(
  tko_membership: TenantMembership,
  tko_correlationId?: string,
): PlatformActor {
  return {
    authSubject: tko_membership.authSubject,
    tenantId: tko_membership.tenant.id,
    tenantSlug: tko_membership.tenant.slug,
    memberId: tko_membership.id,
    role: tko_membership.role,
    membershipStatus: tko_membership.status,
    correlationId: createCorrelationId(tko_correlationId),
  };
}

export async function resolveTenantRequestContext(tko_input: {
  authSubject: string;
  candidateTenantSlug?: string | null;
  correlationId?: string;
}): Promise<TenantRequestContext | null> {
  const tko_store = getPlatformStore();
  let tko_memberships = await tko_store.listMemberships(tko_input.authSubject);
  const tko_isLocalEmailPrincipal = tko_input.authSubject.startsWith("email:");
  const tko_requestedSlug =
    tko_config.deploymentProfile === "single_tenant" && !tko_isLocalEmailPrincipal
      ? tko_config.singleTenantSlug
      : tko_input.candidateTenantSlug?.trim() || tko_memberships[0]?.tenant.slug;

  if (!tko_requestedSlug) return null;

  // A fresh single-tenant PostgreSQL store has no membership rows. Bootstrap only
  // the configured owner; every other account must be invited explicitly.
  const tko_existingTenant = (await tko_store.listTenants()).some(tko_tenant => tko_tenant.slug === tko_requestedSlug);
  const tko_isConfiguredOwner = tko_input.authSubject === tko_config.ownerAuthSubject;
  const tko_canBootstrapFirstWorkspace = !tko_existingTenant && !tko_config.isProduction;

  if (
    tko_config.deploymentProfile === "single_tenant" &&
    !tko_memberships.some(tko_item => tko_item.tenant.slug === tko_requestedSlug) &&
    (tko_isConfiguredOwner || tko_canBootstrapFirstWorkspace)
  ) {
    await tko_store.seedDemoWorkspace({
      ownerAuthSubject: tko_input.authSubject,
      tenantSlug: tko_requestedSlug,
      tenantName: "Tasko workspace",
    });
    tko_memberships = await tko_store.listMemberships(tko_input.authSubject);
  }

  // The browser-provided slug is only a membership-filtered candidate. It is never a tenant authority.
  const tko_membership = tko_memberships.find(
    tko_item => tko_item.tenant.slug === tko_requestedSlug && tko_item.status === "active",
  );
  if (!tko_membership) return null;

  return {
    membership: tko_membership,
    actor: createPlatformActor(tko_membership, tko_input.correlationId),
  };
}

export async function resolveWorkerServiceActor(tko_input: {
  tenantId: string;
  correlationId: string;
}): Promise<PlatformActor | null> {
  const tko_memberships = await getPlatformStore().listMemberships(tko_config.workerServiceAuthSubject);
  const tko_membership = tko_memberships.find(
    tko_item =>
      tko_item.tenant.id === tko_input.tenantId &&
      tko_item.role === "service_account" &&
      tko_item.status === "active",
  );
  return tko_membership ? createPlatformActor(tko_membership, tko_input.correlationId) : null;
}
