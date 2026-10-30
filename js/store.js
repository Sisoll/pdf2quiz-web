/* 作答紀錄與設定的存取、紀錄檔、匯出與匯入 */
/* ---------- 紀錄存取 ---------- */
function emptyRecords() { return { version: RECORD_VERSION, items: {}, exams: [] }; }

/* ---------- 精簡格式（存檔用） ----------
   每筆作答存成 [時間, 選項, 對錯, 難度, 來源, 秒數]：
   時間是 Unix 秒數的 36 進位字串；對錯 1 / 0；難度 E / M / H；模擬考的作答第 5 欄是 'x'；
   練習時記錄的作答秒數放第 6 欄（這時第 5 欄不是模擬考就寫 0），舊紀錄沒有秒數
   程式內部仍用物件格式，只在存檔、讀檔時轉換 */
const LEVEL_CODE = { EASY: 'E', MEDIUM: 'M', HARD: 'H' };
const LEVEL_NAME = { E: 'EASY', M: 'MEDIUM', H: 'HARD' };
const toSec = t => Math.floor(Date.parse(t) / 1000) || 0;
function packHistory(h) {
    const a = [toSec(h.t).toString(36), h.pick, h.ok ? 1 : 0, LEVEL_CODE[h.level] || 'M'];
    if (h.src === 'exam' || typeof h.sec === 'number') a.push(h.src === 'exam' ? 'x' : 0);
    if (typeof h.sec === 'number') a.push(h.sec);
    return a;
}
function unpackHistory(a) {
    const h = { t: new Date(parseInt(a[0], 36) * 1000).toISOString(), pick: a[1], ok: a[2] === 1, level: LEVEL_NAME[a[3]] || 'MEDIUM' };
    if (a[4] === 'x') h.src = 'exam';
    if (typeof a[5] === 'number') h.sec = a[5];
    return h;
}
/* ---------- 版本 4：欄位式格式 ----------
   作答紀錄依題庫分組，每題一列、只寫流水號；題目 id 不符合「題庫 id + 流水號」的（例如對不到題庫的舊 id）放在 other，原樣保留
   分數、答對次數等算得出來的欄位不存，載入時重算 */
const RECORDS_FORMAT = 'pdf2quiz-records';
const ITEM_COLUMNS = ['h', 'review', 'noReview', 'markAt', 'base'];
const EXAM_COLUMNS = ['at', 'durationMs', 'timeUp', 'passScore', 'pass', 'recorded', 'subjects'];
const SUBJECT_COLUMNS = ['category', 'n', 'correct', 'score'];
function packRecords(data = records) {
    const byBank = {}, other = [];
    for (const [id, r] of Object.entries(data.items)) {
        const o = { h: r.history.map(packHistory), review: r.review ? 1 : 0, noReview: r.noReview ? 1 : 0, markAt: r.markAt || null, base: r.base || null };
        if (!o.h.length && !o.review && !o.noReview && !o.markAt && !o.base) continue;   // 完全沒有資料的題目不存
        const k = splitQid(id);
        if (k) (byBank[k.bankId] = byBank[k.bankId] || []).push({ seq: k.seq, ...o });
        else other.push({ id, ...o });
    }
    const banksOut = {};
    for (const id of Object.keys(byBank).sort()) banksOut[id] = toTable(['seq', ...ITEM_COLUMNS], byBank[id].sort((a, b) => a.seq - b.seq));
    const exams = (data.exams || []).map(x => ({ ...x, subjects: toTable(SUBJECT_COLUMNS, x.subjects || []) }));
    const out = { format: RECORDS_FORMAT, version: RECORD_VERSION, updatedAt: data.updatedAt, banks: banksOut, exams: toTable(EXAM_COLUMNS, exams) };
    if (other.length) out.other = toTable(['id', ...ITEM_COLUMNS], other);
    return out;
}
/* 版本 4 轉回 { items, exams }，之後和舊版走同一條轉換流程 */
function unpackRecords(data) {
    const items = {};
    const item = row => ({ h: row.h || [], review: !!row.review, noReview: !!row.noReview, markAt: row.markAt || null, ...(row.base ? { base: row.base } : {}) });
    for (const [bankId, t] of Object.entries(data.banks || {})) for (const row of tableRows(t)) items[qid(bankId, row.seq)] = item(row);
    for (const row of tableRows(data.other)) items[row.id] = item(row);
    const exams = tableRows(data.exams).map(x => ({ ...x, subjects: Array.isArray(x.subjects) ? x.subjects : tableRows(x.subjects) }));
    return { version: data.version, updatedAt: data.updatedAt, items, exams };
}
const isRecordData = data => !!data && (data.format === RECORDS_FORMAT || typeof data.items === 'object');

