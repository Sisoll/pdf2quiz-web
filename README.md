# pdf2quiz-web

把金融證照題庫 PDF 轉成可以在瀏覽器練習的網頁測驗。不需要伺服器或資料庫，直接雙擊 `index.html` 就能使用。

線上版（GitHub Pages）：https://sisoll.github.io/pdf2quiz-web/

## 使用方式

1. 用 Chrome 或 Edge 開啟 `index.html`（或上面的線上版）。
2. **練習**：設定科目、分數區間、條件、順序與題數，按「開始」出題。答完選 EASY / MEDIUM / HARD 會直接進下一題；點錯可以按「復原」。也可以標記「加強複習」或「暫停複習」。一輪結束（中止或做完）時會詢問要不要檢討：可以看本輪答錯、標加強複習、標 HARD 的題目，以及正確答案和當時的選擇。測驗中改了出題設定會先詢問要不要結束本輪（這樣結束不顯示本輪成績）；沒在測驗時改設定，上一輪的成績就不再顯示。
3. **題目總覽**：依條件列出題目，可排序、分頁、一鍵顯示 / 隱藏答案。
4. **模擬考**：各科隨機抽題（預設各 50 題）、限時，作答中不顯示答案，交卷後看各科分數與檢討。
5. **題庫管理**（頁首的「題庫管理」，`manage.html`）：匯入、匯出、刪除題庫，把幾份題庫建成組合，以及「完整備份」（題庫、樣板、組合、作答紀錄一起匯出）與還原。匯入的題庫只存在這個瀏覽器裡，之後還想用請記得完整備份。
6. **從 PDF 建立題庫**（題庫管理頁）：選擇 PDF 後會自動試過內建樣板、挑解析得最好的一個，可以預覽、看檢查結果（無法解析的段落、題號跳號或重複、題目重複）、手動修正或把無法解析的段落整理成題目，填上類別 key、名稱、年份就建立完成。目前只支援單選題，不支援掃描檔。PDF 取出的文字有問題時，可以改用 Python 取文字：`uv run --with pdfplumber python tools/extract_text.py 檔名.pdf > 檔名.txt`，再用「匯入 Python 取出的文字」。
7. **修正題目**（題庫管理頁，每份題庫的「修正題目」）：內建題庫的修正存在這個瀏覽器裡（完整備份會一起帶走），題庫檔本身不變；修正答案不會重新判定過去的作答。
8. **建立樣板**（從 PDF 建立題庫時，「樣板都不合？」）：在程式取出的文字上用滑鼠選取，標出至少 2 題的題號、每個選項和答案，頁首頁尾標成忽略，按「推出樣板」。程式會把推出的樣板套回你標的範例，結果一致才能儲存。自建的樣板存在這個瀏覽器裡（完整備份會一起帶走），也可以匯出成 `.template.json`、用「匯入檔案」匯入、直接修改設定。

### 樣板設定

樣板是一段 JSON，內建樣板在 `templates/index.js`：

| 欄位 | 說明 |
| --- | --- |
| `start` | 題目開頭那一行的正規表達式，要有具名群組 `num`（題號）和 `rest`（同一行其餘的文字）；答案寫在題號前時另有 `ans` |
| `sequential` | 題號要比上一題大、最多跳幾號才算新的一題（避免題目內容剛好像題號）；`0` 表示不檢查 |
| `options` | `marker`：選項標記 `paren-digit`（(1)）、`paren-alpha`（(A)）、`circled`（①）；`count`：選項數 2～5，或 `"auto"` 自動判斷 |
| `answer` | `{ "position": "start" }`（答案在 `start` 的 `ans` 群組），或 `{ "position": "pattern", "pattern": "答案[:：](?<ans>[A-E])" }`（在題目文字裡找，找到後從題目移除） |
| `ignore`、`ignorePattern` | 含這些文字的行、符合這些正規表達式的行不算題目內容（頁首、頁尾、頁碼） |

## 作答紀錄與同步

- 紀錄預設存在瀏覽器裡（每台電腦、每個瀏覽器各一份）。
- 在電腦版 Chrome / Edge 可以連結一個 JSON 紀錄檔，每次作答自動寫回。開啟既有紀錄檔時會和瀏覽器裡的紀錄**合併**，不會蓋掉任何一邊。
- 兩台電腦（或電腦與手機）各自練習時：在一台「匯出 JSON」，到另一台按「**合併匯入**」。作答歷程以「時間 + 選項」辨識，重複匯入同一份檔案不會變成重複資料。
- 「取代匯入」會用檔案蓋掉目前的紀錄，只在想完全換成另一份紀錄時使用。
- 匯出 CSV 可以用 Excel 分析。
- 舊版的紀錄檔（題目 id 像 `ETH-0001`）可以直接開啟或匯入，會自動轉成新的題目 id，作答歷程、標記與分數都不變；轉換前的原始紀錄會在瀏覽器裡另存一份。
- 紀錄只存在瀏覽器裡：清除瀏覽器資料、換電腦或換瀏覽器就看不到，需要保留時請匯出或連結紀錄檔。

