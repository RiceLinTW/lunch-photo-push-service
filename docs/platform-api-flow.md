# 校園食材登錄平臺查詢流程

MealTracker 的 Worker 依賴「校園食材登錄平臺」（`fatraceschool.k12ea.gov.tw`）取得學校午餐菜單與菜色照片。這個外部平臺只有部分介面有正式文件，而且學校清單與即時供餐資料採用不同的存取條件；本文記錄本次實際調查得到的正確查詢順序、回應形狀與安全界線，供後續維護時查考。

## 流程總覽

平臺自身的即時資料介面都位於裸網域 `https://fatraceschool.k12ea.gov.tw` 下。完整的查詢鏈如下：

```text
GET /county                         public
    │ CountyId
    ▼
GET /area?CountyId={id}             public
    │ AreaId
    ▼
GET /school?CountyId={id}           GATED: X-School-List-Key
            &AreaId={id}
            &SchoolType={type}
    │ SchoolId
    ▼
GET /offered/meal?SchoolId={id}     public + browser User-Agent
            &period={yyyy-mm-dd}
            &KitchenId=all
            &MenuType=1
    │ BatchDataId
    ▼
GET /dish?BatchDataId={id}          public + browser User-Agent
    │ DishId (when PicturePath is non-empty)
    ▼
GET /dish/pic/{DishId}              public + browser User-Agent
    └─ raw image binary; inspect Content-Type
```

The list operation in the third step is gated, but a caller that already knows a `SchoolId` can enter the chain at `GET /school/{SchoolId}` or `GET /offered/meal` without listing schools first.

## Stage-by-stage live-data flow

### 1. Select a county

`GET /county` is public and requires no authentication. It returns all 22 counties and cities, including their platform IDs and codes:

```json
{"result":1,"message":"Search County Successful","data":[{"CountyId":18,"County":"基隆市","Code":"C"}, ...]}
```

The selected `CountyId` feeds the area lookup.

### 2. Select an area

`GET /area?CountyId={id}` is also public and requires no authentication. It returns the districts within the selected county:

```json
{"result":1,"message":"Search Area Successful","data":[{"CountyId":17,"County":"臺北市","Code":"A","Area":"中正區","AreaId":131355}, ...]}
```

The selected `AreaId`, together with `CountyId` and a school type, would normally feed the school-list lookup.

### 3. List schools in an area (gated)

`GET /school?CountyId={id}&AreaId={id}&SchoolType={type}` requires an `X-School-List-Key` header whose observed value was approximately 64 hexadecimal characters. Without that header, it returns:

```json
{"result":0,"message":"Unauthorized","data":[]}
```

The platform's official search page at `https://fatraceschool.k12ea.gov.tw/frontend/search.html` calls this endpoint internally to populate its school dropdown after the user chooses a county and area. The key was not hardcoded in any of the static JavaScript files checked—`jquery.utils.js`, `app.js`, `certCs2Api.js`, `console.js`, and `app/view/FSOfferingSerivceView.js`—and appears to be issued dynamically per browser session rather than being a fixed public value. A real value was observed in a live browser session, but it was deliberately not copied into this document or reused by the Worker.

### 4. Look up one known school (public)

`GET /school/{SchoolId}` is materially different from the area-wide list endpoint: it is public and requires no authentication, but only returns one school whose platform `SchoolId` is already known. A real response was:

```json
{"result":1,"message":"Get School successful","data":{"SchoolId":64737329,"SchoolName":"桃園市楊梅區楊梅國小","ConuntyId":25,"AreaId":131440,"SchoolType":2}}
```

`ConuntyId` is the spelling used by the live API; it is not corrected here. Keeping an already-known-ID lookup open while gating an area-wide listing is a reasonable security split: the former leaks little information per call, while the latter enables bulk discovery.

### 5. Fetch a school's lunch offering

`GET /offered/meal?SchoolId={id}&period={yyyy-mm-dd}&KitchenId=all&MenuType=1` is public but must be sent with a realistic browser `User-Agent`. `MenuType=1` means lunch. A successful response has this shape:

```json
{"result":1,"message":"Get Offering Meal successful","data":[{"BatchDataId":"...","KitchenId":...,"KitchenName":"...","SchoolId":...,"SchoolCode":"...","SchoolName":"...","MenuDate":"...","MenuType":1,"MenuTypeName":"午餐","UploadDateTime":"...","TypeGrains":"...","TypeOil":"...","TypeVegetable":"...","TypeMilk":"...","TypeFruit":"...","TypeMeatBeans":"...","Calorie":"..."}]}
```

An empty `data: []` means that the school has not posted a menu for that date yet. MealTracker uses this as its polling signal to check again later. The `BatchDataId` from a returned offering identifies the associated dishes.

### 6. Fetch the dishes and detect photo readiness

`GET /dish?BatchDataId={id}` is public and has the same `User-Agent` requirement. It returns:

```json
{"result":1,"message":"Get Dish successful","data":[{"DishBatchDataId":"...","BatchDataId":"...","DishName":"...","DishType":"...","DishId":"...","UpdateDateTime":"...","DishOrder":...,"KitchenId":...,"PicturePath":"/mnt/hdb/cateringservice/dish/.../..._....jpg"}]}
```

The response is an object wrapping the dish array in `data`; it is **not** a bare array. Assuming a bare array caused a real project bug, fixed in commit `216a7cb`.

A dish record can exist before its photo does. An empty `PicturePath` means that this specific dish's photo has not yet been uploaded, even though the school has posted the menu. MealTracker therefore keeps polling until at least one dish has a non-empty `PicturePath`, rather than treating the menu record alone as photo readiness.

### 7. Fetch the dish photo

`GET /dish/pic/{DishId}` is public and has the same `User-Agent` requirement. It returns the raw image binary; a real JPEG was confirmed during testing. Because the URL contains neither a filename nor an extension, callers must use the response's `Content-Type` header to determine the image format.

## Public and gated surfaces

The access split for the live-data system is intentional and should be preserved:

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /county` | Public | List all counties/cities |
| `GET /area?CountyId={id}` | Public | List areas in one county |
| `GET /school?CountyId={id}&AreaId={id}&SchoolType={type}` | Gated by `X-School-List-Key` | List schools in an area |
| `GET /school/{SchoolId}` | Public | Look up one already-known school |
| `GET /offered/meal?...` | Public, browser `User-Agent` required | Get one school's dated meal offering |
| `GET /dish?BatchDataId={id}` | Public, browser `User-Agent` required | Get dishes and photo availability |
| `GET /dish/pic/{DishId}` | Public, browser `User-Agent` required | Get image binary |

The `X-School-List-Key` is not the access code issued by the separate official OpenAPI system described below.

## Cloudflare bot protection and `User-Agent`

The entire domain is behind Cloudflare. For the live-data endpoints used by the Worker—`/offered/meal`, `/dish`, and `/dish/pic/{DishId}`—the observed behavior depended on the request's `User-Agent`:

- `curl -A ""` (explicitly no `User-Agent`) received HTTP 403 from Cloudflare bot protection.
- Plain `curl`, which sends its default `curl/x.y.z` user agent, received HTTP 200.
- Node's bare `fetch()` with no explicit headers received HTTP 500, an origin-side failure rather than Cloudflare's block page.
- Node's `fetch()` with an explicit, realistic browser `User-Agent` received HTTP 200 and real data.

The practical rule is to send a realistic browser `User-Agent` on every server-to-server request to this origin. The Worker already centralizes this behavior in `src/source-headers.ts`.

## Separate official OpenAPI system

The platform also publishes an official OpenAPI, but it is a different and narrower system from the live-data endpoints above. Its base path is:

```text
https://fatraceschool.k12ea.gov.tw/cateringservice/openapi
```

It does **not** use the bare domain root. For example, calling `https://fatraceschool.k12ea.gov.tw/accountReg/` returns the generic route-not-found response below, not an authentication result:

```json
{"result":0,"message":"Invalid operation","data":{}}
```

This base-path distinction caused one false start during the investigation. The complete specification is published at `https://fatraceschool.k12ea.gov.tw/cateringservice/web/openapi_doc/v1/openapi.json`; the human-readable documentation is at `https://fatraceschool.k12ea.gov.tw/cateringservice/web/openapi_doc/v1/index.html` and is linked as「API服務」from the platform homepage footer.

All endpoint paths in this section are relative to `/cateringservice/openapi`:

### `POST /accountReg/`

This is self-service registration with body `{"account":"<email>"}`. No approval or manual review was required: registering a real email during the investigation immediately triggered a real email containing a 24-character `openapi存取碼`. A real access code was obtained and tested, but neither it nor the registration email is recorded here because credentials and account details do not belong in git history.

### `POST /county/`

This endpoint takes `{"accesscode":"..."}`. It differs from the live system's public `GET /county`: it uses POST, has a trailing slash, and requires an OpenAPI access code. A call with the real access code worked and returned a plain array containing all 22 county-name strings, with no county IDs.

### `POST /opendatadataset/`

The body is `{"accesscode":"...","year":"...","month":"...","county":"..."}`. It lists the downloadable dataset names available for a year, month, and county; `"全國"` selects a nationwide dataset. The documentation's older example month, 2018/02, returned「查無資料」. The recent months 2025/12, 2026/01, 2026/06, and 2026/07 all had real data available when tested.

### `POST /opendatadownload/`

The body is `{"accesscode":"...","year":"...","month":"...","county":"...","grade":"...","datasetname":"..."}`. It returns a ZIP download URL. A test with `county:"全國"`, `grade:"國中小"`, `datasetname:"午餐菜色資料集"`, `year:"2026"`, and `month:"07"` returned a real ZIP at:

```text
https://fatraceschool.k12ea.gov.tw/cateringservice/web/openapi_download/202607_全國國中小午餐菜色資料集20260904235532.zip
```

