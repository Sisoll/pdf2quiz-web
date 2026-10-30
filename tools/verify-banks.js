#!/usr/bin/env node
// 驗證 banks/ 裡的內建題庫和 questions.json 完全一致
//
// 用法：node tools/verify-banks.js
// 全部通過時 exit 0 並印出摘要；有問題時 exit 1 並列出所有問題。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BANK_ID_RE = /^([A-Z0-9]{3,6})-(\d{4})-([A-HJKMNP-Z2-9]{4})$/;
const QUESTION_COLUMNS = ['seq', 'num', 'question', 'options', 'answer'];
const CORRECTION_COLUMNS = ['seq', 'field', 'from', 'to', 'note'];
const EXPECTED_COUNTS = { ETH: 616, MKT: 504 };
const EXPECTED_TOTAL = 1120;

const problems = [];
const problem = msg => problems.push(msg);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function finish(summary) {
    if (problems.length) {
        console.error(`驗證失敗，共 ${problems.length} 個問題：`);
        for (const p of problems.slice(0, 200)) console.error('  - ' + p);
        if (problems.length > 200) console.error(`  …另外 ${problems.length - 200} 個問題省略`);
        process.exit(1);
    }
    console.log(summary.join('\n'));
    console.log('全部通過');
    process.exit(0);
}

// 用 vm 執行 banks/*.js，模擬瀏覽器的 window
const ctx = { window: {} };
vm.createContext(ctx);
function load(rel) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) { problem(`找不到檔案 ${rel}`); return false; }
    try {
        vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
        return true;
    } catch (e) {
        problem(`${rel} 執行失敗：${e.message}`);
        return false;
    }
}

const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'questions.json'), 'utf8'));
const oldById = new Map(old.map(q => [q.id, q]));
if (oldById.size !== old.length) problem('questions.json 裡有重複的 id');

if (!load('banks/index.js')) finish([]);
const catalog = ctx.window.QUIZ_CATALOG;
if (!catalog || !Array.isArray(catalog.banks)) { problem('banks/index.js 沒有 QUIZ_CATALOG.banks'); finish([]); }

const summary = [];
const bankIds = catalog.banks.map(b => b.id);
if (new Set(bankIds).size !== bankIds.length) problem(`題庫 id 重複：${bankIds.join(', ')}`);
const codes = bankIds.map(id => id.slice(-4));
if (new Set(codes).size !== codes.length) problem(`題庫隨機碼重複：${codes.join(', ')}`);

const matchedOld = new Set();
const bankKeys = {};
let total = 0;

