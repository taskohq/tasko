import type { OutboxRecord, PlatformActor } from "../../../packages/contracts/src/platform";
import { recordAuditedEvent } from "../../audit/src/audit-service";

export async function enqueueDurableEvent(tko_input: {
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
  return recordAuditedEvent(tko_input);
}
