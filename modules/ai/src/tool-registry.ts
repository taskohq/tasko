import type { AIToolDefinition, AIToolName } from "../../../packages/contracts/src/ai";
import type { PlatformActor } from "../../../packages/contracts/src/platform";
import { requireCapability } from "../../permissions/src/authorization";
import { recordAIToolAudit } from "./ai-audit";
import * as chatService from "../../chat/src/chat-service";
import * as crmService from "../../crm/src/crm-service";
import * as workService from "../../work/src/work-service";
import { resolveContext } from "./context-resolver";

export interface AIToolExecutionContext { proposalId?: string | null }
export interface AITool extends AIToolDefinition { execute(actor: PlatformActor, input: Record<string, unknown>, correlationId: string, context?: AIToolExecutionContext): Promise<Record<string, unknown>>; }
const tko_text = (tko_value: unknown, tko_name: string, tko_max = 4_000): string => { if (typeof tko_value !== "string" || !tko_value.trim()) throw new Error(`AI_TOOL_${tko_name}_REQUIRED`); return tko_value.trim().slice(0, tko_max); };
const tko_array = (tko_value: unknown): Array<{ kind: "work_item" | "project" | "channel" | "message" | "lead" | "deal" | "document" | "form"; id: string }> => Array.isArray(tko_value) ? tko_value.filter((tko_item): tko_item is { kind: "work_item" | "project" | "channel" | "message" | "lead" | "deal" | "document" | "form"; id: string } => typeof tko_item === "object" && tko_item !== null && typeof (tko_item as { kind?: unknown }).kind === "string" && typeof (tko_item as { id?: unknown }).id === "string") : [];

// Wrapper around every registered handler: capability check first, then the durable audit trail
// (ai.tool.executed / ai.tool.denied / ai.tool.failed) via recordAuditedEvent. Audit writes never
// mask the original outcome: a failed audit row after a successful action is best-effort, and a
// failed audit row on the error path still rethrows the original error.
function tko_tool(tko_definition: AIToolDefinition, tko_execute: AITool["execute"]): AITool {
  return {
    ...tko_definition,
    execute: async (tko_actor, tko_input, tko_correlationId, tko_context) => {
      try {
        requireCapability(tko_actor, tko_definition.capability, { tenantId: tko_actor.tenantId, type: "ai_tool", id: tko_definition.name, visibility: "internal" });
        const tko_result = await tko_execute(tko_actor, tko_input, tko_correlationId);
        try { await recordAIToolAudit({ actor: tko_actor, toolName: tko_definition.name, outcome: "executed", correlationId: tko_correlationId, proposalId: tko_context?.proposalId ?? null, input: tko_input }); } catch { /* business action already durably recorded by the owning service; never fail a completed execution because of the audit append */ }
        return tko_result;
      } catch (tko_error) {
        const tko_message = tko_error instanceof Error ? tko_error.message : "AI_TOOL_FAILED";
        const tko_outcome = tko_message.startsWith("TASKO_AUTHORIZATION_DENIED") ? "denied" : "failed";
        try { await recordAIToolAudit({ actor: tko_actor, toolName: tko_definition.name, outcome: tko_outcome, correlationId: tko_correlationId, proposalId: tko_context?.proposalId ?? null, input: tko_input, reason: tko_message.slice(0, 300) }); } catch { /* rethrow the original error below */ }
        throw tko_error;
      }
    },
  };
}

