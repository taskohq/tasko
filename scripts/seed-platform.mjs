import { randomUUID } from "node:crypto";
import pg from "pg";

const tko_connectionString = process.env.TASKO_POSTGRES_URL;
const tko_ownerAuthSubject = process.env.OWNER_OPEN_ID;
const tko_tenantSlug = process.env.TASKO_SINGLE_TENANT_SLUG ?? "tasko-demo";
if (!tko_connectionString || !tko_ownerAuthSubject) {
  throw new Error("TASKO_POSTGRES_URL and OWNER_OPEN_ID are required for the Tasko seed workspace.");
}

const tko_pool = new pg.Pool({ connectionString: tko_connectionString });
const tko_client = await tko_pool.connect();
try {
  await tko_client.query("begin");
  const tko_tenantResult = await tko_client.query(
    `insert into tenants (id, slug, name, status, deployment_profile)
     values ($1, $2, 'Tasko Demo Workspace', 'active', $3)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [randomUUID(), tko_tenantSlug, process.env.DEPLOYMENT_PROFILE === "saas" ? "saas" : "single_tenant"],
  );
  const tko_userResult = await tko_client.query(
    `insert into users (id, auth_subject, status)
     values ($1, $2, 'active')
     on conflict (auth_subject) do update set status = 'active'
     returning id`,
    [randomUUID(), tko_ownerAuthSubject],
  );
  await tko_client.query(
    `insert into tenant_members (id, tenant_id, user_id, role, status, display_name)
     values ($1, $2, $3, 'owner', 'active', 'Demo Owner')
     on conflict (tenant_id, user_id) do update set role = 'owner', status = 'active'`,
    [randomUUID(), tko_tenantResult.rows[0].id, tko_userResult.rows[0].id],
  );
  await tko_client.query("commit");
  console.log(`Tasko seed workspace is ready: ${tko_tenantSlug}`);
} catch (tko_error) {
  await tko_client.query("rollback");
  throw tko_error;
} finally {
  tko_client.release();
  await tko_pool.end();
}
