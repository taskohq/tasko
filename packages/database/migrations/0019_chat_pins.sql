create table if not exists pinned_messages (
  message_id uuid primary key references messages(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  pinned_by_member_id uuid not null references tenant_members(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists pinned_messages_tenant_channel_created_idx on pinned_messages (tenant_id, channel_id, created_at desc);
alter table pinned_messages enable row level security;
create policy pinned_messages_tenant_isolation on pinned_messages using (tenant_id = current_setting('app.tenant_id', true)::uuid);
