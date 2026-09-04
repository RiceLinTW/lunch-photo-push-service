## Context

個人 n8n 版本已驗證來源 API 行為（見 proposal 與交接筆記）。這次要把單校的個人自動化，擴充成任何學校家長都能訂閱的公開服務。約束：不能碰信用卡/billing（GCP VM 因此出局）、來源網站有 Cloudflare bot 防護、來源 API 非正式公開（無 ToS/robots.txt）、正式公開發布前需徵詢維運單位同意（見 proposal Impact）。

## Goals / Non-Goals

**Goals:**
- 任何學校的家長都能自行訂閱/取消訂閱，不需要人工介入
- 菜色照片一發布就推播，同校同天不重複通知
- 不碰信用卡/billing account，維持免費額度內運作
- 訂閱資料最小化蒐集，符合個資法基本要求

**Non-Goals:**
- v1 不做全國學校對照表/搜尋 UI，先讓使用者手動輸入 SchoolId
- v1 不做圖片長期典藏（R2 相簿），只做當日快取
- 不支援 Android 原生 App / iOS 原生 App，僅 PWA
- 不處理午餐以外的餐別（只做 MenuType=1）

## Decisions

### 通知傳輸：直接用標準 VAPID Web Push，不整合 Firebase FCM

**這修正了先前 session 定案的架構圖**（原圖畫了 Firebase FCM 這個外部服務框），原因：

瀏覽器 `PushManager.subscribe()` 產生的 `subscription.endpoint` 本身就是各家瀏覽器供應商自己的推播服務網址——Chrome/Edge 是 `fcm.googleapis.com/...`、Firefox 是 Mozilla 自己的服務、iOS 16.4+ Safari 是 `web.push.apple.com/...`。只要用標準 Web Push 協議（RFC 8030：VAPID JWT 簽章 + payload 用訂閱的 `p256dh`/`auth` 金鑰做 aes128gcm 加密）直接 POST 到這個 endpoint，就能送達，不需要建立 Firebase 專案、不需要管理 FCM server key。

- 比原規劃少一個外部服務依賴（不用管 Firebase 專案/API key）
- 對 Safari/Firefox 用戶反而更正確——FCM REST API 本來就只涵蓋 Chrome 系訂閱，不含 Safari/Firefox 的 endpoint
- 代價：Cloudflare Workers runtime 沒有 Node 的 `crypto` 模組，不能直接用 npm 上最常見的 `web-push` 套件；需要找相容 Workers 的實作（純 `SubtleCrypto`），這點列進下面的 Risks 並在寫 tasks 前先做技術驗證

**Alternatives considered**：維持原 Firebase FCM 方案——優點是有現成 SDK；缺點是仍要開 Firebase 專案、且原生只涵蓋 Chrome 系裝置，Safari/Firefox 還是得走標準 Web Push，等於兩套邏輯都要寫。直接全用標準 Web Push 更簡單也更正確。

### D1 Schema

```sql
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_notified_date TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subscriptions_school_id ON subscriptions(school_id);

CREATE TABLE notification_log (
  school_id TEXT NOT NULL,
  date TEXT NOT NULL,
  notified_at TEXT NOT NULL,
  PRIMARY KEY (school_id, date)
);
```

`endpoint` 設 UNIQUE：同一裝置/瀏覽器重複訂閱會直接覆蓋既有記錄，不會產生重複列。`notification_log` 用複合主鍵天生防止同校同天重複通知，不需要額外的查詢邏輯去判斷「今天推播過了嗎」。

**Alternatives considered**：把 push subscription 存成單一 JSON 欄位——放棄，因為依 `school_id` 查詢是每日排程的核心操作，拆欄位才能建索引。

### 排程與去重流程

Cloudflare Cron Trigger 在合理時間窗內（例如台灣時間 08:00–14:00）每小時跑一次，而非一天只跑一次：學校上傳菜色照片的時間不固定，抓太早會撲空、只跑一次會錯過晚上傳的學校。每次執行：
1. 先查 `notification_log` 排除今天已通知過的 `school_id`，只對剩下的學校打來源 API（減少沒必要的來源請求）
2. 查到 `data` 非空且至少一道菜 `PicturePath` 非空 → 寫入 `notification_log`、對該校所有訂閱送 Web Push
3. 菜單存在但 `PicturePath` 皆空（照片還沒上傳）→ 不寫 log，留給下一輪

### 相片代理與快取

Worker route 自己 fetch 來源圖片並轉發，不用額外的 R2/KV：直接靠 Cloudflare 的 Cache API（`caches.default`）+ 長效 `Cache-Control`（例如 30 天，因為同一個 `DishId` 的照片不會變）。省掉多開一個儲存系統的複雜度，符合目前的量（一天最多數十張）。

