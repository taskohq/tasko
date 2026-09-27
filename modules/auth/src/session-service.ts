import { createHash } from "node:crypto";
import { getSessionStore, tko_isSessionRecordAlive, type SessionRecord } from "../../../packages/database/src/session-store";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";

/**
 * Session lifecycle service (framework-agnostic).
 *
 * Every minted session token gets a durable row holding only the token hash.
 * `authenticateRequest` re-checks liveness on each request with a short-lived
 * Redis verdict cache (<= 30s). Revocation overwrites the cached verdict so a
 * revoked session is rejected promptly, satisfying acceptance-test K.
 */

const TKO_SESSION_VERDICT_TTL_MS = 30_000;
const TKO_CRON_SUBJECT_PREFIX = "cron_";
const TKO_ALIVE_VERDICT = "1";
const TKO_DEAD_VERDICT = "0";
const TKO_MAX_DEVICE_LABEL_LENGTH = 200;

export function tko_isCronSubject(tko_authSubject: string): boolean {
  return tko_authSubject.startsWith(TKO_CRON_SUBJECT_PREFIX);
}

/** Cron callbacks are ephemeral platform-level jobs and never receive session rows. */
export function tko_shouldTrackSubject(tko_authSubject: string): boolean {
  return !tko_isCronSubject(tko_authSubject);
}

export function tko_hashSessionToken(tko_sessionToken: string): string {
  return createHash("sha256").update(tko_sessionToken).digest("hex");
}

function tko_verdictCacheKey(tko_tokenHash: string): string {
  return `session:alive:${tko_tokenHash}`;
}

export function tko_normalizeDeviceLabel(tko_userAgent: unknown): string | null {
  if (typeof tko_userAgent !== "string" || tko_userAgent.trim().length === 0) return null;
  return tko_userAgent.trim().slice(0, TKO_MAX_DEVICE_LABEL_LENGTH);
}

export interface PersistSessionInput {
  sessionToken: string;
  authSubject: string;
  tenantId?: string | null;
  device?: string | null;
  expiresAt: Date;
}

export async function tko_persistSession(tko_input: PersistSessionInput): Promise<SessionRecord> {
  return getSessionStore().create({
    authSubject: tko_input.authSubject,
    tokenHash: tko_hashSessionToken(tko_input.sessionToken),
    tenantId: tko_input.tenantId ?? null,
    device: tko_normalizeDeviceLabel(tko_input.device),
    expiresAt: tko_input.expiresAt,
  });
}

/**
 * Whether the presented token still maps to an unrevoked, unexpired session
 * row. The verdict is cached in Redis for 30 seconds keyed by token hash.
 */
export async function tko_isSessionAlive(tko_sessionToken: string, tko_device?: string | null): Promise<boolean> {
  const tko_tokenHash = tko_hashSessionToken(tko_sessionToken);
  const tko_cacheKey = tko_verdictCacheKey(tko_tokenHash);

  try {
    const tko_cached = await getRedisAdapter().getCache(tko_cacheKey);
    if (tko_cached === TKO_ALIVE_VERDICT) return true;
    if (tko_cached === TKO_DEAD_VERDICT) return false;
  } catch {
    // Cache unavailability must never unlock a session; fall through to the store.
  }

  const tko_record = await getSessionStore().findByTokenHash(tko_tokenHash);
  const tko_alive = tko_isSessionRecordAlive(tko_record);
  try {
    await getRedisAdapter().setCache(tko_cacheKey, tko_alive ? TKO_ALIVE_VERDICT : TKO_DEAD_VERDICT, TKO_SESSION_VERDICT_TTL_MS);
  } catch {
    // Best-effort cache; the store remains the source of truth.
  }
  if (tko_alive) {
    await getSessionStore().touch(tko_tokenHash, tko_normalizeDeviceLabel(tko_device) ?? null);
  }
  return tko_alive;
}

async function tko_invalidateVerdictCache(tko_tokenHash: string): Promise<void> {
  try {
    await getRedisAdapter().setCache(tko_verdictCacheKey(tko_tokenHash), TKO_DEAD_VERDICT, TKO_SESSION_VERDICT_TTL_MS);
  } catch {
    // If the cache cannot be overwritten the verdict expires within 30s anyway.
  }
}

export async function tko_revokeSessionByToken(tko_sessionToken: string): Promise<boolean> {
  const tko_tokenHash = tko_hashSessionToken(tko_sessionToken);
  const tko_revoked = await getSessionStore().revoke(tko_tokenHash);
  await tko_invalidateVerdictCache(tko_tokenHash);
  return tko_revoked;
}

export async function tko_revokeSessionByTokenHash(tko_tokenHash: string): Promise<boolean> {
  const tko_revoked = await getSessionStore().revoke(tko_tokenHash);
  await tko_invalidateVerdictCache(tko_tokenHash);
  return tko_revoked;
}

/** Revoke every active session of a subject except (optionally) the current one. */
export async function tko_revokeAllSessionsForSubject(
  tko_authSubject: string,
  tko_exceptTokenHash?: string | null,
): Promise<number> {
  const tko_active = await getSessionStore().listActiveBySubject(tko_authSubject);
  let tko_count = 0;
  for (const tko_record of tko_active) {
    if (tko_exceptTokenHash && tko_record.tokenHash === tko_exceptTokenHash) continue;
    if (await tko_revokeSessionByTokenHash(tko_record.tokenHash)) tko_count += 1;
  }
  return tko_count;
}

export async function tko_listActiveSessions(tko_authSubject: string): Promise<SessionRecord[]> {
  return getSessionStore().listActiveBySubject(tko_authSubject);
}
