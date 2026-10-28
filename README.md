# pdf2quiz-web

把金融證照題庫 PDF 轉成可以在瀏覽器練習的網頁測驗。不需要伺服器或資料庫，直接雙擊 `index.html` 就能使用。

線上版（GitHub Pages）：https://sisoll.github.io/pdf2quiz-web/

## 使用方式

1. 用 Chrome 或 Edge 開啟 `index.html`（或上面的線上版）。
2. **練習**：設定科目、分數區間、條件、順序與題數，按「開始」出題。答完選 EASY / MEDIUM / HARD 會直接進下一題；點錯可以按「復原」。也可以標記「加強複習」或「暫停複習」。
3. **題目總覽**：依條件列出題目，可排序、分頁、一鍵顯示 / 隱藏答案。
4. **模擬考**：各科隨機抽題（預設各 50 題）、限時，作答中不顯示答案，交卷後看各科分數與檢討。

## 作答紀錄與同步

- 紀錄預設存在瀏覽器裡（每台電腦、每個瀏覽器各一份）。
- 在電腦版 Chrome / Edge 可以連結一個 JSON 紀錄檔，每次作答自動寫回。開啟既有紀錄檔時會和瀏覽器裡的紀錄**合併**，不會蓋掉任何一邊。
- 兩台電腦（或電腦與手機）各自練習時：在一台「匯出 JSON」，到另一台按「**合併匯入**」。作答歷程以「時間 + 選項」辨識，重複匯入同一份檔案不會變成重複資料。
- 「取代匯入」會用檔案蓋掉目前的紀錄，只在想完全換成另一份紀錄時使用。
- 匯出 CSV 可以用 Excel 分析。

## 重新產生題庫

題庫來源放在 `source/`，執行以下指令會產生 `questions.json` 與 `questions.js`：

```
uv run --with pdfplumber python parse_pdf.py
```

或先安裝 Python 與 pdfplumber：

```
python -m pip install pdfplumber
python parse_pdf.py
```

## 計分規則

- 答對：分數加上「難度係數 × 連續加成」。難度係數 EASY 2.5、MEDIUM 1.5、HARD 1.0；連續加成 ×1.0、×1.5、×2.0。
- 答錯：分數砍半再減 1，連續次數歸零。
- 分數範圍 −2 到 8；分數 ≥ 5 且沒有標記「加強複習」即為「已記住」。
- 同一題 10 分鐘內重複答對不加分。

計分與隨機加權的參數都在 `js/config.js`。

## 檔案結構

| 檔案 | 內容 |
|---|---|
| `index.html` | 頁面結構 |
| `css/style.css` | 樣式 |
| `js/config.js` | 計分規則、隨機加權、出題條件 |
| `js/scoring.js` | 依作答歷程重算分數 |
| `js/store.js` | 作答紀錄、設定、紀錄檔、匯出匯入 |
| `js/filters.js` | 篩選條件與統計 |
| `js/quiz.js` | 出題、作答、一輪測驗 |
| `js/browse.js` | 題目總覽 |
| `js/exam.js` | 模擬考 |
| `js/main.js` | 啟動、分頁切換、快捷鍵 |
| `parse_pdf.py` | PDF 轉題庫 |
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
