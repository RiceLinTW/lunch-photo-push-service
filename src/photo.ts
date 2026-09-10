import { SOURCE_REQUEST_HEADERS } from "./source-headers.ts";

const PHOTO_ORIGIN = "https://fatraceschool.k12ea.gov.tw";
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const CORS_HEADERS = { "access-control-allow-origin": "*" };

function withCacheStatus(response: Response, status: "HIT" | "MISS"): Response {
  const headers = new Headers(response.headers);
  headers.set("cf-cache-status", status);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function proxyPhoto(
  request: Request,
  dishId: string,
  fetcher: typeof fetch = fetch,
  cache: Cache = (caches as unknown as { default: Cache }).default,
): Promise<Response> {
  if (!dishId || dishId.length > 200) return Response.json({ ok: false, error: "Invalid dishId" }, { status: 400, headers: CORS_HEADERS });

  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return withCacheStatus(cached, "HIT");

  const sourceUrl = new URL(`/dish/pic/${encodeURIComponent(dishId)}`, PHOTO_ORIGIN);
  const source = await fetcher(sourceUrl, { headers: { accept: "image/*", ...SOURCE_REQUEST_HEADERS } });
  if (!source.ok) {
    return Response.json(
      { ok: false, error: "Photo source request failed" },
      { status: source.status === 404 ? 404 : 502, headers: CORS_HEADERS },
    );
  }

  const contentType = source.headers.get("content-type") ?? "application/octet-stream";
  const cacheable = new Response(source.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${THIRTY_DAYS}, s-maxage=${THIRTY_DAYS}, immutable`,
      ...CORS_HEADERS,
    },
  });
  await cache.put(cacheKey, cacheable.clone());
  return withCacheStatus(cacheable, "MISS");
}
