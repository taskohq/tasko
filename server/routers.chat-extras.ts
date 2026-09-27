import { tenantProcedure } from "./_core/trpc";
import * as chatService from "../modules/chat/src/chat-service";
import { z } from "zod";

/**
 * M2 chat extras (realtime, search filters, notification prefs, @team mentions).
 * Wiring for the orchestrator, inside the `chat:` section of server/routers.ts:
 *
 *   chat: router({
 *     channels: tenantProcedure.query(...),
 *     ...every other existing chat procedure EXCEPT `search` and `sendMessage`...,
 *     ...tkoChatExtraProcedures,
 *   })
 *
 * 1. Spread `tkoChatExtraProcedures` into the chat section (import from "./routers.chat-extras").
 * 2. DELETE the base `search` and `sendMessage` definitions from the chat section: the extras
 *    redefine them fully with new OPTIONAL inputs (strict supersets). Keeping both would either
 *    override the enhanced versions (spread first) or trip TS2783 (duplicate keys, spread last).
 * 3. `message`, `memberNotificationPrefs`, `updateMemberNotificationPrefs` and `mentionTeams` are
 *    brand-new procedures and need no other change.
 */
export const tkoChatExtraProcedures = {
  // NOTE: redefines `chat.search`, adding optional filters (spec 08 §11). The base definition in
  // routers.ts only accepted { query }; this one is a strict superset.
  search: tenantProcedure
    .input(
      z.object({
        query: z.string().trim().min(2).max(250),
        channelId: z.string().uuid().nullable().optional(),
        fromMemberId: z.string().uuid().nullable().optional(),
        hasFile: z.boolean().optional(),
        dateFrom: z.date().nullable().optional(),
        dateTo: z.date().nullable().optional(),
        inThreads: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      chatService.search(ctx.platform.actor, input.query, {
        channelId: input.channelId,
        fromMemberId: input.fromMemberId,
        hasFile: input.hasFile,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        inThreads: input.inThreads,
        limit: input.limit,
      }),
    ),
  // NOTE: redefines `chat.sendMessage`, adding the optional `body.teamMentions` field for @team
  // mentions (spec 08 §5). Everything else matches the base definition in routers.ts.
  sendMessage: tenantProcedure
    .input(
      z
        .object({
          channelId: z.string().uuid(),
          clientMessageId: z.string().uuid(),
          body: z.object({
            type: z.literal("text"),
            text: z.string().max(40_000),
            mentions: z.array(z.string().uuid()).max(100).optional(),
            teamMentions: z.array(z.string().uuid()).max(20).optional(),
            broadcastMention: z.enum(["channel", "here"]).optional(),
            quotedMessageId: z.string().uuid().nullable().optional(),
          }),
          attachments: z
            .array(z.object({ filename: z.string().trim().min(1).max(180), contentType: z.string().trim().min(3).max(160), dataBase64: z.string().min(4).max(6_700_000) }))
            .max(5)
            .default([]),
          parentMessageId: z.string().uuid().nullable().optional(),
        })
        .refine(tko_input => Boolean(tko_input.body.text.trim()) || tko_input.attachments.length > 0, { message: "A message needs text or an attachment." }),
    )
    .mutation(({ ctx, input }) => chatService.sendMessage(ctx.platform.actor, input, ctx.correlationId)),
  // Single-message fetch used by the WS realtime client to patch the react-query cache in place
  // for edits, deletes and reaction changes without refetching channel history.
  message: tenantProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(({ ctx, input }) => chatService.message(ctx.platform.actor, input.messageId)),
  memberNotificationPrefs: tenantProcedure.query(({ ctx }) => chatService.memberNotificationPrefs(ctx.platform.actor)),
  updateMemberNotificationPrefs: tenantProcedure
    .input(
      z.object({
        defaultPolicy: z.enum(["all", "mentions", "none"]),
        quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
        quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      chatService.updateMemberNotificationPrefs(
        ctx.platform.actor,
        { defaultPolicy: input.defaultPolicy, quietHoursStart: input.quietHoursStart ?? null, quietHoursEnd: input.quietHoursEnd ?? null },
        ctx.correlationId,
      ),
    ),
  // Teams offered by the @mention picker (team CRUD itself lives elsewhere).
  mentionTeams: tenantProcedure.query(({ ctx }) => chatService.listMentionableTeams(ctx.platform.actor)),
};
