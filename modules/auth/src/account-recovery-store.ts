import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { tko_config } from "../../../packages/config/src/tasko-config";

/**
 * Durable storage for one-time account-recovery tokens (spec 06 §2 P1):
 * password reset and email verification. Only SHA-256 token hashes are stored.
 * Consumption is atomic: a token is consumed only when still unconsumed and
 * unexpired, so a raced double-submit cannot reuse it.
 */

export interface PasswordResetTokenRecord {
  id: string;
  authSubject: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface EmailVerificationTokenRecord {
  id: string;
  authSubject: string;
  tokenHash: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
}

export interface AccountRecoveryStore {
  createPasswordResetToken(tko_input: { authSubject: string; tokenHash: string; expiresAt: Date }): Promise<PasswordResetTokenRecord>;
  /** Atomically consume a reset token; null when unknown, already used, or expired. */
  consumePasswordResetToken(tko_tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  /** Invalidate unconsumed reset tokens for the subject (a fresh request supersedes old links). */
  clearPendingPasswordResetTokens(tko_authSubject: string): Promise<void>;
  createEmailVerificationToken(tko_input: { authSubject: string; tokenHash: string; expiresAt: Date }): Promise<EmailVerificationTokenRecord>;
  /** Atomically mark a verification token verified; null when unknown, already verified, or expired. */
  consumeEmailVerificationToken(tko_tokenHash: string): Promise<EmailVerificationTokenRecord | null>;
  clearPendingEmailVerificationTokens(tko_authSubject: string): Promise<void>;
  isEmailVerified(tko_authSubject: string): Promise<boolean>;
}

function tko_mapResetRow(tko_row: Record<string, unknown>): PasswordResetTokenRecord {
  return {
    id: String(tko_row.id),
    authSubject: String(tko_row.auth_subject),
    tokenHash: String(tko_row.token_hash),
    expiresAt: new Date(String(tko_row.expires_at)),
    usedAt: tko_row.used_at ? new Date(String(tko_row.used_at)) : null,
    createdAt: new Date(String(tko_row.created_at)),
  };
}

function tko_mapVerificationRow(tko_row: Record<string, unknown>): EmailVerificationTokenRecord {
  return {
    id: String(tko_row.id),
    authSubject: String(tko_row.auth_subject),
    tokenHash: String(tko_row.token_hash),
    expiresAt: new Date(String(tko_row.expires_at)),
    verifiedAt: tko_row.verified_at ? new Date(String(tko_row.verified_at)) : null,
    createdAt: new Date(String(tko_row.created_at)),
  };
}

export class MemoryAccountRecoveryStore implements AccountRecoveryStore {
  readonly tko_resetTokens = new Map<string, PasswordResetTokenRecord>();
  readonly tko_verificationTokens = new Map<string, EmailVerificationTokenRecord>();

  async createPasswordResetToken(tko_input: { authSubject: string; tokenHash: string; expiresAt: Date }): Promise<PasswordResetTokenRecord> {
    const tko_record: PasswordResetTokenRecord = { id: randomUUID(), authSubject: tko_input.authSubject, tokenHash: tko_input.tokenHash, expiresAt: new Date(tko_input.expiresAt), usedAt: null, createdAt: new Date() };
    this.tko_resetTokens.set(tko_record.tokenHash, tko_record);
    return { ...tko_record };
  }

  async consumePasswordResetToken(tko_tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    const tko_record = this.tko_resetTokens.get(tko_tokenHash);
    if (!tko_record || tko_record.usedAt || tko_record.expiresAt.getTime() <= Date.now()) return null;
    tko_record.usedAt = new Date();
    return { ...tko_record };
  }

  async clearPendingPasswordResetTokens(tko_authSubject: string): Promise<void> {
    for (const [tko_hash, tko_record] of Array.from(this.tko_resetTokens.entries())) {
      if (tko_record.authSubject === tko_authSubject && !tko_record.usedAt) this.tko_resetTokens.delete(tko_hash);
    }
  }

  async createEmailVerificationToken(tko_input: { authSubject: string; tokenHash: string; expiresAt: Date }): Promise<EmailVerificationTokenRecord> {
    const tko_record: EmailVerificationTokenRecord = { id: randomUUID(), authSubject: tko_input.authSubject, tokenHash: tko_input.tokenHash, expiresAt: new Date(tko_input.expiresAt), verifiedAt: null, createdAt: new Date() };
    this.tko_verificationTokens.set(tko_record.tokenHash, tko_record);
    return { ...tko_record };
  }

