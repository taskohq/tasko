-- M2 Collaboration Alpha. Every durable entity remains tenant-scoped and is protected by RLS.
create table if not exists channels (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('public','private','dm','group_dm')),
  name varchar(120), topic text, visibility text not null default 'internal' check (visibility in ('internal','private')),
  last_sequence bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists channel_members (
  tenant_id uuid not null references tenants(id) on delete cascade, channel_id uuid not null references channels(id) on delete cascade,
  member_id uuid not null references tenant_members(id) on delete cascade, last_read_seq bigint not null default 0,
  last_notified_seq bigint not null default 0, unread_mentions integer not null default 0, notification_level text not null default 'mentions',
  created_at timestamptz not null default now(), primary key (channel_id, member_id)
);
create table if not exists messages (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade, sequence bigint not null,
  client_message_id uuid not null, author_member_id uuid not null references tenant_members(id), body jsonb not null,
  plain_text text not null, parent_message_id uuid references messages(id), reply_count integer not null default 0,
  latest_reply_at timestamptz, linked_work_item_id uuid, edited_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now(),
  unique(channel_id, sequence), unique(channel_id, client_message_id)
);
create table if not exists message_reactions (
  tenant_id uuid not null references tenants(id) on delete cascade, message_id uuid not null references messages(id) on delete cascade,
  member_id uuid not null references tenant_members(id) on delete cascade, emoji varchar(64) not null, created_at timestamptz not null default now(),
  primary key(message_id, member_id, emoji)
);
create table if not exists saved_messages (
  tenant_id uuid not null references tenants(id) on delete cascade, message_id uuid not null references messages(id) on delete cascade,
  member_id uuid not null references tenant_members(id) on delete cascade, status text not null default 'open', note text, reminder_at timestamptz,
  created_at timestamptz not null default now(), primary key(message_id, member_id)
);
create index if not exists messages_tenant_channel_sequence_idx on messages (tenant_id, channel_id, sequence desc);
create index if not exists messages_plain_text_search_idx on messages using gin (to_tsvector('simple', plain_text));
alter table channels enable row level security; alter table channel_members enable row level security; alter table messages enable row level security;
alter table message_reactions enable row level security; alter table saved_messages enable row level security;
create policy channels_tenant_isolation on channels using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy channel_members_tenant_isolation on channel_members using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy messages_tenant_isolation on messages using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy message_reactions_tenant_isolation on message_reactions using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy saved_messages_tenant_isolation on saved_messages using (tenant_id = current_setting('app.tenant_id', true)::uuid);
