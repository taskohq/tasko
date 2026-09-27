-- Tasko M0 security: revocable server-side sessions.
-- A session row is persisted for every minted session token (login, signup,
-- OAuth callback). Only the SHA-256 hash of the token is stored, so a database
-- leak cannot be replayed as a valid cookie. `authenticateRequest` refuses any
-- non-cron token whose session row is missing, expired or revoked.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null,
  token_hash text not null unique,
  tenant_id uuid references tenants(id) on delete set null,
  device text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists sessions_auth_subject_idx on sessions (auth_subject, revoked_at);
create index if not exists sessions_expires_idx on sessions (expires_at);
