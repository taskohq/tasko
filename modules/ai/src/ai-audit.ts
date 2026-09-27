import type { PlatformActor } from "../../../packages/contracts/src/platform";
import { recordAuditedEvent } from "../../audit/src/audit-service";

// Durable audit wiring for the AI module (spec 15 §6/§8): every tool execution, denial and
// proposal lifecycle transition lands in the standard outbox+audit pattern through
// recordAuditedEvent. Metadata is deliberately minimal (tool name, outcome, entity refs,
// proposal id, reason) and reuses the audit service key redaction plus a value redactor so
// prompts, tokens and credentials never reach the audit trail.

export type AIToolAuditOutcome = "executed" | "denied" | "failed";
export type AIProposalAuditOutcome = "confirmed" | "expired" | "executed" | "execute_failed" | "denied";

const tko_entityRefKeys = ["projectId", "channelId", "workItemId", "targetStatusId", "dealId", "stageId"] as const;
const tko_redactValue = (tko_value: string): string => tko_value.replace(/\b(?:api[_ -]?key|secret|password|authorization|bearer|token)\b\s*[:=]\s*[^\s,;]+/gi, "[redacted]").slice(0, 200);

function tko_collectEntityRefs(tko_input: Record<string, unknown> | undefined): Record<string, string> {
  const tko_refs: Record<string, string> = {};
  if (!tko_input) return tko_refs;
  for (const tko_key of tko_entityRefKeys) {
    const tko_value = tko_input[tko_key];
    if (typeof tko_value === "string" && tko_value.trim()) tko_refs[tko_key] = tko_redactValue(tko_value.trim());
  }
  return tko_refs;
}

export async function recordAIToolAudit(tko_input: {
  actor: PlatformActor;
  toolName: string;
  outcome: AIToolAuditOutcome;
  correlationId: string;
  proposalId?: string | null;
  input?: Record<string, unknown>;
  reason?: string | null;
}): Promise<void> {
  const tko_entityRefs = tko_collectEntityRefs(tko_input.input);
  const tko_reason = tko_input.reason ? tko_redactValue(tko_input.reason) : null;
  const tko_metadata: Record<string, unknown> = {
    toolName: tko_input.toolName,
    outcome: tko_input.outcome,
    proposalId: tko_input.proposalId ?? null,
    actorMemberId: tko_input.actor.memberId,
    entityRefs: tko_entityRefs,
    reason: tko_reason,
  };
  await recordAuditedEvent({
    actor: tko_input.actor,
    tenantId: tko_input.actor.tenantId,
    eventType: `ai.tool_${tko_input.outcome}.v1`,
    topic: "ai",
    payload: { toolName: tko_input.toolName, outcome: tko_input.outcome, proposalId: tko_input.proposalId ?? null, entityRefs: tko_entityRefs, reason: tko_reason },
    action: `ai.tool.${tko_input.outcome}`,
    resourceType: "ai_tool",
    resourceId: tko_input.toolName,
    correlationId: tko_input.correlationId,
    metadata: tko_metadata,
  });
}

export async function recordAIProposalAudit(tko_input: {
  actor: PlatformActor;
  outcome: AIProposalAuditOutcome;
  proposalId: string | null;
  toolName: string | null;
  correlationId: string;
  reason?: string | null;
}): Promise<void> {
  const tko_reason = tko_input.reason ? tko_redactValue(tko_input.reason) : null;
  const tko_metadata: Record<string, unknown> = {
    toolName: tko_input.toolName,
    outcome: tko_input.outcome,
    proposalId: tko_input.proposalId,
    actorMemberId: tko_input.actor.memberId,
    reason: tko_reason,
  };
  await recordAuditedEvent({
    actor: tko_input.actor,
    tenantId: tko_input.actor.tenantId,
    eventType: "ai.proposal_lifecycle.v1",
    topic: "ai",
    payload: { proposalId: tko_input.proposalId, toolName: tko_input.toolName, outcome: tko_input.outcome, reason: tko_reason },
    action: `ai.proposal.${tko_input.outcome}`,
    resourceType: "ai_tool_proposal",
    resourceId: tko_input.proposalId ?? "unknown",
    correlationId: tko_input.correlationId,
    metadata: tko_metadata,
  });
}
