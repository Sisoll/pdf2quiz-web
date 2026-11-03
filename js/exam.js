/* 模擬考：各科隨機抽題（不加權；或依抽題範圍的篩選條件與順序）、限時、作答中不顯示答案，交卷後評分 */
let exam = null;          // 考試中：{ items: [{ q, pick }], idx, startedAt, endsAt, timer, cfg }
let examResult = null;    // 最近一次交卷的結果，給結果頁用
let examReviewWrongOnly = false;

function examCategories() { return [...new Set(allQuestions.map(q => q.category))]; }

/* 依抽題方式，某一科可以抽的題目 */
function examPool(cat) {
    const all = allQuestions.filter(q => q.category === cat);
    return settings.examPick === 'filter' ? all.filter(matches) : all;
}
/* 各科題數的輸入框；預設值來自選用組合的模擬考設定。onlyLabels：只更新題數說明，保留已輸入的題數 */
function renderExamCounts(onlyLabels = false) {
    const box = $('x-counts');
    const labelText = cat => {
        const total = allQuestions.filter(q => q.category === cat).length;
        return settings.examPick === 'filter' ? `${cat}（符合 ${examPool(cat).length} ／ 共 ${total} 題）` : `${cat}（共 ${total} 題）`;
    };
    if (onlyLabels) {
        box.querySelectorAll('input').forEach(i => { i.parentNode.firstChild.textContent = labelText(i.dataset.cat); });
        return;
    }
    const cfg = (currentSource && currentSource.exam) || {};
    box.innerHTML = '';
    for (const cat of examCategories()) {
        const total = allQuestions.filter(q => q.category === cat).length;
        const label = el('label', null, labelText(cat));
        const input = Object.assign(el('input'), { type: 'number', min: 0, max: total, value: Math.min(cfg.perCategory ?? 50, total) });
        input.dataset.cat = cat;
        label.appendChild(input);
        box.appendChild(label);
    }
    if (cfg.pass !== undefined) $('x-pass').value = cfg.pass;
    if (cfg.minutes !== undefined) $('x-time').value = cfg.minutes;
}