for (const entry of catalog.banks) {
    const m = BANK_ID_RE.exec(entry.id || '');
    if (!m) { problem(`題庫 id 格式不正確：${entry.id}`); continue; }
    if (entry.file !== `banks/${entry.id}.js`) problem(`${entry.id} 的檔案路徑應為 banks/${entry.id}.js，實際是 ${entry.file}`);
    if (!load(entry.file)) continue;
    const data = (ctx.window.QUIZ_BANKS || {})[entry.id];
    if (!data) { problem(`${entry.file} 沒有設定 QUIZ_BANKS['${entry.id}']`); continue; }

    // 檔案格式欄位
    if (data.format !== 'pdf2quiz-bank') problem(`${entry.id} format 應為 pdf2quiz-bank，實際是 ${data.format}`);
    if (data.version !== 4) problem(`${entry.id} version 應為 4，實際是 ${data.version}`);
    const bank = data.bank || {};
    if (bank.id !== entry.id) problem(`${entry.id} bank.id 不一致：${bank.id}`);
    if (bank.key !== m[1]) problem(`${entry.id} bank.key 應為 ${m[1]}，實際是 ${bank.key}`);
    if (bank.year !== Number(m[2])) problem(`${entry.id} bank.year 應為 ${m[2]}，實際是 ${bank.year}`);
    if (typeof bank.name !== 'string' || !bank.name) problem(`${entry.id} 缺少 bank.name`);
    if (!data.questions || !same(data.questions.columns, QUESTION_COLUMNS)) problem(`${entry.id} questions.columns 不正確`);
    if (!data.corrections || !same(data.corrections.columns, CORRECTION_COLUMNS)) problem(`${entry.id} corrections.columns 不正確`);
    if (bankKeys[bank.key]) problem(`類別 key ${bank.key} 出現在多份題庫`);
    bankKeys[bank.key] = entry.id;

    const rows = (data.questions && data.questions.rows) || [];
    const col = Object.fromEntries(QUESTION_COLUMNS.map((c, i) => [c, i]));
    rows.forEach((r, i) => {
        const seq = r[col.seq];
        const label = `${entry.id} 第 ${i + 1} 列`;
        if (seq !== i + 1) problem(`${label}：seq 應為 ${i + 1}，實際是 ${seq}`);
        if (r[col.num] !== seq) problem(`${label}：num ${r[col.num]} 不等於 seq ${seq}`);
        const newId = `${entry.id}-${String(seq).padStart(4, '0')}`;
        const oldId = `${bank.key}-${String(seq).padStart(4, '0')}`;
        const q = oldById.get(oldId);
        if (!q) { problem(`${newId} 在 questions.json 找不到對應的 ${oldId}`); return; }
        if (matchedOld.has(oldId)) problem(`${oldId} 被對應到兩次`);
        matchedOld.add(oldId);
        if (r[col.question] !== q.question) problem(`${newId} 題目文字和 ${oldId} 不同`);
        if (!Array.isArray(r[col.options]) || r[col.options].length !== 4) problem(`${newId} 選項不是 4 個`);
        if (!same(r[col.options], q.options)) problem(`${newId} 選項和 ${oldId} 不同`);
        if (r[col.answer] !== q.answer) problem(`${newId} 答案 ${r[col.answer]} 和 ${oldId} 的 ${q.answer} 不同`);
        if (r[col.num] !== q.num) problem(`${newId} 題號 ${r[col.num]} 和 ${oldId} 的 ${q.num} 不同`);
        if (q.category !== bank.name) problem(`${oldId} 的科目「${q.category}」不等於題庫名稱「${bank.name}」`);
        if (r.length !== QUESTION_COLUMNS.length) problem(`${newId} 欄位數 ${r.length} 不等於 ${QUESTION_COLUMNS.length}`);
    });

    // 修正紀錄：to 必須等於目前的值
    const corr = (data.corrections && data.corrections.rows) || [];
    for (const c of corr) {
        const [seq, field, from, to] = c;
        const r = rows[seq - 1];
        if (!r || !(field in col) || field === 'seq') { problem(`${entry.id} 修正紀錄指到不存在的題目或欄位：${JSON.stringify(c)}`); continue; }
        if (!same(r[col[field]], to)) problem(`${entry.id} 第 ${seq} 題 ${field} 目前是 ${JSON.stringify(r[col[field]])}，修正紀錄的 to 是 ${JSON.stringify(to)}`);
        if (same(from, to)) problem(`${entry.id} 第 ${seq} 題的修正紀錄 from 和 to 相同`);
    }

    const expected = EXPECTED_COUNTS[bank.key];
    if (expected !== undefined && rows.length !== expected) problem(`${entry.id} 題數 ${rows.length}，預期 ${expected}`);
    total += rows.length;
    summary.push(`${entry.id}  ${bank.name}  ${rows.length} 題  修正 ${corr.length} 筆  (${entry.file}, ${fs.statSync(path.join(ROOT, entry.file)).size} bytes)`);
}

// 沒有多也沒有少
for (const q of old) if (!matchedOld.has(q.id)) problem(`questions.json 的 ${q.id} 沒有對應到任何內建題庫的題目`);
if (total !== EXPECTED_TOTAL) problem(`合計 ${total} 題，預期 ${EXPECTED_TOTAL}`);
if (old.length !== EXPECTED_TOTAL) problem(`questions.json 有 ${old.length} 題，預期 ${EXPECTED_TOTAL}`);

// 組合
const combos = Array.isArray(catalog.combos) ? catalog.combos : [];
if (!combos.some(c => c.id === catalog.defaultCombo)) problem(`defaultCombo ${catalog.defaultCombo} 不在 combos 裡`);
for (const c of combos) {
    for (const id of c.banks || []) if (!bankIds.includes(id)) problem(`組合 ${c.id} 包含不存在的題庫 ${id}`);
}
// 組合裡的科目順序要和 questions.json 裡科目出現的順序相同
const def = combos.find(c => c.id === catalog.defaultCombo);
if (def) {
    const oldKeys = [...new Set(old.map(q => q.id.split('-')[0]))];
    const comboKeys = def.banks.map(id => id.split('-')[0]);
    if (!same(oldKeys, comboKeys)) problem(`組合 ${def.id} 的題庫順序 ${comboKeys.join(',')} 和 questions.json 的 ${oldKeys.join(',')} 不同`);
    summary.push(`組合 ${def.id}「${def.name}」：${def.banks.join(' + ')}，模擬考預設 ${JSON.stringify(def.exam)}`);
}

summary.push(`合計 ${total} 題，questions.json 的 ${old.length} 題全部逐題對應（題目、選項、答案、題號、科目完全相同）`);
finish(summary);
