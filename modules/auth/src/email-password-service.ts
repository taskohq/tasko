import { createHash, randomBytes, randomUUID, scrypt as tko_scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getEmailPasswordStore, type EmailPasswordAccount } from "../../../packages/database/src/email-password-store";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { recordAuthenticationEvent } from "../../audit/src/audit-service";
import { createPlatformActor, resolveTenantRequestContext } from "../../tenancy/src/tenant-context";
import { sdk } from "../../../server/_core/sdk";
import { ONE_YEAR_MS } from "../../../shared/const";

const tko_scryptAsync = promisify(tko_scrypt);
const TKO_KDF = { algorithm: "scrypt", N: 16_384, r: 8, p: 1, keyLength: 64 } as const;
const TKO_EMAIL_SUBJECT_PREFIX = "email:";

export type EmailPasswordAuthResult = { account: Pick<EmailPasswordAccount, "authSubject" | "email" | "displayName">; sessionToken: string };

function tko_normalizeEmail(tko_email: string): string { return tko_email.trim().toLowerCase(); }
function tko_emailKey(tko_email: string): string { return createHash("sha256").update(tko_email).digest("hex"); }
function tko_workspaceSlug(tko_email: string): string { const tko_base = tko_email.split("@")[0]?.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"; return `${tko_base.slice(0, 28)}-${randomUUID().slice(0, 8)}`; }
async function tko_passwordHash(tko_password: string, tko_salt = randomBytes(16)): Promise<string> { const tko_derived = await tko_scryptAsync(tko_password, tko_salt, TKO_KDF.keyLength) as Buffer; return `${TKO_KDF.algorithm}$${TKO_KDF.N}$${TKO_KDF.r}$${TKO_KDF.p}$${tko_salt.toString("base64url")}$${tko_derived.toString("base64url")}`; }
async function tko_verifyPassword(tko_password: string, tko_encoded: string): Promise<boolean> { try { const [tko_algorithm, tko_N, tko_r, tko_p, tko_salt, tko_expected] = tko_encoded.split("$"); if (tko_algorithm !== TKO_KDF.algorithm || Number(tko_N) !== TKO_KDF.N || Number(tko_r) !== TKO_KDF.r || Number(tko_p) !== TKO_KDF.p || !tko_salt || !tko_expected) return false; const tko_derived = await tko_scryptAsync(tko_password, Buffer.from(tko_salt, "base64url"), TKO_KDF.keyLength) as Buffer; const tko_expectedBuffer = Buffer.from(tko_expected, "base64url"); return tko_derived.length === tko_expectedBuffer.length && timingSafeEqual(tko_derived, tko_expectedBuffer); } catch { return false; } }
async function tko_takeCredentialRateLimit(tko_action: "login" | "signup", tko_email: string): Promise<void> { const tko_result = await getRedisAdapter().takeRateLimit(`auth:${tko_action}:${tko_emailKey(tko_email)}`, tko_action === "login" ? 8 : 4, 15 * 60_000); if (!tko_result.allowed) throw new Error("TASKO_AUTH_RATE_LIMITED"); }

export function tko_isEmailPasswordSubject(tko_authSubject: string): boolean { return tko_authSubject.startsWith(TKO_EMAIL_SUBJECT_PREFIX); }
export async function getEmailPasswordAccount(tko_authSubject: string): Promise<EmailPasswordAccount | null> { return tko_isEmailPasswordSubject(tko_authSubject) ? getEmailPasswordStore().getByAuthSubject(tko_authSubject) : null; }

export async function signUpWithEmailPassword(tko_input: { email: string; password: string; displayName: string; workspaceName?: string; correlationId: string }): Promise<EmailPasswordAuthResult> {
  const tko_email = tko_normalizeEmail(tko_input.email);
  if (tko_input.password.length < 12 || tko_input.password.length > 128) throw new Error("TASKO_PASSWORD_POLICY_FAILED");
  await tko_takeCredentialRateLimit("signup", tko_email);
  const tko_authSubject = `${TKO_EMAIL_SUBJECT_PREFIX}${randomUUID()}`;
  const tko_account = await getEmailPasswordStore().create({ authSubject: tko_authSubject, email: tko_email, displayName: tko_input.displayName.trim(), passwordHash: await tko_passwordHash(tko_input.password) });
  let tko_provisioned: { tenant: { id: string } };
  try {
    tko_provisioned = await getPlatformStore().provisionTenant({ name: tko_input.workspaceName?.trim() || `${tko_account.displayName}'s Workspace`, slug: tko_workspaceSlug(tko_email), ownerAuthSubject: tko_authSubject, ownerDisplayName: tko_account.displayName, planKey: "starter", idempotencyKey: `email-signup:${tko_authSubject}`, correlationId: tko_input.correlationId });
  } catch (tko_error) { await getEmailPasswordStore().delete(tko_authSubject); throw tko_error; }
  const tko_membership = (await getPlatformStore().listMemberships(tko_authSubject)).find(tko_item => tko_item.tenant.id === tko_provisioned.tenant.id && tko_item.status === "active");
  if (!tko_membership) throw new Error("TASKO_SIGNUP_TENANT_MISSING");
  await recordAuthenticationEvent({ actor: createPlatformActor(tko_membership, tko_input.correlationId), action: "login", correlationId: tko_input.correlationId, metadata: { loginMethod: "email_password", enrollment: "signup" } });
  return { account: tko_account, sessionToken: await sdk.createSessionToken(tko_authSubject, { name: tko_account.displayName, expiresInMs: ONE_YEAR_MS }) };
}

export async function signInWithEmailPassword(tko_input: { email: string; password: string; correlationId: string }): Promise<EmailPasswordAuthResult> {
  const tko_email = tko_normalizeEmail(tko_input.email); await tko_takeCredentialRateLimit("login", tko_email);
  const tko_account = await getEmailPasswordStore().getByEmail(tko_email);
  if (!tko_account || !(await tko_verifyPassword(tko_input.password, tko_account.passwordHash))) throw new Error("TASKO_INVALID_CREDENTIALS");
  const tko_context = await resolveTenantRequestContext({ authSubject: tko_account.authSubject, correlationId: tko_input.correlationId });
  if (!tko_context) throw new Error("TASKO_INVALID_CREDENTIALS");
  await getEmailPasswordStore().touchLastSignedIn(tko_account.authSubject);
  await recordAuthenticationEvent({ actor: createPlatformActor(tko_context.membership, tko_input.correlationId), action: "login", correlationId: tko_input.correlationId, metadata: { loginMethod: "email_password" } });
  return { account: tko_account, sessionToken: await sdk.createSessionToken(tko_account.authSubject, { name: tko_account.displayName, expiresInMs: ONE_YEAR_MS }) };
}
