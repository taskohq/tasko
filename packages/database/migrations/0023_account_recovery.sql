-- Account recovery (spec 06 §2 P1): self-service password reset and email
-- verification. Only the SHA-256 hash of each one-time token is persisted, so
-- a database leak cannot be replayed as a working recovery link. Tokens are
-- consumed atomically (`used_at` / `verified_at` is set only when still
-- unconsumed and unexpired) and expire after a short window.
create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_auth_subject_idx
  on password_reset_tokens (auth_subject, created_at);
create index if not exists password_reset_tokens_expires_idx
  on password_reset_tokens (expires_at);

create table if not exists email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_tokens_auth_subject_idx
  on email_verification_tokens (auth_subject, verified_at);
create index if not exists email_verification_tokens_expires_idx
  on email_verification_tokens (expires_at);
