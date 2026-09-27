/** Browser-side CSV parsing for the CRM import flow (spec 19 §2). Mirrors the header
 * normalization of modules/ecosystem/src/import-adapters.ts parseCrmCsv (headers trimmed and
 * lowercased) with a dependency-free RFC4180-style parser: quoted fields, doubled quotes,
 * comma/semicolon agnostic line endings. */

export interface TkoCsvParseResult {
  headers: string[];
  /** Raw cell grid without the header row (empty trailing rows removed). */
  rows: string[][];
  /** Header-normalized objects, one per data row. */
  records: Array<Record<string, string>>;
}

export function tko_csvRows(tko_csv: string): string[][] {
  const tko_rows: string[][] = [];
  let tko_row: string[] = [];
  let tko_field = "";
  let tko_quotes = false;
  for (let tko_index = 0; tko_index < tko_csv.length; tko_index += 1) {
    const tko_character = tko_csv[tko_index];
    if (tko_character === '"' && tko_csv[tko_index + 1] === '"') { tko_field += '"'; tko_index += 1; }
    else if (tko_character === '"') tko_quotes = !tko_quotes;
    else if (tko_character === "," && !tko_quotes) { tko_row.push(tko_field); tko_field = ""; }
    else if ((tko_character === "\n" || tko_character === "\r") && !tko_quotes) {
      if (tko_character === "\r" && tko_csv[tko_index + 1] === "\n") tko_index += 1;
      tko_row.push(tko_field);
      if (tko_row.some(tko_value => tko_value.trim())) tko_rows.push(tko_row);
      tko_row = [];
      tko_field = "";
    } else tko_field += tko_character;
  }
  tko_row.push(tko_field);
  if (tko_row.some(tko_value => tko_value.trim())) tko_rows.push(tko_row);
  return tko_rows;
}

export function tko_parseCsvText(tko_csv: string): TkoCsvParseResult {
  const tko_body = tko_csv.charCodeAt(0) === 0xfeff ? tko_csv.slice(1) : tko_csv;
  const [tko_headers = [], ...tko_dataRows] = tko_csvRows(tko_body);
  const tko_normalizedHeaders = tko_headers.map(tko_header => tko_header.trim().toLowerCase());
  const tko_records = tko_dataRows.map(tko_row => Object.fromEntries(tko_normalizedHeaders.map((tko_header, tko_column) => [tko_header, (tko_row[tko_column] ?? "").trim()])));
  return { headers: tko_normalizedHeaders, rows: tko_dataRows, records: tko_records };
}
