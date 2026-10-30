#!/usr/bin/env node
// 把現有的 questions.json 轉成內建題庫格式（banks/<題庫id>.js 與 banks/index.js）
//
// 用法：
//   node tools/convert-questions.js                     # 沿用 banks/index.js 裡既有的題庫 id；沒有才產生新的
//   node tools/convert-questions.js --id ETH=ETH-2024-7K3Q --id MKT=MKT-2024-9WXP   # 指定題庫 id
//
// 題庫 id 只產生一次：重跑時會從 banks/index.js 讀回原本的 id，不會換掉。
// 題目文字、選項、答案和 questions.json 逐字相同，不做任何正規化。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'questions.json');
const BANK_DIR = path.join(ROOT, 'banks');
const INDEX_FILE = path.join(BANK_DIR, 'index.js');
const HEADER = '// 由 tools/convert-questions.js 產生，請勿手動修改\n';

const FORMAT = 'pdf2quiz-bank';
const VERSION = 4;
const YEAR = 2024; // 113 年 = 西元 2024

// 內建題庫的設定，順序就是組合裡的科目順序（和 questions.json 中科目出現的順序相同）
const BANKS = [
    {
        key: 'ETH', name: '職業道德', source: '職業道德-113.pdf',
        // 人工修正紀錄；rows 裡放的是修正後的最終值
        corrections: [
            [279, 'answer', 1, 4, 'PDF 印的是 (1)，第 4 個選項是「以上皆是」'],
        ],
    },
    { key: 'MKT', name: '金融市場常識', source: '金融市場常識-113.pdf', corrections: [] },
];

const COMBO = { id: 'finance-2024', name: '金融證照（113 年）' };
// 模擬考預設值，來源：js/exam.js 第 15 行（各科 Math.min(50, 題數)）、
// index.html 第 121 行（時間 60 分鐘）、第 124 行（每科及格 70 分）
const EXAM_DEFAULTS = { perCategory: 50, pass: 70, minutes: 60 };

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 排除 0 O 1 I L
const BANK_ID_RE = /^([A-Z0-9]{3,6})-(\d{4})-([A-HJKMNP-Z2-9]{4})$/;

function fail(msg) {
    console.error('錯誤：' + msg);
    process.exit(1);
}

function randomCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    return s;
}

// 讀取既有 banks/index.js 裡的題庫 id，依類別 key 對應
function readExistingIds() {
    const ids = {};
    if (!fs.existsSync(INDEX_FILE)) return ids;
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(INDEX_FILE, 'utf8'), ctx, { filename: INDEX_FILE });
    const catalog = ctx.window.QUIZ_CATALOG;
    if (!catalog || !Array.isArray(catalog.banks)) fail('banks/index.js 格式不正確，找不到 QUIZ_CATALOG.banks');
    for (const b of catalog.banks) {
        const m = BANK_ID_RE.exec(b.id || '');
        if (!m) fail(`banks/index.js 裡的題庫 id 格式不正確：${b.id}`);
        ids[m[1]] = b.id;
    }
    return ids;
}

function parseArgs() {
    const ids = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--id' && argv[i + 1]) {
            const [key, id] = argv[++i].split('=');
            ids[key] = id;
        } else {
            fail(`不認得的參數：${argv[i]}`);
        }
    }
    return ids;
}

function resolveIds() {
    const fromArgs = parseArgs();
    const existing = readExistingIds();
    const result = {};
    const used = new Set();
    for (const b of BANKS) {
        let id = fromArgs[b.key] || existing[b.key];
        if (id) {
            const m = BANK_ID_RE.exec(id);
            if (!m || m[1] !== b.key || Number(m[2]) !== YEAR) fail(`題庫 id 不符合格式 ${b.key}-${YEAR}-XXXX：${id}`);
            if (fromArgs[b.key] && existing[b.key] && fromArgs[b.key] !== existing[b.key]) {
                console.warn(`注意：${b.key} 的題庫 id 由 ${existing[b.key]} 改為 ${fromArgs[b.key]}（作答紀錄會對不上！）`);
            }
        }
        result[b.key] = id || null;
        if (id) used.add(id.slice(-4));
    }
    // 沒有既有 id 的才產生新的；兩份題庫的隨機碼不能相同
    for (const b of BANKS) {
        if (result[b.key]) continue;
        let code;
        do { code = randomCode(); } while (used.has(code));
        used.add(code);
        result[b.key] = `${b.key}-${YEAR}-${code}`;
        console.log(`產生新的題庫 id：${result[b.key]}`);
    }
    return result;
}

