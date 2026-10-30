/* 題庫管理：題庫清單、匯入匯出、刪除、組合、完整備份與還原（最後載入） */
let settings = loadSettings();
let records = emptyRecords();
const META_KEY = 'manageMeta';   // IndexedDB：{ lastBackupAt, noticeShown }
const BANK_FORMAT = 'pdf2quiz-bank';
const BACKUP_FORMAT = 'pdf2quiz-backup';
const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 題庫 id 的隨機碼，排除容易看錯的 0 O 1 I L
const BACKUP_REMIND_DAYS = 7;
let meta = {};

/* ---------- 讀取與儲存 ---------- */
async function reloadBanks() {
    banks = {};
    await loadBanks();
}
async function reloadAll() {
    await reloadBanks();
    records = await loadRecords();
    await loadTemplates();
    try { meta = (await idb('readonly', s => s.get(META_KEY))) || {}; } catch { meta = {}; }
    renderAll();
}
/* 存不進瀏覽器時明確告知，不能默默失敗 */
async function saveUserData() {
    try {
        await idb('readwrite', s => { s.put(userBankData, USER_BANKS_KEY); return s.put(userCombos, USER_COMBOS_KEY); });
    } catch (e) {
        alert(`這個瀏覽器無法儲存題庫（${e.message}），題庫管理無法使用。`);
        throw e;
    }
    notifyChanged('banks');
}
async function saveMeta() {
    try { await idb('readwrite', s => s.put(meta, META_KEY)); } catch {}
}
async function saveRecordsNow() {
    records.updatedAt = new Date().toISOString();
    await saveToBrowser();
    notifyChanged('records');
}
/* 題庫檔內容；內建題庫有使用者修正時，匯出的是套上修正後的內容，修正也記進 corrections */
function bankData(id) {
    const entry = banks[id];
    if (!entry) return null;
    if (!entry.builtin) return userBankData[id];
    const base = window.QUIZ_BANKS[id];
    const fix = builtinCorrections[id];
    if (!fix || !fix.rows.length) return base;
    const data = JSON.parse(JSON.stringify(base));
    const cols = data.questions.columns;
    for (const row of data.questions.rows) {
        const q = entry.questions.find(x => x.seq === row[cols.indexOf('seq')]);
        for (const f of ['question', 'options', 'answer']) row[cols.indexOf(f)] = q[f];
    }
    data.corrections.rows.push(...tableRows(fix).map(r => data.corrections.columns.map(c => r[c] ?? null)));
    return data;
}

/* ---------- 題庫檢查 ---------- */
function validateBank(data) {
    if (!data || data.format !== BANK_FORMAT) return '不是題庫檔';
    if (data.version !== 4) return `不支援的題庫版本：${data.version}`;
    const b = data.bank || {};
    if (!/^[A-Z0-9]{3,6}$/.test(b.key || '')) return '類別 key 必須是 3～6 個大寫英文或數字';
    if (!BANK_ID.test(b.id || '') || !b.id.startsWith(b.key + '-')) return `題庫 id 格式不對：${b.id}`;
    if (!b.name || typeof b.name !== 'string') return '缺少題庫名稱';
    const cols = (data.questions && data.questions.columns) || [];
    for (const c of ['seq', 'question', 'options', 'answer']) if (!cols.includes(c)) return `題目缺少欄位：${c}`;
    const rows = tableRows(data.questions);
    if (!rows.length) return '題庫裡沒有題目';
    const seen = new Set();
    for (const r of rows) {
        const at = `第 ${r.seq} 題`;
        if (!Number.isInteger(r.seq) || r.seq < 1 || r.seq > 9999) return `${at}：流水號必須是 1～9999 的整數`;
        if (seen.has(r.seq)) return `${at}：流水號重複`;
        seen.add(r.seq);
        if (!r.question || typeof r.question !== 'string') return `${at}：沒有題目文字`;
        if (!Array.isArray(r.options) || r.options.length < 2 || r.options.some(o => !o || typeof o !== 'string')) return `${at}：選項至少要兩個，而且不能是空的`;
        if (!Number.isInteger(r.answer) || r.answer < 1 || r.answer > r.options.length) return `${at}：答案超出選項範圍`;
    }
    return null;
}
const rowKey = r => JSON.stringify([r.seq, r.question, r.options, r.answer]);
function diffCount(a, b) {
    const ka = new Map(tableRows(a.questions).map(r => [r.seq, rowKey(r)]));
    const kb = new Map(tableRows(b.questions).map(r => [r.seq, rowKey(r)]));
    return [...new Set([...ka.keys(), ...kb.keys()])].filter(s => ka.get(s) !== kb.get(s)).length;
}
const sameContent = (a, b) => !!a && !!b && diffCount(a, b) === 0;
/* 一個類別 key 只對應一個名稱 */
function keyNames() {
    const m = new Map();
    for (const { bank } of Object.values(banks)) if (!m.has(bank.key)) m.set(bank.key, bank.name);
    return m;
}
function genBankId(key, year) {
    const y = /^\d{4}$/.test(String(year)) ? String(year) : '0000';
    for (;;) {
        const rand = [...crypto.getRandomValues(new Uint8Array(4))].map(n => ID_CHARS[n % ID_CHARS.length]).join('');
        const id = `${key}-${y}-${rand}`;
        if (!banks[id] && !userBankData[id]) return id;
    }
}
const randomCode = () => [...crypto.getRandomValues(new Uint8Array(4))].map(n => ID_CHARS[n % ID_CHARS.length]).join('');

