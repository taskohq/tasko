// M5/M6 ecosystem extras procedures. The orchestrator spreads tkoEcosystemExtraProcedures into
// the `ecosystem:` section of appRouter (server/routers.ts). Existing procedures are never edited
// here. Authorization is enforced inside the services (data.export for exports, workspace.settings.manage
// for feature flags), so guests/members/service accounts are denied at the capability layer.
import { z } from "zod";
import { tenantProcedure } from "./_core/trpc";
import { getExportService } from "../modules/ecosystem/src/export-service";
import { listFeatureFlagsForActor, setFeatureFlagOverride } from "../modules/platform/src/feature-flags";

export const tkoEcosystemExtraProcedures = {
  exportCsv: tenantProcedure
    .input(
      z.object({
        entityType: z.enum(["work_items", "time_logs", "crm_leads", "crm_companies", "crm_contacts", "crm_deals"]),
        filters: z
          .object({
            projectId: z.string().uuid().nullable().optional(),
            pipelineId: z.string().uuid().nullable().optional(),
          })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => getExportService().exportCsv(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  featureFlags: tenantProcedure.query(({ ctx }) => listFeatureFlagsForActor(ctx.platform.actor)),
  setFeatureFlag: tenantProcedure
    .input(z.object({ flagKey: z.enum(["ai.tools", "publicForms", "automationV2"]), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => setFeatureFlagOverride(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
};
