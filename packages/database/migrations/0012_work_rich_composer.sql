alter table workflow_statuses add column if not exists description text not null default '';

create table if not exists work_item_checklist_items (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id) on delete cascade,
  body text not null,
  completed_at timestamptz,
  completed_by_member_id uuid references tenant_members(id),
  sort_order integer not null,
  created_by_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  unique (work_item_id, sort_order)
);
create index if not exists work_item_checklist_items_tenant_item_idx on work_item_checklist_items (tenant_id, work_item_id, sort_order);

create table if not exists work_item_attachments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id) on delete cascade,
  object_key text not null,
  filename text not null,
  content_type text not null,
  byte_size integer not null check (byte_size >= 0 and byte_size <= 10485760),
  uploaded_by_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  unique (work_item_id, object_key)
);
create index if not exists work_item_attachments_tenant_item_idx on work_item_attachments (tenant_id, work_item_id, created_at);

do $$
declare tko_table text;
begin
  foreach tko_table in array array['work_item_checklist_items', 'work_item_attachments']
  loop
    execute format('alter table %I enable row level security', tko_table);
    execute format('drop policy if exists tasko_tenant_isolation on %I', tko_table);
    execute format('create policy tasko_tenant_isolation on %I using (tenant_id = tasko_current_tenant_id()) with check (tenant_id = tasko_current_tenant_id())', tko_table);
  end loop;
end $$;