// JSON 輸出到 .js 檔時，把 U+2028 / U+2029 轉成跳脫字元（JSON 解析結果不變）
function toJs(value, indent) {
    const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
    return JSON.stringify(value, null, indent).split(LS).join('\\u2028').split(PS).join('\\u2029');
}

function main() {
    const all = JSON.parse(fs.readFileSync(SRC, 'utf8'));
    if (!Array.isArray(all)) fail('questions.json 不是陣列');
    const ids = resolveIds();

    fs.mkdirSync(BANK_DIR, { recursive: true });
    const catalogBanks = [];

    for (const b of BANKS) {
        const bankId = ids[b.key];
        const qs = all.filter(q => q.id.startsWith(b.key + '-'));
        if (!qs.length) fail(`questions.json 裡沒有 ${b.key} 的題目`);
        const rows = qs.map((q, i) => {
            const seq = i + 1;
            if (q.id !== `${b.key}-${String(seq).padStart(4, '0')}`) fail(`${q.id} 的順序不連續（預期第 ${seq} 題）`);
            if (q.category !== b.name) fail(`${q.id} 的科目是「${q.category}」，預期「${b.name}」`);
            return [seq, q.num, q.question, q.options, q.answer];
        });
        // 確認修正紀錄的 to 等於目前的值
        const fieldIdx = { num: 1, question: 2, options: 3, answer: 4 };
        for (const [seq, field, , to] of b.corrections) {
            const row = rows[seq - 1];
            if (!row || JSON.stringify(row[fieldIdx[field]]) !== JSON.stringify(to)) {
                fail(`${b.key} 第 ${seq} 題的 ${field} 目前不是修正後的值 ${JSON.stringify(to)}`);
            }
        }
        const data = {
            format: FORMAT,
            version: VERSION,
            bank: { id: bankId, key: b.key, name: b.name, year: YEAR, source: b.source, template: null },
            questions: { columns: ['seq', 'num', 'question', 'options', 'answer'], rows },
            corrections: { columns: ['seq', 'field', 'from', 'to', 'note'], rows: b.corrections },
        };
        const file = `banks/${bankId}.js`;
        const js = HEADER +
            'window.QUIZ_BANKS = window.QUIZ_BANKS || {};\n' +
            `window.QUIZ_BANKS[${JSON.stringify(bankId)}] = ${toJs(data)};\n`;
        fs.writeFileSync(path.join(ROOT, file), js, 'utf8');
        catalogBanks.push({ id: bankId, file });
        console.log(`已寫入 ${file}（${rows.length} 題）`);
    }

    const catalog = {
        banks: catalogBanks,
        combos: [{ id: COMBO.id, name: COMBO.name, banks: catalogBanks.map(b => b.id), exam: EXAM_DEFAULTS }],
        defaultCombo: COMBO.id,
    };
    fs.writeFileSync(INDEX_FILE, HEADER + `window.QUIZ_CATALOG = ${toJs(catalog, 2)};\n`, 'utf8');
    console.log('已寫入 banks/index.js');

    // 提醒 banks/ 裡不在清單上的舊檔案
    const known = new Set(['index.js', ...catalogBanks.map(b => path.basename(b.file))]);
    for (const f of fs.readdirSync(BANK_DIR)) {
        if (!known.has(f)) console.warn(`注意：banks/${f} 不在清單上`);
    }
}

main();
