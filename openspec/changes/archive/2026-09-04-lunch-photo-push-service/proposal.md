## Why

家長現在得自己記得去教育部「校園食材登錄平臺」查詢，才知道當天菜色照片有沒有上傳。把個人使用的 n8n 午餐照片自動化擴充成公開服務，讓任何學校的家長訂閱後，菜色照片一發布就主動收到推播通知，不必手動查詢。

## What Changes

- 新增 PWA 前端（GitHub Pages 靜態站台）：選擇學校、安裝到手機桌面、訂閱/取消訂閱推播
- 新增 Cloudflare Worker 排程任務：每日定時查詢所有已訂閱學校的午餐 API，判斷菜色照片是否已發布
- 新增 Cloudflare D1 資料庫：儲存訂閱記錄（schoolId、push subscription、建立時間、每日通知狀態），最小化蒐集欄位（不存姓名、不存兒童資訊）
- 新增去重機制：同一學校同一天只推播一次，避免重複通知
- 新增照片代理：Worker 自行下載來源 API 的菜色照片並轉發，不讓使用者瀏覽器直接存取受 Cloudflare bot 防護保護的來源網域
- 新增 Firebase FCM 整合：僅使用免費的推播發送功能，不啟用 Cloud Functions/Blaze 付費方案
- 新增隱私權政策頁面與取消訂閱流程

## Non-Goals

(將於 design.md 中列出範圍排除與未採用方案)

## Capabilities

### New Capabilities

- `school-subscription`: 使用者選校、訂閱/取消訂閱推播的完整流程，以及訂閱資料的儲存、最小化蒐集與清除規則
- `menu-check-and-notify`: 排程查詢來源 API、判斷菜色照片是否已發布、每日去重、觸發 FCM 推播
- `photo-proxy`: 由 Worker 代理下載/轉發菜色照片，避免依賴使用者瀏覽器或第三方直接存取來源網域

### Modified Capabilities

(無，全新專案)

## Impact

- 依賴外部政府 API（fatraceschool.k12ea.gov.tw 的即時查詢端點），該端點未正式公告為開放 API；正式公開發布前需徵詢維運單位（成大代維信箱 foodsafety@email.ncku.edu.tw）同意查詢頻率與方式，被拒絕時退回僅供自己使用
- 新增三項外部服務依賴：Cloudflare Workers（排程/邏輯）、Cloudflare D1（訂閱資料）、Firebase FCM（推播發送）
- 新增 GitHub Pages 作為前端託管
