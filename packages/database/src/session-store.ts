import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { tko_config } from "../../config/src/tasko-config";

/**
 * Server-side session records backing acceptance-test K (permission/session
 * revocation). Only the SHA-256 hash of the session token is persisted.
 */
export interface SessionRecord {
  id: string;
  authSubject: string;
  tokenHash: string;
  tenantId: string | null;
  device: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  authSubject: string;
  tokenHash: string;
  tenantId?: string | null;
  device?: string | null;
  expiresAt: Date;
}

export interface SessionStore {
  create(tko_input: CreateSessionInput): Promise<SessionRecord>;
  findByTokenHash(tko_tokenHash: string): Promise<SessionRecord | null>;
  /** Refresh `last_seen_at` and, on first use, record the client device label. */
  touch(tko_tokenHash: string, tko_device: string | null): Promise<void>;
  revoke(tko_tokenHash: string): Promise<boolean>;
  revokeAllForSubject(tko_authSubject: string, tko_exceptTokenHash?: string | null): Promise<number>;
  listActiveBySubject(tko_authSubject: string): Promise<SessionRecord[]>;
}

export function tko_isSessionRecordAlive(tko_record: SessionRecord | null, tko_now = new Date()): boolean {
  if (!tko_record) return false;
  if (tko_record.revokedAt) return false;
  return tko_record.expiresAt.getTime() > tko_now.getTime();
}

function tko_clone(tko_record: SessionRecord): SessionRecord {
  return {
    ...tko_record,
    createdAt: new Date(tko_record.createdAt),
    lastSeenAt: new Date(tko_record.lastSeenAt),
    expiresAt: new Date(tko_record.expiresAt),
    revokedAt: tko_record.revokedAt ? new Date(tko_record.revokedAt) : null,
  };
}

export class MemorySessionStore implements SessionStore {
  private readonly tko_byTokenHash = new Map<string, SessionRecord>();

  async create(tko_input: CreateSessionInput): Promise<SessionRecord> {
    if (this.tko_byTokenHash.has(tko_input.tokenHash)) throw new Error("TASKO_SESSION_ALREADY_EXISTS");
    const tko_now = new Date();
    const tko_record: SessionRecord = {
      id: randomUUID(),
      authSubject: tko_input.authSubject,
      tokenHash: tko_input.tokenHash,
      tenantId: tko_input.tenantId ?? null,
      device: tko_input.device ?? null,
      createdAt: tko_now,
      lastSeenAt: tko_now,
      expiresAt: tko_input.expiresAt,
      revokedAt: null,
    };
    this.tko_byTokenHash.set(tko_record.tokenHash, tko_record);
    return tko_clone(tko_record);
  }

  async findByTokenHash(tko_tokenHash: string): Promise<SessionRecord | null> {
    const tko_record = this.tko_byTokenHash.get(tko_tokenHash);
    return tko_record ? tko_clone(tko_record) : null;
  }

  async touch(tko_tokenHash: string, tko_device: string | null): Promise<void> {
    const tko_record = this.tko_byTokenHash.get(tko_tokenHash);
    if (!tko_record) return;
    tko_record.lastSeenAt = new Date();
    if (tko_device && !tko_record.device) tko_record.device = tko_device;
  }

  async revoke(tko_tokenHash: string): Promise<boolean> {
    const tko_record = this.tko_byTokenHash.get(tko_tokenHash);
    if (!tko_record || tko_record.revokedAt) return false;
    tko_record.revokedAt = new Date();
    return true;
  }

  async revokeAllForSubject(tko_authSubject: string, tko_exceptTokenHash?: string | null): Promise<number> {
    let tko_count = 0;
    for (const tko_record of Array.from(this.tko_byTokenHash.values())) {
      if (tko_record.authSubject !== tko_authSubject) continue;
      if (tko_record.revokedAt) continue;
      if (tko_exceptTokenHash && tko_record.tokenHash === tko_exceptTokenHash) continue;
      tko_record.revokedAt = new Date();
      tko_count += 1;
    }
    return tko_count;
  }

