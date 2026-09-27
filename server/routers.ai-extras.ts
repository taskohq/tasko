// M7 AI extras procedures. The orchestrator spreads tkoAiExtraProcedures into the `ai:` section
// of appRouter (server/routers.ts). Existing procedures are never edited here.
// `proposeTool` generalizes the legacy `ai.propose` (whose zod enum is frozen to the two original
// write tools) so the registry-driven UI and any new proposal-required tool can stage proposals
// without touching server/routers.ts. addProposeToolFromRegistry: tool names stay in sync with
// listAITools() at module load.
import { z } from "zod";
import type { AIToolName } from "../packages/contracts/src/ai";
import { tenantProcedure } from "./_core/trpc";
import * as aiService from "../modules/ai/src/ai-service";
import { listAITools } from "../modules/ai/src/tool-registry";

const tko_proposableToolNames = listAITools()
  .filter(tko_tool => tko_tool.requiresConfirmation && tko_tool.risk === "write")
  .map(tko_tool => tko_tool.name) as [AIToolName, ...AIToolName[]];

export const tkoAiExtraProcedures = {
  proposeTool: tenantProcedure
    .input(z.object({
      toolName: z.enum(tko_proposableToolNames),
      input: z.record(z.string(), z.unknown()),
      idempotencyKey: z.string().trim().min(1).max(180).optional(),
    }))
    .mutation(({ ctx, input }) => aiService.proposeAction(ctx.platform.actor, { toolName: input.toolName, input: input.input, idempotencyKey: input.idempotencyKey, correlationId: ctx.correlationId })),
};
