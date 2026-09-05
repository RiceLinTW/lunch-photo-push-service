import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCES = [
  { stage: "國小", url: "https://stats.moe.gov.tw/files/school/114/e1_new.json" },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

const target = process.argv[2];
if (target !== "--local" && target !== "--remote") {
  fail("Usage: node scripts/import-schools.mjs --local|--remote");
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function decodeJson(bytes, url) {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) throw new Error("top-level value is not an array");
    return value;
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error instanceof Error ? error.message : error}`);
  }
}

async function loadSource(source) {
  const override = process.env[`SCHOOL_DIRECTORY_${source.stage === "國小" ? "ELEMENTARY" : source.stage === "國中" ? "JUNIOR_HIGH" : "SENIOR_HIGH"}_URL`];
  const url = override || source.url;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const records = decodeJson(await response.arrayBuffer(), url);
  const years = records.map((record) => String(record["學年度"] ?? "").trim()).filter(Boolean);
  const latestYear = years.length ? years.sort((a, b) => Number(b) - Number(a))[0] : null;
  const current = latestYear ? records.filter((record) => String(record["學年度"] ?? "").trim() === latestYear) : records;
  const rows = current.map((record, index) => {
    const school_code = String(record["代碼"] ?? "").trim();
    const school_name = String(record["學校名稱"] ?? "").trim();
    const county = String(record["縣市名稱"] ?? "").trim().replace(/^\[\d+\]/, "").trim();
    if (!school_code || !school_name || !county) throw new Error(`${url} record ${index + 1} is missing 代碼, 學校名稱, or 縣市名稱`);
    return { school_code, school_name, county, school_stage: source.stage };
  });
  console.log(`${source.stage}: ${rows.length} rows${latestYear ? ` (學年度 ${latestYear})` : ""} from ${url}`);
  return rows;
}

const rows = (await Promise.all(SOURCES.map(loadSource))).flat();
const uniqueCodes = new Set(rows.map((row) => row.school_code));
if (uniqueCodes.size !== rows.length) fail(`Sources contain ${rows.length - uniqueCodes.size} duplicate school_code values across stages`);

const importedAt = new Date().toISOString();
const statements = [];
for (const row of rows) {
  statements.push(`INSERT OR REPLACE INTO school_directory (school_code, school_name, county, school_stage, updated_at) VALUES (${quote(row.school_code)}, ${quote(row.school_name)}, ${quote(row.county)}, ${quote(row.school_stage)}, ${quote(importedAt)});`);
}
const temporaryDirectory = mkdtempSync(join(tmpdir(), "mealtracker-schools-"));
const sqlPath = join(temporaryDirectory, "import.sql");
try {
  writeFileSync(sqlPath, statements.join("\n"));
  const wrangler = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(wrangler, ["wrangler", "d1", "execute", "DB", target, "--file", sqlPath], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Imported ${rows.length} schools into D1.`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
