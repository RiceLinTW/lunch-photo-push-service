const config = globalThis.APP_CONFIG;
const form = document.querySelector("#school-form");
const searchForm = document.querySelector("#school-search-form");
const countyInput = document.querySelector("#school-county");
const queryInput = document.querySelector("#school-query");
const resultsElement = document.querySelector("#school-results");
const directoryStatus = document.querySelector("#directory-status");
const manualFallback = document.querySelector("#manual-fallback");
const schoolInput = document.querySelector("#school-id");
const subscribeButton = document.querySelector("#subscribe");
const unsubscribeButton = document.querySelector("#unsubscribe");
const status = document.querySelector("#status");
const menuSection = document.querySelector("#menu-section");
const menuElement = document.querySelector("#menu");
const menuDate = document.querySelector("#menu-date");

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function applicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function workerRegistration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in globalThis)) throw new Error("此瀏覽器不支援網頁推播。");
  await navigator.serviceWorker.register("sw.js");
  return navigator.serviceWorker.ready;
}

async function post(path, body) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "服務暫時無法使用。");
}

function selectedSchool() {
  const schoolId = schoolInput.value.trim();
  if (!schoolId) throw new Error("請先輸入 SchoolId。");
  return schoolId;
}

function manualReady() { subscribeButton.disabled = !schoolInput.value.trim(); }

async function resolveCandidate(candidate) {
  directoryStatus.textContent = "正在確認學校代碼…";
  const response = await fetch(`${config.apiBaseUrl}/api/schools/resolve`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ school_code: candidate.school_code }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("無法自動確認代碼，請使用下方手動輸入。 ");
  schoolInput.value = result.school_id;
  subscribeButton.disabled = false;
  manualFallback.hidden = true;
  directoryStatus.textContent = `已確認：${candidate.county} ${candidate.school_name}`;
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultsElement.replaceChildren(); manualFallback.hidden = true;
  directoryStatus.textContent = "正在搜尋學校…";
  try {
    const params = new URLSearchParams({ county: countyInput.value, q: queryInput.value.trim() });
    const response = await fetch(`${config.apiBaseUrl}/api/schools/search?${params}`);
    if (!response.ok) throw new Error("學校搜尋暫時無法使用。 ");
    const result = await response.json();
    if (!result.schools?.length) {
      directoryStatus.textContent = "找不到符合的學校。";
      manualFallback.hidden = false;
      return;
    }
    directoryStatus.textContent = "請選擇學校以確認代碼：";
    for (const school of result.schools) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "school-result";
      button.textContent = `${school.county} ${school.school_name}`;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await resolveCandidate(school); }
        catch (error) { directoryStatus.textContent = error instanceof Error ? error.message : "無法確認代碼。"; manualFallback.hidden = false; button.disabled = false; }
      });
      resultsElement.append(button);
    }
  } catch (error) {
    directoryStatus.textContent = error instanceof Error ? error.message : "搜尋失敗。";
    manualFallback.hidden = false;
  }
});

subscribeButton.addEventListener("click", async () => {
  subscribeButton.disabled = true;
  try {
    const schoolId = selectedSchool();
    subscribeButton.disabled = false;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("需要允許通知才能訂閱。");
    const registration = await workerRegistration();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.vapidPublicKey),
    });
    await post("/api/subscribe", { schoolId, subscription: subscription.toJSON() });
    localStorage.setItem("schoolId", schoolId);
    status.textContent = "已開啟通知；午餐照片上傳後會告訴你。";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "訂閱失敗。";
  } finally { subscribeButton.disabled = false; }
});

unsubscribeButton.addEventListener("click", async () => {
  unsubscribeButton.disabled = true;
  try {
    const registration = await workerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await post("/api/unsubscribe", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    status.textContent = "已取消通知。";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "取消失敗。";
  } finally { unsubscribeButton.disabled = false; }
});

function renderDishes(dishes) {
  menuElement.replaceChildren();
  const photographed = dishes.filter((dish) => dish.PicturePath && dish.DishId != null);
  if (!photographed.length) {
    const message = document.createElement("p");
    message.className = "empty";
    message.textContent = dishes.length ? "菜單已公布，照片還沒上傳。" : "今天尚未公布菜單。";
    menuElement.append(message);
    return;
  }
  for (const dish of photographed) {
    const article = document.createElement("article");
    article.className = "dish";
    const image = document.createElement("img");
    image.src = `${config.apiBaseUrl}/api/photo/${encodeURIComponent(dish.DishId)}`;
    image.alt = dish.DishName ? `${dish.DishName}照片` : "午餐菜色照片";
    image.loading = "lazy";
    const copy = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = dish.DishName || "未命名菜色";
    const type = document.createElement("small");
    type.textContent = dish.DishType || "";
    copy.append(name, type);
    article.append(image, copy);
    menuElement.append(article);
  }
}

async function loadMenu(schoolId, date) {
  status.textContent = "正在查詢菜色…";
  const query = new URLSearchParams({ schoolId, date });
  const response = await fetch(`${config.apiBaseUrl}/api/menu?${query}`);
  if (!response.ok) throw new Error("目前無法取得菜單，請稍後再試。");
  const result = await response.json();
  renderDishes(result.dishes);
  menuDate.dateTime = date;
  menuDate.textContent = date;
  menuSection.hidden = false;
  status.textContent = "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const schoolId = selectedSchool();
    localStorage.setItem("schoolId", schoolId);
    await loadMenu(schoolId, todayInTaipei());
  } catch (error) { status.textContent = error instanceof Error ? error.message : "查詢失敗。"; }
});

const params = new URLSearchParams(location.search);
const initialSchool = params.get("schoolId") || localStorage.getItem("schoolId") || "";
const initialDate = params.get("date") || todayInTaipei();
schoolInput.value = initialSchool;
manualReady();
schoolInput.addEventListener("input", manualReady);
if (!initialSchool) manualFallback.hidden = false;
if (initialSchool) loadMenu(initialSchool, initialDate).catch((error) => { status.textContent = error.message; });
workerRegistration().catch(() => {});