/* ---------- 瀏覽器端儲存（IndexedDB） ----------
   localStorage 每個網站只有約 5 MB，紀錄多了會存不進去，所以改存 IndexedDB。
   舊版存在 localStorage 的紀錄會在載入時搬過來，存檔成功後刪掉；IndexedDB 不能用時才退回 localStorage */
const RECORDS_IDB_KEY = 'records';
const RECORDS_BACKUP_KEY = 'records-backup-before-v4';   // 轉成版本 4 之前的原始紀錄，只存第一次的
let legacyPending = false;   // localStorage 裡還有舊資料，等 IndexedDB 存檔成功後刪除
let browserWriting = Promise.resolve();
let saveWarned = false;

async function loadRecords() {
    let data = null, legacy = null;
    try { data = await idb('readonly', s => s.get(RECORDS_IDB_KEY)); } catch {}
    try { legacy = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
    await backupBeforeV4(data, legacy);
    if (!isRecordData(legacy)) return normalizeRecords(data || emptyRecords());
    legacyPending = true;
    // 兩邊都有資料時合併，不會蓋掉任何一邊
    return data ? mergeRecordSets(normalizeRecords(data), normalizeRecords(legacy)) : normalizeRecords(legacy);
}
/* 轉換格式前先把原始紀錄另存一份；已經有備份時不覆蓋 */
async function backupBeforeV4(data, legacy) {
    const old = [data, legacy].filter(d => d && d.format !== RECORDS_FORMAT && typeof d.items === 'object' && Object.keys(d.items).length);
    if (!old.length) return;
    try {
        if (await idb('readonly', s => s.get(RECORDS_BACKUP_KEY))) return;
        await idb('readwrite', s => s.put({ savedAt: new Date().toISOString(), records: old }, RECORDS_BACKUP_KEY));
    } catch (e) { console.warn('無法備份舊紀錄', e); }
}
/* 依呼叫順序寫入，避免較舊的內容蓋掉較新的 */
function saveToBrowser() {
    const data = packRecords();
    browserWriting = browserWriting.then(() => idb('readwrite', s => s.put(data, RECORDS_IDB_KEY)).then(() => {
        if (legacyPending) { try { localStorage.removeItem(STORAGE_KEY); } catch {} legacyPending = false; }
    }).catch(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); legacyPending = true; }
        catch (e) { warnSaveFailed(e); }
    }));
    return browserWriting;
}
/* 存不進去時一定要讓使用者知道，不能只印在 console */
function warnSaveFailed(e) {
    console.warn('無法儲存紀錄', e);
    if (saveWarned) return;
    saveWarned = true;
    alert(`作答紀錄無法存進瀏覽器（${e.message}）。請先匯出 JSON 備份，或連結紀錄檔。`);
}
/* 舊版紀錄：題目層級的難度改記到最近一次作答上，再用新公式重算 */
function migrateRecords(data) {
    if (data && data.format === RECORDS_FORMAT) data = unpackRecords(data);
    if (!data || typeof data.items !== 'object') return emptyRecords();
    // 精簡格式（版本 3）轉回程式內部用的物件格式
    for (const r of Object.values(data.items)) {
        if (Array.isArray(r.h)) { r.history = r.h.map(unpackHistory); delete r.h; }
    }
    if ((data.version || 1) < 2) {
        for (const r of Object.values(data.items)) {
            r.history = r.history || [];
            r.history.forEach(h => { h.level = h.level || 'MEDIUM'; });
            if (r.level && r.history.length) r.history[r.history.length - 1].level = r.level;
        }
    }
    data.version = RECORD_VERSION;
    for (const r of Object.values(data.items)) {
        r.history = r.history || [];
        // 「不清楚」已併入「加強複習」
        if ('unclear' in r) { r.review = !!(r.review || r.unclear); delete r.unclear; }
        r.review = !!r.review;
        r.noReview = !!r.noReview && !r.review;   // 兩個標記不會同時存在
        recompute(r);
    }
    return convertLegacyIds(data);
}
/* 舊版題目 id（ETH-0001）換成新 id；新舊 id 同時存在時合併，同一筆作答不會變成兩筆 */
function convertLegacyIds(data) {
    const moved = {};
    for (const id of Object.keys(data.items)) {
        const to = convertLegacyId(id);
        if (!to) continue;
        moved[to] = data.items[id];
        delete data.items[id];
    }
    if (!Object.keys(moved).length) return data;
    const merged = mergeRecordSets({ items: data.items, exams: data.exams || [] }, { items: moved, exams: [] });
    merged.updatedAt = data.updatedAt;
    return merged;
}
function saveRecords() {
    records.updatedAt = new Date().toISOString();
    saveToBrowser().then(() => notifyChanged('records'));
    scheduleFileWrite();
}

