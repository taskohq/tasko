create table if not exists project_invitations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  token_hash text not null unique,
  invitee_email text,
  project_role text not null check (project_role in ('viewer', 'editor')),
  created_by_member_id uuid not null references tenant_members(id),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_member_id uuid references tenant_members(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((redeemed_at is null) = (redeemed_by_member_id is null))
);

create index if not exists project_invitations_tenant_project_created_idx
  on project_invitations (tenant_id, project_id, created_at desc);
create index if not exists project_invitations_tenant_token_idx
  on project_invitations (tenant_id, token_hash);

alter table project_invitations enable row level security;
drop policy if exists tasko_tenant_isolation on project_invitations;
create policy tasko_tenant_isolation on project_invitations
  using (tenant_id = tasko_current_tenant_id())
  with check (tenant_id = tasko_current_tenant_id());
