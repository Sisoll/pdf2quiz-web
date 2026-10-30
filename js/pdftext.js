/* 從 PDF 取出文字行（pdf.js 3.x UMD 版，雙擊開啟也能用）
   規則來自第 0 步的驗證：每頁的文字項目依 y 座標分行、依 x 排序；
   同一行兩個項目的間距超過字高 0.3 倍時補空白，但兩個中文字之間不補；最後去掉中文字之間的空白 */
const PDFJS_DIR = 'vendor/pdfjs/';
const CJK = /[　-鿿＀-￯]/;

/* 一行文字的正規化：pdf.js 與 Python 取出的文字都經過這一步，樣板才會一致 */
function normalizeLine(s) {
    return s.replace(/(?<=[　-鿿＀-￯])\s+(?=[　-鿿＀-￯])/g, '').trim();
}

let pdfjsReady = null;
/* 只在需要時載入 pdf.js；worker 檔也用 script 載入，讓 pdf.js 在主執行緒執行（雙擊開啟時不依賴 Worker） */
function loadPdfjs() {
    if (!pdfjsReady) {
        pdfjsReady = loadScript(PDFJS_DIR + 'pdf.min.js')
            .then(() => loadScript(PDFJS_DIR + 'pdf.worker.min.js'))
            .then(() => {
                if (!window.pdfjsLib) throw new Error('pdf.js 沒有載入');
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'pdf.worker.min.js';
                return window.pdfjsLib;
            });
        pdfjsReady.catch(() => { pdfjsReady = null; });
    }
    return pdfjsReady;
}

function pageLines(items) {
    const rows = [];
    for (const it of items) {
        if (!it.str) continue;
        const x = it.transform[4], y = it.transform[5], hgt = Math.abs(it.transform[3]) || it.height || 10;
        let row = rows.find(r => Math.abs(r.y - y) < hgt * 0.5);
        if (!row) rows.push(row = { y, items: [] });
        row.items.push({ x, w: it.width, str: it.str, hgt });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => {
        r.items.sort((a, b) => a.x - b.x);
        let out = '', end = null;
        for (const it of r.items) {
            const gap = end !== null && it.x - end > it.hgt * 0.3;
            if (gap && !out.endsWith(' ') && !it.str.startsWith(' ') && !(CJK.test(out.slice(-1)) && CJK.test(it.str[0]))) out += ' ';
            out += it.str;
            end = it.x + it.w;
        }
        return normalizeLine(out);
    }).filter(Boolean);
}

/* 回傳 { pages, lines }；取不到任何文字時多半是掃描檔 */
async function extractPdfLines(arrayBuffer) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        lines.push(...pageLines((await page.getTextContent()).items));
    }
    return { pages: doc.numPages, lines };
}
/* Python 工具（tools/extract_text.py）輸出的文字檔：一行一筆 */
function textFileLines(text) {
    return text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
}
