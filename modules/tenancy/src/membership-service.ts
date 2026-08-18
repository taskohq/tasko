import type { PlatformActor, TenantRole } from "../../../packages/contracts/src/platform";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { requireCapability } from "../../permissions/src/authorization";

export async function changeMemberRole(tko_input: {
  actor: PlatformActor;
  memberId: string;
  newRole: Exclude<TenantRole, "service_account">;
  correlationId: string;
}): Promise<void> {
  requireCapability(tko_input.actor, "workspace.members.manage", {
    tenantId: tko_input.actor.tenantId,
    type: "tenant_member",
    id: tko_input.memberId,
    visibility: "internal",
  });
  await getPlatformStore().changeTenantMemberRole({
    actor: tko_input.actor,
    tenantId: tko_input.actor.tenantId,
    memberId: tko_input.memberId,
    newRole: tko_input.newRole,
    correlationId: tko_input.correlationId,
  });
}
