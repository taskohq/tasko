import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const tko_connectionString = process.env.TASKO_POSTGRES_URL;
if (!tko_connectionString) {
  throw new Error("TASKO_POSTGRES_URL is required to apply Tasko PostgreSQL migrations.");
}

const tko_pool = new pg.Pool({ connectionString: tko_connectionString });
const tko_sql = await readFile(resolve("packages/database/migrations/0001_platform_skeleton.sql"), "utf8");
try {
  await tko_pool.query(tko_sql);
  console.log("Tasko PostgreSQL platform migration applied.");
} finally {
  await tko_pool.end();
}