  async listActiveBySubject(tko_authSubject: string): Promise<SessionRecord[]> {
    const tko_now = new Date();
    return Array.from(this.tko_byTokenHash.values())
      .filter(tko_record => tko_record.authSubject === tko_authSubject && !tko_record.revokedAt && tko_record.expiresAt.getTime() > tko_now.getTime())      .map(tko_clone)
      .sort((tko_a, tko_b) => tko_b.lastSeenAt.getTime() - tko_a.lastSeenAt.getTime());
  }
}

export class PostgresSessionStore implements SessionStore {
  private readonly tko_pool: Pool;
  constructor(tko_connectionString: string) {
    this.tko_pool = new Pool({ connectionString: tko_connectionString });
  }

  private tko_map(tko_row: Record<string, unknown>): SessionRecord {
    return {
      id: String(tko_row.id),
      authSubject: String(tko_row.auth_subject),
      tokenHash: String(tko_row.token_hash),
      tenantId: tko_row.tenant_id ? String(tko_row.tenant_id) : null,
      device: tko_row.device ? String(tko_row.device) : null,
      createdAt: new Date(String(tko_row.created_at)),
      lastSeenAt: new Date(String(tko_row.last_seen_at)),
      expiresAt: new Date(String(tko_row.expires_at)),
      revokedAt: tko_row.revoked_at ? new Date(String(tko_row.revoked_at)) : null,
    };
  }

  async create(tko_input: CreateSessionInput): Promise<SessionRecord> {
    const tko_result = await this.tko_pool.query(
      "insert into sessions(id,auth_subject,token_hash,tenant_id,device,expires_at) values($1,$2,$3,$4,$5,$6) returning id,auth_subject,token_hash,tenant_id,device,created_at,last_seen_at,expires_at,revoked_at",
      [randomUUID(), tko_input.authSubject, tko_input.tokenHash, tko_input.tenantId ?? null, tko_input.device ?? null, tko_input.expiresAt],
    );
    return this.tko_map(tko_result.rows[0]);
  }

  async findByTokenHash(tko_tokenHash: string): Promise<SessionRecord | null> {
    const tko_result = await this.tko_pool.query(
      "select id,auth_subject,token_hash,tenant_id,device,created_at,last_seen_at,expires_at,revoked_at from sessions where token_hash=$1",
      [tko_tokenHash],
    );
    return tko_result.rowCount ? this.tko_map(tko_result.rows[0]) : null;
  }

  async touch(tko_tokenHash: string, tko_device: string | null): Promise<void> {
    await this.tko_pool.query(
      "update sessions set last_seen_at=now(), device=coalesce(device,$2) where token_hash=$1 and revoked_at is null",
      [tko_tokenHash, tko_device],
    );
  }

  async revoke(tko_tokenHash: string): Promise<boolean> {
    const tko_result = await this.tko_pool.query(
      "update sessions set revoked_at=now() where token_hash=$1 and revoked_at is null",
      [tko_tokenHash],
    );
    return Boolean(tko_result.rowCount);
  }

  async revokeAllForSubject(tko_authSubject: string, tko_exceptTokenHash?: string | null): Promise<number> {
    const tko_result = await this.tko_pool.query(
      "update sessions set revoked_at=now() where auth_subject=$1 and revoked_at is null and ($2::text is null or token_hash <> $2)",
      [tko_authSubject, tko_exceptTokenHash ?? null],
    );
    return tko_result.rowCount ?? 0;
  }

  async listActiveBySubject(tko_authSubject: string): Promise<SessionRecord[]> {
    const tko_result = await this.tko_pool.query(
      "select id,auth_subject,token_hash,tenant_id,device,created_at,last_seen_at,expires_at,revoked_at from sessions where auth_subject=$1 and revoked_at is null and expires_at > now() order by last_seen_at desc",
      [tko_authSubject],
    );
    return tko_result.rows.map((tko_row: Record<string, unknown>) => this.tko_map(tko_row));
  }
}

let tko_store: SessionStore | null = null;
export function getSessionStore(): SessionStore {
  if (!tko_store) tko_store = tko_config.postgresUrl ? new PostgresSessionStore(tko_config.postgresUrl) : new MemorySessionStore();
  return tko_store;
}
export function setSessionStoreForTests(tko_next: SessionStore | null): void {
  tko_store = tko_next;
}
