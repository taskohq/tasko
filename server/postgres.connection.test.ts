import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const tko_postgresUrl = process.env.TASKO_POSTGRES_URL;
const tko_pool = tko_postgresUrl
  ? new Pool({ connectionString: tko_postgresUrl, connectionTimeoutMillis: 5_000 })
  : null;

afterAll(async () => {
  await tko_pool?.end();
});

describe("TASKO_POSTGRES_URL runtime connection", () => {
  it("connects to the configured PostgreSQL Docker endpoint", async () => {
    expect(tko_postgresUrl).toMatch(/^postgres(?:ql)?:\/\//i);
    const tko_result = await tko_pool!.query<{ healthy: number }>("select 1 as healthy");
    expect(tko_result.rows[0]?.healthy).toBe(1);
  }, 10_000);

  it("retains the M7 AI/MCP persistence tables", async () => {
    const tko_result = await tko_pool!.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[]) order by table_name",
      [["ai_context_references", "ai_runs", "ai_tool_proposals"]],
    );
    expect(tko_result.rows.map(tko_row => tko_row.table_name)).toEqual([
      "ai_context_references",
      "ai_runs",
      "ai_tool_proposals",
    ]);
  }, 10_000);
});
