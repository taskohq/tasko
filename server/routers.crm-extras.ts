// M3 Slim CRM extras procedures. The orchestrator spreads tkoCrmExtraProcedures into the
// `crm:` section of appRouter (server/routers.ts). Existing procedures are never edited here.
// NOTE FOR ORCHESTRATOR: `moveDeal` below REDEFINES the existing crm.moveDeal procedure with one
// added optional input field (`lossReason`) required by the M3 won/lost confirmation flow —
// drop the old one in favor of this.
// NOTE FOR ORCHESTRATOR: `createFollowUp` below REDEFINES the existing crm.createFollowUp
// procedure with one added optional input field (`assigneeMemberIds`) so follow-up WorkItems
// can be assigned from the CRM UI — drop the old one in favor of this.
import { z } from "zod";
import { tenantProcedure } from "./_core/trpc";
import * as crmService from "../modules/crm/src/crm-service";

const tko_entityType = z.enum(["lead", "company", "contact", "deal"]);
const tko_tags = z.array(z.string().trim().min(1).max(60)).max(50).optional();

export const tkoCrmExtraProcedures = {
  companies: tenantProcedure.query(({ ctx }) => crmService.companies(ctx.platform.actor)),
  contacts: tenantProcedure.input(z.object({ companyId: z.string().uuid().nullable().optional() })).query(({ ctx, input }) => crmService.contacts(ctx.platform.actor, input.companyId ?? undefined)),
  stages: tenantProcedure.input(z.object({ pipelineId: z.string().uuid() })).query(({ ctx, input }) => crmService.stages(ctx.platform.actor, input.pipelineId)),
  company: tenantProcedure.input(z.object({ companyId: z.string().uuid() })).query(({ ctx, input }) => crmService.company(ctx.platform.actor, input.companyId)),
  contact: tenantProcedure.input(z.object({ contactId: z.string().uuid() })).query(({ ctx, input }) => crmService.contact(ctx.platform.actor, input.contactId)),
  entityActivities: tenantProcedure.input(z.object({ entityType: tko_entityType, entityId: z.string().uuid() })).query(({ ctx, input }) => crmService.entityActivities(ctx.platform.actor, input.entityType, input.entityId)),
  entityLinks: tenantProcedure.input(z.object({ sourceType: tko_entityType, sourceId: z.string().uuid() })).query(({ ctx, input }) => crmService.entityLinks(ctx.platform.actor, input.sourceType, input.sourceId)),
  updateLead: tenantProcedure.input(z.object({
    leadId: z.string().uuid(),
    ownerMemberId: z.string().uuid().optional(),
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
    companyName: z.string().trim().max(240).optional(),
    jobTitle: z.string().trim().max(180).optional(),
    email: z.string().trim().email().max(320).optional().or(z.literal("")),
    phone: z.string().trim().max(80).optional(),
    website: z.string().trim().url().max(500).optional().or(z.literal("")),
    country: z.string().trim().max(120).optional(),
    source: z.string().trim().max(120).optional(),
    status: z.enum(["new", "contacted", "qualified", "nurture", "disqualified"]).optional(),
    score: z.number().int().min(0).max(100).nullable().optional(),
    tags: tko_tags,
    notes: z.string().max(10_000).optional(),
    nextFollowUpAt: z.date().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })).mutation(({ ctx, input }) => crmService.updateLead(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  updateCompany: tenantProcedure.input(z.object({
    companyId: z.string().uuid(),
    ownerMemberId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(240).optional(),
    domain: z.string().trim().max(240).optional(),
    website: z.string().trim().url().max(500).optional().or(z.literal("")),
    industry: z.string().trim().max(160).optional(),
    employeeRange: z.string().trim().max(120).optional(),
    country: z.string().trim().max(120).optional(),
    lifecycleStatus: z.string().trim().max(120).optional(),
    tags: tko_tags,
    customFields: z.record(z.string(), z.unknown()).optional(),
  })).mutation(({ ctx, input }) => crmService.updateCompany(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  updateContact: tenantProcedure.input(z.object({
    contactId: z.string().uuid(),
    companyId: z.string().uuid().nullable().optional(),
    ownerMemberId: z.string().uuid().optional(),
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().max(180).optional(),
    emails: z.array(z.string().email().max(320)).max(10).optional(),
    phones: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
    tags: tko_tags,
    customFields: z.record(z.string(), z.unknown()).optional(),
  })).mutation(({ ctx, input }) => crmService.updateContact(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  moveDeal: tenantProcedure.input(z.object({ dealId: z.string().uuid(), stageId: z.string().uuid(), lossReason: z.string().trim().max(500).optional() })).mutation(({ ctx, input }) => crmService.moveDeal(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  createFollowUp: tenantProcedure.input(z.object({ entityType: tko_entityType, entityId: z.string().uuid(), projectId: z.string().uuid(), title: z.string().trim().min(1).max(500), dueAt: z.date().nullable().optional(), assigneeMemberIds: z.array(z.string().uuid()).max(20).optional() })).mutation(({ ctx, input }) => crmService.createFollowUp(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
};
