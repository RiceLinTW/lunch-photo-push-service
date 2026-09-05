## Context

詳細調查記錄見 `docs/platform-api-flow.md`。重點結論：

- `fatraceschool` 平台的即時學校清單端點需要未公開發放的 `X-School-List-Key`，我們不會取得或重放
- 地方政府開放資料查證過桃園（機關代碼，不相干）、宜蘭（伺服器連不上）、臺南（跟教育部代碼相同），都無法提供「平台內部 SchoolId」
- 教育部統計處的官方學校名錄（國小/國中/高中，data.gov.tw 6087/6088/6089）**完整、免授權、涵蓋全國**，但裡面的代碼是標準 SchoolCode，不是平台的 SchoolId
- 實測 SchoolCode 直接當 SchoolId 查詢：雙北約 98% 命中、宜蘭/桃園/臺南/高雄/屏東 0% 命中、臺中混合

在這個限制下，唯一能做到「全國完整覆蓋」的搜尋資料來源就是教育部名錄；「這個代碼能不能用」則必須逐校即時驗證，不能假設。

## Goals / Non-Goals

**Goals:**
- 使用者可以用縣市 + 學校名稱關鍵字，在我們自己的服務內搜尋到學校，不用連到對方網站
- 搜尋結果選定後，自動嘗試驗證是否可直接使用；驗證通過才進入訂閱流程
- 驗證結果快取，同一學校不用重複驗證

**Non-Goals:**
- 不嘗試取得或重放 `X-School-List-Key`，不批次列舉 `fatraceschool` 的學校清單端點
- 不做學前教育（幼兒園）的搜尋——教育部沒有對應的公開名錄資料集可用，這塊仍只能手動輸入代碼
- 不做即時同步教育部資料——名錄一年才變動一次，用手動/低頻率的重新匯入即可，不需要排程自動化
- 不做地址解析出「區域」欄位做三層下拉——教育部資料沒有乾淨的區域欄位，兩層（縣市＋名稱關鍵字）搜尋已足夠

## Decisions

### 資料來源與匯入方式

一次性匯入教育部統計處三份名錄（國小 dataset 6087、國中 6088、高中 6089，例如 `https://stats.moe.gov.tw/files/school/114/e1_new.json` 等）到自己的 D1，寫成可重複執行的匯入 script（用 `INSERT OR REPLACE`，以 SchoolCode 為鍵），之後每學年跑一次即可。三個教育階段一起匯入，因為資料格式一致、來源相同，分階段處理只會增加複雜度、沒有實質好處。

**Alternatives considered**：即時呼叫教育部 API 現查現搜——放棄，因為那些是靜態檔案下載（無搜尋端點），每次搜尋都下載整份 JSON 不合理；自建 D1 快取一次匯入更符合「不做不必要的重複外部請求」原則。

### D1 Schema

```sql
CREATE TABLE school_directory (
  school_code TEXT PRIMARY KEY,
  school_name TEXT NOT NULL,
  county TEXT NOT NULL,
  school_stage TEXT NOT NULL,      -- '國小' | '國中' | '高中'
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_school_directory_county ON school_directory(county);
CREATE INDEX idx_school_directory_name ON school_directory(school_name);

CREATE TABLE verified_school_ids (
  school_code TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
```

`school_directory` 是教育部名錄的本地副本；`verified_school_ids` 是「這個教育部代碼在 fatraceschool 平台上確認可用」的快取，一旦驗證成功就永久記住，不重複驗證。

### 搜尋方式：縣市 + 名稱關鍵字（兩層，非三層）

前端提供縣市下拉（從 `school_directory` 的 distinct county 取得）+ 學校名稱關鍵字輸入框，後端用 `LIKE '%關鍵字%'` 模糊比對 `school_name`（不要求完全比對，因為家長可能打簡稱）。不做「區域」第三層，因為教育部資料沒有乾淨的區域欄位，要從地址字串解析出來，增加的複雜度換不到多少使用者價值。

### 選定學校後的即時驗證邏輯

使用者選定一筆搜尋結果後：
1. 先查 `verified_school_ids`，有就直接回傳已知可用的 `school_id`（等於 `school_code`）
2. 沒有的話，用該 `school_code` 當候選 `SchoolId`，依序嘗試最近 7 天（含今天）的 `/offered/meal?SchoolId=<code>&period=<date>`，只要任何一天回傳非空 `data`，就視為驗證通過，寫入 `verified_school_ids`
3. 7 天內都是空資料，視為「無法確認」（可能是代碼真的不對，也可能該校最近剛好沒上傳）——不當作失敗直接拒絕，而是明確告訴使用者「無法自動確認，請至官方頁面查詢正確代碼並手動輸入」

