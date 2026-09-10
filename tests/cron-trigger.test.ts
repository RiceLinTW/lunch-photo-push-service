import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/index.ts";
import { triggerCron } from "../src/index.ts";

const env = {
  CRON_TRIGGER_TOKEN: "cron-secret",
  FRONTEND_URL: "https://frontend.test/",
} as Env;

test("cron trigger rejects a missing or incorrect token", async () => {
  let calls = 0;
  const checker = async () => { calls++; };

  for (const token of [undefined, "wrong-secret"]) {
    const headers = token ? { "x-cron-token": token } : undefined;
    const response = await triggerCron(
      new Request("https://worker.test/api/cron/trigger", { method: "POST", headers }),
      env,
      checker,
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "Unauthorized" });
  }
  assert.equal(calls, 0);
});

test("cron trigger runs the menu checker when the token matches", async () => {
  let calls = 0;
  const response = await triggerCron(
    new Request("https://worker.test/api/cron/trigger", {
      method: "POST",
      headers: { "x-cron-token": "cron-secret" },
    }),
    env,
    async (receivedEnv, frontendUrl) => {
      calls++;
      assert.equal(receivedEnv, env);
      assert.equal(frontendUrl, env.FRONTEND_URL);
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 1);
});