const tko_tools: AITool[] = [
  tko_tool({ name: "context.read", risk: "read", capability: "ai.context.read", requiresConfirmation: false, idempotent: true, description: "Resolve only entities that the current Tasko identity can read." }, async (tko_actor, tko_input) => ({ context: await resolveContext(tko_actor, tko_array(tko_input.entityRefs), typeof tko_input.intent === "string" ? tko_input.intent : "context" ) })),
  tko_tool({ name: "work_item.draft", risk: "draft", capability: "ai.draft.create", requiresConfirmation: false, idempotent: true, description: "Prepare a non-persistent Work item draft." }, async (_tko_actor, tko_input) => ({ draft: { projectId: tko_text(tko_input.projectId, "PROJECT_ID", 80), title: tko_text(tko_input.title, "TITLE", 240), description: typeof tko_input.description === "string" ? tko_input.description.slice(0, 8_000) : "" } })),
  tko_tool({ name: "document.draft", risk: "draft", capability: "ai.draft.create", requiresConfirmation: false, idempotent: true, description: "Prepare a non-persistent document draft." }, async (_tko_actor, tko_input) => ({ draft: { title: tko_text(tko_input.title, "TITLE", 240), body: tko_text(tko_input.body, "BODY", 12_000) } })),
  tko_tool({ name: "work_item.create", risk: "write", capability: "ai.action.propose", requiresConfirmation: true, idempotent: true, description: "Create a Work item only after the proposed action is explicitly confirmed.", inputFields: [ { name: "projectId", label: "Project ID", type: "uuid", required: true }, { name: "title", label: "Title", type: "string", required: true, placeholder: "Ship release notes" }, { name: "description", label: "Description", type: "text", required: false } ] }, async (tko_actor, tko_input, tko_correlationId) => { const tko_item = await workService.createWorkItem({ actor: tko_actor, projectId: tko_text(tko_input.projectId, "PROJECT_ID", 80), title: tko_text(tko_input.title, "TITLE", 240), description: typeof tko_input.description === "string" ? tko_input.description.slice(0, 8_000) : undefined, correlationId: tko_correlationId }); return { workItemId: tko_item.id, key: tko_item.key, title: tko_item.title }; }),
  tko_tool({ name: "chat.message.send", risk: "write", capability: "ai.action.propose", requiresConfirmation: true, idempotent: true, description: "Send a Tasko chat message only after the proposed action is explicitly confirmed.", inputFields: [ { name: "channelId", label: "Channel ID", type: "uuid", required: true }, { name: "text", label: "Message text", type: "text", required: true } ] }, async (tko_actor, tko_input, tko_correlationId) => { const tko_message = await chatService.sendMessage(tko_actor, { channelId: tko_text(tko_input.channelId, "CHANNEL_ID", 80), body: { type: "text", text: tko_text(tko_input.text, "TEXT", 8_000), mentions: [] }, clientMessageId: tko_text(tko_input.idempotencyKey, "IDEMPOTENCY_KEY", 180) }, tko_correlationId); return { messageId: tko_message.id, channelId: tko_message.channelId }; }),
  tko_tool({ name: "work.transition_status", risk: "write", capability: "ai.action.propose", requiresConfirmation: true, idempotent: true, description: "Transition a Work item to a target status only after the proposed action is explicitly confirmed.", inputFields: [ { name: "workItemId", label: "Work item ID", type: "uuid", required: true }, { name: "targetStatusId", label: "Target status ID", type: "uuid", required: true }, { name: "expectedVersion", label: "Expected item version", type: "number", required: true } ] }, async (tko_actor, tko_input, tko_correlationId) => { const tko_expectedVersion = Number(tko_input.expectedVersion); if (!Number.isInteger(tko_expectedVersion) || tko_expectedVersion <= 0) throw new Error("AI_TOOL_EXPECTED_VERSION_INVALID"); const tko_item = await workService.transitionWorkItem({ actor: tko_actor, workItemId: tko_text(tko_input.workItemId, "WORK_ITEM_ID", 80), targetStatusId: tko_text(tko_input.targetStatusId, "TARGET_STATUS_ID", 80), expectedVersion: tko_expectedVersion, correlationId: tko_correlationId }); return { workItemId: tko_item.id, statusId: tko_item.statusId, version: tko_item.version }; }),
  tko_tool({ name: "crm.update_deal_stage", risk: "write", capability: "ai.action.propose", requiresConfirmation: true, idempotent: true, description: "Move a CRM deal to a new pipeline stage (sensitive write) only after the proposed action is explicitly confirmed.", inputFields: [ { name: "dealId", label: "Deal ID", type: "uuid", required: true }, { name: "stageId", label: "Target stage ID", type: "uuid", required: true }, { name: "note", label: "Note (optional)", type: "text", required: false } ] }, async (tko_actor, tko_input, tko_correlationId) => { const tko_deal = await crmService.moveDeal(tko_actor, { dealId: tko_text(tko_input.dealId, "DEAL_ID", 80), stageId: tko_text(tko_input.stageId, "STAGE_ID", 80), correlationId: tko_correlationId }); const tko_note = typeof tko_input.note === "string" ? tko_input.note.trim().slice(0, 1_000) : ""; if (tko_note) await crmService.addActivity(tko_actor, { entityType: "deal", entityId: tko_deal.id, activityType: "note", subject: "AI operator note", body: tko_note, correlationId: tko_correlationId }); return { dealId: tko_deal.id, stageId: tko_deal.stageId, pipelineId: tko_deal.pipelineId }; }),
];

export function listAITools(): AIToolDefinition[] { return tko_tools.map(({ execute: _tko_execute, ...tko_definition }) => tko_definition); }
export function getAITool(tko_name: AIToolName): AITool { const tko_toolEntry = tko_tools.find(tko_toolItem => tko_toolItem.name === tko_name); if (!tko_toolEntry) throw new Error("AI_TOOL_NOT_FOUND"); return tko_toolEntry; }