嘗試 7 天而不是 1 天，是為了降低「代碼其實是對的，只是那天沒發布」被誤判為驗證失敗的機率——這跟 `menu-check-and-notify` 本來就會遇到的「查到空資料不代表 ID 錯」是同一個問題，用同樣的保守判斷方式處理。

### 前端選校流程改版

原本「連到官方查詢頁 + 手動輸入代碼」的單一路徑，改成：
1. 縣市下拉 + 學校名稱關鍵字搜尋（主要路徑）→ 顯示候選清單 → 點選一筆 → 觸發驗證
2. 驗證成功 → 直接進入訂閱流程（跟現有 `/api/subscribe` 串接不變）
3. 驗證失敗或搜尋不到 → 顯示原本的備援文字（連到官方查詢頁 + 手動輸入代碼欄位），不整個拿掉，只降級成備援

## Implementation Contract

### school-directory-search

- `POST /api/schools/import`（或等效的一次性匯入腳本，不一定要是 Worker HTTP 端點，也可以是本機執行的 script 直接寫 D1）：把教育部三份名錄匯入 `school_directory`，以 `school_code` 為鍵，重複執行時用 `INSERT OR REPLACE` 更新而非產生重複列
- `GET /api/schools/search?county=&q=`：依 county（可選）與 q（學校名稱關鍵字，`LIKE`）查詢 `school_directory`，回傳候選清單（`school_code`、`school_name`、`county`）
- `POST /api/schools/resolve`：body `{school_code}`；先查 `verified_school_ids` 快取，沒有則嘗試最近 7 天的 `/offered/meal?SchoolId=<school_code>` 驗證；驗證通過寫入快取並回傳 `{ok:true, school_id}`；7 天內都查不到資料則回傳 `{ok:false}`（不是錯誤，是「無法確認」）
- 驗收：
  - 匯入後 `school_directory` 筆數與教育部原始資料筆數一致（三個教育階段加總）
  - 搜尋「清溝」在宜蘭縣範圍內能找到「縣立清溝國小」
  - 對已知會命中的學校（如新北市/臺北市任一校）呼叫 resolve，回傳 `{ok:true}` 且 `school_id` 正確寫入 `verified_school_ids`
  - 對已知不會命中的學校（如宜蘭清溝國小，教育部代碼 `024701` ≠ 真實 SchoolId `64736349`）呼叫 resolve，回傳 `{ok:false}`，且不會誤寫入錯誤的 `school_id`
- 範圍內：資料匯入、站內搜尋、驗證與快取。範圍外：對 `fatraceschool` 平台的任何批次列舉或金鑰重放（明確排除，見 proposal Non-Goals 與 `docs/platform-api-flow.md`）

## Risks / Trade-offs

- [驗證查詢會對 fatraceschool 平台增加請求量] → 頻率跟現有的每日輪詢邏輯同數量級（一次選校最多 7 次查詢，且結果永久快取，不重複打同一校），不是批次查詢
- [教育部資料每年變動，代碼可能新增/廢止] → 每學年手動重新執行一次匯入 script 即可，用 `INSERT OR REPLACE` 保證可重複執行不出錯
- [學校名稱打法不一致（簡稱、有無「市立/縣立」等前綴）可能搜尋不到] → 用模糊 `LIKE` 而非完全比對；找不到時保留手動輸入代碼的備援路徑
- [7 天驗證視窗仍可能誤判從未上傳菜單照片的學校] → 這是可接受的殘餘風險，比起 1 天判斷已經大幅降低機率，且失敗時的訊息是「無法確認」而非「查無此校」，不會誤導使用者代碼一定是錯的

## Migration Plan

1. 建立 `school_directory`、`verified_school_ids` 兩張表（D1 migration）
2. 寫一次性匯入 script，從教育部三個資料集網址下載並寫入 `school_directory`
3. 新增 `/api/schools/search`、`/api/schools/resolve` 兩個 Worker 端點
4. 前端改版選校流程（搜尋為主、手動輸入為備援）
5. 手動測試涵蓋至少一個「會命中」（雙北）與一個「不會命中」（宜蘭/桃園/臺南/高雄/屏東任一）的縣市，確認兩種結果都正確處理

## Open Questions

- 教育部代碼每學年變動時，要不要對「消失的學校」做警示，還是讓匯入直接覆蓋、不特別處理
- 學前教育（公立幼兒園）目前沒有對應的教育部公開名錄，這塊要不要之後另外想辦法，或長期維持手動輸入
