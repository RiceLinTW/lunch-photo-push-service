## 1. Cloudflare Worker 專案骨架

- [x] 1.1 建立 Cloudflare Worker 專案（wrangler.toml、D1 binding），依 D1 Schema 決策建立 `subscriptions` 與 `notification_log` 兩張表；驗證：`wrangler d1 execute` 成功建表，欄位與 design.md 的 D1 Schema 一致
- [x] 1.2 依 VAPID Key 管理 決策產生 VAPID key pair，private key 存為 Worker secret、public key 提供給前端使用；驗證：`wrangler secret list` 顯示 `VAPID_PRIVATE_KEY` 已設定

## 2. school-subscription 能力

- [ ] 2.1 實作 `POST /api/subscribe`，落實 Subscribe to a school：收到 schoolId + push subscription 時 upsert `subscriptions` 表（依 endpoint unique）；驗證：curl 測試新 endpoint 建立新列、既有 endpoint 換 school_id 時更新而非新增列
- [ ] 2.2 實作 `POST /api/unsubscribe`，落實 Unsubscribe from a school：刪除對應 endpoint 記錄，對未知 endpoint 回成功不報錯；驗證：curl 分別測試已知/未知 endpoint 兩種情境
- [ ] 2.3 在 subscribe endpoint 加上欄位白名單，落實 Minimal data collection：忽略 payload 中除 schoolId/push subscription 外的欄位；驗證：送出含多餘欄位的 payload，檢查 D1 記錄未包含這些欄位
- [ ] 2.4 依 訂閱失效自動清除 決策，實作 Automatic removal of invalid subscriptions：Web Push 回 410 時 `failure_count` +1，達 3 次刪除該筆訂閱，成功送達時歸零；驗證：模擬三次連續 410 後該筆記錄消失、模擬失敗後接一次成功歸零計數

## 3. menu-check-and-notify 能力

- [ ] 3.1 依 排程與去重流程 決策實作 Cron Trigger 主流程，落實 Scheduled menu check scoped to pending schools：先過濾掉今天已有 `notification_log` 的學校再查來源 API；驗證：模擬今天已通知的 school_id，下一輪不觸發來源 API 呼叫（mock fetch 呼叫次數為 0）
- [ ] 3.2 實作 Photo-published detection and daily dedup：查到至少一道菜 `PicturePath` 非空時寫入 `notification_log` 並發送推播；照片皆未上傳時不寫入不推播；驗證：兩種情境各一則單元測試（有照片寫入+推播一次、無照片不寫入不推播）
- [ ] 3.3 組出 Notification payload content：推播 payload 含 title/body/url，url 帶 schoolId 與日期查詢參數；驗證：檢查產生的 payload JSON 結構符合規格
- [ ] 3.4 依 通知傳輸：直接用標準 VAPID Web Push，不整合 Firebase FCM 決策，用相容 Cloudflare Workers runtime 的 SubtleCrypto 實作完成 aes128gcm 加密與 VAPID JWT 簽章（技術驗證 spike）；驗證：對 Chrome、Firefox、Safari(iOS PWA) 三種瀏覽器各自建立測試訂閱，實際收到推播通知
- [ ] 3.5 實作 Delivery failure tracking：Web Push 送達回 410 時呼叫 school-subscription 的 `failure_count` 遞增邏輯；驗證：mock 410 回應後檢查對應訂閱 `failure_count` 增加

## 4. photo-proxy 能力

- [ ] 4.1 實作 `GET /api/photo/:dishId`，落實 Server-side photo fetch：server-to-server fetch 來源圖片並回傳正確 Content-Type；驗證：curl 測試回應的 Content-Type 與圖片格式一致
- [ ] 4.2 依 相片代理與快取 決策，實作 Edge caching of fetched photos：用 Cloudflare Cache API 對同一 dishId 設定 30 天 Cache-Control；驗證：連續兩次請求同一 dishId，第二次回應的 `cf-cache-status` header 顯示 HIT

## 5. PWA 前端

- [ ] 5.1 依 學校清單/選校 UX（v1）決策，建立 GitHub Pages 靜態站台骨架（manifest.json、service worker、手動輸入 SchoolId 的選校畫面）；驗證：手機瀏覽器可將頁面加入主畫面，出現獨立 App 圖示
- [ ] 5.2 實作訂閱/取消訂閱 UI，呼叫 Worker 的 `/api/subscribe`、`/api/unsubscribe`；驗證：瀏覽器 devtools 檢查訂閱後 D1 出現記錄、取消訂閱後記錄消失
- [ ] 5.3 實作當天菜色檢視頁，依推播 url 帶入的 schoolId/日期顯示菜色與圖片，落實 No direct client access to source domain：圖片一律只呼叫 `/api/photo/`；驗證：檢查頁面 DOM 中所有 `img` 的 `src` 均以 `/api/photo/` 開頭

## 6. 隱私與合規頁面

- [ ] 6.1 建立隱私權政策頁面，列出蒐集項目、用途、保留期限、取消訂閱之聯絡方式；驗證：人工檢視頁面內容涵蓋上述四項
- [ ] 6.2 撰寫徵詢來源維運單位（foodsafety@email.ncku.edu.tw）同意的信件草稿，對應 proposal Impact 所述正式公開前置條件；驗證：信件涵蓋服務性質、預期查詢頻率、聯絡方式三項內容，經人工確認後才寄出
