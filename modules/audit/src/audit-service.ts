import type { DurableMutationInput, OutboxRecord, PlatformActor } from "../../../packages/contracts/src/platform";
import { getPlatformStore } from "../../../packages/database/src/platform-store";

function redactMetadata(tko_metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(tko_metadata).map(([tko_key, tko_value]) => {
      const tko_isSecret = /password|secret|token|authorization/i.test(tko_key);
      return [tko_key, tko_isSecret ? "[REDACTED]" : tko_value];
    }),
  );
}

export async function recordAuditedEvent(tko_input: {
  actor: PlatformActor | null;
  tenantId: string;
  eventType: string;
  topic: string;
  payload: Record<string, unknown>;
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}): Promise<OutboxRecord> {
  const tko_mutation: DurableMutationInput = {
    actor: tko_input.actor,
    tenantId: tko_input.tenantId,
    eventType: tko_input.eventType,
    topic: tko_input.topic,
    payload: tko_input.payload,
    auditAction: tko_input.action,
    resourceType: tko_input.resourceType,
    resourceId: tko_input.resourceId,
    auditMetadata: redactMetadata(tko_input.metadata ?? {}),
    correlationId: tko_input.correlationId,
  };
  return getPlatformStore().writeDurableMutation(tko_mutation);
}
