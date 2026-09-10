const CACHE_NAME = "lunch-photo-shell-v4";
const APP_SHELL = ["./", "index.html", "styles.css?v=4", "config.js?v=4", "app.js?v=4", "manifest.json", "icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method === "GET" && new URL(event.request.url).origin === location.origin) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "午餐照片已上傳", body: "點一下查看今日菜色。", url: "./" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "icons/icon.svg",
    badge: "icons/icon.svg",
    data: { url: data.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "./"));
});
