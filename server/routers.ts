import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, tenantProcedure } from "./_core/trpc";
import { tko_config } from "../packages/config/src/tasko-config";
import { getPlatformStore } from "../packages/database/src/platform-store";
import { can } from "../modules/permissions/src/authorization";
import { enqueueDurableEvent } from "../modules/events/src/outbox-service";
import { recordAuthenticationEvent } from "../modules/audit/src/audit-service";
import { changeMemberRole } from "../modules/tenancy/src/membership-service";
import * as workService from "../modules/work/src/work-service";
import * as chatService from "../modules/chat/src/chat-service";
import * as crmService from "../modules/crm/src/crm-service";
import * as workspaceService from "../modules/workspace/src/workspace-service";
import { getWorkStore } from "../packages/database/src/work-store";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      if (ctx.platform) {
        await recordAuthenticationEvent({
          actor: ctx.platform.actor,
          action: "logout",
          correlationId: ctx.correlationId,
          metadata: { transport: "http" },
        });
      }
      return {
        success: true,
      } as const;
    }),
  }),

  platform: router({
    status: publicProcedure.query(async () => {
      const tko_database = await getPlatformStore().health();
      return {
        deploymentProfile: tko_config.deploymentProfile,
        database: tko_database,
        moduleStatus: "m0_platform_skeleton",
      } as const;
    }),
    memberships: protectedProcedure.query(async ({ ctx }) => {
      const tko_memberships = await getPlatformStore().listMemberships(ctx.user.openId);
      return tko_memberships.map(tko_membership => ({
        tenant: tko_membership.tenant,
        role: tko_membership.role,
        status: tko_membership.status,
        displayName: tko_membership.displayName,
      }));
    }),
    currentTenant: tenantProcedure.query(({ ctx }) => ({
      tenant: ctx.platform.membership.tenant,
      role: ctx.platform.actor.role,
      memberId: ctx.platform.actor.memberId,
      correlationId: ctx.platform.actor.correlationId,
    })),
    authorizationProbe: tenantProcedure
      .input(
        z.object({
          action: z.enum([
            "workspace.read",
            "workspace.settings.manage",
            "workspace.members.manage",
            "workspace.audit.read",
            "attachment.upload",
            "attachment.download",
            "realtime.connect",
            "job.enqueue",
          ]),
          resourceId: z.string().min(1),
          visibility: z.enum(["internal", "private", "guest_shared"]).default("internal"),
          explicitMemberIds: z.array(z.string()).default([]),
        }),
      )
      .query(({ ctx, input }) =>
        can(ctx.platform.actor, input.action, {
          // Deliberately ignore all browser-supplied tenant identifiers.
          tenantId: ctx.platform.actor.tenantId,
          type: "authorization_probe",
          id: input.resourceId,
          visibility: input.visibility,
          explicitMemberIds: input.explicitMemberIds,
        }),
      ),
    enqueueTestEvent: tenantProcedure.mutation(async ({ ctx }) => {
      const tko_decision = can(ctx.platform.actor, "job.enqueue", {
        tenantId: ctx.platform.actor.tenantId,
        type: "outbox",
        id: "test-event",
        visibility: "internal",
      });
      if (!tko_decision.allowed) {
        throw new Error(`TASKO_AUTHORIZATION_DENIED:${tko_decision.reason}`);
      }
      return enqueueDurableEvent({
        actor: ctx.platform.actor,
        tenantId: ctx.platform.actor.tenantId,
        eventType: "platform.test_event.v1",
        topic: "platform.events",
        payload: { source: "platform.enqueueTestEvent" },
        action: "platform.test_event.queued",
        resourceType: "outbox",
        resourceId: "test-event",
        correlationId: ctx.correlationId,
      });
    }),
    changeMemberRole: tenantProcedure
      .input(
        z.object({
          memberId: z.string().min(1),
          newRole: z.enum(["owner", "admin", "member", "guest"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await changeMemberRole({
          actor: ctx.platform.actor,
          memberId: input.memberId,
          newRole: input.newRole,
          correlationId: ctx.correlationId,
        });
        return { success: true } as const;
      }),
    seedDemo: protectedProcedure.mutation(async ({ ctx }) => {
      if (!tko_config.ownerAuthSubject || ctx.user.openId !== tko_config.ownerAuthSubject) {
        throw new Error("TASKO_AUTHORIZATION_DENIED:seed_owner_required");
      }
      return getPlatformStore().seedDemoWorkspace({ ownerAuthSubject: ctx.user.openId });
    }),
  }),

  work: router({
    spaces: tenantProcedure.query(({ ctx }) => getWorkStore().listSpaces(ctx.platform.actor.tenantId)),
    projects: tenantProcedure.query(({ ctx }) => getWorkStore().listProjects(ctx.platform.actor.tenantId)),
    board: tenantProcedure.input(z.object({ projectId: z.string().uuid() })).query(({ ctx, input }) => workService.board(ctx.platform.actor, input.projectId)),
    item: tenantProcedure.input(z.object({ workItemId: z.string().uuid() })).query(async ({ ctx, input }) => {
      return workService.itemDetails(ctx.platform.actor, input.workItemId);
    }),
    customFields: tenantProcedure.input(z.object({ projectId: z.string().uuid() })).query(({ ctx, input }) => workService.customFields(ctx.platform.actor, input.projectId)),
    createSpace: tenantProcedure.input(z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().min(2).max(80), visibility: z.enum(["internal", "private", "guest_shared"]).default("internal") })).mutation(({ ctx, input }) => workService.createSpace(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    createProject: tenantProcedure.input(z.object({ spaceId: z.string().uuid(), name: z.string().trim().min(2).max(160), key: z.string().trim().min(2).max(10), description: z.string().max(10_000).optional(), methodology: z.enum(["kanban", "scrum", "simple"]).default("kanban"), visibility: z.enum(["internal", "private", "guest_shared"]).default("internal") })).mutation(({ ctx, input }) => workService.createProject({ actor: ctx.platform.actor, ...input, correlationId: ctx.correlationId })),
    createItem: tenantProcedure.input(z.object({ projectId: z.string().uuid(), workTypeId: z.string().uuid().optional(), parentId: z.string().uuid().nullable().optional(), title: z.string().trim().min(1).max(500), description: z.string().max(50_000).optional(), priority: z.enum(["none", "low", "medium", "high", "urgent"]).default("none"), assigneeMemberIds: z.array(z.string().uuid()).max(50).default([]), startAt: z.date().nullable().optional(), dueAt: z.date().nullable().optional(), estimateMinutes: z.number().int().min(0).max(1_000_000).nullable().optional(), rank: z.string().min(1).max(80).optional() })).mutation(({ ctx, input }) => workService.createWorkItem({ actor: ctx.platform.actor, ...input, correlationId: ctx.correlationId })),
    transitionItem: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), targetStatusId: z.string().uuid(), expectedVersion: z.number().int().positive() })).mutation(({ ctx, input }) => workService.transitionWorkItem({ actor: ctx.platform.actor, ...input, correlationId: ctx.correlationId })),
    createComment: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), body: z.string().trim().min(1).max(20_000) })).mutation(({ ctx, input }) => workService.createComment({ actor: ctx.platform.actor, ...input, correlationId: ctx.correlationId })),
    addDependency: tenantProcedure.input(z.object({ sourceWorkItemId: z.string().uuid(), targetWorkItemId: z.string().uuid(), relationType: z.enum(["blocks", "blocked_by", "relates_to", "duplicates", "duplicated_by"]) })).mutation(({ ctx, input }) => workService.addDependency(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    createSprint: tenantProcedure.input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(120), goal: z.string().max(5_000).optional(), startAt: z.date().nullable().optional(), endAt: z.date().nullable().optional() })).mutation(({ ctx, input }) => workService.createSprint({ actor: ctx.platform.actor, ...input, correlationId: ctx.correlationId })),
    addItemsToSprint: tenantProcedure.input(z.object({ sprintId: z.string().uuid(), workItemIds: z.array(z.string().uuid()).min(1).max(500) })).mutation(({ ctx, input }) => workService.addItemsToSprint(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    completeSprint: tenantProcedure.input(z.object({ sprintId: z.string().uuid(), incompleteDisposition: z.enum(["backlog", "next_sprint"]).default("backlog") })).mutation(({ ctx, input }) => workService.completeSprint(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    createCustomField: tenantProcedure.input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(120), fieldType: z.enum(["text", "long_text", "number", "boolean", "date", "datetime", "single_select", "multi_select", "user", "url", "email"]), config: z.record(z.string(), z.unknown()).optional() })).mutation(({ ctx, input }) => workService.createCustomField(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    setCustomFieldValue: tenantProcedure.input(z.object({ workItemId: z.string().uuid(), fieldId: z.string().uuid(), value: z.unknown() })).mutation(({ ctx, input }) => workService.setCustomFieldValue(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    saveView: tenantProcedure.input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(120), renderer: z.enum(["list", "board", "calendar", "timeline"]), visibility: z.enum(["private", "workspace"]).default("private"), filter: z.record(z.string(), z.unknown()).default({}), layout: z.record(z.string(), z.unknown()).default({}) })).mutation(({ ctx, input }) => workService.saveView(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    seedDemo: tenantProcedure.mutation(({ ctx }) => workService.seedWorkDemo(ctx.platform.actor)),
  }),

  crm: router({
    overview: tenantProcedure.query(({ ctx }) => crmService.overview(ctx.platform.actor)),
    lead: tenantProcedure.input(z.object({ leadId: z.string().uuid() })).query(({ ctx, input }) => crmService.lead(ctx.platform.actor, input.leadId)),
    pipelines: tenantProcedure.query(({ ctx }) => import("../packages/database/src/crm-store").then(({ getCRMStore }) => getCRMStore().listPipelines(ctx.platform.actor.tenantId))),
    board: tenantProcedure.input(z.object({ pipelineId: z.string().uuid() })).query(({ ctx, input }) => crmService.board(ctx.platform.actor, input.pipelineId)),
    createLead: tenantProcedure.input(z.object({ firstName: z.string().trim().min(1).max(120), lastName: z.string().trim().min(1).max(120), companyName: z.string().trim().max(240).optional(), jobTitle: z.string().trim().max(180).optional(), email: z.string().trim().email().max(320).optional().or(z.literal("")), phone: z.string().trim().max(80).optional(), website: z.string().trim().url().max(500).optional().or(z.literal("")), country: z.string().trim().max(120).optional(), source: z.string().trim().max(120).optional(), status: z.enum(["new", "contacted", "qualified", "nurture", "disqualified"]).optional(), score: z.number().int().min(0).max(100).nullable().optional(), tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(), notes: z.string().max(10_000).optional(), nextFollowUpAt: z.date().nullable().optional(), customFields: z.record(z.string(), z.unknown()).optional() })).mutation(({ ctx, input }) => crmService.createLead({ actor: ctx.platform.actor, ...input, correlationId: ctx.correlationId })),
    createCompany: tenantProcedure.input(z.object({ name: z.string().trim().min(1).max(240), domain: z.string().trim().max(240).optional(), website: z.string().trim().url().max(500).optional().or(z.literal("")), industry: z.string().trim().max(160).optional(), employeeRange: z.string().trim().max(120).optional(), country: z.string().trim().max(120).optional(), lifecycleStatus: z.string().trim().max(120).optional(), tags: z.array(z.string().trim().min(1).max(60)).max(50).optional() })).mutation(({ ctx, input }) => crmService.createCompany(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    createContact: tenantProcedure.input(z.object({ companyId: z.string().uuid().nullable().optional(), firstName: z.string().trim().min(1).max(120), lastName: z.string().trim().min(1).max(120), title: z.string().trim().max(180).optional(), emails: z.array(z.string().email().max(320)).max(10).optional(), phones: z.array(z.string().trim().min(1).max(80)).max(10).optional(), tags: z.array(z.string().trim().min(1).max(60)).max(50).optional() })).mutation(({ ctx, input }) => crmService.createContact(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    createPipeline: tenantProcedure.input(z.object({ name: z.string().trim().min(1).max(160), stages: z.array(z.object({ name: z.string().trim().min(1).max(120), probabilityDefault: z.number().int().min(0).max(100), category: z.enum(["open", "won", "lost"]) })).min(2).max(20).optional() })).mutation(({ ctx, input }) => crmService.createPipeline(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    createDeal: tenantProcedure.input(z.object({ companyId: z.string().uuid().nullable().optional(), pipelineId: z.string().uuid(), stageId: z.string().uuid(), name: z.string().trim().min(1).max(320), amountCents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(), currency: z.string().trim().length(3).optional(), probability: z.number().int().min(0).max(100).optional(), expectedCloseDate: z.date().nullable().optional(), source: z.string().trim().max(120).optional(), nextStep: z.string().trim().max(2_000).optional() })).mutation(({ ctx, input }) => crmService.createDeal(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    moveDeal: tenantProcedure.input(z.object({ dealId: z.string().uuid(), stageId: z.string().uuid() })).mutation(({ ctx, input }) => crmService.moveDeal(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    requestDealHandoff: tenantProcedure.input(z.object({ dealId: z.string().uuid() })).mutation(({ ctx, input }) => crmService.requestDealHandoff(ctx.platform.actor, { dealId: input.dealId, correlationId: ctx.correlationId })),
    addActivity: tenantProcedure.input(z.object({ entityType: z.enum(["lead", "company", "contact", "deal"]), entityId: z.string().uuid(), activityType: z.enum(["note", "call", "meeting", "email_reference", "status_change", "file", "linked_work_event"]), subject: z.string().trim().max(500).optional(), body: z.string().max(10_000).optional(), metadata: z.record(z.string(), z.unknown()).optional() })).mutation(({ ctx, input }) => crmService.addActivity(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    convertLead: tenantProcedure.input(z.object({ leadId: z.string().uuid(), conversionKey: z.string().uuid(), companyId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), createDeal: z.boolean().default(true), pipelineId: z.string().uuid().optional(), stageId: z.string().uuid().optional(), dealName: z.string().trim().min(1).max(320).optional(), dealAmountCents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional() })).mutation(({ ctx, input }) => crmService.convertLead({ actor: ctx.platform.actor, ...input, correlationId: ctx.correlationId })),
    createFollowUp: tenantProcedure.input(z.object({ entityType: z.enum(["lead", "company", "contact", "deal"]), entityId: z.string().uuid(), projectId: z.string().uuid(), title: z.string().trim().min(1).max(500), dueAt: z.date().nullable().optional() })).mutation(({ ctx, input }) => crmService.createFollowUp(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    linkEntity: tenantProcedure.input(z.object({ sourceType: z.enum(["lead", "company", "contact", "deal"]), sourceId: z.string().uuid(), targetType: z.enum(["work_item", "project", "channel", "message"]), targetId: z.string().uuid(), relationType: z.enum(["follow_up", "delivery_project", "delivery_channel", "context"]) })).mutation(({ ctx, input }) => crmService.link(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  }),

  workspace: router({
    overview: tenantProcedure.query(({ ctx }) => workspaceService.overview(ctx.platform.actor)),
    search: tenantProcedure.input(z.object({ query: z.string().trim().min(2).max(250), kind: z.enum(["work", "chat", "crm", "doc"]).optional() })).query(({ ctx, input }) => workspaceService.search(ctx.platform.actor, input)),
    indexSearchDocument: tenantProcedure.input(z.object({ entityType: z.enum(["work_item", "project", "channel", "message", "crm_lead", "crm_company", "crm_contact", "crm_deal", "document", "form"]), entityId: z.string().uuid(), kind: z.enum(["work", "chat", "crm", "doc"]), title: z.string().trim().min(1).max(500), bodyText: z.string().max(50_000).default(""), href: z.string().trim().min(1).max(2_000), visibility: z.enum(["internal", "private", "guest_shared"]).default("internal"), explicitMemberIds: z.array(z.string().uuid()).max(100).default([]) })).mutation(({ ctx, input }) => workspaceService.indexSearchDocument(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    inbox: tenantProcedure.input(z.object({ includeArchived: z.boolean().optional() }).optional()).query(({ ctx, input }) => workspaceService.inbox(ctx.platform.actor, input)),
    setInboxState: tenantProcedure.input(z.object({ inboxItemId: z.string().uuid(), state: z.enum(["read", "unread", "archived"]) })).mutation(({ ctx, input }) => workspaceService.setInboxState(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    documents: tenantProcedure.query(({ ctx }) => workspaceService.documents(ctx.platform.actor)),
    createDocument: tenantProcedure.input(z.object({ title: z.string().trim().min(1).max(500), bodyText: z.string().max(100_000).optional(), content: z.record(z.string(), z.unknown()).optional(), visibility: z.enum(["internal", "private", "guest_shared"]).optional(), templateKey: z.string().trim().max(120).nullable().optional() })).mutation(({ ctx, input }) => workspaceService.createDocument(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    linkDocument: tenantProcedure.input(z.object({ documentId: z.string().uuid(), entityType: z.enum(["work_item", "project", "channel", "message", "crm_lead", "crm_company", "crm_contact", "crm_deal", "document", "form"]), entityId: z.string().uuid() })).mutation(({ ctx, input }) => workspaceService.linkDocument(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    entityLinks: tenantProcedure.input(z.object({ entityType: z.enum(["work_item", "project", "channel", "message", "crm_lead", "crm_company", "crm_contact", "crm_deal", "document", "form"]), entityId: z.string().uuid() })).query(({ ctx, input }) => workspaceService.entityLinks(ctx.platform.actor, input.entityType, input.entityId)),
    createEntityLink: tenantProcedure.input(z.object({ sourceType: z.enum(["work_item", "project", "channel", "message", "crm_lead", "crm_company", "crm_contact", "crm_deal", "document", "form"]), sourceId: z.string().uuid(), targetType: z.enum(["work_item", "project", "channel", "message", "crm_lead", "crm_company", "crm_contact", "crm_deal", "document", "form"]), targetId: z.string().uuid(), relationType: z.enum(["context", "reference", "related", "blocks"]) })).mutation(({ ctx, input }) => workspaceService.createEntityLink(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    forms: tenantProcedure.query(({ ctx }) => workspaceService.forms(ctx.platform.actor)),
    createForm: tenantProcedure.input(z.object({ name: z.string().trim().min(1).max(240), description: z.string().max(5_000).optional(), fields: z.array(z.object({ id: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(240), fieldType: z.enum(["text", "textarea", "email", "number", "select", "date"]), required: z.boolean().default(false), options: z.array(z.string().trim().min(1).max(180)).max(100).optional() })).min(1).max(50), targetType: z.enum(["work_item", "crm_lead"]), targetConfig: z.record(z.string(), z.unknown()) })).mutation(({ ctx, input }) => workspaceService.createForm(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    activateForm: tenantProcedure.input(z.object({ formId: z.string().uuid() })).mutation(({ ctx, input }) => workspaceService.activateForm(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    submitForm: tenantProcedure.input(z.object({ formId: z.string().uuid(), values: z.record(z.string(), z.unknown()), idempotencyKey: z.string().uuid() })).mutation(({ ctx, input }) => workspaceService.submitForm(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
    automationRules: tenantProcedure.query(({ ctx }) => workspaceService.automationRules(ctx.platform.actor)),
    automationExecutions: tenantProcedure.query(({ ctx }) => workspaceService.automationExecutions(ctx.platform.actor)),
    createAutomationRule: tenantProcedure.input(z.object({ name: z.string().trim().min(1).max(240), triggerType: z.enum(["crm.lead_created.v1", "work.work_item_created.v1", "workspace.form_submitted.v1"]), condition: z.record(z.string(), z.unknown()).optional(), actions: z.array(z.object({ type: z.enum(["create_work_item", "create_crm_activity"]), config: z.record(z.string(), z.unknown()) })).min(1).max(10) })).mutation(({ ctx, input }) => workspaceService.createAutomationRule(ctx.platform.actor, { ...input, correlationId: ctx.correlationId })),
  }),

  chat: router({
    channels: tenantProcedure.query(({ ctx }) => chatService.listChannels(ctx.platform.actor)),
    readStates: tenantProcedure.query(({ ctx }) => chatService.readStates(ctx.platform.actor)),
    messages: tenantProcedure.input(z.object({ channelId: z.string().uuid(), afterSequence: z.number().int().min(0).optional() })).query(({ ctx, input }) => chatService.messages(ctx.platform.actor, input.channelId, input.afterSequence)),
    createChannel: tenantProcedure.input(z.object({ kind: z.enum(["public", "private", "dm", "group_dm"]), name: z.string().trim().min(1).max(120).optional(), topic: z.string().trim().max(2_000).optional(), memberIds: z.array(z.string().uuid()).max(100).default([]), visibility: z.enum(["internal", "private"]).optional() })).mutation(({ ctx, input }) => chatService.createChannel(ctx.platform.actor, input)),
    sendMessage: tenantProcedure.input(z.object({ channelId: z.string().uuid(), clientMessageId: z.string().uuid(), body: z.object({ type: z.literal("text"), text: z.string().max(40_000), mentions: z.array(z.string().uuid()).max(100).optional() }), attachments: z.array(z.object({ filename: z.string().trim().min(1).max(180), contentType: z.string().trim().min(3).max(160), dataBase64: z.string().min(4).max(6_700_000) })).max(5).default([]), parentMessageId: z.string().uuid().nullable().optional() }).refine(tko_input => Boolean(tko_input.body.text.trim()) || tko_input.attachments.length > 0, { message: "A message needs text or an attachment." })).mutation(({ ctx, input }) => chatService.sendMessage(ctx.platform.actor, input, ctx.correlationId)),
    editMessage: tenantProcedure.input(z.object({ messageId: z.string().uuid(), text: z.string().trim().min(1).max(40_000) })).mutation(({ ctx, input }) => chatService.editMessage(ctx.platform.actor, input.messageId, input.text, ctx.correlationId)),
    deleteMessage: tenantProcedure.input(z.object({ messageId: z.string().uuid() })).mutation(({ ctx, input }) => chatService.deleteMessage(ctx.platform.actor, input.messageId, ctx.correlationId)),
    toggleReaction: tenantProcedure.input(z.object({ messageId: z.string().uuid(), emoji: z.string().trim().min(1).max(64) })).mutation(({ ctx, input }) => chatService.toggleReaction(ctx.platform.actor, input.messageId, input.emoji, ctx.correlationId)),
    markRead: tenantProcedure.input(z.object({ channelId: z.string().uuid(), lastReadSeq: z.number().int().min(0) })).mutation(({ ctx, input }) => chatService.markRead(ctx.platform.actor, input.channelId, input.lastReadSeq)),
    setNotificationPreference: tenantProcedure.input(z.object({ channelId: z.string().uuid(), notificationLevel: z.enum(["all", "mentions", "none"]) })).mutation(({ ctx, input }) => chatService.setNotificationPreference(ctx.platform.actor, input.channelId, input.notificationLevel, ctx.correlationId)),
    savedMessages: tenantProcedure.query(({ ctx }) => chatService.savedMessages(ctx.platform.actor)),
    saveMessage: tenantProcedure.input(z.object({ messageId: z.string().uuid(), status: z.enum(["open", "done"]).optional(), note: z.string().trim().max(4_000).nullable().optional(), reminderAt: z.date().nullable().optional() })).mutation(({ ctx, input }) => chatService.saveMessage(ctx.platform.actor, input.messageId, { status: input.status, note: input.note, reminderAt: input.reminderAt }, ctx.correlationId)),
    search: tenantProcedure.input(z.object({ query: z.string().trim().min(2).max(250) })).query(({ ctx, input }) => chatService.search(ctx.platform.actor, input.query)),
    linkWorkItem: tenantProcedure.input(z.object({ messageId: z.string().uuid(), workItemId: z.string().uuid() })).mutation(({ ctx, input }) => chatService.linkWorkItem(ctx.platform.actor, input.messageId, input.workItemId, ctx.correlationId)),
    attachmentUrl: tenantProcedure.input(z.object({ messageId: z.string().uuid(), attachmentId: z.string().uuid() })).query(({ ctx, input }) => chatService.attachmentUrl(ctx.platform.actor, input.messageId, input.attachmentId)),
    setPresence: tenantProcedure.input(z.object({ status: z.enum(["online", "away", "offline"]) })).mutation(({ ctx, input }) => chatService.setPresence(ctx.platform.actor, input.status)),
    presence: tenantProcedure.input(z.object({ channelId: z.string().uuid() })).query(({ ctx, input }) => chatService.presence(ctx.platform.actor, input.channelId)),
    setTyping: tenantProcedure.input(z.object({ channelId: z.string().uuid(), isTyping: z.boolean() })).mutation(({ ctx, input }) => chatService.setTyping(ctx.platform.actor, input.channelId, input.isTyping)),
    typing: tenantProcedure.input(z.object({ channelId: z.string().uuid() })).query(({ ctx, input }) => chatService.typing(ctx.platform.actor, input.channelId)),
    seedDemo: tenantProcedure.mutation(({ ctx }) => chatService.seedDemo(ctx.platform.actor)),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
