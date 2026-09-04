import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("privacy policy covers collection, purpose, retention, unsubscribe, and contact", async () => {
  const policy = await readFile("frontend/privacy.html", "utf8");
  for (const phrase of ["我們蒐集什麼", "資料用途", "保留期限與刪除", "取消訂閱與聯絡", "mailto:"]) {
    assert.match(policy, new RegExp(phrase));
  }
  assert.match(policy, /SchoolId/);
  assert.match(policy, /p256dh/);
  assert.match(policy, /兒童資料/);
});

test("maintainer email draft covers service, query frequency, and sender contact", async () => {
  const draft = await readFile("docs/api-maintainer-email-draft.md", "utf8");
  assert.match(draft, /免費、非營利/);
  assert.match(draft, /08:00–14:00/);
  assert.match(draft, /每小時/);
  assert.match(draft, /聯絡人/);
  assert.match(draft, /電子郵件/);
  assert.match(draft, /尚未寄出/);
});