**Alternatives considered**：存進 R2 長期保留——本次不做（見 Non-Goals），量小、且來源本身就是永久紀錄，沒有典藏的急迫性。

### VAPID Key 管理

產生一組 VAPID key pair；private key 存為 Worker Secret（`wrangler secret put VAPID_PRIVATE_KEY`），public key 直接寫進前端程式碼（VAPID public key 設計上就是給 client 用的，不是機密）。

### 學校清單/選校 UX（v1）

不自建全量學校對照表，改為使用者手動輸入 SchoolId，PWA 附上查詢方式說明連結（指向教育部平台）。全量搜尋列為 Open Question，等有真實使用者反饋再決定要不要做。

### 訂閱失效自動清除

Web Push 送達失敗回應 410 Gone（訂閱已失效，瀏覽器端已取消或清除資料）時累計 `failure_count`；連續達到門檻（3 次）自動刪除該筆訂閱，不需要使用者手動處理，也順帶滿足資料保留最小化的隱私要求。

## Implementation Contract

### school-subscription
- `POST /api/subscribe`：body `{schoolId, subscription: {endpoint, keys: {p256dh, auth}}}` → upsert `subscriptions`（依 `endpoint` unique，換學校時覆蓋 `school_id`）
- `POST /api/unsubscribe`：body `{endpoint}` → 刪除對應列
- 驗收：訂閱後 D1 出現對應 row；取消訂閱後該 row 消失；同一 endpoint 重複訂閱不產生重複列
- 範圍內：訂閱/取消訂閱 API、D1 schema、失效自動清除。範圍外：使用者帳號系統（不需要登入，endpoint 本身就是識別依據）

### menu-check-and-notify
- Cron trigger 依上述流程查詢、去重、推播；推播 payload 為 `{title, body, url}`，`url` 帶 `schoolId` + 日期查詢字串指回 PWA 當天菜色頁
- 驗收：對同一 `school_id` + 今日日期，一天內 cron 多次觸發只會呼叫來源 API 一次成功查詢並推播一次；模擬「菜單存在但照片未上傳」時不寫 log、不推播，下一輪會重試
- 範圍內：Cron 邏輯、Web Push 發送（含 VAPID 簽章/payload 加密）、失敗計數。範圍外：使用者端如何顯示通知內容（由瀏覽器 Notification 標準行為處理）

### photo-proxy
- `GET /api/photo/:dishId` → server-to-server fetch 來源 `/dish/pic/{dishId}`，轉發 binary 並帶正確 `Content-Type`，設定長效 `Cache-Control`
- 驗收：前端顯示菜色圖一律走此代理路徑，不直接連線來源網域；同一 `dishId` 短時間內重複請求應命中 Cloudflare edge cache（可用 `cf-cache-status` header 驗證）
- 範圍內：圖片代理與快取。範圍外：圖片轉檔/壓縮（原樣轉發）

## Risks / Trade-offs

- [來源 API 非正式開放，查詢方式或回應格式可能無預警變動] → 用最小輪詢頻率、查詢失敗達門檻時寄信通知自己；正式公開前徵詢維運單位同意查詢頻率與方式
- [Cloudflare Workers runtime 缺乏成熟的官方 Web Push 函式庫（多數套件依賴 Node crypto）] → 進 tasks 前先做技術驗證（spike），確認選用的 edge-compatible 實作能正確送達 Chrome/Firefox/Safari 三種 endpoint
- [學校上傳照片時間不固定，cron 頻率與查詢次數需要平衡] → 先用保守的每小時一次時間窗，依第一週實際資料調整
- [D1/Workers Cron 免費額度] → 目前規模（個位數到數十所學校）遠低於免費額度上限，暫不構成風險

## Migration Plan

全新專案，無既有使用者資料。部署順序：
1. 部署 Worker（含 D1 binding、VAPID secret）
2. 部署 GitHub Pages 前端
3. 手動測試訂閱 → cron 觸發 → 推播 → 點開看圖 全流程
4. 私人使用驗證幾天，確認去重/失效清除邏輯正常
5. 徵詢來源維運單位同意後才對外公開網址（見 proposal Impact）

## Open Questions

- 學校搜尋/選校 UX 要不要做全量清單搜尋（v1 先用手動輸入 SchoolId）
- Cron 查詢時間窗與頻率的實際數字，待第一週真實資料調整
- 是否需要對使用者輸入的 SchoolId 做即時驗證（呼叫來源 API 確認學校存在）
