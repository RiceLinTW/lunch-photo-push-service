// Created by rice.lin
//
// One-off (but repeatable) import of an authoritative SchoolCode -> real
// platform SchoolId mapping, obtained directly from the platform maintainer
// with permission - see docs/api-maintainer-email-draft.md. Scoped to
// elementary schools (SchoolType 2) to match this project's current scope
// ("先做國小就好"). Upserts both school_directory (in case the source file
// has schools/branch campuses we don't have yet) and verified_school_ids.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const target = process.argv[2];
const filePath = process.argv[3];
if ((target !== "--local" && target !== "--remote") || !filePath) {
  fail("Usage: node scripts/import-verified-school-ids.mjs --local|--remote <path-to-raw-schools.json>");
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const records = JSON.parse(readFileSync(filePath, "utf8"));
if (!Array.isArray(records)) fail("Expected the input file to be a JSON array");

const elementary = records.filter((record) => {
  const raw = record.raw;
  return raw && raw.SchoolType === 2 && raw.SchoolCode && raw.SchoolName && raw.SchoolId != null;
});

console.log(`Found ${elementary.length} elementary (SchoolType 2) records in ${filePath}.`);

const importedAt = new Date().toISOString();
const statements = [];
for (const record of elementary) {
  const raw = record.raw;
  statements.push(`INSERT OR REPLACE INTO school_directory (school_code, school_name, county, school_stage, updated_at) VALUES (${quote(raw.SchoolCode)}, ${quote(raw.SchoolName)}, ${quote(record.County ?? "")}, ${quote("國小")}, ${quote(importedAt)});`);
  statements.push(`INSERT OR REPLACE INTO verified_school_ids (school_code, school_id, verified_at) VALUES (${quote(raw.SchoolCode)}, ${quote(String(raw.SchoolId))}, ${quote(importedAt)});`);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "mealtracker-verified-import-"));
const sqlPath = join(temporaryDirectory, "import.sql");
try {
  writeFileSync(sqlPath, statements.join("\n"));
  const wrangler = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(wrangler, ["wrangler", "d1", "execute", "DB", target, "--file", sqlPath], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Imported ${elementary.length} verified school IDs (and refreshed their school_directory rows).`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
