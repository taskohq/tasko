import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresChatStore } from "../../packages/database/src/postgres-chat-store";
import type { PlatformActor } from "../../packages/contracts/src/platform";

const tko_postgresUrl = process.env.TASKO_POSTGRES_URL;
const tko_describe = tko_postgresUrl && process.env.TASKO_RUN_POSTGRES_INTEGRATION_TESTS === "1" ? describe : describe.skip;

async function tko_cleanupTenant(tko_pool: Pool, tko_tenantId: string, tko_userId: string): Promise<void> {
  for (const tko_table of ["message_attachments", "message_reactions", "saved_messages", "messages", "channel_members", "channels", "outbox", "audit_logs", "tenant_members"]) {
    await tko_pool.query(`delete from ${tko_table} where tenant_id=$1`, [tko_tenantId]);
  }
  await tko_pool.query(`delete from tenants where id=$1`, [tko_tenantId]);
  await tko_pool.query(`delete from users where id=$1`, [tko_userId]);
}

tko_describe("Collaboration Alpha M2 on PostgreSQL", () => {
  it("persists attachment metadata, audit and transactional outbox in the Docker database", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    const tko_store = new PostgresChatStore(tko_postgresUrl!);
    const tko_tenantId = randomUUID();
    const tko_userId = randomUUID();
    const tko_memberId = randomUUID();
    const tko_actor: PlatformActor = { authSubject: `postgres-chat-test:${tko_tenantId}`, tenantId: tko_tenantId, tenantSlug: `postgres-chat-${tko_tenantId.slice(0, 8)}`, memberId: tko_memberId, role: "owner", membershipStatus: "active", correlationId: `postgres-chat-${tko_tenantId}` };

    try {
      await tko_pool.query(`insert into tenants (id,slug,name,status,deployment_profile) values ($1,$2,$3,'active','single_tenant')`, [tko_tenantId, tko_actor.tenantSlug, "PostgreSQL Chat Acceptance"]);
      await tko_pool.query(`insert into users (id,auth_subject,status) values ($1,$2,'active')`, [tko_userId, tko_actor.authSubject]);
      await tko_pool.query(`insert into tenant_members (id,tenant_id,user_id,role,status,display_name) values ($1,$2,$3,'owner','active','PostgreSQL Chat Owner')`, [tko_memberId, tko_tenantId, tko_userId]);

      const tko_channel = await tko_store.createChannel(tko_actor, { tenantId: tko_tenantId, kind: "private", name: `m2-attachment-${tko_tenantId.slice(0, 8)}`, memberIds: [tko_memberId], visibility: "private" });
      const tko_attachmentId = randomUUID();
      const tko_message = await tko_store.sendMessage(tko_actor, { tenantId: tko_tenantId, channelId: tko_channel.id, authorMemberId: tko_memberId, clientMessageId: randomUUID(), body: { type: "text", text: "Attachment metadata is durable." }, attachments: [{ id: tko_attachmentId, tenantId: tko_tenantId, objectKey: `tenants/${tko_tenantId}/attachments/${tko_attachmentId}/handoff.txt`, filename: "handoff.txt", contentType: "text/plain", url: "/manus-storage/not-persisted-as-file-bytes" }] }, tko_actor.correlationId);

      const tko_attachment = await tko_pool.query(`select object_key,filename,content_type from message_attachments where tenant_id=$1 and message_id=$2`, [tko_tenantId, tko_message.id]);
      const tko_durableEffects = await tko_pool.query(`select (select count(*) from audit_logs where tenant_id=$1 and resource_id=$2 and action='chat.message.created') as audits, (select count(*) from outbox where tenant_id=$1 and event_type='chat.message_created.v1') as events`, [tko_tenantId, tko_message.id]);

      expect(tko_message.attachments).toEqual([expect.objectContaining({ id: tko_attachmentId, filename: "handoff.txt", contentType: "text/plain" })]);
      expect(tko_attachment.rows).toEqual([expect.objectContaining({ object_key: expect.stringContaining("attachments/"), filename: "handoff.txt", content_type: "text/plain" })]);
      expect(tko_durableEffects.rows[0]).toMatchObject({ audits: "1", events: "1" });
    } finally {
      await tko_cleanupTenant(tko_pool, tko_tenantId, tko_userId);
      await tko_store.close();
      await tko_pool.end();
    }
  });

  it("updates a read cursor with PostgreSQL JSONB mention counting and durable audit/outbox", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    const tko_store = new PostgresChatStore(tko_postgresUrl!);
    const tko_tenantId = randomUUID();
    const tko_userId = randomUUID();
    const tko_memberId = randomUUID();
    const tko_actor: PlatformActor = { authSubject: `postgres-read-test:${tko_tenantId}`, tenantId: tko_tenantId, tenantSlug: `postgres-read-${tko_tenantId.slice(0, 8)}`, memberId: tko_memberId, role: "owner", membershipStatus: "active", correlationId: `postgres-read-${tko_tenantId}` };

    try {
      await tko_pool.query(`insert into tenants (id,slug,name,status,deployment_profile) values ($1,$2,$3,'active','single_tenant')`, [tko_tenantId, tko_actor.tenantSlug, "PostgreSQL Read Cursor Acceptance"]);
      await tko_pool.query(`insert into users (id,auth_subject,status) values ($1,$2,'active')`, [tko_userId, tko_actor.authSubject]);
      await tko_pool.query(`insert into tenant_members (id,tenant_id,user_id,role,status,display_name) values ($1,$2,$3,'owner','active','PostgreSQL Read Owner')`, [tko_memberId, tko_tenantId, tko_userId]);

      const tko_channel = await tko_store.createChannel(tko_actor, { tenantId: tko_tenantId, kind: "private", name: `m2-read-${tko_tenantId.slice(0, 8)}`, memberIds: [tko_memberId], visibility: "private" });
      await tko_store.sendMessage(tko_actor, { tenantId: tko_tenantId, channelId: tko_channel.id, authorMemberId: tko_memberId, clientMessageId: randomUUID(), body: { type: "text", text: "Mention makes read cursor exercise JSONB.", mentions: [tko_memberId] } }, tko_actor.correlationId);

      const tko_cursor = await tko_store.updateReadState(tko_actor, tko_channel.id, 1);
      const tko_durableEffects = await tko_pool.query(`select (select count(*) from audit_logs where tenant_id=$1 and resource_id=$2 and action='chat.read_cursor.updated') as audits, (select count(*) from outbox where tenant_id=$1 and event_type='chat.read_cursor_updated.v1') as events`, [tko_tenantId, tko_channel.id]);

      expect(tko_cursor).toMatchObject({ channelId: tko_channel.id, memberId: tko_memberId, lastReadSeq: 1, unreadMentions: 0 });
      expect(tko_durableEffects.rows[0]).toMatchObject({ audits: "1", events: "1" });
    } finally {
      await tko_cleanupTenant(tko_pool, tko_tenantId, tko_userId);
      await tko_store.close();
      await tko_pool.end();
    }
  });
});