/* ---------- 多個分頁同時開著 ----------
   一個分頁改了題庫或作答紀錄（寫進 IndexedDB 之後），用 localStorage 的 storage 事件通知其他分頁重新讀取
   kind：'records' 作答紀錄、'banks' 題庫或組合 */
const CHANGED_KEY = 'pdf2quiz-changed';
const TAB_ID = Math.random().toString(36).slice(2);
function notifyChanged(kind) {
    try { localStorage.setItem(CHANGED_KEY, JSON.stringify({ kind, from: TAB_ID, at: Date.now() })); } catch {}
}
function onDataChanged(fn) {
    window.addEventListener('storage', e => {
        if (e.key !== CHANGED_KEY || !e.newValue) return;
        try {
            const m = JSON.parse(e.newValue);
            if (m.from !== TAB_ID) fn(m.kind);
        } catch {}
    });
}
function loadSettings() {
    const defaults = { source: '', category: 'all', include: [], exclude: ['noReview'], order: 'seq', limit: '', threshold: DEFAULT_THRESHOLD, min: '', max: '', browseSort: 'num', showAnswers: false, scoringVersion: 2 };
    let s;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { s = {}; }
    // 舊版的單選「題目範圍」轉成「包含」
    if ('status' in s) {
        const map = { noLevel: 'new', unclear: 'review' };   // 未分級 = 未作答
        const st = map[s.status] || s.status;
        if (!Array.isArray(s.include)) s.include = st && st !== 'all' ? [st] : [];
        delete s.status;
    }
    // 「尚未記住」等同排除「已記住」；「分數為負」改用分數區間
    if (Array.isArray(s.include) && s.include.includes('notMastered')) {
        s.include = s.include.filter(x => x !== 'notMastered');
        s.exclude = [...new Set([...(Array.isArray(s.exclude) ? s.exclude : ['noReview']), 'mastered'])];
    }
    const known = CONDITIONS.map(c => c.key);
    for (const k of ['include', 'exclude']) if (Array.isArray(s[k])) s[k] = s[k].filter(x => known.includes(x));
    if (s.scoringVersion !== 2) s.scoringVersion = 2;
    // 記住門檻目前固定，不讀取舊設定
    return Object.assign(defaults, s, { threshold: DEFAULT_THRESHOLD });
}
function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
function rec(id) {
    if (!records.items[id]) {
        records.items[id] = { correct: 0, wrong: 0, score: 0, streak: 0, review: false, noReview: false, level: null, last: null, lastAt: null, history: [] };
    }
    return records.items[id];
}
const EMPTY = { correct: 0, wrong: 0, score: 0, streak: 0, review: false, noReview: false, level: null, history: [] };   // 未作答的題目沒有難度
function peek(id) { return records.items[id] || EMPTY; }
function isMastered(r) { return r.score >= settings.threshold && !r.review; }
function fmtScore(n) {
    const v = round2(n);
    if (v === 0) return '0';
    const t = Number.isInteger(v * 10) ? v.toFixed(1) : v.toFixed(2);
    return v > 0 ? `+${t}` : t;
}

