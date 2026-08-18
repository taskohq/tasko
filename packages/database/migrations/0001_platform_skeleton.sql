-- Tasko M0: PostgreSQL is the durable source of truth.
-- This migration is intentionally independent of the managed MySQL development adapter.
create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  status text not null check (status in ('active', 'suspended')),
  deployment_profile text not null check (deployment_profile in ('single_tenant', 'saas')),
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key,
  auth_subject text not null unique,
  email text unique,
  display_name text,
  status text not null check (status in ('active', 'suspended')) default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_members (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  role text not null check (role in ('owner', 'admin', 'member', 'guest', 'service_account')),
  status text not null check (status in ('active', 'suspended', 'invited')) default 'active',
  display_name text not null,
  profile_json jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists teams (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  name text not null,
  handle text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, handle),
  unique (tenant_id, id)
);

create table if not exists team_members (
  tenant_id uuid not null references tenants(id) on delete restrict,
  team_id uuid not null,
  user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (tenant_id, team_id) references teams(tenant_id, id) on delete restrict
);

create table if not exists attachments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  object_key text not null,
  filename text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum text,
  uploader_auth_subject text not null,
  scan_status text not null check (scan_status in ('pending', 'clean', 'rejected')) default 'pending',
  created_at timestamptz not null default now(),
  unique (tenant_id, object_key)
);

create table if not exists domain_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  event_type text not null,
  actor_auth_subject text,
  entity_type text not null,
  entity_id text not null,
  payload_json jsonb not null,
  correlation_id text not null,
  occurred_at timestamptz not null default now()
);

create table if not exists outbox (
  id uuid primary key,
  event_id uuid not null unique,
  tenant_id uuid not null references tenants(id) on delete restrict,
  topic text not null,
  event_type text not null,
  payload_json jsonb not null,
  actor_auth_subject text,
  correlation_id text not null,
  status text not null check (status in ('pending', 'processing', 'processed', 'dead_letter')) default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists outbox_pending_idx on outbox (status, available_at, created_at)
  where status = 'pending';
create index if not exists outbox_tenant_idx on outbox (tenant_id, created_at desc);

create table if not exists audit_logs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  actor_auth_subject text,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  correlation_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at desc);

-- Every tenant-owned write must use the session tenant context in addition to application filters.
alter table tenant_members enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table attachments enable row level security;
alter table domain_events enable row level security;
alter table outbox enable row level security;
alter table audit_logs enable row level security;

create or replace function tasko_current_tenant_id() returns uuid as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid;
$$ language sql stable;

create policy tenant_members_isolation on tenant_members using (tenant_id = tasko_current_tenant_id());
create policy teams_isolation on teams using (tenant_id = tasko_current_tenant_id());
create policy team_members_isolation on team_members using (tenant_id = tasko_current_tenant_id());
create policy attachments_isolation on attachments using (tenant_id = tasko_current_tenant_id());
create policy domain_events_isolation on domain_events using (tenant_id = tasko_current_tenant_id());
create policy outbox_isolation on outbox using (tenant_id = tasko_current_tenant_id());
create policy audit_logs_isolation on audit_logs using (tenant_id = tasko_current_tenant_id());
