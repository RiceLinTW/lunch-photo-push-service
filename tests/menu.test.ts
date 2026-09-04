import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/index.ts";
import { checkMenusAndNotify, notificationPayload } from "../src/menu.ts";

interface State {
  schools: string[];
  subscriptions: Array<{ school_id: string; endpoint: string; p256dh: string; auth: string; failure_count: number }>;
  logs: Set<string>;
}

class MenuStatement {
  args: unknown[] = [];
  sql: string;
  private state: State;
  constructor(sql: string, state: State) { this.sql = sql; this.state = state; }
  bind(...args: unknown[]) { this.args = args; return this; }
  async all<T>() {
    if (this.sql.includes("SELECT DISTINCT")) {
      const date = this.args[0];
      return { results: this.state.schools.filter((school) => !this.state.logs.has(`${school}:${date}`)).map((school_id) => ({ school_id })) as T[] };
    }
    const school = this.args[0];
    return { results: this.state.subscriptions.filter((row) => row.school_id === school).map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })) as T[] };
  }
  async run() {
    if (this.sql.startsWith("INSERT OR IGNORE")) {
      const key = `${this.args[0]}:${this.args[1]}`;
      if (this.state.logs.has(key)) return { meta: { changes: 0 } };
      this.state.logs.add(key); return { meta: { changes: 1 } };
    }
    if (this.sql.includes("failure_count = failure_count + 1")) {
      const row = this.state.subscriptions.find((item) => item.endpoint === this.args[0]); if (row) row.failure_count += 1;
    } else if (this.sql.includes("failure_count = 0")) {
      const row = this.state.subscriptions.find((item) => item.endpoint === this.args[0]); if (row) row.failure_count = 0;
    } else if (this.sql.startsWith("DELETE")) {
      this.state.subscriptions = this.state.subscriptions.filter((row) => row.endpoint !== this.args[0] || row.failure_count < 3);
    }
    return { meta: { changes: 1 } };
  }
}

function environment(state: State): Env {
  return {
    DB: { prepare: (sql: string) => new MenuStatement(sql, state) } as unknown as D1Database,
    VAPID_PRIVATE_KEY: "private",
    VAPID_PUBLIC_KEY: "public",
    VAPID_SUBJECT: "mailto:test@example.com",
    FRONTEND_URL: "https://frontend.test/",
  };
}

const now = new Date("2026-09-04T02:00:00Z");
const subscription = { school_id: "123", endpoint: "https://push.test/1", p256dh: "key", auth: "auth", failure_count: 0 };

test("an already-notified school causes zero source API calls", async () => {
  const state = { schools: ["123"], subscriptions: [subscription], logs: new Set(["123:2026-09-04"]) };
  let calls = 0;
  await checkMenusAndNotify(environment(state), "https://frontend.test/", { now, fetch: async () => { calls++; return Response.json({}); } });
  assert.equal(calls, 0);
});

test("a photo claims the daily log and pushes once", async () => {
  const state: State = { schools: ["123"], subscriptions: [{ ...subscription }], logs: new Set() };
  let sourceCalls = 0;
  const fetcher = async (input: URL | RequestInfo) => {
    sourceCalls++;
    const url = new URL(String(input));
    return Response.json(url.pathname === "/offered/meal" ? { data: [{ BatchDataId: "batch" }] } : { data: [{ PicturePath: "/photo.jpg" }] });
  };
  const payloads: unknown[] = [];
  const push = async (_target: unknown, payload: unknown) => { payloads.push(payload); return new Response(null, { status: 201 }); };
  await checkMenusAndNotify(environment(state), "https://frontend.test/", { now, fetch: fetcher as typeof fetch, push: push as never });
  assert.equal(sourceCalls, 2);
  assert.equal(state.logs.has("123:2026-09-04"), true);
  assert.equal(payloads.length, 1);
  assert.match((payloads[0] as { url: string }).url, /schoolId=123/);
  assert.match((payloads[0] as { url: string }).url, /date=2026-09-04/);
});

test("a menu without photos writes no log and sends no push", async () => {
  const state: State = { schools: ["123"], subscriptions: [{ ...subscription }], logs: new Set() };
  const fetcher = async (input: URL | RequestInfo) => Response.json(new URL(String(input)).pathname === "/offered/meal" ? { data: [{ BatchDataId: "batch" }] } : { data: [{ PicturePath: "" }] });
  let pushes = 0;
  await checkMenusAndNotify(environment(state), "https://frontend.test/", { now, fetch: fetcher as typeof fetch, push: (async () => { pushes++; return new Response(null, { status: 201 }); }) as never });
  assert.equal(state.logs.size, 0);
  assert.equal(pushes, 0);
});

test("a 410 push response increments failure_count", async () => {
  const state: State = { schools: ["123"], subscriptions: [{ ...subscription }], logs: new Set() };
  const fetcher = async (input: URL | RequestInfo) => Response.json(new URL(String(input)).pathname === "/offered/meal" ? { data: [{ BatchDataId: "batch" }] } : { data: [{ PicturePath: "photo" }] });
  await checkMenusAndNotify(environment(state), "https://frontend.test/", { now, fetch: fetcher as typeof fetch, push: (async () => new Response(null, { status: 410 })) as never });
  assert.equal(state.subscriptions[0].failure_count, 1);
});

test("notification payload always contains title, body, school and date", () => {
  const payload = notificationPayload("school/1", "2026-09-04", "https://frontend.test/menu");
  assert.ok(payload.title); assert.ok(payload.body);
  const url = new URL(payload.url);
  assert.equal(url.searchParams.get("schoolId"), "school/1");
  assert.equal(url.searchParams.get("date"), "2026-09-04");
});