## 題庫

內建兩份題庫，預設以組合「金融市場常識與職業道德測驗」一起練習，也可以在「題庫」選單只選其中一份：

| 題庫 id | 科目 | 題數 |
|---|---|---|
| `ETH-2024-NX89` | 職業道德 | 616 |
| `MKT-2024-8MYQ` | 金融市場常識 | 504 |

題庫檔在 `banks/`，由 `questions.json` 轉換產生（`banks/index.js` 固定了題庫 id，不能刪除）：

```
node tools/convert-questions.js   # 產生 banks/
node tools/verify-banks.js        # 逐題比對 banks/ 和 questions.json
```

`questions.json` 原本由 `parse_pdf.py` 從 `source/` 的 PDF 產生（`uv run --with pdfplumber python parse_pdf.py`）。注意 ETH 第 279 題的答案經過人工修正（PDF 印的是 1，正確是 4），重新解析 PDF 會蓋掉這個修正；修正紀錄在題庫檔的 `corrections`。現在改由題庫管理頁從 PDF 建立題庫；尚未完成的延伸項目見 `plans/question-bank-manager.md`。

## 計分規則

- 答對：分數加上「難度係數 × 連續加成」。難度係數 EASY 2.5、MEDIUM 1.5、HARD 1.0；連續加成 ×1.0、×1.5、×2.0。
- 答錯：分數砍半再減 1，連續次數歸零。
- 分數範圍 −2 到 8；分數 ≥ 5 且沒有標記「加強複習」即為「已記住」。
- 同一題 10 分鐘內重複答對不加分。
- 答題速度：答對時，這次加的分數再乘上速度係數。12～20 秒為平均 ×1；比 12 秒快，每快 1 秒 +5%（最多 ×1.4）；比 20 秒慢，每慢 1 秒 −1.25%（最少 ×0.7）；超過 60 秒當成平均。模擬考與舊紀錄沒有秒數，當成平均，所以既有的分數不變。

計分與隨機加權的參數都在 `js/config.js`。

## 檔案結構

| 檔案 | 內容 |
|---|---|
| `index.html` | 頁面結構 |
| `css/style.css` | 樣式 |
| `banks/` | 內建題庫與清單（由 `tools/convert-questions.js` 產生） |
| `js/config.js` | 計分規則、隨機加權、出題條件 |
| `js/banks.js` | 載入題庫、題庫與組合的選擇、舊題目 id 轉換 |
| `js/scoring.js` | 依作答歷程重算分數 |
| `js/store.js` | 作答紀錄、設定、紀錄檔、匯出匯入 |
| `js/filters.js` | 篩選條件與統計 |
| `js/quiz.js` | 出題、作答、一輪測驗 |
| `js/browse.js` | 題目總覽 |
| `js/exam.js` | 模擬考 |
| `js/main.js` | 啟動、分頁切換、快捷鍵 |
| `manage.html`、`js/manage.js` | 題庫管理頁 |
| `js/manage-pdf.js` | 從 PDF 建立題庫、修正題目 |
| `js/manage-template.js` | 標記範例建立樣板、樣板管理 |
| `js/pdftext.js` | 用 pdf.js 從 PDF 取出文字行 |
| `js/templates.js`、`templates/index.js` | 拆題引擎、從標記推出樣板，與內建樣板 |
| `vendor/pdfjs/` | pdf.js 3.11.174（Apache-2.0，見該資料夾的 LICENSE） |
| `parse_pdf.py` | PDF 轉 `questions.json`（舊流程） |
| `tools/` | 題庫轉換與驗證腳本 |
| `plans/` | 規劃文件 |
| `tests/` | 端對端測試 |

## 測試

需要 Node.js 與 Chrome（或 Edge）。測試會用真的瀏覽器開啟 `index.html` 操作。

```
npm install
npm test
```

找不到瀏覽器時，用環境變數 `CHROME_PATH` 指定路徑。

## 發布到 GitHub Pages

在 GitHub 的 repo 頁面：Settings → Pages → Build and deployment → Source 選「Deploy from a branch」，Branch 選 `main`、資料夾選 `/ (root)`，按 Save。幾分鐘後就能用 https://sisoll.github.io/pdf2quiz-web/ 開啟。之後每次 push 到 main 都會自動更新。
