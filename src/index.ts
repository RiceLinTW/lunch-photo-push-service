export interface Env {
  DB: D1Database;
  VAPID_PRIVATE_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  FRONTEND_URL: string;
}

import { checkMenusAndNotify, fetchSchoolMenu } from "./menu.ts";
import { proxyPhoto } from "./photo.ts";
import { searchSchools } from "./schools.ts";

interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface SubscribeInput {
  schoolId: string;
  subscription: PushSubscriptionInput;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSubscribeInput(value: unknown): SubscribeInput | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const subscription = body.subscription;
  if (!nonEmptyString(body.schoolId) || !subscription || typeof subscription !== "object") return null;
  const push = subscription as Record<string, unknown>;
  const keys = push.keys;
  if (!nonEmptyString(push.endpoint) || !keys || typeof keys !== "object") return null;
  const pushKeys = keys as Record<string, unknown>;
  if (!nonEmptyString(pushKeys.p256dh) || !nonEmptyString(pushKeys.auth)) return null;
  return {
    schoolId: body.schoolId.trim(),
    subscription: {
      endpoint: push.endpoint,
      keys: { p256dh: pushKeys.p256dh, auth: pushKeys.auth },
    },
  };
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function subscribe(request: Request, db: D1Database): Promise<Response> {
  const input = parseSubscribeInput(await readJson(request));
  if (!input) return json({ ok: false, error: "Invalid subscription payload" }, 400);
  const { schoolId, subscription } = input;
  await db
    .prepare(`INSERT INTO subscriptions (school_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        school_id = excluded.school_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        created_at = excluded.created_at,
        last_notified_date = NULL,
        failure_count = 0`)
    .bind(schoolId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString())
    .run();
  return json({ ok: true });
}

export async function unsubscribe(request: Request, db: D1Database): Promise<Response> {
  const body = await readJson(request);
  const endpoint = body && typeof body === "object" ? (body as Record<string, unknown>).endpoint : null;
  if (!nonEmptyString(endpoint)) return json({ ok: false, error: "Invalid endpoint" }, 400);
  await db.prepare("DELETE FROM subscriptions WHERE endpoint = ?").bind(endpoint).run();
  return json({ ok: true });
}

export async function recordDeliveryResult(db: D1Database, endpoint: string, status: number): Promise<void> {
  if (status >= 200 && status < 300) {
    await db.prepare("UPDATE subscriptions SET failure_count = 0 WHERE endpoint = ?").bind(endpoint).run();
    return;
  }
  if (status !== 410) return;
  await db.prepare("UPDATE subscriptions SET failure_count = failure_count + 1 WHERE endpoint = ?").bind(endpoint).run();
  await db.prepare("DELETE FROM subscriptions WHERE endpoint = ? AND failure_count >= 3").bind(endpoint).run();
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method === "POST" && pathname === "/api/subscribe") return subscribe(request, env.DB);
  if (request.method === "POST" && pathname === "/api/unsubscribe") return unsubscribe(request, env.DB);
  if (request.method === "GET" && pathname === "/api/schools/search") return searchSchools(request, env.DB);
  if (request.method === "GET" && pathname.startsWith("/api/photo/")) {
    const dishId = decodeURIComponent(pathname.slice("/api/photo/".length));
    return proxyPhoto(request, dishId);
  }
  if (request.method === "GET" && pathname === "/api/menu") {
    const schoolId = url.searchParams.get("schoolId")?.trim();
    const date = url.searchParams.get("date");
    if (!schoolId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "Invalid schoolId or date" }, 400);
    try {
      return json({ ok: true, schoolId, date, dishes: await fetchSchoolMenu(schoolId, date) });
    } catch (error) {
      console.error("Menu lookup failed", error);
      return json({ ok: false, error: "Menu source request failed" }, 502);
    }
  }
  if (request.method === "GET" && pathname === "/health") return json({ service: "lunch-photo-push-service", status: "ok" });
  return json({ ok: false, error: "Not found" }, 404);
}

export default {
  fetch: handleRequest,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(checkMenusAndNotify(env, env.FRONTEND_URL));
  },
} satisfies ExportedHandler<Env>;