The ZIP contained one CSV per county/city. The CSV files use UTF-8 with a BOM. Under macOS's default `unzip`, the ZIP entry filenames appeared Big5-garbled, but Python's `zipfile` module decoded the actual filenames and CSV contents cleanly as UTF-8.

The verified CSV columns were:

```text
市縣名稱, 區域名稱, 學校名稱, 供餐日期, 菜色名稱
```

These are human-readable text fields only: there is no `SchoolId`, no `SchoolCode`, and no other usable system identifier. Several county CSVs for that month were only 77 bytes—the header row with no data rows—so participation and reporting completeness vary by county. This dataset serves public transparency and nutrition research, not system integration or live school lookup.

Other dataset names observed, but not individually schema-checked, were `學校供餐團膳業者資料集`, `調味料及供應商資料集`, `午餐食材及供應商資料集`, `午餐菜色及食材資料集`, and `食材中文名稱資料集`. Given the system's shared design, they are presumed to follow the same human-readable, identifier-free pattern, but that remains an explicit presumption rather than a verified schema fact.

In short, the official OpenAPI provides registration, county names, dataset discovery, and monthly bulk downloads. Its access code is unrelated to `X-School-List-Key`, and its scope does not include the live county/area school listing or the live meal-to-photo query chain.

## `SchoolCode` versus `SchoolId`

The Ministry of Education Statistics Department separately publishes open national school directories on data.gov.tw: datasets 6087（國民小學名錄）, 6088（國民中學名錄）, and 6089（一般高級中等學校名錄）. One example source is `https://stats.moe.gov.tw/files/school/114/e1_new.json`, with fields `學年度, 代碼, 學校名稱, 公/私立, 縣市名稱, 地址, 電話, 網址`. The `代碼` value is the official six-digit MOE school code and matches the live platform's `SchoolCode` field, for example `"024701"`.

That official `SchoolCode` is **not reliably equal** to the platform's internal `SchoolId`, which is used by `/school/{SchoolId}` and `/offered/meal?SchoolId=` and is typically an approximately eight-digit value such as `64736349`. This relationship was tested empirically by trying the official code as `SchoolId` on real school days and checking for actual meal data. Multiple dates per school were cross-checked to reduce the chance of mistaking “not posted today” for an ID mismatch.

The limited sample produced these results:

| Region | Observed result |
| --- | --- |
| 新北市（code prefix 01）and 臺北市（code prefixes in the observed 31–42 range） | About 98% matched: 47 of 48 schools sampled across the two cities |
| 宜蘭縣、桃園市、臺南市、高雄市、屏東縣 | 0% matched: 0 of roughly 20 schools sampled across the five regions |
| 臺中市 | Mixed: about 2 of 3 sampled schools matched |

These are empirical results from a limited sample, not regional guarantees. No universal conversion formula was found. The best current hypothesis is that the behavior follows the pre-2010 county/city-merger administrative code prefix under which a school was originally assigned: some legacy systems may have adopted the official code directly as an internal ID, while others may have assigned a separate sequential/internal ID during onboarding. This explanation is unconfirmed and must remain labeled as a hypothesis.

For MealTracker, an official `SchoolCode` may be tried only as a candidate `SchoolId`. It may be accepted or shown to a user only after that candidate returns real menu data. A response with no menu cannot confirm an ID, because a wrong ID and a correct school that has not posted for the date are indistinguishable; treating either case as “no menu today” would be misleading.

## What we deliberately did not do

### Mass enumeration or harvesting

We did not brute-force the `SchoolId` space, try every ID in a range, or automate the gated school-list endpoint across many areas to reconstruct a national directory. Regardless of the underlying endpoint, that would be mass automated harvesting of a government platform without permission. This boundary was set independently of, and before, any request to the platform maintainer for permission.

### Replay the observed `X-School-List-Key`

A real `X-School-List-Key` was observed through browser developer-tools network inspection in a legitimate live session. It was not extracted for server-side use, reused, or recorded here. A credential being easy to copy from one's own network tab does not authorize a third-party server to replay it. The decision to leave `/county`, `/area`, and `/school/{id}` open while gating the area-wide school list is a deliberate access signal; bypassing that gate with a captured session-bound credential would be unauthorized access regardless of the protection's technical strength.

### Build a browser-extension workaround

We considered an extension that would let a parent use the official search page in their own legitimate browser session and then read the school ID already returned to that browser. This is more defensible than credential replay or bulk harvesting because it neither reuses credentials nor harvests in bulk. It was set aside for practical reasons: users are expected to be overwhelmingly on mobile, especially iOS Safari, where extension distribution requires a full iOS App Store app submission. That engineering and distribution cost is disproportionate to a one-time “find my own school's ID” lookup.

### Ask users to copy the search-page URL

The official search page's address does not update with the selected school: normal use of the county, area, and school dropdowns does not add a `?school=` query parameter. Asking a parent to copy the URL after searching therefore cannot recover the ID. A correct-looking `school=` value observed earlier in the investigation came from an SSO deep link with pre-filled parameters, not from interacting with the search UI itself.
