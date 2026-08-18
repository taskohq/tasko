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
  const tko_seedMembers = [
    [tko_ownerAuthSubject, "owner", "Demo Owner"],
    [`demo-admin:${tko_tenantSlug}`, "admin", "Demo Admin"],
    [`demo-member:${tko_tenantSlug}`, "member", "Demo Member"],
    [`demo-guest:${tko_tenantSlug}`, "guest", "Demo Guest"],
    [process.env.TASKO_WORKER_SERVICE_SUBJECT ?? "service:tasko-worker", "service_account", "Tasko Worker"],
  ];
  for (const [tko_authSubject, tko_role, tko_displayName] of tko_seedMembers) {
    const tko_userResult = await tko_client.query(
      `insert into users (id, auth_subject, status)
       values ($1, $2, 'active')
       on conflict (auth_subject) do update set status = 'active'
       returning id`,
      [randomUUID(), tko_authSubject],
    );
    await tko_client.query(
      `insert into tenant_members (id, tenant_id, user_id, role, status, display_name)
       values ($1, $2, $3, $4, 'active', $5)
       on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active', display_name = excluded.display_name`,
      [randomUUID(), tko_tenantResult.rows[0].id, tko_userResult.rows[0].id, tko_role, tko_displayName],
    );
  }
  await tko_client.query("commit");
  console.log(`Tasko seed workspace is ready: ${tko_tenantSlug}`);
} catch (tko_error) {
  await tko_client.query("rollback");
  throw tko_error;
} finally {
  tko_client.release();
  await tko_pool.end();
}
