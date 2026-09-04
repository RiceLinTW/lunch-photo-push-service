import assert from "node:assert/strict";
import test from "node:test";
import { recordDeliveryResult, subscribe, unsubscribe } from "../src/index.ts";

interface Row {
  school_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
  last_notified_date: string | null;
  failure_count: number;
}

class MockStatement {
  args: unknown[] = [];
  private sql: string;
  private rows: Map<string, Row>;
  constructor(sql: string, rows: Map<string, Row>) {
    this.sql = sql;
    this.rows = rows;
  }
  bind(...args: unknown[]) { this.args = args; return this; }
  async run() {
    if (this.sql.startsWith("INSERT")) {
      const [school_id, endpoint, p256dh, auth, created_at] = this.args as string[];
      this.rows.set(endpoint, { school_id, endpoint, p256dh, auth, created_at, last_notified_date: null, failure_count: 0 });
    } else if (this.sql.includes("failure_count = failure_count + 1")) {
      const row = this.rows.get(this.args[0] as string); if (row) row.failure_count += 1;
    } else if (this.sql.startsWith("UPDATE") && this.sql.includes("failure_count = 0")) {
      const row = this.rows.get(this.args[0] as string); if (row) row.failure_count = 0;
    } else if (this.sql.includes("failure_count >= 3")) {
      const row = this.rows.get(this.args[0] as string); if (row && row.failure_count >= 3) this.rows.delete(row.endpoint);
    } else if (this.sql.startsWith("DELETE")) {
      this.rows.delete(this.args[0] as string);
    }
    return { success: true };
  }
}

function mockDb() {
  const rows = new Map<string, Row>();
  const db = { prepare: (sql: string) => new MockStatement(sql, rows) } as unknown as D1Database;
  return { db, rows };
}

function request(body: unknown) {
  return new Request("https://worker.test/api", { method: "POST", body: JSON.stringify(body) });
}

const push = { endpoint: "https://push.test/1", keys: { p256dh: "public", auth: "secret" } };

test("subscribe creates and updates one endpoint while ignoring extra fields", async () => {
  const { db, rows } = mockDb();
  assert.equal((await subscribe(request({ schoolId: "A", subscription: push, name: "not stored" }), db)).status, 200);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(push.endpoint)?.school_id, "A");
  assert.equal(Object.hasOwn(rows.get(push.endpoint)!, "name"), false);
  await subscribe(request({ schoolId: "B", subscription: push }), db);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(push.endpoint)?.school_id, "B");
});

test("unsubscribe succeeds for known and unknown endpoints", async () => {
  const { db, rows } = mockDb();
  await subscribe(request({ schoolId: "A", subscription: push }), db);
  assert.equal((await unsubscribe(request({ endpoint: push.endpoint }), db)).status, 200);
  assert.equal(rows.size, 0);
  assert.equal((await unsubscribe(request({ endpoint: "unknown" }), db)).status, 200);
});

test("three consecutive 410 results remove a subscription", async () => {
  const { db, rows } = mockDb();
  await subscribe(request({ schoolId: "A", subscription: push }), db);
  await recordDeliveryResult(db, push.endpoint, 410);
  await recordDeliveryResult(db, push.endpoint, 410);
  assert.equal(rows.get(push.endpoint)?.failure_count, 2);
  await recordDeliveryResult(db, push.endpoint, 410);
  assert.equal(rows.has(push.endpoint), false);
});

test("a successful delivery resets prior failures", async () => {
  const { db, rows } = mockDb();
  await subscribe(request({ schoolId: "A", subscription: push }), db);
  await recordDeliveryResult(db, push.endpoint, 410);
  await recordDeliveryResult(db, push.endpoint, 201);
  assert.equal(rows.get(push.endpoint)?.failure_count, 0);
});
