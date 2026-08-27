create table if not exists chat_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid not null references tenant_members(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  title varchar(500) not null,
  note text,
  reminder_at timestamptz not null,
  status text not null default 'open' check (status in ('open','done','dismissed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists chat_reminders_member_due_idx on chat_reminders (tenant_id, member_id, status, reminder_at);
alter table chat_reminders enable row level security;
create policy chat_reminders_tenant_isolation on chat_reminders using (tenant_id = current_setting('app.tenant_id', true)::uuid);
