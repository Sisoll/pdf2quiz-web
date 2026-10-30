// 測試共用工具：啟動 Chrome、開啟 index.html、準備作答紀錄
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');


/* 找 Chrome / Edge；也可以用環境變數 CHROME_PATH 指定 */
function findBrowser() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].filter(Boolean);
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) throw new Error('找不到 Chrome 或 Edge，請用環境變數 CHROME_PATH 指定瀏覽器路徑');
    return found;
}

let browser;
async function getBrowser() {
    if (!browser) browser = await puppeteer.launch({ executablePath: findBrowser(), headless: 'new' });
    return browser;
}
async function closeBrowser() {
    if (browser) await browser.close();
    browser = null;
}

const pageUrl = file => pathToFileURL(path.join(__dirname, '..', file)).href;
/* 各頁面載入完成的條件 */
const READY = {
    'index.html': () => typeof records !== 'undefined' && document.querySelector('#f-chips .chip'),
    'manage.html': () => typeof records !== 'undefined' && document.querySelector('#m-banks .item-row'),
};

/* 開一個全新的分頁（全新的瀏覽器設定檔，localStorage 是空的）
   records：預先放入的作答紀錄；settings：預先放入的設定；file：要開的頁面（預設 index.html）
   每個分頁有可控時鐘：page.advance(ms) 讓時間往前走，用來避開 10 分鐘冷卻
   page.openSibling(file)：在同一個瀏覽器設定檔再開一個分頁（共用 IndexedDB 與 localStorage） */
async function openPage({ records, settings, width = 900, file = 'index.html' } = {}) {
    const b = await getBrowser();
    const context = await b.createBrowserContext();
    const page = await preparePage(context, { records, settings, width, seed: true });
    await gotoPage(page, file);
    page.closeContext = () => context.close();
    page.openSibling = async (f = 'index.html') => {
        const p = await preparePage(context, { width, seed: false });
        await gotoPage(p, f);
        return p;
    };
    return page;
}
async function preparePage(context, { records, settings, width, seed }) {
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => { page.lastDialog = d.message(); d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined); });
    await page.setViewport({ width, height: 1000 });
    await page.evaluateOnNewDocument((records, settings, seed) => {
        const RealDate = Date;
        let offset = 0;
        window.__advance = ms => { offset += ms; };
        // 測試用：舊版題目 id（ETH-0001）換成目前的 id（題庫 id + 流水號）
        window.Q = id => (typeof convertLegacyId === 'function' && convertLegacyId(id)) || id;
        window.Date = class extends RealDate {
            constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
            static now() { return RealDate.now() + offset; }
        };
        if (seed && !sessionStorage.getItem('__seeded')) {
            sessionStorage.setItem('__seeded', '1');
            localStorage.clear();
            if (records) localStorage.setItem('pdf2quiz-records-v1', JSON.stringify(records));
            if (settings) localStorage.setItem('pdf2quiz-settings-v1', JSON.stringify(settings));
        }
    }, records || null, settings || null, seed);
    page.advance = ms => page.evaluate(ms => window.__advance(ms), ms);
    return page;
}
async function gotoPage(page, file) {
    await page.goto(pageUrl(file));
    await page.waitForFunction(READY[file]);
}

/* 產生作答歷程：'OE' = 答對 EASY、'XM' = 答錯 MEDIUM、'OH' = 答對 HARD；每筆間隔 1 小時 */
function history(...codes) {
    const level = { E: 'EASY', M: 'MEDIUM', H: 'HARD' };
    return codes.map((c, i) => ({
        t: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
        pick: c[0] === 'O' ? 0 : 9,   // 只用來區分不同作答
        ok: c[0] === 'O',
        level: level[c[1]],
    }));
}

module.exports = { openPage, closeBrowser, history };