/* ---------- 匯入 ---------- */
/* 依檔案內容判斷種類；匯入後重畫畫面 */
async function importData(data) {
    try { return await importByKind(data); } finally { renderAll(); }
}
function importByKind(data) {
    if (data && data.format === BANK_FORMAT) return importBankData(data);
    if (data && data.format === BACKUP_FORMAT) return restoreBackup(data);
    if (data && data.format === TEMPLATE_FORMAT) return importTemplate(data.template);
    if (Array.isArray(data) && data.length && data.every(q => q && typeof q.question === 'string' && Array.isArray(q.options))) return importLegacyQuestions(data);
    if (isRecordData(data)) return importRecords(data);
    throw new Error('不認得的檔案格式');
}
/* 匯入一份題庫；和內建題庫 id 相同時一律另存成新 id */
async function importBankData(input) {
    const err = validateBank(input);
    if (err) throw new Error(err);
    const data = JSON.parse(JSON.stringify(input));
    const { key, name } = data.bank;
    const used = keyNames().get(key);
    if (used && used !== name) throw new Error(`類別 key「${key}」已經用在「${used}」，一個 key 只能對應一個名稱。請改用其他 key 後再匯入。`);
    const n = data.questions.rows.length;
    let id = data.bank.id, renamed = false;
    const existing = banks[id];
    if (existing) {
        const old = bankData(id);
        if (sameContent(old, data)) return `「${name}」（${id}）已經存在，內容相同，沒有變更。`;
        const replace = !existing.builtin && confirm(`已經有題庫 ${id}（${diffCount(old, data)} 題不同）。\n按「確定」用檔案取代，按「取消」另存成新的題庫。`);
        if (!replace) { id = genBankId(key, id.split('-')[1]); data.bank.id = id; renamed = true; }
    }
    if (!existing) {
        // 同一個類別 key 下已經有內容相同的題庫時不重複匯入
        const twin = Object.keys(banks).find(other => banks[other].bank.key === key && sameContent(bankData(other), data));
        if (twin) return `「${name}」和既有題庫 ${twin} 內容相同，沒有匯入。`;
    }
    userBankData[id] = data;
    await saveUserData();
    await reloadBanks();
    await firstImportNotice();
    return `已匯入題庫「${name}」（${id}，${n} 題）` + (renamed ? `。原本的 id 已被使用，另存成新的 id。` : '');
}
/* 舊版 questions.json：依科目拆成多份題庫；和內建題庫題目相同的不匯入 */
async function importLegacyQuestions(list) {
    const groups = new Map();
    for (const q of list) {
        if (!groups.has(q.category)) groups.set(q.category, []);
        groups.get(q.category).push(q);
    }
    const msgs = [];
    for (const [name, qs] of groups) {
        const m = LEGACY_ID.exec(qs[0].id || '');
        if (!m) { msgs.push(`「${name}」：題目 id 不是舊版格式（例如 ETH-0001），沒有匯入`); continue; }
        const key = m[1];
        const builtin = Object.values(banks).find(b => b.builtin && b.bank.key === key && b.questions.length === qs.length
            && b.questions.every((x, i) => x.question === qs[i].question));
        if (builtin) { msgs.push(`「${name}」和內建題庫 ${builtin.bank.id} 的題目相同，不需要匯入`); continue; }
        const year = (prompt(`「${name}」的年份（西元年，未設定請填 0000）`, '0000') || '').trim();
        if (!/^\d{4}$/.test(year)) { msgs.push(`「${name}」：年份要是 4 位數字，沒有匯入`); continue; }
        const data = {
            format: BANK_FORMAT, version: 4,
            bank: { id: genBankId(key, year), key, name, year: year === '0000' ? null : Number(year), source: null, template: null },
            questions: toTable(['seq', 'num', 'question', 'options', 'answer'], qs.map((q, i) => ({ seq: i + 1, num: q.num ?? i + 1, question: q.question, options: q.options, answer: q.answer }))),
            corrections: toTable(['seq', 'field', 'from', 'to', 'note'], []),
        };
        try { msgs.push(await importBankData(data)); } catch (e) { msgs.push(`「${name}」：${e.message}`); }
    }
    return msgs.join('\n');
}
/* 作答紀錄檔（新舊格式）：和目前的紀錄合併 */
async function importRecords(data) {
    records = await loadRecords();
    const { added, total } = mergeInto(data);
    await saveRecordsNow();
    renderAll();
    return added ? `作答紀錄合併完成：新增 ${added} 筆，目前共 ${total} 筆。` : `作答紀錄合併完成：檔案裡的作答都已經存在（目前共 ${total} 筆）。`;
}
async function firstImportNotice() {
    if (meta.noticeShown) return;
    meta.noticeShown = true;
    await saveMeta();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
    alert('匯入的題庫只存在這個瀏覽器裡。清除瀏覽器資料、換電腦或換瀏覽器就會看不到，之後還想用的話，請記得用「完整備份」把題庫和作答紀錄一起匯出。');
}

