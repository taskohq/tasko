create table if not exists workspace_invitations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  email text not null,
  role text not null check (role in ('admin', 'member', 'guest')),
  token_hash text not null unique,
  status text not null check (status in ('pending', 'accepted', 'revoked', 'expired')) default 'pending',
  created_by_auth_subject text not null,
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by_auth_subject text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_invitations_tenant_created_idx
  on workspace_invitations (tenant_id, created_at desc);
create unique index if not exists workspace_invitations_pending_email_idx
  on workspace_invitations (tenant_id, lower(email)) where status = 'pending';
create index if not exists workspace_invitations_token_idx
  on workspace_invitations (token_hash) where status = 'pending';

alter table workspace_invitations enable row level security;
create policy workspace_invitations_isolation on workspace_invitations
  using (tenant_id = tasko_current_tenant_id());
