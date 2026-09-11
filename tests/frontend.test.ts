import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest defines a standalone installable app and icon", async () => {
  const manifest = JSON.parse(await readFile("frontend/manifest.json", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name && manifest.start_url);
  assert.ok(manifest.icons.some((icon: { sizes: string }) => icon.sizes === "any"));
  assert.match(await readFile("frontend/index.html", "utf8"), /rel="manifest"/);
  assert.match(await readFile("frontend/app.js", "utf8"), /serviceWorker\.register/);
});

test("frontend implements subscribe, unsubscribe and deep-linked menu loading", async () => {
  const source = await readFile("frontend/app.js", "utf8");
  assert.match(source, /pushManager\.subscribe/);
  assert.match(source, /\/api\/subscribe/);
  assert.match(source, /\/api\/unsubscribe/);
  assert.match(source, /params\.get\("schoolId"\)/);
  assert.match(source, /params\.get\("date"\)/);
});

test("frontend searches the directory and resolves candidates before enabling subscribe", async () => {
  const source = await readFile("frontend/app.js", "utf8");
  const html = await readFile("frontend/index.html", "utf8");
  assert.match(source, /\/api\/schools\/search/);
  assert.match(source, /\/api\/schools\/resolve/);
  assert.match(source, /addEventListener\("input"/);
  assert.match(html, /id="school-query"/);
  assert.match(html, /id="school-results"/);
});

test("frontend shares the confirmed school with a copyable link and QR code", async () => {
  const source = await readFile("frontend/app.js", "utf8");
  const html = await readFile("frontend/index.html", "utf8");
  assert.match(source, /navigator\.clipboard\.writeText\(shareUrl\(\)\)/);
  assert.match(source, /schoolId=\$\{encodeURIComponent\(confirmedSchoolId\)\}/);
  assert.match(source, /new QRCode\(qrContainer, shareUrl\(\)\)/);
  assert.match(html, /id="share-section" hidden/);
  assert.match(html, /src="vendor\/qrcode\.min\.js"/);
});

test("dish images only use the Worker photo proxy and never the source domain", async () => {
  const source = await readFile("frontend/app.js", "utf8");
  assert.match(source, /\/api\/photo\//);
  assert.doesNotMatch(source, /fatraceschool\.k12ea\.gov\.tw/);
});
