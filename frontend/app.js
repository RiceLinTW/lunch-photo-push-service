const config = globalThis.APP_CONFIG;
const SW_VERSION = "5";
const queryInput = document.querySelector("#school-query");
const resultsElement = document.querySelector("#school-results");
const directoryStatus = document.querySelector("#directory-status");
const subscribeButton = document.querySelector("#subscribe");
const unsubscribeButton = document.querySelector("#unsubscribe");
const status = document.querySelector("#status");
const menuSection = document.querySelector("#menu-section");
const menuElement = document.querySelector("#menu");
const weekRangeLabel = document.querySelector("#week-range");
const prevWeekButton = document.querySelector("#prev-week");
const nextWeekButton = document.querySelector("#next-week");
const installButton = document.querySelector("#install-app");
const installHint = document.querySelector("#install-hint");
const selectedSchoolLabel = document.querySelector("#selected-school");
const changeSchoolButton = document.querySelector("#change-school");
const schoolSearchSection = document.querySelector("#school-search");
const shareSection = document.querySelector("#share-section");
const copyLinkButton = document.querySelector("#copy-link");
const showQrButton = document.querySelector("#show-qr");
const shareStatus = document.querySelector("#share-status");
const qrContainer = document.querySelector("#qr-code");

let confirmedSchoolId = "";
let weekMonday = "";
let qrInstance = null;

function updateShareSection() {
  shareSection.hidden = !confirmedSchoolId;
  if (!confirmedSchoolId) {
    qrContainer.hidden = true;
    qrContainer.replaceChildren();
    shareStatus.textContent = "";
    showQrButton.textContent = "📱 顯示 QR Code";
  }
}

function shareUrl() {
  return `${location.origin}${location.pathname}?schoolId=${encodeURIComponent(confirmedSchoolId)}`;
}

function showSchoolSearch(visible) {
  schoolSearchSection.hidden = !visible;
  changeSchoolButton.hidden = visible;
}

function readStoredSchool() {
  try {
    const raw = localStorage.getItem("school");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore malformed storage */ }
  const legacyId = localStorage.getItem("schoolId");
  return legacyId ? { schoolId: legacyId, label: "" } : null;
}

function showSelectedSchool(schoolId, label) {
  if (!schoolId) { selectedSchoolLabel.hidden = true; return; }
  selectedSchoolLabel.textContent = label ? `目前已選擇：${label}` : "正在確認學校資訊…";
  selectedSchoolLabel.hidden = false;
}

function rememberSchool(schoolId, label) {
  const existing = readStoredSchool();
  const finalLabel = label ?? (existing?.schoolId === schoolId ? existing.label : "");
  localStorage.setItem("school", JSON.stringify({ schoolId, label: finalLabel }));
  showSelectedSchool(schoolId, finalLabel);
}

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(dateStr, n) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + n);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function mondayOf(dateStr) {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return addDays(dateStr, day === 0 ? -6 : 1 - day);
}

function applicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function workerRegistration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in globalThis)) throw new Error("此瀏覽器不支援網頁推播。");
  const registration = await navigator.serviceWorker.register(`sw.js?v=${SW_VERSION}`, { updateViaCache: "none" });
  registration.update().catch(() => {});
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
  if (!confirmedSchoolId) throw new Error("請先搜尋並選擇你的學校。");
  return confirmedSchoolId;
}

async function resolveCandidate(candidate) {
  directoryStatus.textContent = "正在確認學校代碼…";
  const response = await fetch(`${config.apiBaseUrl}/api/schools/resolve`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ school_code: candidate.school_code }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("無法自動確認這間學校的代碼，請稍後再試或改搜尋其他關鍵字。");
  confirmedSchoolId = result.school_id;
  updateShareSection();
  subscribeButton.disabled = false;
  rememberSchool(result.school_id, `${candidate.county} ${candidate.school_name}`);
  directoryStatus.textContent = `已確認：${candidate.county} ${candidate.school_name}`;
  showSchoolSearch(false);
  await loadWeek(result.school_id, mondayOf(todayInTaipei())).catch((error) => { status.textContent = error.message; });
}

let searchToken = 0;
let debounceTimer = null;

