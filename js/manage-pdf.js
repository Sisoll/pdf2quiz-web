/* 題庫管理：從 PDF 建立題庫、修正題目（在 manage.js 之後載入） */
let pdfWork = null;   // 目前正在建立的題庫：{ source, lines, ranked, chosen, questions, corrections }

/* ---------- 題目編輯器：題目文字、選項（一行一個）、答案 ---------- */
function questionEditor(q, onSave, onCancel) {
    const box = el('div', 'qitem');
    const qText = Object.assign(el('textarea', 'q-edit'), { rows: 3, value: q.question || '' });
    const oText = Object.assign(el('textarea', 'q-edit'), { rows: Math.max(4, (q.options || []).length), value: (q.options || []).join('\n') });
    const ans = Object.assign(el('input'), { type: 'number', min: 1, value: q.answer || 1 });
    const msg = el('div', 'manage-result');
    const save = el('button', 'btn small', '儲存修正');
    const cancel = el('button', 'btn light small', '取消');
    save.onclick = () => {
        const next = { question: qText.value.trim(), options: oText.value.split('\n').map(s => s.trim()).filter(Boolean), answer: parseInt(ans.value, 10) };
        if (!next.question) { msg.textContent = '題目不能是空的'; return; }
        if (next.options.length < 2) { msg.textContent = '選項至少要兩個（一行一個）'; return; }
        if (!(next.answer >= 1 && next.answer <= next.options.length)) { msg.textContent = `答案要是 1～${next.options.length}`; return; }
        onSave(next);
    };
    cancel.onclick = onCancel;
    box.append(el('div', 'qhead', `第 ${q.num ?? q.seq} 題（流水號 ${q.seq ?? '新增'}）`),
        el('label', 'field', '題目'), qText, el('label', 'field', '選項（一行一個）'), oText,
        Object.assign(el('label', 'field', '答案（第幾個選項）'), {}), ans, el('div', 'footer-actions'), msg);
    box.querySelector('.footer-actions').append(save, cancel);
    return box;
}
/* 比較修正前後，列出改了哪些欄位 */
function correctionRows(seq, before, after, note = '') {
    return ['question', 'options', 'answer'].filter(f => !sameValue(before[f], after[f]))
        .map(f => ({ seq, field: f, from: before[f], to: after[f], note }));
}

