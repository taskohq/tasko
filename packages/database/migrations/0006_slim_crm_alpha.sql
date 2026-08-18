create table if not exists crm_pipelines (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists crm_pipeline_stages (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  pipeline_id uuid not null references crm_pipelines(id) on delete cascade,
  name text not null,
  sort_order integer not null,
  probability_default integer not null default 0 check (probability_default between 0 and 100),
  category text not null default 'open' check (category in ('open', 'won', 'lost')),
  unique (pipeline_id, sort_order),
  unique (pipeline_id, name)
);

create table if not exists crm_companies (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  domain text not null default '',
  website text not null default '',
  industry text not null default '',
  employee_range text not null default '',
  country text not null default '',
  owner_member_id uuid not null references tenant_members(id),
  lifecycle_status text not null default 'prospect',
  tags_json jsonb not null default '[]'::jsonb,
  custom_fields_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists crm_contacts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid references crm_companies(id),
  first_name text not null,
  last_name text not null,
  title text not null default '',
  emails_json jsonb not null default '[]'::jsonb,
  phones_json jsonb not null default '[]'::jsonb,
  owner_member_id uuid not null references tenant_members(id),
  tags_json jsonb not null default '[]'::jsonb,
  custom_fields_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm_leads (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  owner_member_id uuid not null references tenant_members(id),
  first_name text not null,
  last_name text not null,
  company_name text not null default '',
  job_title text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  country text not null default '',
  source text not null default '',
  status text not null default 'new' check (status in ('new','contacted','qualified','nurture','disqualified','converted')),
  score integer check (score is null or score between 0 and 100),
  tags_json jsonb not null default '[]'::jsonb,
  notes text not null default '',
  next_follow_up_at timestamptz,
  custom_fields_json jsonb not null default '{}'::jsonb,
  converted_at timestamptz,
  converted_company_id uuid references crm_companies(id),
  converted_contact_id uuid references crm_contacts(id),
  converted_deal_id uuid,
  conversion_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, conversion_key)
);
create index if not exists crm_leads_tenant_status_follow_up_idx on crm_leads(tenant_id, status, next_follow_up_at);

create table if not exists crm_deals (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid references crm_companies(id),
  pipeline_id uuid not null references crm_pipelines(id),
  stage_id uuid not null references crm_pipeline_stages(id),
  name text not null,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  currency text not null default 'USD',
  probability integer not null default 0 check (probability between 0 and 100),
  owner_member_id uuid not null references tenant_members(id),
  expected_close_date date,
  source text not null default '',
  next_step text not null default '',
  won_at timestamptz,
  lost_at timestamptz,
  loss_reason text not null default '',
  custom_fields_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table crm_leads add constraint crm_leads_converted_deal_fk foreign key (converted_deal_id) references crm_deals(id) deferrable initially deferred;
create index if not exists crm_deals_tenant_pipeline_stage_idx on crm_deals(tenant_id, pipeline_id, stage_id);

create table if not exists crm_activities (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  entity_type text not null check (entity_type in ('lead','company','contact','deal')),
  entity_id uuid not null,
  activity_type text not null check (activity_type in ('note','call','meeting','email_reference','status_change','file','linked_work_event')),
  subject text not null default '',
  body text not null default '',
  metadata_json jsonb not null default '{}'::jsonb,
  created_by_member_id uuid not null references tenant_members(id),
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_tenant_entity_created_idx on crm_activities(tenant_id, entity_type, entity_id, created_at desc);

create table if not exists crm_entity_links (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  source_type text not null check (source_type in ('lead','company','contact','deal')),
  source_id uuid not null,
  target_type text not null check (target_type in ('work_item','project','channel','message')),
  target_id uuid not null,
  relation_type text not null check (relation_type in ('follow_up','delivery_project','delivery_channel','context')),
  created_at timestamptz not null default now(),
  unique (tenant_id, source_type, source_id, target_type, target_id, relation_type)
);

create table if not exists crm_deal_handoffs (
  deal_id uuid primary key references crm_deals(id),
  tenant_id uuid not null references tenants(id),
  delivery_project_id uuid references projects(id),
  delivery_channel_id uuid references channels(id),
  status text not null default 'pending' check (status in ('pending','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

do $$
declare tko_table text;
begin
  foreach tko_table in array array['crm_pipelines','crm_pipeline_stages','crm_companies','crm_contacts','crm_leads','crm_deals','crm_activities','crm_entity_links','crm_deal_handoffs']
  loop
    execute format('alter table %I enable row level security', tko_table);
    execute format('drop policy if exists tasko_tenant_isolation on %I', tko_table);
    execute format('create policy tasko_tenant_isolation on %I using (tenant_id = tasko_current_tenant_id()) with check (tenant_id = tasko_current_tenant_id())', tko_table);
  end loop;
end $$;
