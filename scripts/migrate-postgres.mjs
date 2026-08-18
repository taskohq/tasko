import { readFile } from "node:fs/promises";
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
  for (const tko_file of tko_migrationFiles) {
    const tko_sql = await readFile(resolve(tko_migrationsDir, tko_file), "utf8");
    await tko_pool.query(tko_sql);
    console.log(`Tasko migration applied: ${tko_file}`);
  }
} finally {
  await tko_pool.end();
}
