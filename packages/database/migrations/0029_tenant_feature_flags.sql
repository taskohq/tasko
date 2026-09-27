-- Tenant-scoped feature-flag overrides (spec 03 P0, spec 22 §10). Static env defaults live in
-- TASKO_FEATURE_<NAME>; this table stores per-tenant overrides resolved on top of them.

create table if not exists tenant_feature_flags (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  flag_key text not null check (flag_key <> ''),
  enabled boolean not null,
  set_by_auth_subject text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, flag_key)
);
create index if not exists tenant_feature_flags_tenant_idx on tenant_feature_flags(tenant_id);

alter table tenant_feature_flags enable row level security;
create policy tenant_feature_flags_isolation on tenant_feature_flags using (tenant_id = tasko_current_tenant_id());
