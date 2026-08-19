create table if not exists workspace_search_documents (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  entity_type text not null check (entity_type in ('work_item','project','channel','message','crm_lead','crm_company','crm_contact','crm_deal','document','form')),
  entity_id uuid not null,
  kind text not null check (kind in ('work','chat','crm','doc')),
  title text not null,
  body_text text not null default '',
  href text not null,
  visibility text not null default 'internal' check (visibility in ('internal','private','guest_shared')),
  explicit_member_ids_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_type, entity_id)
);
create index if not exists workspace_search_documents_tenant_kind_idx on workspace_search_documents(tenant_id, kind, updated_at desc);
create index if not exists workspace_search_documents_fts_idx on workspace_search_documents using gin (to_tsvector('simple', title || ' ' || body_text));

create table if not exists workspace_inbox_items (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  member_id uuid not null references tenant_members(id),
  kind text not null check (kind in ('mention','assignment','comment','deal','form','automation','system')),
  entity_type text not null check (entity_type in ('work_item','project','channel','message','crm_lead','crm_company','crm_contact','crm_deal','document','form')),
  entity_id uuid not null,
  title text not null,
  body text not null default '',
  href text not null,
  source_event_id uuid,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, member_id, source_event_id, kind)
);
create index if not exists workspace_inbox_items_tenant_member_state_idx on workspace_inbox_items(tenant_id, member_id, archived_at, read_at, created_at desc);

create table if not exists workspace_entity_links (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  source_type text not null check (source_type in ('work_item','project','channel','message','crm_lead','crm_company','crm_contact','crm_deal','document','form')),
  source_id uuid not null,
  target_type text not null check (target_type in ('work_item','project','channel','message','crm_lead','crm_company','crm_contact','crm_deal','document','form')),
  target_id uuid not null,
  relation_type text not null check (relation_type in ('context','reference','related','blocks')),
  created_at timestamptz not null default now(),
  unique (tenant_id, source_type, source_id, target_type, target_id, relation_type)
);

create table if not exists workspace_documents (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  title text not null,
  content_json jsonb not null default '{}'::jsonb,
  body_text text not null default '',
  owner_member_id uuid not null references tenant_members(id),
  visibility text not null default 'internal' check (visibility in ('internal','private','guest_shared')),
  template_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspace_documents_tenant_updated_idx on workspace_documents(tenant_id, updated_at desc);

create table if not exists workspace_document_links (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references workspace_documents(id) on delete cascade,
  entity_type text not null check (entity_type in ('work_item','project','channel','message','crm_lead','crm_company','crm_contact','crm_deal','document','form')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, document_id, entity_type, entity_id)
);

create table if not exists workspace_forms (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','active','archived')),
  access_mode text not null default 'internal' check (access_mode in ('internal')),
  fields_json jsonb not null default '[]'::jsonb,
  target_type text not null check (target_type in ('work_item','crm_lead')),
  target_config_json jsonb not null default '{}'::jsonb,
  owner_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists workspace_form_submissions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  form_id uuid not null references workspace_forms(id) on delete cascade,
  submitted_by_member_id uuid not null references tenant_members(id),
  values_json jsonb not null default '{}'::jsonb,
  target_entity_type text not null check (target_entity_type in ('work_item','crm_lead')),
  target_entity_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, form_id, idempotency_key)
);

create table if not exists workspace_automation_rules (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  status text not null default 'active' check (status in ('active','paused')),
  trigger_type text not null check (trigger_type in ('crm.lead_created.v1','work.item_created.v1','workspace.form_submitted.v1')),
  condition_json jsonb not null default '{}'::jsonb,
  actions_json jsonb not null default '[]'::jsonb,
  owner_member_id uuid not null references tenant_members(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists workspace_automation_executions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  rule_id uuid not null references workspace_automation_rules(id) on delete cascade,
  rule_version integer not null,
  source_event_id uuid not null,
  status text not null check (status in ('completed','failed','skipped')),
  results_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, rule_id, source_event_id, rule_version)
);

do $$
declare tko_table text;
begin
  foreach tko_table in array array['workspace_search_documents','workspace_inbox_items','workspace_entity_links','workspace_documents','workspace_document_links','workspace_forms','workspace_form_submissions','workspace_automation_rules','workspace_automation_executions']
  loop
    execute format('alter table %I enable row level security', tko_table);
    execute format('drop policy if exists tasko_tenant_isolation on %I', tko_table);
    execute format('create policy tasko_tenant_isolation on %I using (tenant_id = tasko_current_tenant_id()) with check (tenant_id = tasko_current_tenant_id())', tko_table);
  end loop;
end $$;
