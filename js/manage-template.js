/* 題庫管理：標記範例建立樣板、樣板清單與匯入匯出（在 manage-pdf.js 之後載入） */
const USER_TEMPLATES_KEY = 'userTemplates';   // IndexedDB：使用者建立的樣板 [樣板設定]
const TEMPLATE_FORMAT = 'pdf2quiz-template';
const MARK_LABELS = { num: '題號', option: '選項', answer: '答案', ignore: '忽略' };
const SHOWN_LINES = 40;
let userTemplates = [];
let tplMarks = [];     // 目前在取出的文字上做的標記 [{ kind, line, start, end }]
let tplDraft = null;   // 最近一次推出的結果 { template, samples }

/* ---------- 讀取與儲存 ---------- */
async function loadTemplates() {
    try { userTemplates = (await idb('readonly', s => s.get(USER_TEMPLATES_KEY))) || []; } catch { userTemplates = []; }
}
async function saveTemplates() {
    try { await idb('readwrite', s => s.put(userTemplates, USER_TEMPLATES_KEY)); }
    catch (e) { alert(`這個瀏覽器無法儲存樣板（${e.message}），樣板管理無法使用。`); throw e; }
    notifyChanged('templates');
}
const newTemplateId = () => { let id; do id = `user-${randomCode()}`; while (allTemplates().some(t => t.id === id)); return id; };
const templateJson = t => { const { builtin, ...rest } = t; return JSON.stringify(rest); };
/* 樣板變了：重新排序正在建立的題庫可用的樣板；selectId 指定時改用那個樣板 */
function refreshRanking(selectId) {
    if (!pdfWork) return;
    const cur = selectId || pdfWork.ranked[pdfWork.chosen].template.id;
    pdfWork.ranked = rankTemplates(pdfWork.lines, allTemplates());
    const i = pdfWork.ranked.findIndex(x => x.template.id === cur);
    if (selectId || i < 0) chooseTemplate(Math.max(0, i));
    else { pdfWork.chosen = i; renderPdfWork(); }
}

/* ---------- 匯入、匯出、刪除 ---------- */
/* 和內建樣板 id 相同時另存成新 id；和自建樣板相同時詢問取代或另存（還原備份時直接取代） */
async function importTemplate(input, { restore = false } = {}) {
    const err = validateTemplate(input);
    if (err) throw new Error(err);
    const t = JSON.parse(templateJson(input));
    let renamed = false;
    if (BUILTIN_TEMPLATES.some(b => b.id === t.id)) { t.id = newTemplateId(); renamed = true; }
    const i = userTemplates.findIndex(x => x.id === t.id);
    if (i >= 0) {
        if (templateJson(userTemplates[i]) === templateJson(t)) return `樣板「${t.name}」已經存在，內容相同，沒有變更。`;
        if (restore || confirm(`已經有樣板 ${t.id}（${userTemplates[i].name}）。\n按「確定」用檔案取代，按「取消」另存成新的樣板。`)) userTemplates[i] = t;
        else { t.id = newTemplateId(); renamed = true; userTemplates.push(t); }
    } else userTemplates.push(t);
    await saveTemplates();
    refreshRanking();
    renderTemplates();
    return `已匯入樣板「${t.name}」（${t.id}）` + (renamed ? '。原本的 id 已被使用，另存成新的 id。' : '');
}
function exportTemplate(id) {
    const t = allTemplates().find(x => x.id === id);
    if (!t) return;
    const data = { format: TEMPLATE_FORMAT, version: 1, template: JSON.parse(templateJson(t)) };
    download(`${t.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.template.json`, JSON.stringify(data, null, 2), 'application/json');
}
async function deleteTemplate(id) {
    userTemplates = userTemplates.filter(t => t.id !== id);
    await saveTemplates();
    refreshRanking();
    renderTemplates();
}

