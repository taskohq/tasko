create table if not exists work_comment_reactions (
  tenant_id uuid not null references tenants(id) on delete cascade,
  comment_id uuid not null references work_comments(id) on delete cascade,
  member_id uuid not null references tenant_members(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (tenant_id, comment_id, member_id, emoji)
);

create index if not exists work_comment_reactions_comment_created_idx
  on work_comment_reactions (tenant_id, comment_id, created_at);

create table if not exists work_comment_attachments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  comment_id uuid not null references work_comments(id) on delete cascade,
  object_key text not null,
  filename text not null,
  content_type text not null check (content_type like 'image/%'),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  uploaded_by_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now()
);

create index if not exists work_comment_attachments_comment_created_idx
  on work_comment_attachments (tenant_id, comment_id, created_at);

alter table work_comment_reactions enable row level security;
drop policy if exists tasko_tenant_isolation on work_comment_reactions;
create policy tasko_tenant_isolation on work_comment_reactions
  using (tenant_id = tasko_current_tenant_id())
  with check (tenant_id = tasko_current_tenant_id());

alter table work_comment_attachments enable row level security;
drop policy if exists tasko_tenant_isolation on work_comment_attachments;
create policy tasko_tenant_isolation on work_comment_attachments
  using (tenant_id = tasko_current_tenant_id())
  with check (tenant_id = tasko_current_tenant_id());
