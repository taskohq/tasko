import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const tko_connectionString = process.env.TASKO_POSTGRES_URL;
if (!tko_connectionString) {
  throw new Error("TASKO_POSTGRES_URL is required to apply Tasko PostgreSQL migrations.");
}

const tko_pool = new pg.Pool({ connectionString: tko_connectionString });
const tko_migrationsDir = resolve("packages/database/migrations");
const tko_migrationFiles = (await readdir(tko_migrationsDir))
  .filter(tko_file => /^\d+_.+\.sql$/.test(tko_file))
  .sort();
try {
  await tko_pool.query(`
    create table if not exists tasko_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  for (const tko_file of tko_migrationFiles) {
    const tko_applied = await tko_pool.query("select 1 from tasko_schema_migrations where filename=$1", [tko_file]);
    if (tko_applied.rowCount) {
      console.log(`Tasko migration already applied: ${tko_file}`);
      continue;
    }
    const tko_sql = await readFile(resolve(tko_migrationsDir, tko_file), "utf8");
    const tko_client = await tko_pool.connect();
    try {
      await tko_client.query("begin");
      await tko_client.query(tko_sql);
      await tko_client.query("insert into tasko_schema_migrations(filename) values($1)", [tko_file]);
      await tko_client.query("commit");
      console.log(`Tasko migration applied: ${tko_file}`);
    } catch (tko_error) {
      await tko_client.query("rollback");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }
} finally {
  await tko_pool.end();
}
