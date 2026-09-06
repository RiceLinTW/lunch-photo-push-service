import assert from "node:assert/strict";
import test from "node:test";
import { lookupSchool, resolveSchool, searchSchools } from "../src/schools.ts";

const schools = [
  { school_code: "024701", school_name: "縣立清溝國小", county: "宜蘭縣" },
  { school_code: "333609", school_name: "市立公館國小", county: "臺北市" },
  { school_code: "999999", school_name: "縣立清溝國中", county: "花蓮縣" },
];

class SearchStatement {
  bindings: string[] = [];
  private readonly sql: string;
  constructor(sql: string) { this.sql = sql; }
  bind(...values: string[]) { this.bindings = values; return this; }
  async all<T>() {
    if (this.sql.includes("verified_school_ids")) return { results: [] as T[] };
    assert.match(this.sql, /school_name LIKE \? ESCAPE/);
    const keyword = this.bindings[0].slice(1, -1).replaceAll("\\%", "%").replaceAll("\\_", "_").replaceAll("\\\\", "\\");
    const county = this.sql.includes("county = ?") ? this.bindings[1] : "";
    return { results: schools.filter((school) => school.school_name.includes(keyword) && (!county || school.county === county)) as T[] };
  }
}

class ResolveDatabase {
  cached: string | null = null;
  prepare(sql: string) {
    const self = this;
    return {
      bind(...values: string[]) {
        return {
          async all<T>() { return { results: self.cached && sql.includes("verified_school_ids") ? [{ school_id: self.cached }] as T[] : [] as T[] }; },
          async run() { self.cached = values[1]; return { meta: { changes: 1 } }; },
        };
      },
    };
  }
}

function database(): D1Database {
  return { prepare: (sql: string) => new SearchStatement(sql) } as unknown as D1Database;
}

test("search finds 清溝 by partial name within clean 宜蘭縣 county", async () => {
  const request = new Request("https://worker.test/api/schools/search?county=%E5%AE%9C%E8%98%AD%E7%B8%A3&q=%E6%B8%85%E6%BA%9D");
  const response = await searchSchools(request, database());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, schools: [schools[0]] });
});

test("search accepts a partial school name and optional county", async () => {
  const response = await searchSchools(new Request("https://worker.test/api/schools/search?q=%E5%85%AC%E9%A4%A8"), database());
  const body = await response.json() as { schools: typeof schools };
  assert.equal(body.schools[0].school_code, "333609");
});

test("search requires a non-empty name query", async () => {
  const response = await searchSchools(new Request("https://worker.test/api/schools/search?county=%E5%AE%9C%E8%98%AD%E7%B8%A3"), database());
  assert.equal(response.status, 400);
});

test("resolve reuses a cached school id without source calls", async () => {
  const db = new ResolveDatabase(); db.cached = "64736349";
  let calls = 0;
  const response = await resolveSchool(new Request("https://worker.test/api/schools/resolve", { method: "POST", body: JSON.stringify({ school_code: "024701" }) }), db as unknown as D1Database, async () => { calls++; return Response.json({ data: [] }); });
  assert.deepEqual(await response.json(), { ok: true, school_id: "64736349" });
  assert.equal(calls, 0);
});

test("resolve checks up to seven dates and caches the first real offering", async () => {
  const db = new ResolveDatabase(); let calls = 0; const dates: string[] = [];
  const response = await resolveSchool(new Request("https://worker.test/api/schools/resolve", { method: "POST", body: JSON.stringify({ school_code: "010001" }) }), db as unknown as D1Database, async (input) => {
    calls++; dates.push(new URL(String(input)).searchParams.get("period")!);
    return Response.json({ data: calls === 3 ? [{ BatchDataId: "batch" }] : [] });
  }, new Date("2026-09-04T02:00:00Z"));
  assert.deepEqual(await response.json(), { ok: true, school_id: "010001" });
  assert.equal(calls, 3); assert.equal(dates[0], "2026-09-04"); assert.equal(db.cached, "010001");
});

test("resolve reports inconclusive after seven empty offerings without caching", async () => {
  const db = new ResolveDatabase(); let calls = 0;
  const response = await resolveSchool(new Request("https://worker.test/api/schools/resolve", { method: "POST", body: JSON.stringify({ school_code: "024701" }) }), db as unknown as D1Database, async () => { calls++; return Response.json({ data: [] }); }, new Date("2026-09-04T02:00:00Z"));
  assert.deepEqual(await response.json(), { ok: false });
  assert.equal(calls, 7); assert.equal(db.cached, null);
});

class LookupStatement {
  bindings: string[] = [];
  private readonly sql: string;
  constructor(sql: string) { this.sql = sql; }
  bind(...values: string[]) { this.bindings = values; return this; }
  async all<T>() {
    assert.match(this.sql, /WHERE school_code = \?/);
    const match = schools.find((school) => school.school_code === this.bindings[0]);
    return { results: match ? [{ school_name: match.school_name, county: match.county }] as T[] : [] as T[] };
  }
}

function lookupDatabase(): D1Database {
  return { prepare: (sql: string) => new LookupStatement(sql) } as unknown as D1Database;
}

test("lookup returns the school name and county for an already-confirmed schoolId", async () => {
  const response = await lookupSchool(new Request("https://worker.test/api/schools/lookup?schoolId=333609"), lookupDatabase());
  assert.deepEqual(await response.json(), { ok: true, school_name: "市立公館國小", county: "臺北市" });
});

test("lookup returns ok:false for a schoolId with no matching directory entry", async () => {
  const response = await lookupSchool(new Request("https://worker.test/api/schools/lookup?schoolId=00000000"), lookupDatabase());
  assert.deepEqual(await response.json(), { ok: false });
});

test("lookup requires a schoolId", async () => {
  const response = await lookupSchool(new Request("https://worker.test/api/schools/lookup"), lookupDatabase());
  assert.equal(response.status, 400);
});