/* ---------- 標記範例 ---------- */
function resetTemplateBuilder() {
    tplMarks = [];
    tplDraft = null;
    $('t-from').value = 1;
    $('t-name').value = '';
    $('t-msg').hidden = true;
    $('t-result').hidden = true;
    renderMarkLines();
}
/* 新增一個標記；同一行重疊的標記不接受；忽略是整行，再標一次就取消 */
function addTemplateMark(kind, line, start, end) {
    if (!pdfWork || !(line >= 0 && line < pdfWork.lines.length)) return '請先選取文字';
    if (kind === 'ignore') {
        const i = tplMarks.findIndex(m => m.kind === 'ignore' && m.line === line);
        if (i >= 0) tplMarks.splice(i, 1);
        else tplMarks.push({ kind, line, start: 0, end: pdfWork.lines[line].length });
    } else {
        if (!(end > start)) return '請先用滑鼠選取要標記的文字';
        if (tplMarks.some(m => m.line === line && (m.kind === 'ignore' || (m.start < end && start < m.end)))) return '和這一行已有的標記重疊（或這一行已經標成忽略）';
        tplMarks.push({ kind, line, start, end });
    }
    renderMarkLines();
    return null;
}
/* 目前選取的文字在第幾行、哪個位置（只能選同一行） */
function selectedSpan() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const host = n => (n.nodeType === 1 ? n : n.parentElement).closest('.t-text');
    const a = host(range.startContainer), b = host(range.endContainer);
    if (!a || !$('t-lines').contains(a)) return null;
    if (a !== b) return { error: '一次只能選同一行的文字' };
    const pre = document.createRange();
    pre.selectNodeContents(a);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    return { line: Number(a.dataset.line), start, end: start + range.toString().length };
}
function onMarkButton(kind) {
    const span = selectedSpan();
    const msg = !span ? '請先在上面的文字裡選取要標記的部分' : span.error || addTemplateMark(kind, span.line, span.start, span.end);
    showTemplateMsg(msg || '', false);
    window.getSelection().removeAllRanges();
}
function renderMarkLines() {
    const box = $('t-lines');
    box.innerHTML = '';
    if (!pdfWork) return;
    const from = Math.max(1, parseInt($('t-from').value, 10) || 1) - 1;
    pdfWork.lines.slice(from, from + SHOWN_LINES).forEach((text, k) => {
        const i = from + k;
        const marks = tplMarks.filter(m => m.line === i).sort((a, b) => a.start - b.start);
        const row = el('div', 't-line' + (marks.some(m => m.kind === 'ignore') ? ' t-ignored' : ''));
        const body = el('span', 't-text');
        body.dataset.line = i;
        let at = 0;
        for (const m of marks.filter(x => x.kind !== 'ignore')) {
            body.append(document.createTextNode(text.slice(at, m.start)), Object.assign(el('mark', `mk-${m.kind}`, text.slice(m.start, m.end)), { title: MARK_LABELS[m.kind] }));
            at = m.end;
        }
        body.append(document.createTextNode(text.slice(at)));
        row.append(el('span', 't-ln', String(i + 1)), body);
        box.appendChild(row);
    });
    const nums = tplMarks.filter(m => m.kind === 'num').length;
    const count = k => tplMarks.filter(m => m.kind === k).length;
    $('t-marks').textContent = tplMarks.length
        ? `已標記：題號 ${nums} 個、選項 ${count('option')} 個、答案 ${count('answer')} 個、忽略 ${count('ignore')} 行` + (nums < 2 ? '。至少要標 2 題，最好再多標幾題' : '')
        : '還沒有標記';
}
function showTemplateMsg(text, warn = true) {
    $('t-msg').hidden = !text;
    $('t-msg').textContent = text;
    $('t-msg').classList.toggle('warn', warn);
}
/* 推出樣板，套回範例檢查，結果顯示在可修改的設定裡 */
function inferFromMarks() {
    const name = $('t-name').value.trim() || '自訂樣板';
    const r = inferTemplate(pdfWork.lines, tplMarks, { name, id: 'user-new' });
    if (r.errors.length) { tplDraft = null; $('t-result').hidden = true; showTemplateMsg(r.errors.join('\n')); return r; }
    tplDraft = r;
    $('t-json').value = JSON.stringify(r.template, null, 2);
    $('t-result').hidden = false;
    const bad = verifyTemplate(pdfWork.lines, r.template, r.samples);
    const all = parseWithTemplate(pdfWork.lines, r.template);
    const lines = bad.length ? ['推出的樣板套回範例時結果不一致：', ...bad] : [`推出的樣板套回範例，結果和標記一致。套用到整份文字：解析出 ${all.questions.length} 題、無法解析 ${all.problems.length} 段。`];
    if (typeof r.template.options.count === 'number') lines.push(`範例都是 ${r.template.options.count} 個選項，樣板固定 ${r.template.options.count} 個；選項數不一定時，把 options.count 改成 "auto" 或多標幾題選項數不同的範例。`);
    showTemplateMsg(lines.join('\n'), bad.length > 0);
    return r;
}
/* 儲存設定裡的樣板：格式要正確，而且套回範例要和標記一致 */
async function saveDraftTemplate() {
    let t;
    try { t = JSON.parse($('t-json').value); } catch (e) { throw new Error(`樣板設定不是正確的 JSON：${e.message}`); }
    const err = validateTemplate(t);
    if (err) throw new Error(err);
    if (tplDraft) {
        const bad = verifyTemplate(pdfWork.lines, t, tplDraft.samples);
        if (bad.length) throw new Error(['樣板套回範例時結果不一致，沒有儲存：', ...bad].join('\n'));
    }
    if (t.id === 'user-new' || allTemplates().some(x => x.id === t.id)) t.id = newTemplateId();
    userTemplates.push(t);
    await saveTemplates();
    refreshRanking(t.id);
    renderTemplates();
    resetTemplateBuilder();
    $('t-builder').open = false;
    return `已儲存樣板「${t.name}」，並用它重新拆題。`;
}

