import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { tko_config } from "../../config/src/tasko-config";

export interface EmailPasswordAccount {
  id: string;
  authSubject: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
  lastSignedInAt: Date | null;
}

export interface EmailPasswordStore {
  create(tko_input: Omit<EmailPasswordAccount, "id" | "createdAt" | "lastSignedInAt">): Promise<EmailPasswordAccount>;
  getByEmail(tko_email: string): Promise<EmailPasswordAccount | null>;
  getByAuthSubject(tko_authSubject: string): Promise<EmailPasswordAccount | null>;
  touchLastSignedIn(tko_authSubject: string): Promise<void>;
  delete(tko_authSubject: string): Promise<void>;
}

function tko_clone(tko_account: EmailPasswordAccount): EmailPasswordAccount {
  return { ...tko_account, createdAt: new Date(tko_account.createdAt), lastSignedInAt: tko_account.lastSignedInAt ? new Date(tko_account.lastSignedInAt) : null };
}

export class MemoryEmailPasswordStore implements EmailPasswordStore {
  private readonly tko_byEmail = new Map<string, EmailPasswordAccount>();
  private readonly tko_bySubject = new Map<string, EmailPasswordAccount>();

  async create(tko_input: Omit<EmailPasswordAccount, "id" | "createdAt" | "lastSignedInAt">): Promise<EmailPasswordAccount> {
    if (this.tko_byEmail.has(tko_input.email) || this.tko_bySubject.has(tko_input.authSubject)) throw new Error("TASKO_EMAIL_ALREADY_REGISTERED");
    const tko_account: EmailPasswordAccount = { ...tko_input, id: randomUUID(), createdAt: new Date(), lastSignedInAt: null };
    this.tko_byEmail.set(tko_account.email, tko_account);
    this.tko_bySubject.set(tko_account.authSubject, tko_account);
    return tko_clone(tko_account);
  }
  async getByEmail(tko_email: string): Promise<EmailPasswordAccount | null> { const tko_account = this.tko_byEmail.get(tko_email); return tko_account ? tko_clone(tko_account) : null; }
  async getByAuthSubject(tko_authSubject: string): Promise<EmailPasswordAccount | null> { const tko_account = this.tko_bySubject.get(tko_authSubject); return tko_account ? tko_clone(tko_account) : null; }
  async touchLastSignedIn(tko_authSubject: string): Promise<void> { const tko_account = this.tko_bySubject.get(tko_authSubject); if (tko_account) tko_account.lastSignedInAt = new Date(); }
  async delete(tko_authSubject: string): Promise<void> { const tko_account = this.tko_bySubject.get(tko_authSubject); if (!tko_account) return; this.tko_bySubject.delete(tko_authSubject); this.tko_byEmail.delete(tko_account.email); }
}

export class PostgresEmailPasswordStore implements EmailPasswordStore {
  private readonly tko_pool: Pool;
  constructor(tko_connectionString: string) { this.tko_pool = new Pool({ connectionString: tko_connectionString }); }
  private tko_map(tko_row: Record<string, unknown>): EmailPasswordAccount {
    return { id: String(tko_row.id), authSubject: String(tko_row.auth_subject), email: String(tko_row.email), displayName: String(tko_row.display_name), passwordHash: String(tko_row.password_hash), createdAt: new Date(String(tko_row.created_at)), lastSignedInAt: tko_row.last_signed_in_at ? new Date(String(tko_row.last_signed_in_at)) : null };
  }
  async create(tko_input: Omit<EmailPasswordAccount, "id" | "createdAt" | "lastSignedInAt">): Promise<EmailPasswordAccount> {
    const tko_result = await this.tko_pool.query(
      "insert into email_password_credentials(auth_subject,email,display_name,password_hash) values($1,$2,$3,$4) returning id,auth_subject,email,display_name,password_hash,created_at,last_signed_in_at",
      [tko_input.authSubject, tko_input.email, tko_input.displayName, tko_input.passwordHash],
    );
    return this.tko_map(tko_result.rows[0]);
  }
  async getByEmail(tko_email: string): Promise<EmailPasswordAccount | null> { const tko_result = await this.tko_pool.query("select id,auth_subject,email,display_name,password_hash,created_at,last_signed_in_at from email_password_credentials where email=$1", [tko_email]); return tko_result.rowCount ? this.tko_map(tko_result.rows[0]) : null; }
  async getByAuthSubject(tko_authSubject: string): Promise<EmailPasswordAccount | null> { const tko_result = await this.tko_pool.query("select id,auth_subject,email,display_name,password_hash,created_at,last_signed_in_at from email_password_credentials where auth_subject=$1", [tko_authSubject]); return tko_result.rowCount ? this.tko_map(tko_result.rows[0]) : null; }
  async touchLastSignedIn(tko_authSubject: string): Promise<void> { await this.tko_pool.query("update email_password_credentials set last_signed_in_at=now() where auth_subject=$1", [tko_authSubject]); }
  async delete(tko_authSubject: string): Promise<void> { await this.tko_pool.query("delete from email_password_credentials where auth_subject=$1", [tko_authSubject]); }
}

let tko_store: EmailPasswordStore | null = null;
export function getEmailPasswordStore(): EmailPasswordStore { if (!tko_store) tko_store = tko_config.postgresUrl ? new PostgresEmailPasswordStore(tko_config.postgresUrl) : new MemoryEmailPasswordStore(); return tko_store; }
export function setEmailPasswordStoreForTests(tko_next: EmailPasswordStore | null): void { tko_store = tko_next; }