/* ---------- 匯出、刪除 ---------- */
function exportBank(id) {
    const data = bankData(id);
    if (data) download(`${id}.quizbank.json`, JSON.stringify(data), 'application/json');
}
const hasRecord = r => r.history.length || r.review || r.noReview;
function recordCount(bankId) {
    return Object.entries(records.items).filter(([id, r]) => hasRecord(r) && (splitQid(id) || {}).bankId === bankId).length;
}
/* 刪除使用者匯入的題庫；作答紀錄可以保留，之後再匯入同一份題庫會自動接回 */
async function deleteBank(id, withRecords) {
    if (!userBankData[id]) return;
    delete userBankData[id];
    userCombos = userCombos.map(c => ({ ...c, banks: c.banks.filter(b => b !== id) })).filter(c => c.banks.length);
    await saveUserData();
    if (withRecords) {
        records = await loadRecords();
        for (const qidKey of Object.keys(records.items)) if ((splitQid(qidKey) || {}).bankId === id) delete records.items[qidKey];
        await saveRecordsNow();
    }
    await reloadBanks();
    renderAll();
}
async function onDeleteBank(id) {
    const { bank } = banks[id];
    if (!confirm(`確定要刪除題庫「${bank.name}」（${id}）嗎？`)) return;
    const n = recordCount(id);
    const withRecords = n > 0 && confirm(`這份題庫有 ${n} 題的作答紀錄。\n按「確定」一併刪除紀錄；按「取消」保留紀錄（之後再匯入同一份題庫會自動接回）。`);
    await deleteBank(id, withRecords);
    showResult(`已刪除題庫「${bank.name}」` + (n ? (withRecords ? `，也刪除了 ${n} 題的作答紀錄` : `，作答紀錄保留`) : ''));
}

