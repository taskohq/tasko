-- TOTP multi-factor authentication (spec 06 §2 P1, RFC 6238).
-- One row per account. The TOTP shared secret is stored encrypted with
-- AES-256-GCM (key derived via scrypt from JWT_SECRET) — never in plaintext.
-- Recovery codes are stored as SHA-256 hashes with a used marker.
create table if not exists totp_credentials (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  secret_encrypted text not null,
  enabled_at timestamptz,
  confirmed_at timestamptz,
  recovery_codes_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists totp_credentials_enabled_idx
  on totp_credentials (auth_subject, enabled_at);
