// M4 Unified Workspace extras procedures (spec 10 §2/§5, spec 12). The orchestrator spreads
// tkoWorkspaceExtraProcedures into the `workspace:` section of appRouter (server/routers.ts).
// Existing procedures are never edited here — see the NOTE FOR ORCHESTRATOR below for the one
// redefinition.
import { z } from "zod";
import { tenantProcedure } from "./_core/trpc";
import * as workspaceService from "../modules/workspace/src/workspace-service";

const tko_automationActionSchema = z.object({
  type: z.enum(["create_work_item", "create_crm_activity", "post_channel_message", "notify_user", "update_work_item"]),
  config: z.record(z.string(), z.unknown()),
});

export const tkoWorkspaceExtraProcedures = {
  documentRevisions: tenantProcedure.input(z.object({ documentId: z.string().uuid() })).query(({ ctx, input }) => workspaceService.documentRevisions(ctx.platform.actor, input.documentId)),
  updateDocumentContent: tenantProcedure.input(z.object({ documentId: z.string().uuid(), title: z.string().trim().min(1).max(500).optional(), bodyText: z.string().max(100_000), content: z.record(z.string(), z.unknown()).optional() })).mutation(({ ctx, input }) => workspaceService.updateDocumentContent(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  restoreDocumentRevision: tenantProcedure.input(z.object({ documentId: z.string().uuid(), revisionId: z.string().uuid() })).mutation(({ ctx, input }) => workspaceService.restoreDocumentRevision(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  setFormSharing: tenantProcedure.input(z.object({ formId: z.string().uuid(), isPublic: z.boolean() })).mutation(({ ctx, input }) => workspaceService.setFormSharing(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  // NOTE FOR ORCHESTRATOR: `createAutomationRule` below REDEFINES the existing workspace.createAutomationRule
  // procedure (server/routers.ts) — the trigger and action enums are extended for automation v2 and an
  // optional AND-ed `conditions` list (max 3) was added. Drop the old one in favor of this. The previous
  // `condition` input remains optional and unchanged.
  createAutomationRule: tenantProcedure.input(z.object({
    name: z.string().trim().min(1).max(240),
    triggerType: z.enum(["crm.lead_created.v1", "work.work_item_created.v1", "work.work_item_status_changed.v1", "crm.deal_stage_changed.v1", "crm.deal_won.v1", "workspace.form_submitted.v1"]),
    condition: z.record(z.string(), z.unknown()).optional(),
    conditions: z.array(z.object({ field: z.string().trim().min(1).max(120), equals: z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]) })).max(3).optional(),
    actions: z.array(tko_automationActionSchema).min(1).max(10),
  })).mutation(({ ctx, input }) => workspaceService.createAutomationRule(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
};