/* ---------- 樣板清單 ---------- */
function renderTemplates() {
    const box = $('t-list');
    box.innerHTML = '';
    for (const t of allTemplates()) {
        const row = el('div', 'item-row');
        const main = el('div', 'item-main');
        main.append(titleLine(t.name, pill(t.builtin ? '內建' : '自建', t.builtin ? 'builtin' : 'user')), el('div', 'item-sub', t.id));
        if (t.example) main.append(el('code', 'item-example', t.example));
        const exp = el('button', 'btn light small', '匯出');
        exp.onclick = () => exportTemplate(t.id);
        const actions = el('div', 'item-actions');
        actions.append(exp);
        if (!t.builtin) {
            const edit = el('button', 'btn light small', '修改');
            edit.onclick = () => openTemplateEditor(t.id);
            const del = el('button', 'btn light small', '刪除');
            del.onclick = () => { if (confirm(`確定要刪除樣板「${t.name}」嗎？已經建立的題庫不受影響。`)) deleteTemplate(t.id); };
            actions.append(edit, del);
        }
        row.append(rowIcon('📐', 'emoji'), main, actions);
        box.appendChild(row);
    }
}
/* 直接修改自建樣板的設定（id 不能改） */
function openTemplateEditor(id) {
    const box = $('t-edit');
    box.innerHTML = '';
    const t = userTemplates.find(x => x.id === id);
    const area = Object.assign(el('textarea', 'q-edit t-json'), { rows: 14, value: JSON.stringify(t, null, 2) });
    const msg = el('div', 'manage-result');
    const save = el('button', 'btn small', '儲存');
    const cancel = el('button', 'btn light small', '取消');
    save.onclick = async () => {
        let next;
        try { next = JSON.parse(area.value); } catch (e) { msg.textContent = `不是正確的 JSON：${e.message}`; return; }
        next.id = id;
        const err = validateTemplate(next);
        if (err) { msg.textContent = err; return; }
        userTemplates[userTemplates.findIndex(x => x.id === id)] = next;
        await saveTemplates();
        refreshRanking();
        renderTemplates();
        box.innerHTML = '';
        showResult(`已修改樣板「${next.name}」。`);
    };
    cancel.onclick = () => { box.innerHTML = ''; };
    const actions = el('div', 'footer-actions');
    actions.append(save, cancel);
    box.append(el('div', 'item-title', `修改樣板「${t.name}」（${id}）`), area, actions, msg);
}

function initTemplates() {
    for (const kind of Object.keys(MARK_LABELS)) {
        const b = $(`t-${kind}`);
        b.onmousedown = e => e.preventDefault();   // 按按鈕時不要取消選取
        b.onclick = () => onMarkButton(kind);
    }
    $('t-undo').onclick = () => { tplMarks.pop(); renderMarkLines(); };
    $('t-clear').onclick = () => { if (!tplMarks.length || confirm('確定要清除所有標記嗎？')) { tplMarks = []; renderMarkLines(); } };
    $('t-from').oninput = renderMarkLines;
    $('t-infer').onclick = inferFromMarks;
    $('t-save').onclick = async () => {
        try { showPdfResult(await saveDraftTemplate()); } catch (err) { showTemplateMsg(err.message); }
    };
    renderTemplates();
}
