import { describe, expect, it } from "vitest";
import { tko_csvRows, tko_parseCsvText } from "./csv-parse";

describe("Tasko client CSV parsing (spec 19 §2)", () => {
  it("normalizes headers to trimmed lowercase keys", () => {
    const tko_result = tko_parseCsvText(" Name , EMAIL,Company\nAda,ada@example.test,Acme");
    expect(tko_result.headers).toEqual(["name", "email", "company"]);
    expect(tko_result.records[0]).toEqual({ name: "Ada", email: "ada@example.test", company: "Acme" });
  });

  it("honors RFC4180 quoting, doubled quotes and embedded separators", () => {
    const tko_result = tko_parseCsvText('name,company\n"Smith, John","Say ""hi"""');
    expect(tko_result.records[0]).toEqual({ name: "Smith, John", company: 'Say "hi"' });
    expect(tko_csvRows('a,"b\nc",d')).toEqual([["a", "b\nc", "d"]]);
  });

  it("strips a UTF-8 BOM and drops blank rows", () => {
    const tko_result = tko_parseCsvText("\uFEFFname,email\nAda,ada@example.test\n,,\n");
    expect(tko_result.headers).toEqual(["name", "email"]);
    expect(tko_result.records).toHaveLength(1);
    expect(tko_result.rows).toHaveLength(1);
  });
});
