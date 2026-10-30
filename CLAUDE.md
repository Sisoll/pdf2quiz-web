# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

把金融證照題庫 PDF 轉成純前端的練習網頁。沒有建置步驟、沒有伺服器，`index.html` 直接雙擊（`file://`）或用 GitHub Pages（push 到 `main` 就會更新）開啟都要能用。程式註解、介面文字、commit 訊息都用繁體中文。

## 指令

```
npm install                                        # 只有測試用的 puppeteer-core
npm test                                           # 全部端對端測試
node --test --test-name-pattern="合併" tests/app.test.js   # 只跑名稱符合的測試
node tools/convert-questions.js                    # 由 questions.json 重新產生 banks/（沿用 banks/index.js 裡的題庫 id）
node tools/verify-banks.js                         # 逐題比對 banks/ 和 questions.json
```

測試會用真的 Chrome / Edge（headless）開 `index.html`；找不到瀏覽器時用 `CHROME_PATH` 指定。沒有 lint。

## 架構

- **沒有模組系統**：`index.html` 依序載入 `banks/index.js` → `config` → `banks` → `scoring` → `store` → `filters` → `quiz` → `browse` → `exam` → `main`，全部是共用全域作用域的一般 script。新函式可以直接呼叫其他檔案的函式，但要注意載入順序；全域狀態（`records`、`settings`、`session`、`queue` 等）宣告在最後載入的 `main.js`。
- **題庫**（`js/banks.js`）：`banks/index.js`（`window.QUIZ_CATALOG`）列出內建題庫與組合，`init()` 再用 script 標籤載入各題庫檔（`window.QUIZ_BANKS[id]`；雙擊開啟時不能用 fetch）。這些檔案由 `tools/convert-questions.js` 產生，不要手動修改；**`banks/index.js` 不能刪**，題庫 id 靠它固定。
  - 題庫 id：`{類別 key}-{西元年}-{4 碼隨機}`，例如 `ETH-2024-NX89`。題目 id：`{題庫 id}-{4 位數流水號 seq}`，例如 `ETH-2024-NX89-0001`；`num` 是 PDF 上的題號，只用來顯示。作答紀錄以題目 id 對應題目，題目 id 一旦產生就不能改。
  - 題目物件另有 `bankId`、`category`（科目名稱）、`categoryKey`（類別 key）。科目篩選存的是類別 key；一個 key 只對應一個名稱。
  - `allQuestions` 是目前選用的題庫或組合（`settings.source`）的題目，換題庫時由 `applySource()` 重建。
  - 舊版題目 id（`ETH-0001`）由 `convertLegacyId()` 轉換，讀入任何紀錄時自動處理。
- **檔案格式**：題庫檔與作答紀錄都用欄位式 `{ columns, rows }`（`tableRows()` / `toTable()`），讀取時依欄位名稱對應。最上層有 `format` 與 `version`。
- **作答紀錄的兩種格式**（`js/store.js`）：
  - 程式內部：每題是物件 `{ history: [{ t, pick, ok, level, src? }], review, noReview, markAt, base?, ...算出來的欄位 }`。`score`、`correct`、`wrong`、`streak`、`level`、`last`、`lastAt` 都由 `recompute()`（`js/scoring.js`）依歷程重算，改過 `history` 就要呼叫它。
  - 存檔（版本 4，`format: "pdf2quiz-records"`）：`packRecords()` 依題庫分組成表格（每題一列、只寫流水號），每筆作答壓成 `[秒數的 36 進位, 選項, 1/0, 'E'|'M'|'H', 'x'?]`，不存算得出來的欄位；對不到題庫的 id 放在 `other` 原樣保留。讀檔一律走 `migrateRecords()` / `normalizeRecords()`，它們也負責轉換版本 1～3 與舊 id。第一次轉換前的原始紀錄會另存在 IndexedDB 的 `records-backup-before-v4`。
