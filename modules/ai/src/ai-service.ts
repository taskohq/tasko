import crypto from "node:crypto";
import type { AIContextKind, AIRun, AIToolName, AIToolProposal } from "../../../packages/contracts/src/ai";
import type { PlatformActor } from "../../../packages/contracts/src/platform";
import { getAIStore } from "../../../packages/database/src/ai-store";
import { invokeLLM } from "../../../server/_core/llm";
import { requireCapability } from "../../permissions/src/authorization";
import { recordAIProposalAudit, type AIProposalAuditOutcome } from "./ai-audit";
import { resolveContext, type ResolvedAIContext } from "./context-resolver";
import { getAITool } from "./tool-registry";

const tko_prompt = (tko_value: string): string => tko_value.replace(/\b(?:api[_ -]?key|secret|password|authorization|bearer|token)\b\s*[:=]\s*[^\s,;]+/gi, "[redacted]").trim().slice(0, 8_000);
const tko_safeValue = (tko_value: unknown): unknown => Array.isArray(tko_value) ? tko_value.map(tko_safeValue) : typeof tko_value === "object" && tko_value !== null ? Object.fromEntries(Object.entries(tko_value).map(([tko_key, tko_child]) => [tko_key, /(?:secret|password|authorization|token|api.?key)/i.test(tko_key) ? "[redacted]" : tko_safeValue(tko_child)])) : typeof tko_value === "string" ? tko_prompt(tko_value) : tko_value;
const tko_correlation = (tko_prefix: string, tko_value?: string) => tko_value?.trim() || `${tko_prefix}:${crypto.randomUUID()}`;
const tko_output = (tko_result: Awaited<ReturnType<typeof invokeLLM>>): string => { const tko_content = tko_result.choices[0]?.message.content; return typeof tko_content === "string" ? tko_content : Array.isArray(tko_content) ? tko_content.filter(tko_part => tko_part.type === "text").map(tko_part => tko_part.text).join("\n") : ""; };

export interface AIRunResponse { run: AIRun; context: ResolvedAIContext; citations: Awaited<ReturnType<typeof getAIStore>> extends never ? never : Array<{ kind: AIContextKind; id: string; label: string; locator: string }>; }

async function tko_recordContext(tko_actor: PlatformActor, tko_run: AIRun, tko_context: ResolvedAIContext, tko_correlationId: string): Promise<void> { await getAIStore().saveContextReferences(tko_actor, { runId: tko_run.id, references: tko_context.citations.map(tko_citation => ({ resourceKind: tko_citation.kind, resourceId: tko_citation.id, label: tko_citation.label, locator: tko_citation.locator })), correlationId: tko_correlationId }); }
function tko_systemPrompt(tko_mode: "read" | "draft", tko_context: ResolvedAIContext): string { return `You are Tasko's authorized operational assistant. ${tko_mode === "read" ? "Answer only from the provided authorized context." : "Create a proposal/draft only; do not claim any action was executed."} Do not request, disclose, infer, or include credentials, tokens, secrets, passwords, or private data outside the authorized context. Cite source labels in square brackets. Authorized context JSON:\n${JSON.stringify(tko_context)}`; }

async function tko_runLLM(tko_actor: PlatformActor, tko_mode: "read" | "draft", tko_input: { prompt: string; context: Array<{ kind: AIContextKind; id: string }>; correlationId?: string }): Promise<AIRunResponse> {
  const tko_capability = tko_mode === "read" ? "ai.context.read" : "ai.draft.create";
  requireCapability(tko_actor, tko_capability, { tenantId: tko_actor.tenantId, type: "ai_run", id: "new", visibility: "internal" });
  const tko_correlationId = tko_correlation(`tko_ai_${tko_mode}`, tko_input.correlationId);
  const tko_safePrompt = tko_prompt(tko_input.prompt);
  if (!tko_safePrompt) throw new Error("AI_PROMPT_REQUIRED");
  const tko_run = await getAIStore().createRun({ actor: tko_actor, mode: tko_mode, prompt: tko_safePrompt, context: tko_input.context, correlationId: tko_correlationId });
  try {
    const tko_context = await resolveContext(tko_actor, tko_input.context, tko_safePrompt);
    await tko_recordContext(tko_actor, tko_run, tko_context, tko_correlationId);
    const tko_model = tko_mode === "read" ? "gpt-5-mini" : "gpt-5-mini";
    const tko_result = await invokeLLM({ model: tko_model, maxTokens: 2_000, messages: [{ role: "system", content: tko_systemPrompt(tko_mode, tko_context) }, { role: "user", content: tko_safePrompt }] });
    const tko_completed = await getAIStore().completeRun(tko_actor, { runId: tko_run.id, status: "completed", output: tko_output(tko_result), model: tko_result.model || tko_model, inputTokens: tko_result.usage?.prompt_tokens ?? null, outputTokens: tko_result.usage?.completion_tokens ?? null, costMicros: null, correlationId: tko_correlationId });
    return { run: tko_completed, context: tko_context, citations: tko_context.citations };
  } catch (tko_error) {
    await getAIStore().completeRun(tko_actor, { runId: tko_run.id, status: "failed", error: tko_error instanceof Error ? tko_error.message.slice(0, 500) : "AI_RUN_FAILED", correlationId: tko_correlationId });
    throw tko_error;
  }
}

