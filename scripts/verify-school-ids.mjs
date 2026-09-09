// Created by rice.lin
//
// Bounded, respectful verification of the SchoolCode == SchoolId assumption
// for a specific set of counties already present in `school_directory`
// (sourced from MOE's public open data, not the protected school-list
// endpoint). For each school, this checks the platform's own per-ID public
// endpoint across the last 7 days, exactly like `resolveSchool` does for a
// single user-selected school - just run once per school in the target
// counties, one at a time, with a delay between requests.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCE_REQUEST_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};
const SOURCE_ORIGIN = "https://fatraceschool.k12ea.gov.tw";
const DELAY_MS = 400;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const target = process.argv[2];
if (target !== "--local" && target !== "--remote") {
  fail("Usage: node scripts/verify-school-ids.mjs --local|--remote [county...]  (default counties: 臺北市 新北市)");
}
const counties = process.argv.slice(3).length ? process.argv.slice(3) : ["臺北市", "新北市"];

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runD1(args, { parse = true } = {}) {
  const wrangler = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(wrangler, ["wrangler", "d1", "execute", "DB", target, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler d1 execute failed: ${result.stderr}`);
  return parse ? JSON.parse(result.stdout) : result.stdout;
}

function taipeiDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasMenuData(schoolCode, date) {
  const url = new URL("/offered/meal", SOURCE_ORIGIN);
  url.search = new URLSearchParams({ SchoolId: schoolCode, period: date, KitchenId: "all", MenuType: "1" }).toString();
  const response = await fetch(url, { headers: SOURCE_REQUEST_HEADERS });
  if (!response.ok) return null; // inconclusive, not a confirmed mismatch
  const result = await response.json();
  return Array.isArray(result.data) && result.data.length > 0;
}

const countyList = counties.map(quote).join(",");
const rows = runD1(["--json", "--command", `SELECT school_code, school_name, county FROM school_directory WHERE county IN (${countyList}) AND school_code NOT IN (SELECT school_code FROM verified_school_ids) ORDER BY county, school_name`])[0].results;

console.log(`Checking ${rows.length} schools in [${counties.join(", ")}] not already verified...`);

const start = new Date(`${taipeiDate(new Date())}T12:00:00Z`);
const matches = [];
const mismatches = [];

for (const [index, row] of rows.entries()) {
  let matched = false;
  let inconclusive = false;
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(start.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let result;
    try {
      result = await hasMenuData(row.school_code, date);
    } catch {
      result = null;
    }
    if (result === null) { inconclusive = true; continue; }
    if (result) { matched = true; break; }
    await sleep(DELAY_MS);
  }
  if (matched) {
    matches.push(row);
  } else {
    mismatches.push({ ...row, inconclusive });
  }
  console.log(`[${index + 1}/${rows.length}] ${row.county} ${row.school_name} (${row.school_code}) -> ${matched ? "MATCH" : inconclusive ? "no data (some days inconclusive)" : "no match"}`);
  await sleep(DELAY_MS);
}

const resultsPath = join(tmpdir(), `mealtracker-verify-results-${Date.now()}.json`);
writeFileSync(resultsPath, JSON.stringify({ matches, mismatches }, null, 2));
console.log(`\nResults saved to ${resultsPath} (in case the D1 write below fails).`);

if (matches.length) {
  const verifiedAt = new Date().toISOString();
  const statements = matches.map((row) => `INSERT OR REPLACE INTO verified_school_ids (school_code, school_id, verified_at) VALUES (${quote(row.school_code)}, ${quote(row.school_code)}, ${quote(verifiedAt)});`);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "mealtracker-verify-"));
  const sqlPath = join(temporaryDirectory, "verify.sql");
  try {
    writeFileSync(sqlPath, statements.join("\n"));
    runD1(["--file", sqlPath], { parse: false });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

console.log(`\nDone. ${matches.length} verified, ${mismatches.length} did not match.`);
if (mismatches.length) {
  console.log("\nSchools that did NOT resolve (school_code != school_id, or genuinely no data in the last 7 days):");
  for (const row of mismatches) {
    console.log(`  ${row.county} ${row.school_name} (${row.school_code})${row.inconclusive ? " [some days had a fetch error, may be worth rechecking]" : ""}`);
  }
}
