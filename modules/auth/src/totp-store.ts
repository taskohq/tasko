import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { tko_config } from "../../../packages/config/src/tasko-config";

/**
 * Durable storage for TOTP MFA credentials (spec 06 §2 P1, migration 0024).
 * `secretEncrypted` holds an AES-256-GCM blob (see secret-box.ts) — plaintext
 * secrets never reach this store. Recovery codes are stored as SHA-256 hashes
 * with per-code used markers.
 */

export interface TotpRecoveryCodeRecord {
  hash: string;
  usedAt: string | null;
}

export interface TotpCredentialRecord {
  authSubject: string;
  secretEncrypted: string;
  enabledAt: Date | null;
  confirmedAt: Date | null;
  recoveryCodes: TotpRecoveryCodeRecord[] | null;
  createdAt: Date;
}

export interface TotpStore {
  /** Insert or replace a pending (unconfirmed) enrollment. */
  upsertPending(tko_input: { authSubject: string; secretEncrypted: string }): Promise<TotpCredentialRecord>;
  getBySubject(tko_authSubject: string): Promise<TotpCredentialRecord | null>;
  isMfaEnabled(tko_authSubject: string): Promise<boolean>;
  activate(tko_input: { authSubject: string; confirmedAt: Date; recoveryCodes: TotpRecoveryCodeRecord[] }): Promise<TotpCredentialRecord>;
  updateRecoveryCodes(tko_authSubject: string, tko_recoveryCodes: TotpRecoveryCodeRecord[]): Promise<void>;
  delete(tko_authSubject: string): Promise<void>;
}

function tko_mapRow(tko_row: Record<string, unknown>): TotpCredentialRecord {
  return {
    authSubject: String(tko_row.auth_subject),
    secretEncrypted: String(tko_row.secret_encrypted),
    enabledAt: tko_row.enabled_at ? new Date(String(tko_row.enabled_at)) : null,
    confirmedAt: tko_row.confirmed_at ? new Date(String(tko_row.confirmed_at)) : null,
    recoveryCodes: (tko_row.recovery_codes_json ?? null) === null ? null : (JSON.parse(String(tko_row.recovery_codes_json)) as TotpRecoveryCodeRecord[]),
    createdAt: new Date(String(tko_row.created_at)),
  };
}

export class MemoryTotpStore implements TotpStore {
  readonly tko_bySubject = new Map<string, TotpCredentialRecord>();

  async upsertPending(tko_input: { authSubject: string; secretEncrypted: string }): Promise<TotpCredentialRecord> {
    const tko_existing = this.tko_bySubject.get(tko_input.authSubject);
    const tko_record: TotpCredentialRecord = {
      authSubject: tko_input.authSubject,
      secretEncrypted: tko_input.secretEncrypted,
      enabledAt: null,
      confirmedAt: null,
      recoveryCodes: null,
      createdAt: tko_existing?.createdAt ?? new Date(),
    };
    this.tko_bySubject.set(tko_record.authSubject, tko_record);
    return { ...tko_record, recoveryCodes: tko_record.recoveryCodes ? [...tko_record.recoveryCodes] : null };
  }

  async getBySubject(tko_authSubject: string): Promise<TotpCredentialRecord | null> {
    const tko_record = this.tko_bySubject.get(tko_authSubject);
    return tko_record ? { ...tko_record, recoveryCodes: tko_record.recoveryCodes ? tko_record.recoveryCodes.map(tko_code => ({ ...tko_code })) : null } : null;
  }

  async isMfaEnabled(tko_authSubject: string): Promise<boolean> {
    const tko_record = this.tko_bySubject.get(tko_authSubject);
    return Boolean(tko_record?.enabledAt && tko_record?.confirmedAt);
  }

  async activate(tko_input: { authSubject: string; confirmedAt: Date; recoveryCodes: TotpRecoveryCodeRecord[] }): Promise<TotpCredentialRecord> {
    const tko_record = this.tko_bySubject.get(tko_input.authSubject);
    if (!tko_record) throw new Error("TASKO_MFA_ENROLLMENT_NOT_STARTED");
    tko_record.confirmedAt = new Date(tko_input.confirmedAt);
    tko_record.enabledAt = new Date(tko_input.confirmedAt);
    tko_record.recoveryCodes = tko_input.recoveryCodes.map(tko_code => ({ ...tko_code }));
    return { ...tko_record, recoveryCodes: tko_record.recoveryCodes.map(tko_code => ({ ...tko_code })) };
  }

