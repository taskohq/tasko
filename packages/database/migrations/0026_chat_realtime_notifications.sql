-- M2 Chat realtime + notifications. Idempotency scope fix (spec 13 §5), per-user notification
-- preferences with quiet hours (spec 08 §8 / 11 §9) and PostgreSQL FTS for chat search (spec 08 §11).

-- 1. Client message idempotency is scoped to (tenant_id, sender_id, client_message_id) so a retry
--    from a different channel or after a channel change still resolves to the original message.
alter table messages drop constraint if exists messages_channel_id_client_message_id_key;
alter table messages drop constraint if exists messages_tenant_author_client_message_id_key;
alter table messages add constraint messages_tenant_author_client_message_id_key unique (tenant_id, author_member_id, client_message_id);

-- 2. Per-user notification defaults and quiet hours. Nullable fields keep existing rows valid;
--    an empty prefs object means "fall back to product defaults".
alter table tenant_members add column if not exists notification_prefs_json jsonb not null default '{}'::jsonb;

-- 3. Full-text search over message plain text: stored tsvector + GIN index, plus a trigram-free
--    snippet headline comes from ts_headline at query time.
alter table messages drop column if exists search_vector;
alter table messages add column if not exists search_vector tsvector generated always as (to_tsvector('simple', coalesce(plain_text, ''))) stored;
create index if not exists messages_search_vector_idx on messages using gin (search_vector);
create index if not exists messages_tenant_created_idx on messages (tenant_id, created_at desc);
create index if not exists channel_members_member_idx on channel_members (tenant_id, member_id);
