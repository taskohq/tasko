alter table chat_reminders add column if not exists schedule_cron_task_uid varchar(65);
alter table chat_reminders add column if not exists push_delivered_at timestamptz;
alter table chat_reminders add column if not exists push_delivery_claimed_at timestamptz;
create index if not exists chat_reminders_schedule_task_idx on chat_reminders (schedule_cron_task_uid) where schedule_cron_task_uid is not null;

create table if not exists chat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid not null references tenant_members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent varchar(1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index if not exists chat_push_subscriptions_member_idx on chat_push_subscriptions (tenant_id, member_id) where disabled_at is null;
alter table chat_push_subscriptions enable row level security;
create policy chat_push_subscriptions_tenant_isolation on chat_push_subscriptions using (tenant_id = current_setting('app.tenant_id', true)::uuid);
