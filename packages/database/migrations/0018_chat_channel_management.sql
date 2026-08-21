alter table channels add column if not exists created_by_member_id uuid references tenant_members(id);
alter table channels add column if not exists archived_at timestamptz;
create index if not exists channels_tenant_active_idx on channels(tenant_id, archived_at, created_at desc);
