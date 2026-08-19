import crypto from "node:crypto";
import type { AIContextKind, AIRun, AIToolName, AIToolProposal } from "../../../packages/contracts/src/ai";
import type { PlatformActor } from "../../../packages/contracts/src/platform";
import { getAIStore } from "../../../packages/database/src/ai-store";
import { invokeLLM } from "../../../server/_core/llm";
import { requireCapability } from "../../permissions/src/authorization";
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

export async function proposeAction(tko_actor: PlatformActor, tko_input: { toolName: AIToolName; input: Record<string, unknown>; idempotencyKey?: string; correlationId?: string }): Promise<AIToolProposal> {
  requireCapability(tko_actor, "ai.action.propose", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: "new", visibility: "internal" });
  const tko_tool = getAITool(tko_input.toolName);
  if (!tko_tool.requiresConfirmation || tko_tool.risk !== "write") throw new Error("AI_TOOL_DOES_NOT_REQUIRE_PROPOSAL");
  const tko_correlationId = tko_correlation("tko_ai_proposal", tko_input.correlationId);
  const tko_safeInput = tko_safeValue(tko_input.input) as Record<string, unknown>;
  const tko_run = await getAIStore().createRun({ actor: tko_actor, mode: "proposal", prompt: `Proposed action: ${tko_tool.name}`, context: [], correlationId: tko_correlationId });
  const tko_preview = tko_tool.name === "work_item.create" ? { title: tko_safeInput.title ?? "", projectId: tko_safeInput.projectId ?? "", description: tko_safeInput.description ?? "" } : { channelId: tko_safeInput.channelId ?? "", text: tko_safeInput.text ?? "" };
  const tko_proposal = await getAIStore().createProposal({ actor: tko_actor, runId: tko_run.id, toolName: tko_tool.name, risk: tko_tool.risk, input: tko_safeInput, preview: tko_preview, idempotencyKey: tko_input.idempotencyKey?.trim() || `ai:${tko_tool.name}:${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 15 * 60_000), correlationId: tko_correlationId });
  await getAIStore().completeRun(tko_actor, { runId: tko_run.id, status: "completed", output: `Proposal ${tko_proposal.id} awaiting explicit confirmation.`, correlationId: tko_correlationId });
  return tko_proposal;
}

export async function confirmProposal(tko_actor: PlatformActor, tko_input: { proposalId: string; correlationId?: string }): Promise<AIToolProposal> {
  requireCapability(tko_actor, "ai.action.confirm", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: tko_input.proposalId, visibility: "internal" });
  const tko_proposal = await getAIStore().getProposal(tko_actor.tenantId, tko_input.proposalId);
  if (!tko_proposal) throw new Error("AI_PROPOSAL_NOT_FOUND");
  if (tko_proposal.expiresAt.getTime() <= Date.now()) return getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "expired", correlationId: tko_correlation("tko_ai_expire", tko_input.correlationId) });
  return getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "confirmed", correlationId: tko_correlation("tko_ai_confirm", tko_input.correlationId) });
}

export async function executeConfirmedProposal(tko_actor: PlatformActor, tko_input: { proposalId: string; correlationId?: string }): Promise<{ proposal: AIToolProposal; result: Record<string, unknown> }> {
  requireCapability(tko_actor, "ai.action.confirm", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: tko_input.proposalId, visibility: "internal" });
  const tko_proposal = await getAIStore().getProposal(tko_actor.tenantId, tko_input.proposalId);
  if (!tko_proposal) throw new Error("AI_PROPOSAL_NOT_FOUND");
  if (tko_proposal.status === "executed") return { proposal: tko_proposal, result: { alreadyExecuted: true } };
  if (tko_proposal.status !== "confirmed" || tko_proposal.expiresAt.getTime() <= Date.now()) throw new Error("AI_PROPOSAL_NOT_EXECUTABLE");
  const tko_correlationId = tko_correlation("tko_ai_execute", tko_input.correlationId);
  try { const tko_result = await getAITool(tko_proposal.toolName).execute(tko_actor, { ...tko_proposal.input, idempotencyKey: tko_proposal.idempotencyKey }, tko_correlationId); const tko_executed = await getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "executed", correlationId: tko_correlationId }); return { proposal: tko_executed, result: tko_result }; } catch (tko_error) { await getAIStore().updateProposal(tko_actor, { proposalId: tko_proposal.id, status: "failed", correlationId: tko_correlationId }); throw tko_error; }
}

export async function listRuns(tko_actor: PlatformActor): Promise<AIRun[]> { requireCapability(tko_actor, "ai.context.read", { tenantId: tko_actor.tenantId, type: "ai_run", id: "list", visibility: "internal" }); return getAIStore().listRuns(tko_actor.tenantId); }
export async function listProposals(tko_actor: PlatformActor): Promise<AIToolProposal[]> { requireCapability(tko_actor, "ai.action.propose", { tenantId: tko_actor.tenantId, type: "ai_tool_proposal", id: "list", visibility: "internal" }); return getAIStore().listProposals(tko_actor.tenantId); }
