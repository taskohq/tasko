create table if not exists ai_runs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  requested_by_member_id uuid not null references tenant_members(id) on delete restrict,
  mode text not null check (mode in ('read','draft','proposal')),
  prompt text not null,
  status text not null check (status in ('running','completed','failed','blocked')),
  model text,
  output text,
  input_tokens integer,
  output_tokens integer,
  cost_micros bigint,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ai_runs_tenant_created_idx on ai_runs(tenant_id, created_at desc);

create table if not exists ai_context_references (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  run_id uuid not null references ai_runs(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('work_item','project','channel','message','lead','deal','document','form')),
  resource_id uuid not null,
  label text not null,
  locator text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, run_id, resource_kind, resource_id)
);
create index if not exists ai_context_references_run_idx on ai_context_references(tenant_id, run_id);

create table if not exists ai_tool_proposals (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  run_id uuid not null references ai_runs(id) on delete cascade,
  tool_name text not null check (tool_name in ('context.read','work_item.draft','document.draft','work_item.create','chat.message.send')),
  risk text not null check (risk in ('read','draft','write')),
  input_json jsonb not null default '{}'::jsonb,
  preview_json jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null check (status in ('proposed','confirmed','executed','rejected','failed','expired')),
  proposed_by_member_id uuid not null references tenant_members(id) on delete restrict,
  confirmed_by_member_id uuid references tenant_members(id) on delete set null,
  executed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index if not exists ai_tool_proposals_tenant_status_idx on ai_tool_proposals(tenant_id, status, created_at desc);

alter table ai_runs enable row level security;
alter table ai_context_references enable row level security;
alter table ai_tool_proposals enable row level security;
create policy ai_runs_isolation on ai_runs using (tenant_id = tasko_current_tenant_id());
create policy ai_context_references_isolation on ai_context_references using (tenant_id = tasko_current_tenant_id());
create policy ai_tool_proposals_isolation on ai_tool_proposals using (tenant_id = tasko_current_tenant_id());