async function performSearch(query) {
  const token = ++searchToken;
  resultsElement.replaceChildren();
  if (!query) { directoryStatus.textContent = ""; return; }
  directoryStatus.textContent = "正在搜尋學校…";
  try {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`${config.apiBaseUrl}/api/schools/search?${params}`);
    if (token !== searchToken) return; // a newer keystroke already superseded this search
    if (!response.ok) throw new Error("學校搜尋暫時無法使用。 ");
    const result = await response.json();
    if (token !== searchToken) return;
    if (!result.schools?.length) {
      directoryStatus.textContent = "找不到符合的學校。";
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
        catch (error) { directoryStatus.textContent = error instanceof Error ? error.message : "無法確認代碼。"; button.disabled = false; }
      });
      resultsElement.append(button);
    }
  } catch (error) {
    if (token !== searchToken) return;
    directoryStatus.textContent = error instanceof Error ? error.message : "搜尋失敗。";
  }
}

changeSchoolButton.addEventListener("click", () => {
  queryInput.value = "";
  resultsElement.replaceChildren();
  directoryStatus.textContent = "";
  showSchoolSearch(true);
  queryInput.focus();
});

queryInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const value = queryInput.value.trim();
  debounceTimer = setTimeout(() => performSearch(value), 250);
});

copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrl());
    shareStatus.textContent = "已複製連結！";
  } catch {
    shareStatus.textContent = "複製失敗，請手動選取網址列的連結。";
  }
});

showQrButton.addEventListener("click", () => {
  qrContainer.hidden = !qrContainer.hidden;
  showQrButton.textContent = qrContainer.hidden ? "📱 顯示 QR Code" : "隱藏 QR Code";
  if (qrContainer.hidden) return;
  if (!qrInstance) {
    qrInstance = new QRCode(qrContainer, shareUrl());
  } else {
    qrInstance.clear();
    qrInstance.makeCode(shareUrl());
  }
});

let deferredInstallPrompt = null;

globalThis.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  installButton.disabled = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
const isStandalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
if (isIOS && !isStandalone) installHint.hidden = false;

