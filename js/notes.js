/* 題目解析：和作答紀錄分開存放
   - 內建解析：data/notes.js（window.QUIZ_NOTES，由 tools/build-notes.js 產生，可以提交到專案）
   - 使用者新增、修改的：IndexedDB 的 userNotes { 題目 id: { text, at } }；刪除時留下 text 為空字串的紀錄，才能蓋掉內建的那一筆
   - 兩邊都有同一題時，以較晚改的為準
   解析檔格式：{ format: 'pdf2quiz-notes', version: 1, notes: { 題目 id: { text, at } } } */
const NOTES_FORMAT = 'pdf2quiz-notes';
const USER_NOTES_KEY = 'userNotes';
const BUILTIN_NOTES = (window.QUIZ_NOTES && window.QUIZ_NOTES.notes) || {};
let userNotes = {};

async function loadNotes() {
    try { userNotes = (await idb('readonly', s => s.get(USER_NOTES_KEY))) || {}; } catch { userNotes = {}; }
}
async function saveNotes() {
    try {
        await idb('readwrite', s => s.put(userNotes, USER_NOTES_KEY));
        notifyChanged('notes');
        scheduleNotesWrite();
    } catch (e) {
        alert(`解析無法存進瀏覽器（${e.message}）。請先匯出解析備份。`);
    }
}
const laterNote = (a, b) => !a ? b : !b ? a : Date.parse(b.at) > Date.parse(a.at) ? b : a;
/* 目前有效的解析；沒有或已刪除時回傳 null */
function getNote(id) {
    const n = laterNote(BUILTIN_NOTES[id], userNotes[id]);
    return n && n.text ? n : null;
}
const hasNote = q => !!getNote(q.id);
function setNote(id, text) {
    userNotes[id] = { text, at: new Date().toISOString() };
    return saveNotes();
}
/* 內建與使用者的解析合起來（含刪除紀錄），匯出、備份用 */
function allNotes() {
    const out = {};
    for (const id of new Set([...Object.keys(BUILTIN_NOTES), ...Object.keys(userNotes)])) out[id] = { ...laterNote(BUILTIN_NOTES[id], userNotes[id]) };
    return out;
}
const isNotesData = data => !!data && data.format === NOTES_FORMAT && typeof data.notes === 'object';
/* 合併匯入的解析：同一題以較晚改的為準；回傳更新了幾題 */
async function mergeNotes(notes) {
    let changed = 0;
    for (const [id, n] of Object.entries(notes || {})) {
        if (!n || typeof n.text !== 'string' || !n.at || isNaN(Date.parse(n.at))) continue;
        const current = laterNote(BUILTIN_NOTES[id], userNotes[id]);
        if (laterNote(current, n) === current) continue;
        userNotes[id] = { text: n.text, at: n.at };
        changed++;
    }
    if (changed) await saveNotes();
    return changed;
}
function exportNotes() {
    const data = { format: NOTES_FORMAT, version: 1, exportedAt: new Date().toISOString(), notes: allNotes() };
    download(`quiz-notes-${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
}
/* 舊的開發版本曾把解析存在作答紀錄裡（note 欄位）；讀到時搬過來 */
function adoptRecordNote(id, note) {
    if (!note || typeof note.text !== 'string') return;
    const kept = laterNote(userNotes[id], note);
    if (kept === userNotes[id]) return;
    userNotes[id] = { text: note.text, at: note.at };
    saveNotes();
}

/* 「提供解析」／「查看說明」按鈕；getQ 回傳目前的題目。存檔或刪除後按鈕文字跟著變 */
function noteButton(getQ) {
    const b = el('button', 'copy-btn note-btn');
    b.type = 'button';
    const draw = () => {
        const q = getQ();
        const has = !!q && hasNote(q);
        b.textContent = has ? '📖 查看說明' : '✏️ 提供解析';
        b.classList.toggle('has-note', has);
        b.title = has ? '查看、編輯或刪除這題的解析' : '貼上這題的解析，之後可以再看';
    };
    b.refresh = draw;
    b.onclick = e => { e.stopPropagation(); const q = getQ(); if (q) openNote(q, draw); };
    draw();
    return b;
}
/* 其他分頁改了解析：畫面上的按鈕跟著更新 */
function refreshNoteButtons() {
    document.querySelectorAll('.note-btn').forEach(b => b.refresh && b.refresh());
}

/* 解析彈窗：有內容時先顯示內容（可複製、編輯、刪除），沒有就直接進入編輯 */
function openNote(q, onChange) {
    const d = $('note-dialog');
    const mode = editing => {
        $('note-view').hidden = editing;
        $('note-edit').hidden = !editing;
        $('note-actions-view').hidden = editing;
        $('note-actions-edit').hidden = !editing;
    };
    const view = () => {
        const note = getNote(q.id);
        $('note-title').textContent = `第 ${q.num} 題的解析`;
        $('note-question').textContent = q.question;
        mode(!note);
        if (note) {
            $('note-text').textContent = note.text;
            $('note-time').textContent = `最後修改 ${new Date(note.at).toLocaleString()}`;
        } else {
            $('note-input').value = '';
            setTimeout(() => $('note-input').focus());
        }
        $('note-cancel').textContent = note ? '取消' : '關閉';
    };
    const edit = () => {
        mode(true);
        $('note-input').value = getNote(q.id)?.text || '';
        $('note-input').focus();
    };
    const save = async text => {
        await setNote(q.id, text);
        if (onChange) onChange();
        refreshNoteButtons();
    };
    $('note-edit-btn').onclick = edit;
    $('note-copy-btn').onclick = async () => {
        const ok = await copyText(getNote(q.id).text);
        $('note-copy-btn').textContent = ok ? '✓ 已複製' : '複製失敗';
        setTimeout(() => { $('note-copy-btn').textContent = '📋 複製'; }, 1200);
    };
    $('note-delete-btn').onclick = async () => {
        if (!confirm('確定要刪除這題的解析嗎？')) return;
        await save('');
        d.close();
    };
    $('note-save').onclick = async () => {
        const text = $('note-input').value.trim();
        if (!text) { alert('解析是空的。要刪除請按「刪除」。'); return; }
        await save(text);
        view();
    };
    $('note-cancel').onclick = () => { if (getNote(q.id)) view(); else d.close(); };
    $('note-close').onclick = () => d.close();
    view();
    if (!d.open) {
        // 每次打開回到畫面中間；大小沿用上次調整的
        d.style.left = d.style.top = d.style.right = d.style.bottom = d.style.margin = '';
        d.showModal();
    }
}
/* 拖標題移動解析彈窗；不超出畫面 */
function initNoteDialogDrag() {
    const d = $('note-dialog');
    const handle = $('note-title');
    handle.title = '拖這裡移動；拖右下角調整大小';
    handle.onpointerdown = e => {
        if (e.button !== 0) return;
        const rect = d.getBoundingClientRect();
        const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
        handle.setPointerCapture(e.pointerId);
        const move = ev => {
            const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - rect.width);
            const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 40);
            // 彈窗預設 inset: 0 置中，拖動後改成固定左上角，右下不拉伸
            Object.assign(d.style, { margin: '0', left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
        };
        const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        e.preventDefault();
    };
}

/* ---------- 解析檔：和作答紀錄檔一樣連結一個檔案，每次改解析就自動寫回（只有 Chrome / Edge） ----------
   可以直接連結專案裡的 data/notes.js：寫成 window.QUIZ_NOTES = {...} 的格式，提交後就是內建解析；
   其他副檔名寫成 JSON。寫回的內容是內建與使用者的解析合起來，刪除的也留著（空字串），另一台電腦合併時才不會補回來 */
const NOTES_FILE_KEY = 'notesFile';
let notesHandle = null;
let notesWriteTimer = null;
let notesWriting = Promise.resolve();
const NOTES_JS_HEADER = '// 由頁面（連結解析檔）或 tools/build-notes.js 產生，請勿手動修改\n' +
    '// 內建解析：{ 題目 id: { text, at } }；text 是空字串表示已刪除；使用者在頁面上改的存在瀏覽器裡，同一題以較晚改的為準\n';

function notesFileContent(name) {
    const notes = allNotes();
    const sorted = {};
    for (const id of Object.keys(notes).sort()) sorted[id] = notes[id];
    const data = { format: NOTES_FORMAT, version: 1, notes: sorted };
    return name.endsWith('.js') ? `${NOTES_JS_HEADER}window.QUIZ_NOTES = ${JSON.stringify(data, null, 1)};\n` : JSON.stringify(data, null, 1);
}
/* 讀解析檔：.js 取出 window.QUIZ_NOTES = 後面的物件 */
function parseNotesFile(text) {
    const at = text.indexOf('window.QUIZ_NOTES');   // 開頭的註解裡也有大括號，從賦值的地方往後找
    const body = at >= 0 ? text.slice(text.indexOf('{', at), text.lastIndexOf('}') + 1) : text;
    const data = JSON.parse(body);
    if (!isNotesData(data)) throw new Error('不是解析檔');
    return data;
}
function setNotesStatus(text, cls = '') {
    $('notes-file-status').textContent = text;
    $('notes-file-status').className = cls;
}
function scheduleNotesWrite() {
    if (!notesHandle) return;
    clearTimeout(notesWriteTimer);
    notesWriteTimer = setTimeout(() => { notesWriting = notesWriting.then(writeNotesFile); }, 300);
}
async function writeNotesFile() {
    if (!notesHandle) return;
    try {
        const w = await notesHandle.createWritable();
        await w.write(notesFileContent(notesHandle.name));
        await w.close();
        setNotesStatus(`已連結 ${notesHandle.name}（最後存檔 ${new Date().toLocaleTimeString()}）`, 'linked');
    } catch (e) {
        setNotesStatus(`寫入 ${notesHandle.name} 失敗：${e.message}。解析仍保存在瀏覽器裡。`, 'warn');
    }
}
const storeNotesHandle = h => idb('readwrite', s => h ? s.put(h, NOTES_FILE_KEY) : s.delete(NOTES_FILE_KEY)).catch(() => {});
/* 連結解析檔：先把檔案裡的解析併進來（同一題以較晚改的為準），再把合併結果寫回 */
async function linkNotesHandle(handle, { load }) {
    if (load) {
        const text = await (await handle.getFile()).text();
        if (text.trim()) await mergeNotes(parseNotesFile(text).notes);
    }
    notesHandle = handle;
    await storeNotesHandle(handle);
    await writeNotesFile();
    $('notes-file-resume').hidden = true;
    $('notes-file-unlink').hidden = false;
    refreshNoteButtons();
}
const notesPickerOpts = { types: [{ description: '解析檔（data/notes.js 或 JSON）', accept: { 'text/javascript': ['.js'], 'application/json': ['.json'] } }] };
async function openNotesFile() {
    try {
        const [handle] = await window.showOpenFilePicker(notesPickerOpts);
        if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
        await linkNotesHandle(handle, { load: true });
    } catch (e) { if (e.name !== 'AbortError') alert('開啟解析檔失敗：' + e.message); }
}
async function newNotesFile() {
    try {
        const handle = await window.showSaveFilePicker({ ...notesPickerOpts, suggestedName: 'notes.js' });
        await linkNotesHandle(handle, { load: false });
    } catch (e) { if (e.name !== 'AbortError') alert('建立解析檔失敗：' + e.message); }
}
async function unlinkNotesFile() {
    notesHandle = null;
    await storeNotesHandle(null);
    $('notes-file-unlink').hidden = true;
    $('notes-file-resume').hidden = true;
    setNotesStatus('尚未連結（目前只存在瀏覽器裡）');
}
async function initNotesFile() {
    if (!fileApiSupported) { $('notes-file-actions').hidden = true; return; }
    $('notes-file-open').onclick = openNotesFile;
    $('notes-file-new').onclick = newNotesFile;
    $('notes-file-unlink').onclick = unlinkNotesFile;
    const saved = await idb('readonly', s => s.get(NOTES_FILE_KEY)).catch(() => null);
    if (!saved) return;
    // 瀏覽器重新開啟後需要使用者按一下才能再次取得寫入權限
    if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') {
        try { await linkNotesHandle(saved, { load: true }); return; } catch {}
    }
    $('notes-file-resume').textContent = `繼續使用 ${saved.name}`;
    $('notes-file-resume').hidden = false;
    $('notes-file-resume').onclick = async () => {
        try {
            if ((await saved.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
            await linkNotesHandle(saved, { load: true });
        } catch (e) { alert(`無法開啟 ${saved.name}：${e.message}。請改用「開啟既有解析檔」。`); }
    };
    setNotesStatus(`上次使用 ${saved.name}，請按「繼續使用」重新授權`, 'warn');
}