/* ---------- 從 PDF 建立題庫 ---------- */
const allTemplates = () => [...BUILTIN_TEMPLATES, ...userTemplates];   // userTemplates 在 manage-template.js
/* 從檔名猜名稱與年份：「職業道德-113.pdf」→ 職業道德、2024（3 位數視為民國年） */
function guessFromFileName(name) {
    const stem = name.replace(/\.[^.]+$/, '');
    const m = stem.match(/(\d{3,4})(?!.*\d)/);
    let year = '';
    if (m) year = m[1].length === 3 ? String(Number(m[1]) + 1911) : m[1];
    return { name: stem.replace(/[-_\s]*\d{3,4}[^\d]*$/, '').trim() || stem, year };
}
async function startPdfWork(source, lines) {
    if (!lines.length) throw new Error('取不到任何文字，可能是掃描檔（只有圖片）。目前不支援掃描檔。');
    const ranked = rankTemplates(lines, allTemplates());
    pdfWork = { source, lines, ranked, chosen: 0, questions: [], corrections: [] };
    chooseTemplate(0);
    const g = guessFromFileName(source.name);
    $('p-name').value = g.name;
    $('p-year').value = g.year;
    $('p-key').value = '';
    onKeyInput();
    resetTemplateBuilder();
    $('p-work').hidden = false;
    return pdfWork;
}
function chooseTemplate(i) {
    pdfWork.chosen = i;
    const r = pdfWork.ranked[i].result;
    pdfWork.questions = r.questions.map(q => ({ ...q, options: [...q.options] }));
    pdfWork.corrections = [];
    r.problems.forEach(p => { delete p.fixed; });   // 換樣板時重來，手動整理的題目不保留
    renderPdfWork();
}
function renderPdfWork() {
    const w = pdfWork;
    const r = w.ranked[w.chosen].result;
    $('p-source').textContent = `${w.source.name}${w.source.pages ? `：${w.source.pages} 頁` : ''}、${w.lines.length} 行文字`;
    $('p-template').innerHTML = w.ranked.map((x, i) => `<option value="${i}">${x.template.name}${x.template.builtin ? '' : '（自建）'}（解析 ${x.result.questions.length} 題、失敗 ${x.result.problems.length} 段）</option>`).join('');
    $('p-template').value = String(w.chosen);
    const added = w.corrections.filter(c => c.field === 'manual').length;
    const left = r.problems.filter(p => !p.fixed).length;
    const summary = [`解析出 ${w.questions.length} 題${added ? `（含手動整理 ${added} 題）` : ''}，無法解析 ${left} 段`, ...r.checks];
    const edited = w.corrections.length - added;
    if (edited) summary.push(`已手動修正 ${edited} 處`);
    $('p-summary').textContent = summary.join('\n');
    $('p-summary').classList.toggle('warn', !w.questions.length || left > 0);
    // 無法解析的段落：可以手動整理成題目
    const pbox = $('p-problems');
    pbox.innerHTML = '';
    for (const p of r.problems) {
        if (p.fixed) continue;
        const row = el('div', 'item-row');
        const main = el('div', 'item-main');
        main.append(el('div', 'item-title', `題號 ${p.num ?? '？'}：${p.reason}`), el('div', 'item-sub', p.text.slice(0, 160) + (p.text.length > 160 ? '…' : '')));
        const btn = el('button', 'btn light small', '手動整理成題目');
        btn.onclick = () => {
            const draft = { seq: null, num: p.num, question: p.text, options: [], answer: 1 };
            row.replaceWith(questionEditor(draft, next => {
                const seq = w.questions.length ? Math.max(...w.questions.map(q => q.seq)) + 1 : 1;
                w.questions.push({ seq, num: p.num ?? seq, ...next });
                w.corrections.push({ seq, field: 'manual', from: null, to: next, note: `手動整理無法解析的段落（${p.reason}）` });
                p.fixed = true;
                renderPdfWork();
            }, renderPdfWork));
        };
        row.append(main, btn);
        pbox.appendChild(row);
    }
    renderPdfPreview();
}
function renderPdfPreview() {
    const w = pdfWork;
    const box = $('p-preview');
    box.innerHTML = '';
    const from = Math.max(1, parseInt($('p-jump').value, 10) || 1);
    const list = w.questions.filter(q => q.num >= from).slice(0, 10);
    for (const q of list) box.appendChild(previewCard(q, next => {
        w.corrections.push(...correctionRows(q.seq, q, next));
        Object.assign(q, next);
        renderPdfWork();
    }));
    if (!list.length) box.appendChild(el('div', 'empty', '沒有題目'));
}
function previewCard(q, onSave) {
    const card = el('div', 'qitem');
    const head = el('div', 'qhead');
    head.append(el('span', 'num', `第 ${q.num} 題`), el('span', 'hint-inline', `流水號 ${q.seq} ・ 答案 (${q.answer})`));
    const edit = el('button', 'linkbtn', '修正');
    edit.onclick = () => card.replaceWith(questionEditor(q, onSave, () => card.replaceWith(previewCard(q, onSave))));
    head.append(edit);
    const opts = el('ol', 'qopts');
    q.options.forEach((o, i) => { const li = el('li', i + 1 === q.answer ? 'ans' : '', `(${i + 1}) ${o}`); opts.appendChild(li); });
    card.append(head, el('div', 'qtext', q.question), opts);
    card.classList.add('show');
    return card;
}
/* 一個 key 只對應一個名稱：輸入已存在的 key 時帶入名稱且不能改 */
function onKeyInput() {
    const k = $('p-key');
    k.value = k.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const used = keyNames().get(k.value);
    if (used) $('p-name').value = used;
    $('p-name').readOnly = !!used;
    $('p-key-hint').textContent = used ? `「${k.value}」已經用在「${used}」，名稱沿用` : '3～6 個大寫英文或數字，代表類別';
}
/* 建立前的檢查，和既有題庫幾乎一樣時先確認 */
async function createBankFromPdf() {
    const w = pdfWork;
    const key = $('p-key').value.trim(), name = $('p-name').value.trim();
    let year = $('p-year').value.trim();
    if (!/^[A-Z0-9]{3,6}$/.test(key)) throw new Error('類別 key 要 3～6 個大寫英文或數字');
    if (!name) throw new Error('請輸入題庫名稱');
    if (/^\d{3}$/.test(year)) year = String(Number(year) + 1911);   // 民國年
    if (year === '') year = '0000';
    if (!/^\d{4}$/.test(year)) throw new Error('年份要是 4 位數的西元年，未設定請留空');
    if (!w.questions.length) throw new Error('沒有任何題目');
    if (w.questions.length > 9999) throw new Error('題目超過 9999 題，請拆成多份 PDF');
    const norm = s => s.replace(/\s+/g, '');
    const near = Object.values(banks).find(b => b.bank.key === key && b.questions.length === w.questions.length
        && b.questions.every((x, i) => norm(x.question) === norm(w.questions[i].question)));
    if (near && !confirm(`這份題庫的題目和既有題庫「${near.bank.name}」（${near.bank.id}）相同。仍要另外建立一份嗎？`)) return '沒有建立。';
    const data = {
        format: BANK_FORMAT, version: 4,
        bank: { id: genBankId(key, year), key, name, year: year === '0000' ? null : Number(year), source: w.source.name, template: w.ranked[w.chosen].template.id },
        questions: toTable(['seq', 'num', 'question', 'options', 'answer'], [...w.questions].sort((a, b) => a.seq - b.seq)),
        corrections: toTable(CORRECTION_COLUMNS, w.corrections),
    };
    const msg = await importData(data);
    if (/^已匯入/.test(msg)) { pdfWork = null; $('p-work').hidden = true; }
    return msg;
}

