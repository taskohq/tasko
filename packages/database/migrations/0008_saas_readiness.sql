-- M5 SaaS readiness. Tenant-owned rows use the same session tenant RLS guard as M0-M4.

create table if not exists saas_plans (
  plan_key text primary key,
  name text not null,
  description text not null default '',
  entitlements_json jsonb not null default '{}'::jsonb,
  quotas_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into saas_plans (plan_key, name, description, entitlements_json, quotas_json)
values
  ('starter', 'Starter', 'Controlled pilot plan', '{"automation":true,"forms":true,"exports":true}'::jsonb, '{"work_items":5000,"automation_executions":1000,"form_submissions":2500}'::jsonb),
  ('growth', 'Growth', 'Multi-team operations plan', '{"automation":true,"forms":true,"exports":true,"advanced_reporting":true}'::jsonb, '{"work_items":25000,"automation_executions":10000,"form_submissions":25000}'::jsonb)
on conflict (plan_key) do nothing;

create table if not exists tenant_entitlements (
  tenant_id uuid primary key references tenants(id) on delete restrict,
  plan_key text not null references saas_plans(plan_key) on delete restrict,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  entitlements_json jsonb not null default '{}'::jsonb,
  quotas_json jsonb not null default '{}'::jsonb,
  billing_customer_ref text,
  billing_subscription_ref text,
  updated_at timestamptz not null default now()
);

create table if not exists tenant_usage_ledger (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  metric text not null,
  amount bigint not null check (amount >= 0),
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  unique (tenant_id, metric, idempotency_key)
);
create index if not exists tenant_usage_ledger_metric_idx on tenant_usage_ledger (tenant_id, metric, occurred_at desc);

create table if not exists tenant_backup_archives (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  schema_version text not null,
  checksum text not null,
  object_key text,
  status text not null check (status in ('requested', 'ready', 'verified', 'failed')),
  resource_counts_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tenant_backup_archives_tenant_created_idx on tenant_backup_archives (tenant_id, created_at desc);

create table if not exists tenant_restore_drills (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  backup_manifest_id uuid not null references tenant_backup_archives(id) on delete restrict,
  status text not null check (status in ('requested', 'verified', 'failed')),
  validation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists tenant_provisioning_requests (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  owner_auth_subject text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

alter table tenant_entitlements enable row level security;
alter table tenant_usage_ledger enable row level security;
alter table tenant_backup_archives enable row level security;
alter table tenant_restore_drills enable row level security;
alter table tenant_provisioning_requests enable row level security;

create policy tenant_entitlements_isolation on tenant_entitlements using (tenant_id = tasko_current_tenant_id());
create policy tenant_usage_ledger_isolation on tenant_usage_ledger using (tenant_id = tasko_current_tenant_id());
create policy tenant_backup_archives_isolation on tenant_backup_archives using (tenant_id = tasko_current_tenant_id());
create policy tenant_restore_drills_isolation on tenant_restore_drills using (tenant_id = tasko_current_tenant_id());
create policy tenant_provisioning_requests_isolation on tenant_provisioning_requests using (tenant_id = tasko_current_tenant_id());
