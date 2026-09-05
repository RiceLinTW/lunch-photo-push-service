import assert from "node:assert/strict";
import test from "node:test";
import { searchSchools } from "../src/schools.ts";

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
    assert.match(this.sql, /school_name LIKE \? ESCAPE/);
    const keyword = this.bindings[0].slice(1, -1).replaceAll("\\%", "%").replaceAll("\\_", "_").replaceAll("\\\\", "\\");
    const county = this.sql.includes("county = ?") ? this.bindings[1] : "";
    return { results: schools.filter((school) => school.school_name.includes(keyword) && (!county || school.county === county)) as T[] };
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