subscribeButton.addEventListener("click", async () => {
  subscribeButton.disabled = true;
  try {
    const schoolId = selectedSchool();
    subscribeButton.disabled = false;
    if (deferredInstallPrompt) {
      // On Android, offer the home-screen install as part of the same tap that turns on
      // notifications — installing isn't required for push to work here (unlike iOS), so a
      // decline just continues straight to the permission request below.
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installButton.hidden = true;
    }
    if (isIOS && !isStandalone) {
      throw new Error("請先將本頁加入主畫面（分享 → 加入主畫面），再從主畫面開啟本 App 才能開啟通知。");
    }
    if (!("Notification" in window)) {
      throw new Error("此瀏覽器不支援通知功能。");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("需要允許通知才能訂閱。");
    const registration = await workerRegistration();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.vapidPublicKey),
    });
    await post("/api/subscribe", { schoolId, subscription: subscription.toJSON() });
    rememberSchool(schoolId);
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

function createDishPhoto(photoUrl, altText) {
  const frame = document.createElement("div");
  frame.className = "dish-photo";
  let objectUrl = null;

  const showError = (message) => {
    frame.classList.remove("photo-loaded");
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "photo-retry";
    retryButton.textContent = message;
    retryButton.addEventListener("click", loadPhoto);
    frame.replaceChildren(retryButton);
  };

  const loadPhoto = async () => {
    frame.classList.remove("photo-loaded");
    const loading = document.createElement("p");
    loading.className = "photo-status";
    loading.textContent = "照片載入中…";
    frame.replaceChildren(loading);

    try {
      const response = await fetch(photoUrl, { cache: "no-store" });
      if (!response.ok) {
        showError(`照片讀取失敗（HTTP ${response.status}），點一下重新載入`);
        return;
      }
      const blob = await response.blob();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = altText;
      frame.replaceChildren(image);
      frame.classList.add("photo-loaded");
    } catch {
      showError("照片讀取失敗（網路錯誤），點一下重新載入");
    }
  };

  loadPhoto();
  return frame;
}

function buildDishCard(dish) {
  const article = document.createElement("article");
  article.className = "dish";
  const photoUrl = `${config.apiBaseUrl}/api/photo/${encodeURIComponent(dish.DishId)}`;
  const altText = dish.DishName ? `${dish.DishName}照片` : "午餐菜色照片";
  const photoFrame = createDishPhoto(photoUrl, altText);
  const copy = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = dish.DishName || "未命名菜色";
  const type = document.createElement("small");
  type.textContent = dish.DishType || "";
  copy.append(name, type);
  article.append(photoFrame, copy);
  return article;
}

async function fetchDayDishes(schoolId, date) {
  const query = new URLSearchParams({ schoolId, date });
  const response = await fetch(`${config.apiBaseUrl}/api/menu?${query}`);
  if (!response.ok) throw new Error("目前無法取得菜單，請稍後再試。");
  const result = await response.json();
  return result.dishes;
}

function renderWeek(dates, resultsPerDay, openIndex) {
  menuElement.replaceChildren();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

  dates.forEach((date, i) => {
    const dishes = resultsPerDay[i];
    const photographed = dishes.filter((dish) => dish.PicturePath && dish.DishId != null);
    const head = document.createElement(dishes.length ? "summary" : "div");
    head.className = "day-head";
    const badge = document.createElement("div");
    badge.className = "day-date";
    const weekday = document.createElement("span");
    weekday.textContent = `週${weekdays[new Date(`${date}T00:00:00`).getDay()]}`;
    const dayNumber = document.createElement("strong");
    dayNumber.textContent = String(Number(date.slice(8, 10)));
    badge.append(weekday, dayNumber);
    const meta = document.createElement("div");
    meta.className = "day-meta";
    const dateLabel = document.createElement("strong");
    dateLabel.textContent = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}${i === openIndex ? "（最新）" : ""}`;
    const subtitle = document.createElement("span");
    subtitle.textContent = dishes.length ? `${dishes.length} 道菜色` : "尚未公布菜單";
    meta.append(dateLabel, subtitle);
    head.append(badge, meta);

    if (!dishes.length) {
      const day = document.createElement("div");
      day.className = "day day-empty";
      day.append(head);
      menuElement.append(day);
      return;
    }

    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.classList.add("chevron");
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m6 9 6 6 6-6");
    chevron.append(path);
    head.append(chevron);
    const details = document.createElement("details");
    details.className = "day";
    const body = document.createElement("div");
    body.className = "day-body";
    const grid = document.createElement("div");
    grid.className = "menu-grid";
    body.append(grid);
    details.append(head, body);

    let populated = false;
    const populate = () => {
      if (populated) return;
      populated = true;
      if (photographed.length) grid.append(...photographed.map(buildDishCard));
      else {
        const message = document.createElement("p");
        message.className = "empty";
        message.textContent = "菜單已公布，照片還沒上傳。";
        grid.append(message);
      }
    };
    if (i === openIndex) {
      details.classList.add("is-today");
      details.open = true;
      populate();
    }
    details.addEventListener("toggle", () => { if (details.open) populate(); });
    menuElement.append(details);
  });
}

async function loadWeek(schoolId, monday, preferredDate) {
  weekMonday = monday;
  status.textContent = "正在查詢菜色…";
  try {
    const dates = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
    const results = await Promise.all(dates.map((date) => fetchDayDishes(schoolId, date).catch(() => [])));
    let openIndex = -1;
    results.forEach((dishes, i) => {
      if (dishes.some((dish) => dish.PicturePath && dish.DishId != null)) openIndex = i;
    });
    if (preferredDate && dates.includes(preferredDate)) openIndex = dates.indexOf(preferredDate);
    renderWeek(dates, results, openIndex);
    weekRangeLabel.textContent = `${Number(dates[0].slice(5, 7))}/${Number(dates[0].slice(8, 10))} – ${Number(dates[4].slice(5, 7))}/${Number(dates[4].slice(8, 10))}`;
    menuSection.hidden = false;
    status.textContent = "";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "目前無法取得菜單，請稍後再試。";
  }
}

prevWeekButton.addEventListener("click", () => {
  if (!confirmedSchoolId) return;
  loadWeek(confirmedSchoolId, addDays(weekMonday, -7)).catch((error) => { status.textContent = error.message; });
});

nextWeekButton.addEventListener("click", () => {
  if (!confirmedSchoolId) return;
  loadWeek(confirmedSchoolId, addDays(weekMonday, 7)).catch((error) => { status.textContent = error.message; });
});

const params = new URLSearchParams(location.search);
const storedSchool = readStoredSchool();
const initialSchool = params.get("schoolId") || storedSchool?.schoolId || "";
const initialLabel = storedSchool?.schoolId === initialSchool ? storedSchool.label : "";
const initialDate = params.get("date") || todayInTaipei();
confirmedSchoolId = initialSchool;
updateShareSection();
subscribeButton.disabled = !initialSchool;
showSelectedSchool(initialSchool, initialLabel);
showSchoolSearch(!initialSchool);
if (initialSchool) loadWeek(initialSchool, mondayOf(initialDate), params.get("date") ? initialDate : undefined).catch((error) => { status.textContent = error.message; });
if (initialSchool && !initialLabel) {
  fetch(`${config.apiBaseUrl}/api/schools/lookup?${new URLSearchParams({ schoolId: initialSchool })}`)
    .then((response) => response.json())
    .then((result) => { if (result.ok) rememberSchool(initialSchool, `${result.county} ${result.school_name}`); })
    .catch(() => {});
}
workerRegistration().catch(() => {});
