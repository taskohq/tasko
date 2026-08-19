create table if not exists import_jobs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  source text not null check (source in ('jira','clickup','slack','crm_csv')),
  status text not null check (status in ('draft','parsed','validated','ready','executing','completed','failed','cancelled')),
  name text not null,
  source_object_key text,
  created_by_member_id uuid not null references tenant_members(id) on delete restrict,
  idempotency_key text not null,
  total_records integer not null default 0,
  imported_records integer not null default 0,
  warning_count integer not null default 0,
  error_count integer not null default 0,
  cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, idempotency_key)
);
create index if not exists import_jobs_tenant_updated_idx on import_jobs(tenant_id, updated_at desc);

create table if not exists import_staging_records (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  source_record_id text not null,
  source_type text not null,
  status text not null check (status in ('staged','valid','warning','error','imported','skipped')),
  payload_json jsonb not null default '{}'::jsonb,
  validation_json jsonb not null default '{}'::jsonb,
  target_kind text,
  target_entity_id uuid,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, import_job_id, source_record_id)
);
create index if not exists import_staging_records_job_status_idx on import_staging_records(tenant_id, import_job_id, status, created_at);

create table if not exists import_mappings (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  source_type text not null,
  target_kind text not null,
  duplicate_strategy text not null check (duplicate_strategy in ('skip','update','create_duplicate')),
  owner_member_id uuid references tenant_members(id) on delete set null,
  fields_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, import_job_id, source_type)
);

create table if not exists import_batches (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  sequence integer not null,
  status text not null check (status in ('queued','running','completed','failed')),
  idempotency_key text not null,
  record_ids_json jsonb not null default '[]'::jsonb,
  processed_count integer not null default 0,
  warning_count integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, import_job_id, idempotency_key),
  unique (tenant_id, import_job_id, sequence)
);
create index if not exists import_batches_job_status_idx on import_batches(tenant_id, import_job_id, status, sequence);

create table if not exists import_source_mappings (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  source_record_id text not null,
  target_kind text not null,
  target_entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, import_job_id, source_record_id)
);

create table if not exists developer_api_tokens (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  scopes_json jsonb not null default '[]'::jsonb,
  created_by_member_id uuid not null references tenant_members(id) on delete restrict,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (token_hash)
);
create index if not exists developer_api_tokens_tenant_idx on developer_api_tokens(tenant_id, created_at desc);

create table if not exists webhook_subscriptions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  name text not null,
  endpoint_url text not null,
  signing_secret_hash text not null,
  signing_secret_ciphertext text not null,
  event_types_json jsonb not null default '[]'::jsonb,
  status text not null check (status in ('active','disabled')),
  consecutive_failures integer not null default 0,
  created_by_member_id uuid not null references tenant_members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  subscription_id uuid not null references webhook_subscriptions(id) on delete cascade,
  outbox_event_id uuid not null,
  event_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pending','delivered','retrying','dead_letter')),
  attempts integer not null default 0,
  response_status integer,
  response_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (tenant_id, subscription_id, outbox_event_id)
);
create index if not exists webhook_deliveries_pending_idx on webhook_deliveries(status, next_attempt_at);

create table if not exists external_connections (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  provider text not null check (provider in ('github','gitlab','jira','clickup','slack')),
  status text not null check (status in ('pending','connected','disabled','error')),
  display_name text not null,
  external_account_id text,
  encrypted_secret_ref text,
  config_json jsonb not null default '{}'::jsonb,
  created_by_member_id uuid not null references tenant_members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, external_account_id)
);

alter table import_jobs enable row level security;
alter table import_staging_records enable row level security;
alter table import_mappings enable row level security;
alter table import_batches enable row level security;
alter table import_source_mappings enable row level security;
alter table developer_api_tokens enable row level security;
alter table webhook_subscriptions enable row level security;
alter table webhook_deliveries enable row level security;
alter table external_connections enable row level security;

create policy import_jobs_isolation on import_jobs using (tenant_id = tasko_current_tenant_id());
create policy import_staging_records_isolation on import_staging_records using (tenant_id = tasko_current_tenant_id());
create policy import_mappings_isolation on import_mappings using (tenant_id = tasko_current_tenant_id());
create policy import_batches_isolation on import_batches using (tenant_id = tasko_current_tenant_id());
create policy import_source_mappings_isolation on import_source_mappings using (tenant_id = tasko_current_tenant_id());
create policy developer_api_tokens_isolation on developer_api_tokens using (tenant_id = tasko_current_tenant_id());
create policy webhook_subscriptions_isolation on webhook_subscriptions using (tenant_id = tasko_current_tenant_id());
create policy webhook_deliveries_isolation on webhook_deliveries using (tenant_id = tasko_current_tenant_id());
create policy external_connections_isolation on external_connections using (tenant_id = tasko_current_tenant_id());