/* ---------- 紀錄檔（File System Access API） ---------- */
const fileApiSupported = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
let fileHandle = null;
let writeTimer = null;
let writing = Promise.resolve();

/* 共用一個連線；開啟失敗的話下次再試 */
let dbOpening = null;
function openDb() {
    if (!dbOpening) {
        dbOpening = new Promise((resolve, reject) => {
            const req = indexedDB.open('pdf2quiz', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
        });
        dbOpening.catch(() => { dbOpening = null; });
    }
    return dbOpening;
}
function idb(mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const r = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    }));
}
const storeHandle = h => idb('readwrite', s => h ? s.put(h, 'recordFile') : s.delete('recordFile')).catch(() => {});
const loadHandle = () => idb('readonly', s => s.get('recordFile')).catch(() => null);

function setFileStatus(text, cls = '') {
    $('file-status').textContent = text;
    $('file-status').className = cls;
}
function recordPayload() {
    return JSON.stringify({ ...packRecords(), threshold: settings.threshold });
}
function scheduleFileWrite() {
    if (!fileHandle) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => { writing = writing.then(writeFile); }, 300);
}
async function writeFile() {
    if (!fileHandle) return;
    try {
        const w = await fileHandle.createWritable();
        await w.write(recordPayload());
        await w.close();
        setFileStatus(`已連結 ${fileHandle.name}（最後存檔 ${new Date().toLocaleTimeString()}）`, 'linked');
    } catch (e) {
        setFileStatus(`寫入 ${fileHandle.name} 失敗：${e.message}。紀錄仍保存在瀏覽器裡。`, 'warn');
    }
}
/* 匯入或讀檔共用；記住門檻目前固定，不沿用檔案裡的值 */
function normalizeRecords(data) {
    if (data.format === RECORDS_FORMAT) data = unpackRecords(data);
    return migrateRecords({ version: data.version || 1, items: data.items || {}, exams: Array.isArray(data.exams) ? data.exams : [], updatedAt: data.updatedAt });
}
/* 取代：直接用檔案的紀錄 */
function adoptRecords(data) {
    records = normalizeRecords(data);
}

/* 合併兩份紀錄（例如 A 電腦與 B 電腦各自練習）
   - 作答歷程取聯集；同一筆作答（時間 + 選項相同）只留一筆，重複匯入也不會變多
   - 加強複習 / 暫停複習：以較晚修改的為準（舊資料沒有修改時間時，有標記就保留）
   - 模擬考成績：依開始時間取聯集
   合併後依新的歷程重算分數 */
