-- Tasko M1 Work extras: watchers, time logs. Labels (work_labels / work_item_labels)
-- and workflow transitions already exist from 0002; this migration only adds what is missing.
create table if not exists work_item_watchers (
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id),
  member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  primary key (work_item_id, member_id)
);
create index if not exists work_item_watchers_tenant_member_idx on work_item_watchers (tenant_id, member_id);

create table if not exists work_time_logs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id),
  member_id uuid not null references tenant_members(id),
  minutes integer not null check (minutes > 0 and minutes <= 100000),
  started_at timestamptz not null default now(),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists work_time_logs_tenant_item_idx on work_time_logs (tenant_id, work_item_id);
create index if not exists work_time_logs_tenant_member_idx on work_time_logs (tenant_id, member_id);

do $$
declare tko_table text;
begin
  foreach tko_table in array array['work_item_watchers', 'work_time_logs']
  loop
    execute format('alter table %I enable row level security', tko_table);
    execute format('drop policy if exists tasko_tenant_isolation on %I', tko_table);
    execute format('create policy tasko_tenant_isolation on %I using (tenant_id = tasko_current_tenant_id()) with check (tenant_id = tasko_current_tenant_id())', tko_table);
  end loop;
end $$;
