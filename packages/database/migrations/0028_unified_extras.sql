-- Tasko M4 unified workspace extras: document version history (spec 10 §2 P2),
-- public form sharing (spec 10 §5) and automation v2 trigger coverage (spec 12).

-- 1. Document revision history: append-only snapshots taken atomically with each
--    content update; restore writes a NEW revision and never rewrites history.
create table if not exists document_revisions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  document_id uuid not null references workspace_documents(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot_json jsonb not null default '{}'::jsonb,
  author_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, document_id, version)
);
create index if not exists document_revisions_tenant_document_idx on document_revisions(tenant_id, document_id, version desc);

-- 2. Public form share mode: a per-tenant unique slug plus an explicit public flag.
alter table workspace_forms
  add column if not exists share_slug text,
  add column if not exists is_public boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_forms_share_slug_ck') then
    alter table workspace_forms add constraint workspace_forms_share_slug_ck check (share_slug is null or share_slug <> '');
  end if;
end $$;

create unique index if not exists workspace_forms_tenant_share_slug_idx on workspace_forms(tenant_id, share_slug) where share_slug is not null;

-- 3. Automation v2: widen the trigger allowlist. The 0007 constraint predates the
--    canonical `work.work_item_created.v1` event name used by every producer today.
do $$
declare tko_constraint_name text;
begin
  for tko_constraint_name in
    select conname from pg_constraint
    where conrelid = 'workspace_automation_rules'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%trigger_type%'
  loop
    execute format('alter table workspace_automation_rules drop constraint %I', tko_constraint_name);
  end loop;
end $$;

alter table workspace_automation_rules add constraint workspace_automation_rules_trigger_type_ck
  check (trigger_type in (
    'crm.lead_created.v1',
    'work.work_item_created.v1',
    'work.work_item_status_changed.v1',
    'crm.deal_stage_changed.v1',
    'crm.deal_won.v1',
    'workspace.form_submitted.v1'
  ));

do $$
declare tko_table text;
begin
  foreach tko_table in array array['document_revisions']
  loop
    execute format('alter table %I enable row level security', tko_table);
    execute format('drop policy if exists tasko_tenant_isolation on %I', tko_table);
    execute format('create policy tasko_tenant_isolation on %I using (tenant_id = tasko_current_tenant_id()) with check (tenant_id = tasko_current_tenant_id())', tko_table);
  end loop;
end $$;
