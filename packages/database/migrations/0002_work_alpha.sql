-- Tasko M1 / Work Alpha. Every operational row is tenant-scoped and RLS protected.
create table if not exists spaces (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  slug text not null,
  visibility text not null default 'internal' check (visibility in ('internal', 'private', 'guest_shared')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists workflows (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_statuses (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  workflow_id uuid not null references workflows(id),
  name text not null,
  category text not null check (category in ('todo', 'in_progress', 'done')),
  color_token text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (workflow_id, sort_order),
  unique (workflow_id, name)
);

create table if not exists workflow_transitions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  workflow_id uuid not null references workflows(id),
  from_status_id uuid references workflow_statuses(id),
  to_status_id uuid not null references workflow_statuses(id),
  restrictions_json jsonb not null default '{}'::jsonb,
  unique (workflow_id, from_status_id, to_status_id)
);

create table if not exists work_types (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid,
  name text not null,
  category text not null check (category in ('epic', 'story', 'task', 'bug', 'request', 'milestone')),
  icon text not null default 'circle',
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, project_id, name)
);

create table if not exists projects (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  space_id uuid not null references spaces(id),
  key text not null,
  sequence_counter integer not null default 0,
  name text not null,
  description text not null default '',
  owner_member_id uuid not null references tenant_members(id),
  visibility text not null default 'internal' check (visibility in ('internal', 'private', 'guest_shared')),
  methodology text not null check (methodology in ('kanban', 'scrum', 'simple')),
  workflow_id uuid not null references workflows(id),
  start_at timestamptz,
  due_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

alter table work_types add constraint work_types_project_fk foreign key (project_id) references projects(id) deferrable initially deferred;

create table if not exists work_items (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  sequence_no integer not null,
  work_type_id uuid not null references work_types(id),
  parent_id uuid references work_items(id),
  workflow_id uuid not null references workflows(id),
  status_id uuid not null references workflow_statuses(id),
  title text not null,
  description_json jsonb not null default '{}'::jsonb,
  description_text text not null default '',
  priority text not null default 'none' check (priority in ('none', 'low', 'medium', 'high', 'urgent')),
  reporter_member_id uuid not null references tenant_members(id),
  start_at timestamptz,
  due_at timestamptz,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes >= 0),
  rank text not null default 'm',
  version integer not null default 1,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence_no)
);
create index if not exists work_items_tenant_project_status_rank_idx on work_items (tenant_id, project_id, status_id, rank);
create index if not exists work_items_tenant_parent_idx on work_items (tenant_id, parent_id);
create index if not exists work_items_tenant_due_idx on work_items (tenant_id, due_at);

create table if not exists work_item_assignees (
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id),
  member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  primary key (work_item_id, member_id)
);

create table if not exists work_labels (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  color_token text not null,
  unique (tenant_id, name)
);
create table if not exists work_item_labels (
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id),
  label_id uuid not null references work_labels(id),
  primary key (work_item_id, label_id)
);

create table if not exists work_item_relations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  source_work_item_id uuid not null references work_items(id),
  target_work_item_id uuid not null references work_items(id),
  relation_type text not null check (relation_type in ('blocks', 'blocked_by', 'relates_to', 'duplicates', 'duplicated_by')),
  created_by_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now(),
  unique (source_work_item_id, target_work_item_id, relation_type)
);

create table if not exists work_comments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id),
  author_member_id uuid not null references tenant_members(id),
  body_json jsonb not null default '{}'::jsonb,
  body_text text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create table if not exists work_item_history (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  work_item_id uuid not null references work_items(id),
  actor_member_id uuid not null references tenant_members(id),
  field_name text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists sprints (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  name text not null,
  goal text not null default '',
  state text not null default 'planned' check (state in ('planned', 'active', 'completed')),
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists sprint_items (
  tenant_id uuid not null references tenants(id),
  sprint_id uuid not null references sprints(id),
  work_item_id uuid not null references work_items(id),
  rank text not null default 'm',
  primary key (sprint_id, work_item_id)
);

create table if not exists custom_field_definitions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  scope_type text not null check (scope_type in ('project', 'space')),
  scope_id uuid not null,
  entity_type text not null default 'work_item',
  name text not null,
  field_type text not null check (field_type in ('text', 'long_text', 'number', 'boolean', 'date', 'datetime', 'single_select', 'multi_select', 'user', 'url', 'email')),
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists custom_field_values (
  tenant_id uuid not null references tenants(id),
  field_id uuid not null references custom_field_definitions(id),
  entity_type text not null default 'work_item',
  entity_id uuid not null,
  value_json jsonb not null,
  primary key (field_id, entity_type, entity_id)
);

create table if not exists saved_views (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  owner_member_id uuid not null references tenant_members(id),
  module text not null default 'work',
  renderer text not null check (renderer in ('list', 'board', 'calendar', 'timeline')),
  name text not null,
  filter_json jsonb not null default '{}'::jsonb,
  layout_json jsonb not null default '{}'::jsonb,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare tko_table text;
begin
  foreach tko_table in array array['spaces', 'workflows', 'workflow_statuses', 'workflow_transitions', 'work_types', 'projects', 'work_items', 'work_item_assignees', 'work_labels', 'work_item_labels', 'work_item_relations', 'work_comments', 'work_item_history', 'sprints', 'sprint_items', 'custom_field_definitions', 'custom_field_values', 'saved_views']
  loop
    execute format('alter table %I enable row level security', tko_table);
    execute format('drop policy if exists tasko_tenant_isolation on %I', tko_table);
    execute format('create policy tasko_tenant_isolation on %I using (tenant_id = tasko_current_tenant_id()) with check (tenant_id = tasko_current_tenant_id())', tko_table);
  end loop;
end $$;