  async updateRecoveryCodes(tko_authSubject: string, tko_recoveryCodes: TotpRecoveryCodeRecord[]): Promise<void> {
    const tko_record = this.tko_bySubject.get(tko_authSubject);
    if (tko_record) tko_record.recoveryCodes = tko_recoveryCodes.map(tko_code => ({ ...tko_code }));
  }

  async delete(tko_authSubject: string): Promise<void> {
    this.tko_bySubject.delete(tko_authSubject);
  }
}

export class PostgresTotpStore implements TotpStore {
  private readonly tko_pool: Pool;
  constructor(tko_connectionString: string) {
    this.tko_pool = new Pool({ connectionString: tko_connectionString });
  }

  private static readonly TKO_COLUMNS = "id,auth_subject,secret_encrypted,enabled_at,confirmed_at,recovery_codes_json,created_at";

  async upsertPending(tko_input: { authSubject: string; secretEncrypted: string }): Promise<TotpCredentialRecord> {
    const tko_result = await this.tko_pool.query(
      `insert into totp_credentials(auth_subject,secret_encrypted) values($1,$2)
       on conflict (auth_subject) do update set secret_encrypted=$2, enabled_at=null, confirmed_at=null, recovery_codes_json=null, updated_at=now()
       returning ${PostgresTotpStore.TKO_COLUMNS}`,
      [tko_input.authSubject, tko_input.secretEncrypted],
    );
    return tko_mapRow(tko_result.rows[0]);
  }

  async getBySubject(tko_authSubject: string): Promise<TotpCredentialRecord | null> {
    const tko_result = await this.tko_pool.query(
      `select ${PostgresTotpStore.TKO_COLUMNS} from totp_credentials where auth_subject=$1`,
      [tko_authSubject],
    );
    return tko_result.rowCount ? tko_mapRow(tko_result.rows[0]) : null;
  }

  async isMfaEnabled(tko_authSubject: string): Promise<boolean> {
    const tko_result = await this.tko_pool.query(
      "select 1 from totp_credentials where auth_subject=$1 and enabled_at is not null and confirmed_at is not null limit 1",
      [tko_authSubject],
    );
    return Boolean(tko_result.rowCount);
  }

  async activate(tko_input: { authSubject: string; confirmedAt: Date; recoveryCodes: TotpRecoveryCodeRecord[] }): Promise<TotpCredentialRecord> {
    const tko_result = await this.tko_pool.query(
      `update totp_credentials set confirmed_at=$2, enabled_at=$2, recovery_codes_json=$3::jsonb, updated_at=now()
       where auth_subject=$1 returning ${PostgresTotpStore.TKO_COLUMNS}`,
      [tko_input.authSubject, tko_input.confirmedAt, JSON.stringify(tko_input.recoveryCodes)],
    );
    if (!tko_result.rowCount) throw new Error("TASKO_MFA_ENROLLMENT_NOT_STARTED");
    return tko_mapRow(tko_result.rows[0]);
  }

  async updateRecoveryCodes(tko_authSubject: string, tko_recoveryCodes: TotpRecoveryCodeRecord[]): Promise<void> {
    await this.tko_pool.query(
      "update totp_credentials set recovery_codes_json=$2::jsonb, updated_at=now() where auth_subject=$1",
      [tko_authSubject, JSON.stringify(tko_recoveryCodes)],
    );
  }

  async delete(tko_authSubject: string): Promise<void> {
    await this.tko_pool.query("delete from totp_credentials where auth_subject=$1", [tko_authSubject]);
  }
}

let tko_store: TotpStore | null = null;
export function getTotpStore(): TotpStore {
  if (!tko_store) tko_store = tko_config.postgresUrl ? new PostgresTotpStore(tko_config.postgresUrl) : new MemoryTotpStore();
  return tko_store;
}
export function setTotpStoreForTests(tko_next: TotpStore | null): void {
  tko_store = tko_next;
}