/* ---------- 修正既有題庫的題目（內建題庫的修正存在使用者資料裡；不重新判定過去的作答） ---------- */
async function correctQuestion(bankId, seq, next, note = '') {
    const entry = banks[bankId];
    const q = entry && entry.questions.find(x => x.seq === seq);
    if (!q) throw new Error('找不到這一題');
    const rows = correctionRows(seq, q, next, note);
    if (!rows.length) return '沒有變更。';
    if (entry.builtin) {
        const t = builtinCorrections[bankId] || { columns: CORRECTION_COLUMNS, rows: [] };
        t.rows.push(...rows.map(r => CORRECTION_COLUMNS.map(c => r[c] ?? null)));
        builtinCorrections[bankId] = t;
        try { await idb('readwrite', s => s.put(builtinCorrections, BUILTIN_CORRECTIONS_KEY)); }
        catch (e) { alert(`這個瀏覽器無法儲存修正（${e.message}）。`); throw e; }
        notifyChanged('banks');
    } else {
        const data = userBankData[bankId];
        const cols = data.questions.columns;
        const row = data.questions.rows.find(r => r[cols.indexOf('seq')] === seq);
        for (const r of rows) row[cols.indexOf(r.field)] = r.to;
        data.corrections = data.corrections && data.corrections.columns ? data.corrections : { columns: CORRECTION_COLUMNS, rows: [] };
        data.corrections.rows.push(...rows.map(r => data.corrections.columns.map(c => r[c] ?? null)));
        await saveUserData();
    }
    await reloadBanks();
    renderAll();
    return `已修正第 ${q.num} 題（${rows.map(r => ({ question: '題目', options: '選項', answer: '答案' })[r.field]).join('、')}）。過去的作答維持當時的判定。`;
}
function openCorrection(bankId) {
    const box = $('m-correct');
    box.innerHTML = '';
    const { bank } = banks[bankId];
    const input = Object.assign(el('input'), { type: 'number', min: 1, placeholder: '題號' });
    const go = el('button', 'btn small', '開啟');
    const area = el('div');
    const head = el('div', 'controls');
    head.append(el('div', 'item-title', `修正「${bank.name}」的題目`), input, go);
    go.onclick = () => {
        const n = parseInt(input.value, 10);
        const q = banks[bankId].questions.find(x => x.num === n) || banks[bankId].questions.find(x => x.seq === n);
        area.innerHTML = '';
        if (!q) { area.appendChild(el('div', 'manage-result', '找不到這一題')); return; }
        area.appendChild(questionEditor(q, async next => {
            try { showResult(await correctQuestion(bankId, q.seq, next)); } catch (e) { showResult(e.message); }
            box.innerHTML = '';
        }, () => { box.innerHTML = ''; }));
    };
    box.append(head, area);
    box.scrollIntoView({ block: 'nearest' });
}

function initPdf() {
    $('p-pdf').onclick = () => $('p-pdf-file').click();
    $('p-text').onclick = () => $('p-text-file').click();
    $('p-pdf-file').onchange = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            showPdfResult('讀取中…');
            const { pages, lines } = await extractPdfLines(await file.arrayBuffer());
            await startPdfWork({ name: file.name, pages }, lines);
            showPdfResult('');
        } catch (err) {
            showPdfResult(/pdf\.js|載入/.test(err.message) ? `這個瀏覽器無法讀取 PDF（${err.message}），這個功能目前無法使用。` : `無法讀取 PDF：${err.message}`);
        }
    };
    $('p-text-file').onchange = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try { await startPdfWork({ name: file.name, pages: null }, textFileLines(await file.text())); showPdfResult(''); }
        catch (err) { showPdfResult(err.message); }
    };
    $('p-template').onchange = () => chooseTemplate(Number($('p-template').value));
    $('p-jump').oninput = () => pdfWork && renderPdfPreview();
    $('p-key').oninput = onKeyInput;
    $('p-create').onclick = async () => {
        try { showPdfResult(await createBankFromPdf()); } catch (err) { showPdfResult(err.message); }
    };
}
function showPdfResult(text) { $('p-result').textContent = text; }
