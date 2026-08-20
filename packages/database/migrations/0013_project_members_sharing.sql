create table if not exists project_members (
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id) on delete cascade,
  member_id uuid not null references tenant_members(id),
  project_role text not null check (project_role in ('viewer', 'editor')),
  added_by_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  primary key (project_id, member_id)
);

create index if not exists project_members_tenant_project_idx on project_members (tenant_id, project_id, created_at);
create index if not exists project_members_tenant_member_idx on project_members (tenant_id, member_id, project_id);

insert into project_members (tenant_id, project_id, member_id, project_role, added_by_member_id)
select p.tenant_id, p.id, p.owner_member_id, 'editor', p.owner_member_id
from projects p
on conflict (project_id, member_id) do nothing;

alter table project_members enable row level security;
drop policy if exists tasko_tenant_isolation on project_members;
create policy tasko_tenant_isolation on project_members
  using (tenant_id = tasko_current_tenant_id())
  with check (tenant_id = tasko_current_tenant_id());