export function runRead(tko_actor: PlatformActor, tko_input: { prompt: string; context: Array<{ kind: AIContextKind; id: string }>; correlationId?: string }): Promise<AIRunResponse> { return tko_runLLM(tko_actor, "read", tko_input); }
export function runDraft(tko_actor: PlatformActor, tko_input: { prompt: string; context: Array<{ kind: AIContextKind; id: string }>; correlationId?: string }): Promise<AIRunResponse> { return tko_runLLM(tko_actor, "draft", tko_input); }

// Per-tool preview payload: enough surface for a human diff/preview before confirming, never the
// raw input blob (secret keys were already redacted into tko_safeInput by tko_safeValue).
function tko_previewFor(tko_toolName: AIToolName, tko_input: Record<string, unknown>): Record<string, unknown> {
  const tko_str = (tko_key: string, tko_max = 240): string => typeof tko_input[tko_key] === "string" ? (tko_input[tko_key] as string).slice(0, tko_max) : "";
  const tko_num = (tko_key: string): number | null => typeof tko_input[tko_key] === "number" ? tko_input[tko_key] : null;
  if (tko_toolName === "work_item.create") return { title: tko_str("title"), projectId: tko_str("projectId", 80), description: tko_str("description", 2_000) };
  if (tko_toolName === "chat.message.send") return { channelId: tko_str("channelId", 80), text: tko_str("text", 2_000) };
  if (tko_toolName === "work.transition_status") return { workItemId: tko_str("workItemId", 80), targetStatusId: tko_str("targetStatusId", 80), expectedVersion: tko_num("expectedVersion") };
  if (tko_toolName === "crm.update_deal_stage") return { dealId: tko_str("dealId", 80), stageId: tko_str("stageId", 80), note: tko_str("note", 500) };
  return {};
}

async function tko_auditProposal(tko_actor: PlatformActor, tko_outcome: AIProposalAuditOutcome, tko_proposalId: string | null, tko_toolName: string | null, tko_correlationId: string, tko_reason?: string | null): Promise<void> {
  await recordAIProposalAudit({ actor: tko_actor, outcome: tko_outcome, proposalId: tko_proposalId, toolName: tko_toolName, correlationId: tko_correlationId, reason: tko_reason ?? null });
}

