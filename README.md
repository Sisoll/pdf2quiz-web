# pdf2quiz-web

把金融證照題庫 PDF 轉成可以在瀏覽器練習的網頁測驗。不需要伺服器或資料庫，直接雙擊 `index.html` 就能使用。

## 使用方式

1. 用 Chrome 或 Edge 開啟 `index.html`。
2. 在上方設定科目、分數區間、條件、順序與題數，按「開始」出題。
3. 答完選 EASY / MEDIUM / HARD 會直接進下一題；也可以標記「加強複習」或「暫停複習」。
4. 「題目總覽」分頁可以依條件列出題目、排序、分頁，並一鍵顯示 / 隱藏答案。

作答紀錄預設存在瀏覽器裡。在 Chrome / Edge 可以連結一個 JSON 紀錄檔，每次作答會自動寫回；也可以匯出 JSON 帶到別台電腦匯入，或匯出 CSV 用 Excel 分析。

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
| `js/main.js` | 啟動、分頁切換、快捷鍵 |
| `parse_pdf.py` | PDF 轉題庫 |
