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
