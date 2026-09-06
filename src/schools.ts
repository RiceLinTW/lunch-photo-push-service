interface SchoolDirectoryRow {
  school_code: string;
  school_name: string;
  county: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function likePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export async function searchSchools(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const county = url.searchParams.get("county")?.trim() ?? "";
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) return json({ ok: false, error: "School name query is required" }, 400);

  const where = ["school_name LIKE ? ESCAPE '\\'"];
  const bindings: string[] = [likePattern(query)];
  if (county) {
    where.push("county = ?");
    bindings.push(county);
  }
  const result = await db.prepare(`SELECT school_code, school_name, county
    FROM school_directory
    WHERE ${where.join(" AND ")}
    ORDER BY county, school_name
    LIMIT 50`).bind(...bindings).all<SchoolDirectoryRow>();
  return json({ ok: true, schools: result.results });
}

export async function lookupSchool(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const schoolId = url.searchParams.get("schoolId")?.trim() ?? "";
  if (!schoolId) return json({ ok: false, error: "schoolId is required" }, 400);
  // Every successful resolve stores school_id === school_code, so a confirmed
  // schoolId can always be looked back up as a school_code.
  const result = await db.prepare("SELECT school_name, county FROM school_directory WHERE school_code = ?")
    .bind(schoolId).all<Pick<SchoolDirectoryRow, "school_name" | "county">>();
  const row = result.results[0];
  if (!row) return json({ ok: false });
  return json({ ok: true, school_name: row.school_name, county: row.county });
}

function taipeiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

interface VerifiedSchoolRow { school_id: string }

export async function resolveSchool(
  request: Request,
  db: D1Database,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const code = body && typeof body === "object" ? (body as Record<string, unknown>).school_code : null;
  if (typeof code !== "string" || !code.trim()) return json({ ok: false, error: "Invalid school_code" }, 400);
  const schoolCode = code.trim();

  const cached = await db.prepare("SELECT school_id FROM verified_school_ids WHERE school_code = ?").bind(schoolCode).all<VerifiedSchoolRow>();
  if (cached.results[0]) return json({ ok: true, school_id: cached.results[0].school_id });

  // Use UTC noon as a date-only anchor so subtracting days does not cross the
  // previous UTC calendar date for Taipei's +08:00 offset.
  const start = new Date(`${taipeiDate(now)}T12:00:00Z`);
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(start.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = new URL("/offered/meal", SOURCE_ORIGIN);
    url.search = new URLSearchParams({ SchoolId: schoolCode, period: date, KitchenId: "all", MenuType: "1" }).toString();
    try {
      const response = await fetcher(url, { headers: SOURCE_REQUEST_HEADERS });
      if (!response.ok) continue;
      const result = await response.json() as { data?: unknown[] };
      if (!Array.isArray(result.data) || result.data.length === 0) continue;
      await db.prepare("INSERT OR REPLACE INTO verified_school_ids (school_code, school_id, verified_at) VALUES (?, ?, ?)").bind(schoolCode, schoolCode, new Date().toISOString()).run();
      return json({ ok: true, school_id: schoolCode });
    } catch {
      // A transient source failure is inconclusive; continue the bounded retry window.
    }
  }
  return json({ ok: false });
}
import { SOURCE_REQUEST_HEADERS } from "./source-headers.ts";

const SOURCE_ORIGIN = "https://fatraceschool.k12ea.gov.tw";