function mergeRecordSets(a, b) {
    const out = { version: RECORD_VERSION, items: {}, exams: [] };
    const ids = new Set([...Object.keys(a.items), ...Object.keys(b.items)]);
    const hkey = h => `${toSec(h.t)}|${h.pick}|${h.ok}`;   // 精簡格式只記到秒，比對時統一用秒
    for (const id of ids) {
        const ra = a.items[id], rb = b.items[id];
        if (!ra || !rb) { out.items[id] = JSON.parse(JSON.stringify(ra || rb)); continue; }
        const seen = new Map();
        for (const h of [...ra.history, ...rb.history]) {
            const k = hkey(h);
            // 同一筆作答在兩邊的難度不同時（其中一邊後來改過），保留非 MEDIUM 的那個
            const prev = seen.get(k);
            if (!prev || (prev.level === 'MEDIUM' && h.level !== 'MEDIUM')) seen.set(k, { ...h });
            // 只有一邊記了作答秒數時保留秒數
            const kept = seen.get(k);
            if (typeof kept.sec !== 'number' && prev && typeof prev.sec === 'number') kept.sec = prev.sec;
            if (typeof kept.sec !== 'number' && typeof h.sec === 'number') kept.sec = h.sec;
        }
        const history = [...seen.values()].sort((x, y) => Date.parse(x.t) - Date.parse(y.t));
        const ta = ra.markAt ? Date.parse(ra.markAt) : 0, tb = rb.markAt ? Date.parse(rb.markAt) : 0;
        let review, noReview, markAt;
        if (ta || tb) {
            const win = tb > ta ? rb : ra;
            review = !!win.review; noReview = !!win.noReview; markAt = win.markAt;
        } else {
            review = !!(ra.review || rb.review);
            noReview = !review && !!(ra.noReview || rb.noReview);
            markAt = null;
        }
        const base = ra.base || rb.base;   // 超過保留上限時濃縮的舊資料（極少見）
        out.items[id] = { history, review, noReview, markAt, ...(base ? { base } : {}) };
    }
    const exams = new Map();
    for (const x of [...(a.exams || []), ...(b.exams || [])]) exams.set(x.at, x);
    out.exams = [...exams.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).slice(-EXAM_HISTORY_LIMIT);
    for (const r of Object.values(out.items)) recompute(r);
    return out;
}
/* 合併後回報新增了多少筆，讓使用者知道發生什麼事 */
function mergeInto(data) {
    const incoming = normalizeRecords(data);
    const count = rs => Object.values(rs.items).reduce((n, r) => n + r.history.length, 0);
    const before = count(records);
    records = mergeRecordSets(records, incoming);
    return { added: count(records) - before, total: count(records) };
}

async function readFileInto(handle) {
    const text = await (await handle.getFile()).text();
    if (!text.trim()) return false;           // 空檔：保留目前紀錄並寫入
    const data = JSON.parse(text);
    if (!isRecordData(data)) throw new Error('不是本程式的紀錄檔');
    // 開啟紀錄檔時和瀏覽器裡的紀錄合併，不會蓋掉任何一邊
    mergeInto(data);
    await saveToBrowser();
    return true;
}
async function linkHandle(handle, { load }) {
    fileHandle = handle;
    await storeHandle(handle);
    if (load) await readFileInto(handle);
    await writeFile();   // 合併後的結果寫回檔案
    $('file-resume').hidden = true;
    $('file-unlink').hidden = false;
    setFileStatus(`已連結 ${handle.name}`, 'linked');
    resetView();
}
const pickerOpts = { types: [{ description: '作答紀錄 JSON', accept: { 'application/json': ['.json'] } }] };