/* ---------- 組合 ---------- */
const normText = s => s.replace(/\s+/g, '');
/* 不同題庫裡題目文字相同的題數；兩題都保留，只用來提示 */
function duplicateCount(bankIds) {
    const seen = new Map();
    let dup = 0;
    for (const id of bankIds) for (const q of banks[id].questions) {
        const k = normText(q.question);
        if (seen.has(k) && seen.get(k) !== id) dup++;
        else if (!seen.has(k)) seen.set(k, id);
    }
    return dup;
}
async function createCombo({ name, bankIds, exam }) {
    name = (name || '').trim();
    if (!name) throw new Error('請輸入組合名稱');
    bankIds = bankIds.filter(id => banks[id]);
    if (!bankIds.length) throw new Error('請至少勾選一份題庫');
    const combo = { id: `combo-${randomCode()}`, name, banks: bankIds, exam };
    userCombos.push(combo);
    await saveUserData();
    const dup = duplicateCount(bankIds);
    return { combo, message: `已建立組合「${name}」（${bankIds.length} 份題庫）` + (dup ? `。有 ${dup} 題和其他題庫的題目文字相同，兩題都保留。` : '') };
}
async function deleteCombo(id) {
    userCombos = userCombos.filter(c => c.id !== id);
    await saveUserData();
    renderAll();
}

/* ---------- 完整備份與還原 ---------- */
async function buildBackup() {
    records = await loadRecords();
    return { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), banks: Object.values(userBankData), combos: userCombos, templates: userTemplates, builtinCorrections, records: packRecords() };
}
async function createBackup() {
    const data = await buildBackup();
    download(`quiz-backup-${stamp()}.json`, JSON.stringify(data), 'application/json');
    meta.lastBackupAt = data.createdAt;
    await saveMeta();
    renderBackupStatus();
    return data;
}
async function restoreBackup(data) {
    const msgs = [];
    for (const b of data.banks || []) {
        try { msgs.push(await importBankData(b)); } catch (e) { msgs.push(`題庫 ${b.bank && b.bank.id}：${e.message}`); }
    }
    let combos = 0;
    for (const c of data.combos || []) {
        if (!c || !c.id || !c.name || !Array.isArray(c.banks)) continue;
        const i = userCombos.findIndex(x => x.id === c.id);
        if (i >= 0) userCombos[i] = c; else userCombos.push(c);
        combos++;
    }
    if (combos) { await saveUserData(); msgs.push(`組合：還原 ${combos} 個`); }
    for (const t of data.templates || []) {
        try { msgs.push(await importTemplate(t, { restore: true })); } catch (e) { msgs.push(`樣板 ${t && t.name}：${e.message}`); }
    }
    // 內建題庫的修正：以備份為準，逐題庫取代
    const fixes = Object.entries(data.builtinCorrections || {}).filter(([id, t]) => banks[id] && banks[id].builtin && t && Array.isArray(t.rows));
    if (fixes.length) {
        for (const [id, t] of fixes) builtinCorrections[id] = t;
        await idb('readwrite', s => s.put(builtinCorrections, BUILTIN_CORRECTIONS_KEY));
        notifyChanged('banks');
        msgs.push(`內建題庫的修正：還原 ${fixes.reduce((n, [, t]) => n + t.rows.length, 0)} 筆`);
    }
    if (data.records) msgs.push(await importRecords(data.records));
    await reloadBanks();
    renderAll();
    return msgs.join('\n');
}

