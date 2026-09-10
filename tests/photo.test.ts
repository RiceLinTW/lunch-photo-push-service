import assert from "node:assert/strict";
import test from "node:test";
import { proxyPhoto } from "../src/photo.ts";

class MemoryCache {
  entries = new Map<string, Response>();
  key(request: RequestInfo | URL) { return request instanceof Request ? request.url : String(request); }
  async match(request: RequestInfo | URL) {
    const response = this.entries.get(this.key(request));
    return response?.clone();
  }
  async put(request: RequestInfo | URL, response: Response) {
    this.entries.set(this.key(request), response.clone());
  }
}

test("photo proxy preserves image type and caches by proxy URL for 30 days", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const cache = new MemoryCache();
  let sourceCalls = 0;
  let sourceUrl = "";
  const fetcher = async (input: RequestInfo | URL) => {
    sourceCalls++;
    sourceUrl = String(input);
    return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
  };
  const request = new Request("https://worker.test/api/photo/dish%2F123");

  const first = await proxyPhoto(request, "dish/123", fetcher as typeof fetch, cache as unknown as Cache);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/jpeg");
  assert.match(first.headers.get("cache-control")!, /max-age=2592000/);
  assert.equal(first.headers.get("cf-cache-status"), "MISS");
  // Without this, the frontend's fetch()-based photo loading (not a plain
  // <img src>) gets silently blocked as a cross-origin request every time.
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.equal(sourceUrl, "https://fatraceschool.k12ea.gov.tw/dish/pic/dish%2F123");
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), bytes);

  const second = await proxyPhoto(request, "dish/123", fetcher as typeof fetch, cache as unknown as Cache);
  assert.equal(second.headers.get("cf-cache-status"), "HIT");
  assert.equal(sourceCalls, 1);
});

test("failed source responses are not cached", async () => {
  const cache = new MemoryCache();
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 404 }); };
  const request = new Request("https://worker.test/api/photo/missing");
  const first = await proxyPhoto(request, "missing", fetcher as typeof fetch, cache as unknown as Cache);
  assert.equal(first.status, 404);
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.equal((await proxyPhoto(request, "missing", fetcher as typeof fetch, cache as unknown as Cache)).status, 404);
  assert.equal(calls, 2);
});