async function openRecordFile() {
    try {
        const [handle] = await window.showOpenFilePicker(pickerOpts);
        if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
        await linkHandle(handle, { load: true });
    } catch (e) { if (e.name !== 'AbortError') alert('開啟紀錄檔失敗：' + e.message); }
}
async function newRecordFile() {
    try {
        const handle = await window.showSaveFilePicker({ ...pickerOpts, suggestedName: 'quiz-record.json' });
        await linkHandle(handle, { load: false });   // 把目前瀏覽器裡的紀錄寫進新檔
    } catch (e) { if (e.name !== 'AbortError') alert('建立紀錄檔失敗：' + e.message); }
}
async function resumeRecordFile(handle) {
    try {
        if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
        await linkHandle(handle, { load: true });
    } catch (e) { alert(`無法開啟 ${handle.name}：${e.message}。請改用「開啟既有紀錄檔」。`); }
}
async function unlinkRecordFile() {
    fileHandle = null;
    await storeHandle(null);
    $('file-unlink').hidden = true;
    $('file-resume').hidden = true;
    setFileStatus('尚未連結（目前只存在瀏覽器裡）');
}
async function initRecordFile() {
    if (!fileApiSupported) {
        $('file-actions').hidden = true;
        $('file-hint').textContent = '這個瀏覽器不支援直接寫入檔案（請改用 Chrome 或 Edge）。目前可以用下方的匯出、匯入保存紀錄。';
        return;
    }
    $('file-open').onclick = openRecordFile;
    $('file-new').onclick = newRecordFile;
    $('file-unlink').onclick = unlinkRecordFile;
    const saved = await loadHandle();
    if (!saved) return;
    // 瀏覽器重新開啟後需要使用者按一下才能再次取得寫入權限
    if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') {
        try { await linkHandle(saved, { load: true }); return; } catch {}
    }
    $('file-resume').textContent = `繼續使用 ${saved.name}`;
    $('file-resume').hidden = false;
    $('file-resume').onclick = () => resumeRecordFile(saved);
    setFileStatus(`上次使用 ${saved.name}，請按「繼續使用」重新授權`, 'warn');
}

/* ---------- 匯出 / 匯入 ---------- */
function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
function stamp() { return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); }

function exportJson() {
    const out = { ...packRecords(), exportedAt: new Date().toISOString(), threshold: settings.threshold };
    download(`quiz-record-${stamp()}.json`, JSON.stringify(out), 'application/json');
}
function exportCsv() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['題目ID', '科目', '題號', '題目', '正確答案', '答對次數', '答錯次數', '分數', '目前連對', '是否記住', '最近難度', '加強複習', '暫停複習', '最後結果', '最後作答時間', '作答歷程'];
    const rows = allQuestions.map(q => {
        const r = peek(q.id);
        const trail = r.history.map(h => `${h.ok ? '對' : '錯'}/${h.level}/${fmtScore(h.s)}`).join(' ');
        return [q.id, q.category, q.num, q.question, q.answer, r.correct, r.wrong, fmtScore(r.score), r.streak,
            isMastered(r) ? '是' : '否', r.correct + r.wrong ? r.level : '', r.review ? '是' : '', r.noReview ? '是' : '',
            r.last === 'correct' ? '對' : r.last === 'wrong' ? '錯' : '', r.lastAt ? new Date(r.lastAt).toLocaleString() : '', trail].map(esc).join(',');
    });
    // 加 BOM 讓 Excel 正確顯示中文
    download(`quiz-record-${stamp()}.csv`, '﻿' + [head.map(esc).join(','), ...rows].join('\r\n'), 'text/csv');
}
/* 匯入 JSON：mode = 'merge'（合併，建議）或 'replace'（取代目前的紀錄） */
function importJson(file, mode) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!isRecordData(data)) throw new Error('格式不符');
            if (mode === 'replace') {
                if (!confirm(`要用這個檔案「取代」目前的作答紀錄嗎？目前瀏覽器裡的紀錄會被蓋掉。（檔案內有 ${Object.keys(normalizeRecords(data).items).length} 題的紀錄）`)) return;
                adoptRecords(data);
                saveRecords(); resetView();
                alert('已用檔案取代目前的作答紀錄。');
            } else {
                const { added, total } = mergeInto(data);
                saveRecords(); resetView();
                alert(added ? `合併完成：新增 ${added} 筆作答，目前共 ${total} 筆。` : `合併完成：檔案裡的作答都已經存在，沒有新增（目前共 ${total} 筆）。`);
            }
        } catch (e) { alert('匯入失敗：' + e.message); }
    };
    reader.readAsText(file, 'utf-8');
}
