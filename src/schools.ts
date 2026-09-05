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
