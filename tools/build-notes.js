#!/usr/bin/env node
// 把頁面上「匯出 → 解析」的檔案併進內建解析 data/notes.js
//
// 用法：
//   node tools/build-notes.js quiz-notes-202611031730.json [更多解析檔...]
//
// 同一題以較晚改的為準；刪除的解析（空字串）會從內建解析拿掉。
// 題目 id 對不到內建題庫的（例如使用者匯入的題庫）不放進內建解析，只列出來。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'notes.js');
// 和頁面連結解析檔時寫的開頭一樣（js/notes.js 的 NOTES_JS_HEADER），兩邊寫出來的檔案只差內容
const HEADER = '// 由頁面（連結解析檔）或 tools/build-notes.js 產生，請勿手動修改\n' +
    '// 內建解析：{ 題目 id: { text, at } }；text 是空字串表示已刪除；使用者在頁面上改的存在瀏覽器裡，同一題以較晚改的為準\n';
const FORMAT = 'pdf2quiz-notes';

function fail(msg) { console.error(msg); process.exit(1); }
function loadWindowScript(file) {
    const ctx = { window: {} };
    if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    return ctx.window;
}

const inputs = process.argv.slice(2);
if (!inputs.length) fail('用法：node tools/build-notes.js <解析檔.json> [...]');

// 內建題庫的題目 id
const catalog = loadWindowScript(path.join(ROOT, 'banks', 'index.js')).QUIZ_CATALOG || { banks: [] };
const ids = new Set();
for (const b of catalog.banks) {
    const w = loadWindowScript(path.join(ROOT, b.file));
    const bank = w.QUIZ_BANKS && w.QUIZ_BANKS[b.id];
    if (!bank) fail(`讀不到題庫 ${b.file}`);
    for (const row of bank.questions.rows) ids.add(`${b.id}-${String(row[0]).padStart(4, '0')}`);
}

const current = (loadWindowScript(OUT).QUIZ_NOTES || {}).notes || {};
const notes = { ...current };
const later = (a, b) => !a ? b : !b ? a : Date.parse(b.at) > Date.parse(a.at) ? b : a;
const skipped = new Set();
let updated = 0;
for (const file of inputs) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.format !== FORMAT || typeof data.notes !== 'object') fail(`${file} 不是解析檔（format 應為 ${FORMAT}）`);
    for (const [id, n] of Object.entries(data.notes)) {
        if (!n || typeof n.text !== 'string' || isNaN(Date.parse(n.at))) fail(`${file} 的 ${id} 格式不正確`);
        if (!ids.has(id)) { skipped.add(id); continue; }
        const kept = later(notes[id], { text: n.text, at: n.at });
        if (kept !== notes[id]) { if (kept.text || (notes[id] && notes[id].text)) updated++; notes[id] = kept; }
    }
}
// 刪除的不留在內建解析裡；依題目 id 排序，diff 比較好讀
const out = {};
for (const id of Object.keys(notes).sort()) if (notes[id].text) out[id] = notes[id];

const js = HEADER +
    `window.QUIZ_NOTES = ${JSON.stringify({ format: FORMAT, version: 1, notes: out }, null, 1)};\n`;
fs.writeFileSync(OUT, js, 'utf8');
console.log(`已寫入 data/notes.js：${Object.keys(out).length} 題有解析（這次更新 ${updated} 題）`);
if (skipped.size) console.log(`對不到內建題庫、沒有放進去的題目：${[...skipped].join('、')}`);
