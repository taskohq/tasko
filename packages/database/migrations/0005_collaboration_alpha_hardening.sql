create table if not exists message_attachments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  object_key text not null,
  filename varchar(180) not null,
  content_type varchar(160) not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, message_id, object_key)
);
create index if not exists message_attachments_message_idx on message_attachments (tenant_id, message_id);
alter table message_attachments enable row level security;
create policy message_attachments_tenant_isolation on message_attachments using (tenant_id = current_setting('app.tenant_id', true)::uuid);