export async function proposeAction(tko_actor: PlatformActor, tko_input: { toolName: AIToolName; input: Record<string, unknown>; idempotencyKey?: string; correlationId?: string }): Promise<AIToolProposal> {
  const tko_correlationId = tko_correlation("tko_ai_proposal", tko_input.correlationId);
  try { requireCapability(tko_actor, "ai.action.propose", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: "new", visibility: "internal" }); } catch (tko_error) { await tko_auditProposal(tko_actor, "denied", null, tko_input.toolName, tko_correlationId, tko_error instanceof Error ? tko_error.message : "TASKO_AUTHORIZATION_DENIED"); throw tko_error; }
  const tko_tool = getAITool(tko_input.toolName);
  if (!tko_tool.requiresConfirmation || tko_tool.risk !== "write") { await tko_auditProposal(tko_actor, "denied", null, tko_tool.name, tko_correlationId, "AI_TOOL_DOES_NOT_REQUIRE_PROPOSAL"); throw new Error("AI_TOOL_DOES_NOT_REQUIRE_PROPOSAL"); }
  const tko_safeInput = tko_safeValue(tko_input.input) as Record<string, unknown>;
  const tko_run = await getAIStore().createRun({ actor: tko_actor, mode: "proposal", prompt: `Proposed action: ${tko_tool.name}`, context: [], correlationId: tko_correlationId });
  const tko_preview = tko_previewFor(tko_tool.name, tko_safeInput);
  const tko_proposal = await getAIStore().createProposal({ actor: tko_actor, runId: tko_run.id, toolName: tko_tool.name, risk: tko_tool.risk, input: tko_safeInput, preview: tko_preview, idempotencyKey: tko_input.idempotencyKey?.trim() || `ai:${tko_tool.name}:${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 15 * 60_000), correlationId: tko_correlationId });
  await getAIStore().completeRun(tko_actor, { runId: tko_run.id, status: "completed", output: `Proposal ${tko_proposal.id} awaiting explicit confirmation.`, correlationId: tko_correlationId });
  return tko_proposal;
}

export async function confirmProposal(tko_actor: PlatformActor, tko_input: { proposalId: string; correlationId?: string }): Promise<AIToolProposal> {
  const tko_correlationId = tko_correlation("tko_ai_confirm", tko_input.correlationId);
  try { requireCapability(tko_actor, "ai.action.confirm", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: tko_input.proposalId, visibility: "internal" }); } catch (tko_error) { await tko_auditProposal(tko_actor, "denied", tko_input.proposalId, null, tko_correlationId, tko_error instanceof Error ? tko_error.message : "TASKO_AUTHORIZATION_DENIED"); throw tko_error; }
  const tko_proposal = await getAIStore().getProposal(tko_actor.tenantId, tko_input.proposalId);
  if (!tko_proposal) { await tko_auditProposal(tko_actor, "denied", tko_input.proposalId, null, tko_correlationId, "AI_PROPOSAL_NOT_FOUND"); throw new Error("AI_PROPOSAL_NOT_FOUND"); }
  if (tko_proposal.expiresAt.getTime() <= Date.now()) { const tko_expired = await getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "expired", correlationId: tko_correlationId }); await tko_auditProposal(tko_actor, "expired", tko_proposal.id, tko_proposal.toolName, tko_correlationId); return tko_expired; }
  const tko_confirmed = await getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "confirmed", correlationId: tko_correlationId });
  await tko_auditProposal(tko_actor, "confirmed", tko_proposal.id, tko_proposal.toolName, tko_correlationId);
  return tko_confirmed;
}

export async function executeConfirmedProposal(tko_actor: PlatformActor, tko_input: { proposalId: string; correlationId?: string }): Promise<{ proposal: AIToolProposal; result: Record<string, unknown> }> {
  const tko_correlationId = tko_correlation("tko_ai_execute", tko_input.correlationId);
  try { requireCapability(tko_actor, "ai.action.confirm", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: tko_input.proposalId, visibility: "internal" }); } catch (tko_error) { await tko_auditProposal(tko_actor, "denied", tko_input.proposalId, null, tko_correlationId, tko_error instanceof Error ? tko_error.message : "TASKO_AUTHORIZATION_DENIED"); throw tko_error; }
  const tko_proposal = await getAIStore().getProposal(tko_actor.tenantId, tko_input.proposalId);
  if (!tko_proposal) { await tko_auditProposal(tko_actor, "denied", tko_input.proposalId, null, tko_correlationId, "AI_PROPOSAL_NOT_FOUND"); throw new Error("AI_PROPOSAL_NOT_FOUND"); }
  if (tko_proposal.status === "executed") return { proposal: tko_proposal, result: { alreadyExecuted: true } };
  if (tko_proposal.status !== "confirmed" || tko_proposal.expiresAt.getTime() <= Date.now()) { await tko_auditProposal(tko_actor, "denied", tko_proposal.id, tko_proposal.toolName, tko_correlationId, "AI_PROPOSAL_NOT_EXECUTABLE"); throw new Error("AI_PROPOSAL_NOT_EXECUTABLE"); }
  try {
    const tko_result = await getAITool(tko_proposal.toolName).execute(tko_actor, { ...tko_proposal.input, idempotencyKey: tko_proposal.idempotencyKey }, tko_correlationId, { proposalId: tko_proposal.id });
    const tko_executed = await getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "executed", correlationId: tko_correlationId });
    await tko_auditProposal(tko_actor, "executed", tko_proposal.id, tko_proposal.toolName, tko_correlationId);
    return { proposal: tko_executed, result: tko_result };
  } catch (tko_error) {
    await getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "failed", correlationId: tko_correlationId });
    await tko_auditProposal(tko_actor, "execute_failed", tko_proposal.id, tko_proposal.toolName, tko_correlationId, tko_error instanceof Error ? tko_error.message : "AI_TOOL_FAILED");
    throw tko_error;
  }
}

export async function listRuns(tko_actor: PlatformActor): Promise<AIRun[]> { requireCapability(tko_actor, "ai.context.read", { tenantId: tko_actor.tenantId, type: "ai_run", id: "list", visibility: "internal" }); return getAIStore().listRuns(tko_actor.tenantId); }
export async function listProposals(tko_actor: PlatformActor): Promise<AIToolProposal[]> { requireCapability(tko_actor, "ai.action.propose", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: "list", visibility: "internal" }); return getAIStore().listProposals(tko_actor.tenantId); }
