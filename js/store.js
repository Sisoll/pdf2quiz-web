/* 作答紀錄與設定的存取、紀錄檔、匯出與匯入 */
/* ---------- 紀錄存取 ---------- */
function emptyRecords() { return { version: RECORD_VERSION, items: {} }; }
function loadRecords() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyRecords(); }
    catch { return emptyRecords(); }
}
/* 舊版紀錄：題目層級的難度改記到最近一次作答上，再用新公式重算 */
function migrateRecords(data) {
    if (!data || typeof data.items !== 'object') return emptyRecords();
    if ((data.version || 1) < RECORD_VERSION) {
        for (const r of Object.values(data.items)) {
            r.history = r.history || [];
            r.history.forEach(h => { h.level = h.level || 'MEDIUM'; });
            if (r.level && r.history.length) r.history[r.history.length - 1].level = r.level;
        }
        data.version = RECORD_VERSION;
    }
    for (const r of Object.values(data.items)) {
        r.history = r.history || [];
        // 「不清楚」已併入「加強複習」
        if ('unclear' in r) { r.review = !!(r.review || r.unclear); delete r.unclear; }
        r.review = !!r.review;
        r.noReview = !!r.noReview && !r.review;   // 兩個標記不會同時存在
        recompute(r);
    }
    return data;
}
function saveRecords() {
    records.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch (e) { console.warn('無法儲存紀錄', e); }
    scheduleFileWrite();
}
function loadSettings() {
    const defaults = { category: 'all', include: [], exclude: ['noReview'], order: 'seq', limit: '', threshold: DEFAULT_THRESHOLD, min: '', max: '', browseSort: 'num', showAnswers: false, scoringVersion: 2 };
    let s;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { s = {}; }
    // 舊版的單選「題目範圍」轉成「包含」
    if ('status' in s) {
        const map = { noLevel: 'MEDIUM', unclear: 'review' };
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
        records.items[id] = { correct: 0, wrong: 0, score: 0, streak: 0, review: false, noReview: false, level: 'MEDIUM', last: null, lastAt: null, history: [] };
    }
    return records.items[id];
}
const EMPTY = { correct: 0, wrong: 0, score: 0, streak: 0, review: false, noReview: false, level: 'MEDIUM', history: [] };
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

function idb(mode, fn) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('pdf2quiz', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            try {
                const tx = req.result.transaction('kv', mode);
                const r = fn(tx.objectStore('kv'));
                tx.oncomplete = () => resolve(r && r.result);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            } catch (e) { reject(e); }
        };
    });
}
const storeHandle = h => idb('readwrite', s => h ? s.put(h, 'recordFile') : s.delete('recordFile')).catch(() => {});
const loadHandle = () => idb('readonly', s => s.get('recordFile')).catch(() => null);

function setFileStatus(text, cls = '') {
    $('file-status').textContent = text;
    $('file-status').className = cls;
}
function recordPayload() {
    return JSON.stringify({ ...records, threshold: settings.threshold }, null, 2);
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
function adoptRecords(data) {
    records = migrateRecords({ version: data.version || 1, items: data.items, updatedAt: data.updatedAt });
}
async function readFileInto(handle) {
    const text = await (await handle.getFile()).text();
    if (!text.trim()) return false;           // 空檔：保留目前紀錄並寫入
    const data = JSON.parse(text);
    if (!data || typeof data.items !== 'object') throw new Error('不是本程式的紀錄檔');
    adoptRecords(data);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch {}
    return true;
}
async function linkHandle(handle, { load }) {
    fileHandle = handle;
    await storeHandle(handle);
    if (load) {
        const loaded = await readFileInto(handle);
        if (!loaded) await writeFile();
    } else {
        await writeFile();
    }
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
    const out = { ...records, exportedAt: new Date().toISOString(), threshold: settings.threshold };
    download(`quiz-record-${stamp()}.json`, JSON.stringify(out, null, 2), 'application/json');
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
function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!data || typeof data.items !== 'object') throw new Error('格式不符');
            if (!confirm(`要用這個檔案取代目前的作答紀錄嗎？（檔案內有 ${Object.keys(data.items).length} 題的紀錄）`)) return;
            adoptRecords(data);
            saveRecords(); resetView();
        } catch (e) { alert('匯入失敗：' + e.message); }
    };
    reader.readAsText(file, 'utf-8');
}