- **儲存位置**：瀏覽器端存 IndexedDB（資料庫 `pdf2quiz`、store `kv`，key `records`；連結的紀錄檔 handle 也存在同一個 store）。localStorage 的 `pdf2quiz-records-v1` 只是舊版的位置，載入時搬移後刪除；設定仍存 localStorage 的 `pdf2quiz-settings-v1`。`saveRecords()` 會寫 IndexedDB，並在有連結紀錄檔時（File System Access API，只有 Chrome / Edge）延遲 300 ms 寫檔。
- **合併**：`mergeRecordSets()` 用「秒數 + 選項 + 對錯」辨識同一筆作答，所以重複匯入不會增加筆數。開啟紀錄檔、合併匯入都走這裡。
- **難度**：未作答的題目 `level` 是 `null`（未分級），答完預設 MEDIUM，題目的難度 = 最近一次作答的難度。不要讓未作答的題目落入任何難度的條件或統計。
- **計分與出題參數**都在 `js/config.js`（`SCORING`、`RANDOM_WEIGHT`、`CONDITIONS`、`HISTORY_LIMIT`）。README 的「計分規則」一節要和這裡一致。
- **題庫管理頁**（`manage.html` + `js/manage.js`，載入 `banks`、`scoring`、`store`，不載入測驗頁的 `filters`／`quiz`／`browse`／`exam`／`main`，所以兩頁共用的常數與工具要放在 `config.js`）：使用者匯入的題庫存在 IndexedDB 的 `userBanks`（題庫 id → 題庫檔內容），自建組合在 `userCombos`，備份提醒的狀態在 `manageMeta`。`importData()` 依內容判斷題庫檔、完整備份（`format: "pdf2quiz-backup"`）、作答紀錄檔或舊版 `questions.json`。和內建題庫 id 相同的一律另存成新 id；一個類別 key 只對應一個名稱。
- **從 PDF 建立題庫**（`js/pdftext.js`、`js/templates.js`、`templates/index.js`、`js/manage-pdf.js`）：`extractPdfLines()` 用 `vendor/pdfjs/` 的 pdf.js 3.x UMD 版取出文字行（依需要才用 script 載入；新版 pdf.js 只有 ES module，雙擊開啟時不能用），每行經過 `normalizeLine()`（去掉中文字之間的空白）；Python 工具 `tools/extract_text.py` 的輸出也走同一個正規化。樣板是可讀的設定（`start` 正規表達式含 `num`／`rest`／`ans` 群組、`sequential`、`options.marker`、`answer.position`、`ignore`），`rankTemplates()` 全部試一次依解析題數排序。現有兩份 PDF 用第一個內建樣板解析，和內建題庫只差空白與 ETH 第 279 題的人工修正。
- **建立樣板**（`js/manage-template.js`，推規則的純函式 `inferTemplate()`／`verifyTemplate()`／`validateTemplate()` 在 `js/templates.js`）：標記是 `{ kind: 'num'|'option'|'answer'|'ignore', line, start, end }`（行與字元位置），每題以題號標記開頭。推出的樣板一定要套回範例、結果和標記一致才能儲存。注意 `normalizeLine()` 已經去掉中文字之間的空白，推規則時不能假設題號後面有空白。自建樣板存在 IndexedDB 的 `userTemplates`（陣列），id 是 `user-` 加 4 碼；樣板檔是 `format: "pdf2quiz-template"`；完整備份的 `templates` 欄位。
- **修正題目**：使用者題庫直接改題庫檔並記進 `corrections`；內建題庫的修正存在 IndexedDB 的 `builtinCorrections`，`loadBanks()` 載入時用 `applyCorrections()` 套上（內建題庫已等於修正後的值就略過；值對不上時記進 `correctionConflicts` 提示）。修正答案不重新判定過去的作答。
- **多個分頁同時開著**：寫進 IndexedDB 之後呼叫 `notifyChanged('records' | 'banks' | 'templates')`，其他分頁透過 localStorage 的 `storage` 事件（`onDataChanged()`）收到通知：作答紀錄直接重新讀取；題庫變了，閒置的測驗頁會重新整理，進行中的練習或考試只提示；樣板變了測驗頁不理會。
- **一輪練習的狀態**（`session`）和進行中的模擬考只存在記憶體，沒有寫進紀錄；模擬考交卷時才寫入。

## 測試

`tests/helpers.js` 的 `openPage({ records, settings })` 會開全新的瀏覽器 context，把 `records` 以舊版 localStorage 的位置放進去（載入時會被搬到 IndexedDB），並提供可控時鐘 `page.advance(ms)`，用來避開 10 分鐘內重複答對不加分的規則。`history('OE', 'XM', ...)` 可以快速產生作答歷程（O/X = 對/錯，E/M/H = 難度）。測試裡預先放的紀錄沿用舊 id（`ETH-0001`），順便測到 id 轉換；在頁面裡查詢時用 `Q('ETH-0001')` 換成目前的 id。大多數測試直接用 `page.evaluate` 呼叫頁面上的全域函式。`openPage({ file: 'manage.html' })` 開題庫管理頁，`page.openSibling(file)` 在同一個瀏覽器設定檔再開一個分頁（共用 IndexedDB），用來測兩頁的連動；背景分頁的 `waitForFunction` 要加 `polling: 100`，不然不會檢查。

## 原則

- 答題紀錄一筆都不能少：任何格式或 id 的變更都要保留每題的作答歷程與標記，重算結果不變。
- 只改網頁程式，不修改、也不要求使用者修改瀏覽器的設定或政策；功能受瀏覽器限制時，停用並彈窗提示不能用。
- 規劃文件在 `plans/`。

## 不要提交的檔案

`record/` 與 `quiz-record*.json` / `quiz-record*.csv` 是個人作答紀錄，已在 `.gitignore` 排除。
