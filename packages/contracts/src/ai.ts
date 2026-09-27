import type { PlatformActor, TenantResource } from "./platform";

export type AIContextKind = "work_item" | "project" | "channel" | "message" | "lead" | "deal" | "document" | "form";
export type AIToolRisk = "read" | "draft" | "write";
export type AIRunStatus = "running" | "completed" | "failed" | "blocked";
export type AIProposalStatus = "proposed" | "confirmed" | "executed" | "rejected" | "failed" | "expired";
export type AIToolName = "context.read" | "work_item.draft" | "document.draft" | "work_item.create" | "chat.message.send" | "work.transition_status" | "crm.update_deal_stage";
export type McpAccessScope = "context:read" | "draft:write" | "action:propose" | "action:confirm";

export interface AIContextReference extends TenantResource {
  type: "ai_context_reference";
  runId: string;
  resourceKind: AIContextKind;
  resourceId: string;
  label: string;
  locator: string;
  createdAt: Date;
}

export interface AIRun extends TenantResource {
  type: "ai_run";
  requestedByMemberId: string;
  mode: "read" | "draft" | "proposal";
  prompt: string;
  status: AIRunStatus;
  model: string | null;
  output: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface AIToolProposal extends TenantResource {
  type: "ai_tool_proposal";
  runId: string;
  toolName: AIToolName;
  risk: AIToolRisk;
  input: Record<string, unknown>;
  preview: Record<string, unknown>;
  idempotencyKey: string;
  status: AIProposalStatus;
  proposedByMemberId: string;
  confirmedByMemberId: string | null;
  executedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIToolInputField {
  name: string;
  label: string;
  type: "string" | "text" | "number" | "uuid";
  required: boolean;
  placeholder?: string;
}

export interface AIToolDefinition {
  name: AIToolName;
  risk: AIToolRisk;
  capability: "ai.context.read" | "ai.draft.create" | "ai.action.propose" | "ai.action.confirm";
  requiresConfirmation: boolean;
  idempotent: boolean;
  description: string;
  /** Pragmatic, schema-driven field hints so UI surfaces (and later MCP schemas) can render parameters without guessing. */
  inputFields?: AIToolInputField[];
}

export interface CreateAIRunInput {
  actor: PlatformActor;
  mode: AIRun["mode"];
  prompt: string;
  context: Array<{ kind: AIContextKind; id: string }>;
  correlationId: string;
}

export interface CreateAIToolProposalInput {
  actor: PlatformActor;
  runId: string;
  toolName: AIToolName;
  input: Record<string, unknown>;
  preview: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string;
}

export interface MCPConnectionIdentity {
  actor: PlatformActor;
  scopes: McpAccessScope[];
}

export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