function initExam() {
    renderExamCounts();
    $('x-pick').value = settings.examPick;
    $('x-pick').onchange = e => { settings.examPick = e.target.value; saveSettings(); syncSetup(); renderStats(); renderExamCounts(true); };
    $('x-start').onclick = startExam;
    $('x-submit').onclick = () => submitExam(false);
    $('x-prev').onclick = () => examGo(exam && exam.idx - 1);
    $('x-next').onclick = () => examGo(exam && exam.idx + 1);
    $('x-back').onclick = showExamSetup;
    $('x-wrong-only').onchange = e => { examReviewWrongOnly = e.target.checked; renderExamReview(); };
    renderExamHistory();
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function startExam() {
    const counts = [...document.querySelectorAll('#x-counts input')].map(i => ({ cat: i.dataset.cat, n: Math.max(0, parseInt(i.value, 10) || 0) }));
    const items = [];
    for (const { cat, n } of counts) {
        // 依抽題範圍：照「順序」設定決定先抽哪些（弱點加權時，1 小時內答過的最後才抽）
        const pool = settings.examPick === 'filter' ? orderQuestions(examPool(cat)) : shuffle(examPool(cat));
        // 同一科的題目依題號排，像正式考卷
        pool.slice(0, n).sort((a, b) => a.num - b.num).forEach(q => items.push({ q, pick: null }));
    }
    if (!items.length) { alert(settings.examPick === 'filter' ? '沒有符合抽題範圍的題目，請調整條件或題數' : '請至少設定一科的題數'); return; }
    const minutes = Math.max(0, parseFloat($('x-time').value) || 0);
    const cfg = { minutes, pass: Math.max(0, parseFloat($('x-pass').value) || 0), record: $('x-record').checked, counts };
    exam = { items, idx: 0, startedAt: Date.now(), endsAt: minutes ? Date.now() + minutes * 60000 : null, timer: null, cfg };
    exam.timer = setInterval(tickExam, 1000);
    $('x-timebar').hidden = !exam.endsAt;   // 不限時間就只顯示已用時間
    $('exam-setup').hidden = true;
    $('exam-result').hidden = true;
    $('exam-run').hidden = false;
    syncSetup();
    buildExamGrid();
    tickExam();
    renderExamQuestion();
    $('exam').scrollIntoView({ block: 'start' });   // 開始後畫面以題目為主，不用自己往下捲
}

function tickExam() {
    if (!exam) return;
    const used = Date.now() - exam.startedAt;
    if (exam.endsAt) {
        const left = exam.endsAt - Date.now();
        // 剩餘時間條：由滿到空；剩 25% 變橘色，剩 5 分鐘或 10%（取較短的）變紅色，所以一定先橘後紅
        const total = exam.endsAt - exam.startedAt;
        const ratio = Math.max(0, left / total);
        const warn = left < Math.min(5 * 60000, total * 0.1);
        const bar = $('x-timebar');
        bar.firstChild.style.width = (ratio * 100).toFixed(2) + '%';
        bar.classList.toggle('low', ratio < 0.25);
        bar.classList.toggle('warn', warn);
        // 數字寬度以考試總時間的位數為準，倒數過程中不會左右跳動
        const w = clockText(exam.endsAt - exam.startedAt).length;
        $('x-timer').innerHTML = `剩餘 ${fixNum(clockText(Math.ceil(Math.max(0, left) / 1000) * 1000), w)}<span class="x-used">已用 ${fixNum(clockText(used), w)}</span>`;
        $('x-timer').classList.toggle('warn', warn);
        if (left <= 0) return submitExam(true);
    } else {
        $('x-timer').innerHTML = `已用 ${fixNum(clockText(used), 6)}`;   // 不限時間：預留到 3 位數分鐘
    }
}

function buildExamGrid() {
    const grid = $('x-grid');
    grid.innerHTML = '';
    let lastCat = null;
    exam.items.forEach((it, i) => {
        if (it.q.category !== lastCat) {
            grid.appendChild(el('div', 'x-grid-title', it.q.category));
            lastCat = it.q.category;
        }
        const b = el('button', 'x-cell', String(i + 1));
        b.type = 'button';
        b.title = `第 ${i + 1} 題（題庫第 ${it.q.num} 題）`;
        b.onclick = () => examGo(i);
        grid.appendChild(b);
    });
}

function renderExamGrid() {
    document.querySelectorAll('#x-grid .x-cell').forEach((b, i) => {
        b.classList.toggle('done', exam.items[i].pick !== null);
        b.classList.toggle('cur', i === exam.idx);
    });
    const done = exam.items.filter(it => it.pick !== null).length;
    $('x-progress').innerHTML = `<span>已作答 ${fixNum(done, String(exam.items.length).length)} / ${exam.items.length}</span><span class="x-progress-bar"><span style="width:${(done / exam.items.length * 100).toFixed(1)}%"></span></span>`;
}

function renderExamQuestion() {
    const it = exam.items[exam.idx];
    $('x-cat').textContent = it.q.category;
    $('x-num').textContent = `第 ${exam.idx + 1} / ${exam.items.length} 題`;
    $('x-question').textContent = it.q.question;
    const box = $('x-options');
    box.innerHTML = '';
    it.q.options.forEach((opt, i) => {
        const b = el('button', 'option-btn' + (it.pick === i + 1 ? ' selected' : ''));
        b.append(optionLabel(i + 1, opt));
        b.onclick = () => examPick(i + 1);
        box.appendChild(b);
    });
    $('x-prev').disabled = exam.idx === 0;
    $('x-next').disabled = exam.idx === exam.items.length - 1;
    renderExamGrid();
}

/* 選答案；再點同一個選項可以取消 */
function examPick(n) {
    if (!exam) return;
    const it = exam.items[exam.idx];
    it.pick = it.pick === n ? null : n;
    renderExamQuestion();
}

function examGo(i) {
    if (!exam || i < 0 || i >= exam.items.length) return;
    exam.idx = i;
    renderExamQuestion();
}

function submitExam(timeUp) {
    if (!exam) return;
    const blank = exam.items.filter(it => it.pick === null).length;
    if (!timeUp && !confirm(blank ? `還有 ${blank} 題沒有作答，確定要交卷嗎？` : '確定要交卷嗎？')) return;
    clearInterval(exam.timer);
    const now = Date.now();
    const subjects = examCategories().map(cat => {
        const its = exam.items.filter(it => it.q.category === cat);
        const correct = its.filter(it => it.pick === it.q.answer).length;
        return { category: cat, n: its.length, correct, score: its.length ? Math.round(correct / its.length * 100) : null };
    }).filter(s => s.n);
    const pass = subjects.every(s => s.score >= exam.cfg.pass);

    // 計入作答紀錄：有作答的題目各加一筆，沒作答的不記；難度沿用題目目前的難度（沒作答過的算 MEDIUM），考完不會改掉標過的難度
    if (exam.cfg.record) {
        const t = new Date(now).toISOString();
        for (const it of exam.items) {
            if (it.pick === null) continue;
            const r = rec(it.q.id);
            r.history.push({ t, pick: it.pick, ok: it.pick === it.q.answer, level: r.level || 'MEDIUM', src: 'exam' });
            recompute(r);
        }
    }
    records.exams = records.exams || [];
    // items：每題的 [題目 id, 選的答案（沒作答為 null）]，依考卷順序，給考試紀錄回看用
    records.exams.push({ at: new Date(exam.startedAt).toISOString(), durationMs: now - exam.startedAt, timeUp, passScore: exam.cfg.pass, pass, recorded: exam.cfg.record, subjects,
        items: exam.items.map(it => [it.q.id, it.pick]) });
    if (records.exams.length > EXAM_HISTORY_LIMIT) records.exams = records.exams.slice(-EXAM_HISTORY_LIMIT);
    saveRecords();

    examResult = { items: exam.items, subjects, pass, timeUp, durationMs: now - exam.startedAt, cfg: exam.cfg, at: null };
    exam = null;
    $('exam-run').hidden = true;
    $('exam-result').hidden = false;
    renderExamResult();
    renderStats();
}

function renderExamResult() {
    const r = examResult;
    const box = $('x-summary');
    box.innerHTML = '';
    const head = el('div', 'x-verdict ' + (r.pass ? 'pass' : 'fail'), r.pass ? '及格' : '不及格');
    box.appendChild(head);
    if (r.at) box.appendChild(el('div', 'hint', `考試紀錄：${new Date(r.at).toLocaleString()}`));
    if (r.timeUp) box.appendChild(el('div', 'hint', '時間到，系統自動交卷。'));
    const table = el('div', 'x-scores');
    for (const s of r.subjects) {
        const row = el('div', 'x-score-row' + (s.score >= r.cfg.pass ? '' : ' low'));
        row.append(el('span', 'x-subj', s.category), el('b', 'x-pts', `${s.score} 分`), el('span', 'x-detail', `答對 ${s.correct} / ${s.n} 題`));
        table.appendChild(row);
    }
    box.appendChild(table);
    const blank = r.items.filter(it => it.pick === null).length;
    box.appendChild(el('div', 'x-meta',
        `每科及格 ${r.cfg.pass} 分 ・ 用時 ${fmtDuration(r.durationMs)}` + (blank ? ` ・ 未作答 ${blank} 題` : '') +
        (r.cfg.record ? ' ・ 已計入作答紀錄' : ' ・ 未計入作答紀錄')));
    $('x-wrong-only').checked = examReviewWrongOnly;
    renderExamReview();
    $('exam').scrollIntoView({ block: 'start' });
}

/* 交卷後的檢討：顯示自己的答案和正確答案 */
function renderExamReview() {
    const list = $('x-review');
    list.innerHTML = '';
    const items = examResult.items.map((it, i) => ({ ...it, i })).filter(it => !examReviewWrongOnly || it.pick !== it.q.answer);
    if (!items.length) { list.appendChild(el('div', 'empty', '全部答對，沒有需要檢討的題目！')); return; }
    for (const it of items) {
        const ok = it.pick === it.q.answer;
        const card = el('div', 'qitem show');
        const head = el('div', 'qhead');
        head.append(el('span', 'badge', it.q.category), el('span', 'num', `第 ${it.i + 1} 題`), el('span', 'hint-inline', `題庫第 ${it.q.num} 題`),
            el('span', 'tag ' + (ok ? 'mastered' : 'everWrong'), it.pick === null ? '未作答' : ok ? '答對' : `答錯（選 ${it.pick}）`),
            copyQuestionButton(() => it.q), noteButton(() => it.q));
        card.appendChild(head);
        card.appendChild(el('div', 'qtext', it.q.question));
        const opts = el('ol', 'qopts');
        it.q.options.forEach((o, k) => {
            const cls = k + 1 === it.q.answer ? 'ans' : k + 1 === it.pick ? 'mine' : '';
            opts.appendChild(el('li', cls, `(${k + 1}) ${o}`));
        });
        card.appendChild(opts);
        card.appendChild(examReviewTools(it.q));
        list.appendChild(card);
    }
}
/* 檢討時直接改難度標籤（不影響分數）與加強複習；沒作答過的題目沒有難度，只能標加強複習 */
function examReviewTools(q) {
    const box = el('div', 'x-tools');
    const draw = () => {
        const r = peek(q.id);
        box.innerHTML = '';
        if (r.history.length) {
            box.appendChild(el('span', 'x-tools-label', '難度'));
            for (const lv of ['EASY', 'MEDIUM', 'HARD']) {
                const b = el('button', 'chip' + (r.level === lv ? ' on' : ''), `${ICONS[lv]} ${lv}`);
                b.type = 'button';
                b.title = '只改難度標籤，不影響分數';
                b.onclick = () => { setExamTag(q, lv); draw(); };
                box.appendChild(b);
            }
        }
        const m = el('button', 'chip' + (r.review ? ' on' : ''), `${ICONS.review} 加強複習`);
        m.type = 'button';
        m.onclick = () => { toggleExamReview(q); draw(); };
        box.appendChild(m);
    };
    draw();
    return box;
}
function setExamTag(q, level) {
    const r = rec(q.id);
    r.tag = { level, at: new Date().toISOString() };
    recompute(r);
    saveRecords(); renderStats();
}
function toggleExamReview(q) {
    const r = rec(q.id);
    r.review = !r.review;
    if (r.review) r.noReview = false;   // 和暫停複習互斥
    r.markAt = new Date().toISOString();   // 合併兩台電腦的紀錄時，以較晚的標記為準
    saveRecords(); renderStats();
}

function showExamSetup() {
    $('exam-result').hidden = true;
    $('exam-run').hidden = true;
    $('exam-setup').hidden = false;
    syncSetup();
    renderExamHistory();
}

function renderExamHistory() {
    const box = $('x-history');
    box.innerHTML = '';
    const list = (records.exams || []).slice().reverse().slice(0, 10);
    if (!list.length) return;
    box.appendChild(el('div', 'x-history-title', '考試紀錄'));
    for (const x of list) {
        const canOpen = Array.isArray(x.items) && x.items.length;
        const row = el(canOpen ? 'button' : 'div', 'x-history-row' + (canOpen ? ' open' : ''));
        row.append(
            el('span', 'x-h-date', new Date(x.at).toLocaleString()),
            el('span', 'tag ' + (x.pass ? 'mastered' : 'everWrong'), x.pass ? '及格' : '不及格'),
            el('span', null, x.subjects.map(s => `${s.category} ${s.score}`).join(' ・ ')),
            el('span', 'x-h-dur', fmtDuration(x.durationMs) + (canOpen ? ' ・ 看題目 ›' : '')));
        if (canOpen) { row.type = 'button'; row.onclick = () => openExamRecord(x); }
        else row.title = '這次考試沒有記下題目（舊版紀錄）';
        box.appendChild(row);
    }
}
/* 打開一次考試紀錄：用記下的題目與作答重建結果頁；找不到的題目（題庫已刪除）略過 */
function openExamRecord(x) {
    const byId = new Map(allQuestions.map(q => [q.id, q]));
    // 不在目前題庫或組合裡的題目，到所有載入的題庫找
    for (const id of x.items.map(it => it[0])) {
        const k = splitQid(id);
        const q = !byId.has(id) && k && banks[k.bankId] && banks[k.bankId].questions.find(q => q.id === id);
        if (q) byId.set(id, q);
    }
    const items = x.items.filter(it => byId.has(it[0])).map(([id, pick]) => ({ q: byId.get(id), pick }));
    if (!items.length) { alert('這次考試的題目都找不到了（題庫可能已刪除）。'); return; }
    examResult = { items, subjects: x.subjects, pass: x.pass, timeUp: x.timeUp, durationMs: x.durationMs, cfg: { pass: x.passScore, record: x.recorded }, at: x.at };
    $('exam-setup').hidden = true;
    $('exam-result').hidden = false;
    syncSetup();
    renderExamResult();
}

/* 考試中的快捷鍵：1–4 選答案、← → 換題 */
function examKey(e) {
    if (!exam) return;
    if (['1', '2', '3', '4'].includes(e.key)) examPick(+e.key);
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); examGo(exam.idx + 1); }
    else if (e.key === 'ArrowLeft') examGo(exam.idx - 1);
}