  async consumeEmailVerificationToken(tko_tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    const tko_record = this.tko_verificationTokens.get(tko_tokenHash);
    if (!tko_record || tko_record.verifiedAt || tko_record.expiresAt.getTime() <= Date.now()) return null;
    tko_record.verifiedAt = new Date();
    return { ...tko_record };
  }

  async clearPendingEmailVerificationTokens(tko_authSubject: string): Promise<void> {
    for (const [tko_hash, tko_record] of Array.from(this.tko_verificationTokens.entries())) {
      if (tko_record.authSubject === tko_authSubject && !tko_record.verifiedAt) this.tko_verificationTokens.delete(tko_hash);
    }
  }

  async isEmailVerified(tko_authSubject: string): Promise<boolean> {
    for (const tko_record of Array.from(this.tko_verificationTokens.values())) {
      if (tko_record.authSubject === tko_authSubject && tko_record.verifiedAt) return true;
    }
    return false;
  }
}

export class PostgresAccountRecoveryStore implements AccountRecoveryStore {
  private readonly tko_pool: Pool;
  constructor(tko_connectionString: string) {
    this.tko_pool = new Pool({ connectionString: tko_connectionString });
  }

  async createPasswordResetToken(tko_input: { authSubject: string; tokenHash: string; expiresAt: Date }): Promise<PasswordResetTokenRecord> {
    const tko_result = await this.tko_pool.query(
      "insert into password_reset_tokens(auth_subject,token_hash,expires_at) values($1,$2,$3) returning id,auth_subject,token_hash,expires_at,used_at,created_at",
      [tko_input.authSubject, tko_input.tokenHash, tko_input.expiresAt],
    );
    return tko_mapResetRow(tko_result.rows[0]);
  }

  async consumePasswordResetToken(tko_tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    const tko_result = await this.tko_pool.query(
      "update password_reset_tokens set used_at=now() where token_hash=$1 and used_at is null and expires_at > now() returning id,auth_subject,token_hash,expires_at,used_at,created_at",
      [tko_tokenHash],
    );
    return tko_result.rowCount ? tko_mapResetRow(tko_result.rows[0]) : null;
  }

  async clearPendingPasswordResetTokens(tko_authSubject: string): Promise<void> {
    await this.tko_pool.query("delete from password_reset_tokens where auth_subject=$1 and used_at is null", [tko_authSubject]);
  }

  async createEmailVerificationToken(tko_input: { authSubject: string; tokenHash: string; expiresAt: Date }): Promise<EmailVerificationTokenRecord> {
    const tko_result = await this.tko_pool.query(
      "insert into email_verification_tokens(auth_subject,token_hash,expires_at) values($1,$2,$3) returning id,auth_subject,token_hash,expires_at,verified_at,created_at",
      [tko_input.authSubject, tko_input.tokenHash, tko_input.expiresAt],
    );
    return tko_mapVerificationRow(tko_result.rows[0]);
  }

  async consumeEmailVerificationToken(tko_tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    const tko_result = await this.tko_pool.query(
      "update email_verification_tokens set verified_at=now() where token_hash=$1 and verified_at is null and expires_at > now() returning id,auth_subject,token_hash,expires_at,verified_at,created_at",
      [tko_tokenHash],
    );
    return tko_result.rowCount ? tko_mapVerificationRow(tko_result.rows[0]) : null;
  }

  async clearPendingEmailVerificationTokens(tko_authSubject: string): Promise<void> {
    await this.tko_pool.query("delete from email_verification_tokens where auth_subject=$1 and verified_at is null", [tko_authSubject]);
  }

  async isEmailVerified(tko_authSubject: string): Promise<boolean> {
    const tko_result = await this.tko_pool.query("select 1 from email_verification_tokens where auth_subject=$1 and verified_at is not null limit 1", [tko_authSubject]);
    return Boolean(tko_result.rowCount);
  }
}

let tko_store: AccountRecoveryStore | null = null;
export function getAccountRecoveryStore(): AccountRecoveryStore {
  if (!tko_store) tko_store = tko_config.postgresUrl ? new PostgresAccountRecoveryStore(tko_config.postgresUrl) : new MemoryAccountRecoveryStore();
  return tko_store;
}
export function setAccountRecoveryStoreForTests(tko_next: AccountRecoveryStore | null): void {
  tko_store = tko_next;
}
