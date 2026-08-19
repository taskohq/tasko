create table if not exists email_password_credentials (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique references users(auth_subject) on delete cascade,
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_signed_in_at timestamptz
);
create index if not exists email_password_credentials_email_idx on email_password_credentials(email);
