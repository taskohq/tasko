// M1 Work extras procedures. The orchestrator spreads tkoWorkExtraProcedures into the
// `work:` section of appRouter (server/routers.ts). Existing procedures are never edited here.
// NOTE FOR ORCHESTRATOR: `board` below REDEFINES the existing work.board procedure with one
// added optional input field (`labels`) for label filtering — drop the old one in favor of this.
import { z } from "zod";
import { tenantProcedure } from "./_core/trpc";
import * as workService from "../modules/work/src/work-service";

export const tkoWorkExtraProcedures = {
  board: tenantProcedure.input(z.object({ projectId: z.string().uuid(), labels: z.array(z.string().uuid()).max(20).optional() })).query(({ ctx, input }) => workService.board(ctx.platform.actor, input.projectId, { labelIds: input.labels })),
  watchers: tenantProcedure.input(z.object({ workItemId: z.string().uuid() })).query(({ ctx, input }) => workService.workItemWatchers(ctx.platform.actor, input.workItemId)),
  addWatcher: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), memberId: z.string().uuid().nullable().optional() })).mutation(({ ctx, input }) => workService.addWorkItemWatcher(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  removeWatcher: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), memberId: z.string().uuid().nullable().optional() })).mutation(({ ctx, input }) => workService.removeWorkItemWatcher(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  labels: tenantProcedure.input(z.object({ projectId: z.string().uuid() })).query(({ ctx, input }) => workService.projectLabels(ctx.platform.actor, input.projectId)),
  createLabel: tenantProcedure.input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(120), colorToken: z.string().trim().min(1).max(60) })).mutation(({ ctx, input }) => workService.createWorkLabel(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  updateLabel: tenantProcedure.input(z.object({ projectId: z.string().uuid(), labelId: z.string().uuid(), name: z.string().trim().min(1).max(120).optional(), colorToken: z.string().trim().min(1).max(60).optional() })).mutation(({ ctx, input }) => workService.updateWorkLabel(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  deleteLabel: tenantProcedure.input(z.object({ projectId: z.string().uuid(), labelId: z.string().uuid() })).mutation(({ ctx, input }) => workService.deleteWorkLabel(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  setItemLabels: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), labelIds: z.array(z.string().uuid()).max(50) })).mutation(({ ctx, input }) => workService.setWorkItemLabels(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  timeLogs: tenantProcedure.input(z.object({ workItemId: z.string().uuid() })).query(({ ctx, input }) => workService.workItemTimeLogs(ctx.platform.actor, input.workItemId)),
  addTimeLog: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), minutes: z.number().int().min(1).max(100_000), startedAt: z.date().nullable().optional(), note: z.string().max(4_000).optional() })).mutation(({ ctx, input }) => workService.addWorkTimeLog(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  deleteTimeLog: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), timeLogId: z.string().uuid() })).mutation(({ ctx, input }) => workService.deleteWorkTimeLog(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  workflowTransitions: tenantProcedure.input(z.object({ projectId: z.string().uuid() })).query(({ ctx, input }) => workService.workflowTransitions(ctx.platform.actor, input.projectId)),
  setTransitionAllowed: tenantProcedure.input(z.object({ projectId: z.string().uuid(), fromStatusId: z.string().uuid().nullable(), toStatusId: z.string().uuid(), allowed: z.boolean() })).mutation(({ ctx, input }) => workService.setWorkflowTransitionAllowed(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  workTypes: tenantProcedure.input(z.object({ projectId: z.string().uuid() })).query(({ ctx, input }) => workService.workTypes(ctx.platform.actor, input.projectId)),
  createWorkType: tenantProcedure.input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(120), category: z.enum(["epic", "story", "task", "bug", "request", "milestone"]), icon: z.string().trim().min(1).max(60).optional() })).mutation(({ ctx, input }) => workService.createWorkType(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  updateWorkType: tenantProcedure.input(z.object({ projectId: z.string().uuid(), workTypeId: z.string().uuid(), name: z.string().trim().min(1).max(120).optional(), icon: z.string().trim().min(1).max(60).optional() })).mutation(({ ctx, input }) => workService.updateWorkType(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  setItemType: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), workTypeId: z.string().uuid() })).mutation(({ ctx, input }) => workService.setWorkItemType(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  duplicateItem: tenantProcedure.input(z.object({ workItemId: z.string().uuid() })).mutation(({ ctx, input }) => workService.duplicateWorkItem(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  moveItemToProject: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), targetProjectId: z.string().uuid() })).mutation(({ ctx, input }) => workService.moveWorkItemToProject(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  views: tenantProcedure.input(z.object({ projectId: z.string().uuid() })).query(({ ctx, input }) => workService.savedViews(ctx.platform.actor, input.projectId)),
  deleteView: tenantProcedure.input(z.object({ projectId: z.string().uuid(), viewId: z.string().uuid() })).mutation(({ ctx, input }) => workService.deleteSavedView(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
};