/* ---------- 畫面 ---------- */
function showResult(text) { $('m-result').textContent = text; }
function renderBackupStatus() {
    const userBanks = Object.keys(userBankData).length;
    const box = $('m-backup-status');
    const last = meta.lastBackupAt ? Date.parse(meta.lastBackupAt) : null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const lastText = last ? `上次完整備份：${days === 0 ? '今天' : `${days} 天前`}（${new Date(last).toLocaleString()}）` : '還沒有完整備份';
    box.textContent = `匯入的題庫 ${userBanks} 份、自建組合 ${userCombos.length} 個 ・ ${lastText}`;
    box.classList.toggle('warn', (userBanks > 0 || userCombos.length > 0) && (days === null || days > BACKUP_REMIND_DAYS));
}
function renderBanks() {
    const box = $('m-banks');
    box.innerHTML = '';
    const list = Object.values(banks).sort((a, b) => (b.builtin - a.builtin));
    for (const { bank, questions, builtin } of list) {
        const row = el('div', 'item-row');
        const main = el('div', 'item-main');
        main.append(el('div', 'item-title', `${bank.name}（${bank.key} ・ ${bank.year || '未設定年份'}）`),
            el('div', 'item-sub', `${bank.id} ・ ${questions.length} 題 ・ 有作答紀錄 ${recordCount(bank.id)} 題 ・ ${builtin ? '內建' : '匯入'}${bank.source ? ` ・ 來源 ${bank.source}` : ''}`));
        const fix = el('button', 'btn light small', '修正題目');
        fix.onclick = () => openCorrection(bank.id);
        const exp = el('button', 'btn light small', '匯出');
        exp.onclick = () => exportBank(bank.id);
        row.append(main, fix, exp);
        if (!builtin) {
            const del = el('button', 'btn light small', '刪除');
            del.onclick = () => onDeleteBank(bank.id);
            row.append(del);
        }
        box.appendChild(row);
    }
}
function renderCombos() {
    const box = $('m-combos');
    box.innerHTML = '';
    for (const c of sourceList().filter(s => s.bankIds.length && !s.id.match(BANK_ID))) {
        const row = el('div', 'item-row');
        const main = el('div', 'item-main');
        const names = c.bankIds.map(id => banks[id].bank.name).join(' + ');
        const ex = c.exam || {};
        main.append(el('div', 'item-title', c.name),
            el('div', 'item-sub', `${names} ・ 模擬考各科 ${ex.perCategory ?? 50} 題、${ex.pass ?? 70} 分及格${ex.minutes ? `、${ex.minutes} 分鐘` : ''} ・ ${c.builtin ? '內建' : '自建'}`));
        row.append(main);
        if (!c.builtin) {
            const del = el('button', 'btn light small', '刪除');
            del.onclick = () => { if (confirm(`確定要刪除組合「${c.name}」嗎？題庫和作答紀錄不受影響。`)) deleteCombo(c.id); };
            row.append(del);
        }
        box.appendChild(row);
    }
    const picks = $('c-banks');
    picks.innerHTML = '';
    for (const { bank } of Object.values(banks)) {
        const label = el('label', 'check');
        const box2 = Object.assign(el('input'), { type: 'checkbox', value: bank.id });
        label.append(box2, document.createTextNode(` ${bank.name}（${bank.year || '未設定年份'}）`));
        picks.appendChild(label);
    }
}
function renderOrphans() {
    const known = new Set(Object.values(banks).flatMap(b => b.questions.map(q => q.id)));
    const ids = Object.entries(records.items).filter(([id, r]) => hasRecord(r) && !known.has(id)).map(([id]) => id);
    $('m-orphans-card').hidden = !ids.length;
    $('m-orphans').textContent = ids.length ? `共 ${ids.length} 題：${ids.slice(0, 30).join('、')}${ids.length > 30 ? '…' : ''}` : '';
}
function renderConflicts() {
    const box = $('m-conflicts');
    box.hidden = !correctionConflicts.length;
    box.textContent = correctionConflicts.length
        ? `內建題庫更新後，有 ${correctionConflicts.length} 處和你的修正對不上，目前沿用你的修正：` + correctionConflicts.map(c => `${c.bankId} 流水號 ${c.seq}（${c.field}）`).join('、')
        : '';
}
function renderAll() {
    renderBackupStatus();
    renderConflicts();
    renderBanks();
    renderCombos();
    renderOrphans();
    renderTemplates();
}

async function init() {
    await reloadAll();
    initPdf();
    initTemplates();
    $('m-backup').onclick = () => createBackup().then(() => showResult('已下載完整備份。'));
    $('m-import').onclick = () => $('m-import-file').click();
    $('m-import-file').onchange = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try { showResult(await importData(JSON.parse(await file.text()))); }
        catch (err) { showResult(`匯入失敗：${err.message}`); }
        renderAll();
    };
    $('c-create').onclick = async () => {
        const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v >= 0 ? v : d; };
        try {
            const { message } = await createCombo({
                name: $('c-name').value,
                bankIds: [...document.querySelectorAll('#c-banks input:checked')].map(i => i.value),
                exam: { perCategory: num('c-per', 50), pass: num('c-pass', 70), minutes: num('c-minutes', 60) },
            });
            $('c-name').value = '';
            showResult(message);
        } catch (err) { showResult(err.message); }
        renderAll();
    };
    onDataChanged(async kind => {
        if (kind === 'records') { records = await loadRecords(); renderAll(); }
        else if (kind === 'templates') { await loadTemplates(); refreshRanking(); renderTemplates(); }
        else await reloadAll();
    });
}

window.onload = init;
