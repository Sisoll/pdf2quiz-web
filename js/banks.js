/* 題庫：讀取內建題庫清單（banks/index.js）與各題庫檔，組成目前選用的題目 */
const CATALOG = window.QUIZ_CATALOG || { banks: [], combos: [] };
const BANK_ID = /^[A-Z0-9]{3,6}-\d{4}-[A-Z0-9]{4}$/;
const LEGACY_ID = /^([A-Z0-9]{3,6})-(\d{4})$/;   // 舊版題目 id，例如 ETH-0001
const USER_BANKS_KEY = 'userBanks';     // IndexedDB：使用者匯入的題庫 { 題庫 id: 題庫檔內容 }
const USER_COMBOS_KEY = 'userCombos';   // IndexedDB：使用者建立的組合 [{ id, name, banks, exam }]
let banks = {};        // 題庫 id → { bank, questions, builtin }
let userBankData = {}; // 使用者匯入的題庫原始內容（匯出、備份用）
let userCombos = [];
const BUILTIN_CORRECTIONS_KEY = 'builtinCorrections';   // IndexedDB：使用者對內建題庫的修正 { 題庫 id: { columns, rows } }
const CORRECTION_COLUMNS = ['seq', 'field', 'from', 'to', 'note'];
let builtinCorrections = {};
let correctionConflicts = [];   // 內建題庫更新後，和使用者修正對不上的項目 [{ bankId, seq, field }]

/* ---------- 欄位式表格 { columns, rows } ----------
   依欄位名稱對應，不依位置：不認得的欄位忽略，缺少的欄位是 undefined */
function tableRows(t) {
    if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) return [];
    return t.rows.map(row => Object.fromEntries(t.columns.map((c, i) => [c, row[i]])));
}
function toTable(columns, list) {
    return { columns, rows: list.map(o => columns.map(c => o[c] ?? null)) };
}

/* 題目 id = 題庫 id + 4 位數流水號 */
const qid = (bankId, seq) => `${bankId}-${String(seq).padStart(4, '0')}`;
function splitQid(id) {
    const k = id.lastIndexOf('-');
    const bankId = id.slice(0, k), seq = id.slice(k + 1);
    return k > 0 && BANK_ID.test(bankId) && /^\d{4,}$/.test(seq) ? { bankId, seq: Number(seq) } : null;
}

/* 雙擊開啟（file://）時不能用 fetch 讀 JSON，題庫包成 script 載入 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`無法載入 ${src}`));
        document.head.appendChild(s);
    });
}
async function loadBanks() {
    window.QUIZ_BANKS = window.QUIZ_BANKS || {};
    for (const b of CATALOG.banks) {
        if (!window.QUIZ_BANKS[b.id]) {
            try { await loadScript(b.file); } catch (e) { console.warn(e.message); }
        }
        if (window.QUIZ_BANKS[b.id]) banks[b.id] = { ...unpackBank(window.QUIZ_BANKS[b.id]), builtin: true };
    }
    // 使用者匯入的題庫與組合存在瀏覽器裡；和內建題庫 id 相同的不載入（匯入時已避免）
    try { userBankData = (await idb('readonly', s => s.get(USER_BANKS_KEY))) || {}; } catch { userBankData = {}; }
    for (const [id, data] of Object.entries(userBankData)) {
        if (!banks[id]) banks[id] = { ...unpackBank(data), builtin: false };
    }
    try { userCombos = (await idb('readonly', s => s.get(USER_COMBOS_KEY))) || []; } catch { userCombos = []; }
    try { builtinCorrections = (await idb('readonly', s => s.get(BUILTIN_CORRECTIONS_KEY))) || {}; } catch { builtinCorrections = {}; }
    correctionConflicts = [];
    for (const [bankId, t] of Object.entries(builtinCorrections)) if (banks[bankId] && banks[bankId].builtin) applyCorrections(banks[bankId], tableRows(t));
}
/* 套上使用者對內建題庫的修正：內建題庫的值等於修正前的值才套用；已經等於修正後的值表示 repo 已修好，不用再套；
   兩者都不是時（內建題庫改成了第三種值）先沿用使用者的修正，並記下衝突提示使用者 */
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function applyCorrections(entry, rows) {
    for (const c of rows) {
        const q = entry.questions.find(x => x.seq === c.seq);
        if (!q || !['question', 'options', 'answer'].includes(c.field) || sameValue(q[c.field], c.to)) continue;
        if (!sameValue(q[c.field], c.from)) correctionConflicts.push({ bankId: entry.bank.id, seq: c.seq, field: c.field });
        q[c.field] = c.to;
    }
}
function unpackBank(data) {
    const bank = data.bank;
    const questions = tableRows(data.questions).map(r => ({
        id: qid(bank.id, r.seq), seq: r.seq, num: r.num ?? r.seq, bankId: bank.id,
        category: bank.name, categoryKey: bank.key,
        question: r.question, options: r.options, answer: r.answer,
    }));
    return { bank, questions };
}

/* ---------- 可以選的題庫與組合 ---------- */
function sourceList() {
    const combos = [...(CATALOG.combos || []).map(c => ({ ...c, builtin: true })), ...userCombos].filter(c => c.banks.some(id => banks[id]))
        .map(c => ({ id: c.id, name: c.name, bankIds: c.banks.filter(id => banks[id]), exam: c.exam || {}, builtin: !!c.builtin, combo: true }));
    const singles = Object.values(banks).map(({ bank }) => ({ id: bank.id, name: `${bank.name}（${bank.year || '未設定年份'}）`, bankIds: [bank.id], exam: {}, combo: false }));
    return [...combos, ...singles];
}
/* 組合包含哪些題庫，給滑鼠提示用 */
const sourceBanksText = src => src.bankIds.map(id => `${banks[id].bank.name}（${banks[id].bank.year || '未設定年份'}）`).join('、');
function findSource(id) {
    const list = sourceList();
    return list.find(s => s.id === id) || list.find(s => s.id === CATALOG.defaultCombo) || list[0] || null;
}
function sourceQuestions(src) {
    return src ? src.bankIds.flatMap(id => banks[id].questions) : [];
}
/* 目前題目裡的科目，依出現順序：[{ key, name }] */
function categoryList(questions) {
    const seen = new Map();
    for (const q of questions) if (!seen.has(q.categoryKey)) seen.set(q.categoryKey, q.category);
    return [...seen].map(([key, name]) => ({ key, name }));
}

/* ---------- 舊版題目 id 轉換 ----------
   ETH-0001 → 類別 key 為 ETH 的內建題庫中題號 1 的題目；同一個 key 有多份內建題庫時無法判斷，不轉換 */
function convertLegacyId(id) {
    const m = LEGACY_ID.exec(id);
    if (!m) return null;
    const candidates = CATALOG.banks.filter(b => b.id.split('-')[0] === m[1]);
    if (candidates.length !== 1) return null;
    const bankId = candidates[0].id, num = Number(m[2]);
    const q = banks[bankId] && banks[bankId].questions.find(x => x.num === num);
    return q ? q.id : qid(bankId, num);
}
