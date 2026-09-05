## 1. 學校名錄資料（school-directory-search 能力）

- [x] 1.1 依 D1 Schema 決策，建立 `school_directory` 與 `verified_school_ids` 兩張表（D1 migration）；驗證：`wrangler d1 migrations apply --local` 成功建表，欄位與 design.md 一致
- [x] 1.2 依 資料來源與匯入方式 決策，寫一次性匯入 script 從教育部國小名錄下載並寫入 `school_directory`（本次僅匯入國小，國中/高中留待後續擴充），落實 Import the official school directory：以 `school_code` 為鍵、可重複執行不產生重複列；驗證：跑兩次匯入，國小 `school_directory` 總筆數維持 2608

## 2. 站內搜尋

- [x] 2.1 依 搜尋方式：縣市 + 名稱關鍵字（兩層，非三層） 決策，實作 `GET /api/schools/search?county=&q=`，落實 Search the directory by county and name：對 `school_name` 做 `LIKE` 模糊比對；驗證：搜尋「清溝」＋縣市「宜蘭縣」能找到「縣立清溝國小」；搜尋部分關鍵字（非全名）也能命中

## 3. 代碼驗證與快取

- [x] 3.1 實作 `POST /api/schools/resolve` 的快取查詢，落實 Verify a candidate school code before accepting it 的快取重用情境：`verified_school_ids` 已有記錄時直接回傳，不觸發對外部平台的查詢；驗證：mock 已快取的 `school_code`，確認外部查詢呼叫次數為 0
- [x] 3.2 依 選定學校後的即時驗證邏輯 決策，實作最近 7 天重試驗證：依序查詢 `/offered/meal?SchoolId=<code>` 直到某天有真實資料或 7 天皆查完；驗證通過寫入 `verified_school_ids`，驗證不通過回傳「無法確認」且不寫入快取；驗證：對已知會命中的學校（雙北任一校）驗證通過並正確寫入快取；對已知不會命中的學校（宜蘭清溝國小，教育部代碼 `024701` ≠ 真實 SchoolId `64736349`）驗證回傳無法確認，且 `verified_school_ids` 未寫入錯誤資料

## 4. 前端選校流程

- [ ] 4.1 依 前端選校流程改版 決策，實作縣市下拉 + 學校名稱關鍵字搜尋 UI，呼叫 `/api/schools/search` 顯示候選清單；驗證：輸入關鍵字後畫面顯示對應候選學校清單
- [ ] 4.2 實作選定候選學校後呼叫 `/api/schools/resolve`：驗證通過才顯示訂閱按鈕並帶入確認後的 `SchoolId`；驗證失敗或搜尋不到時，落實 Manual entry remains available as a fallback，顯示連到官方查詢頁的備援文字與手動輸入代碼欄位；驗證：模擬驗證回傳「無法確認」，畫面正確顯示手動輸入備援而非卡住或報錯
