/* 練習：出題、作答與一輪測驗 */
function renderMeta(q) {
    const r = peek(q.id);
    document.querySelectorAll('.remark[data-level]').forEach(b => b.classList.toggle('on', r.level === b.dataset.level));
    $('review-btn').classList.toggle('on', !!r.review);
    $('review-btn').title = r.review ? '移除加強複習（快捷鍵 R）' : '標記為加強複習，標記期間不算已記住（快捷鍵 R）';
    $('noreview-btn').classList.toggle('on', !!r.noReview);
    $('noreview-btn').title = r.noReview ? '移除暫停複習（快捷鍵 S）' : '標記為暫停複習（快捷鍵 S）';
    const s = $('score');
    // 從沒作答過的題目沒有分數可看，只標示第一次作答
    if (r.correct + r.wrong === 0) {
        s.textContent = `${ICONS.new} 第一次作答`;
        s.className = 'score';
        s.title = '這一題還沒有作答紀錄';
        return;
    }
    const streak = r.streak > 1 ? ` ・ 連對 ${r.streak}` : '';
    s.textContent = `${fmtScore(r.score)}（對 ${r.correct} ・ 錯 ${r.wrong}${streak}）`;
    s.className = 'score' + (r.score > 0 ? ' pos' : r.score < 0 ? ' neg' : '') + (isMastered(r) ? ' mastered' : '');
    s.title = isMastered(r) ? '已記住'
        : r.review && r.score >= settings.threshold ? '分數已達門檻，但標記為加強複習，所以不算已記住'
        : `分數達 ${settings.threshold} 視為已記住`;
}

function renderResult(q) {
    const r = peek(q.id);
    const h = r.history[r.history.length - 1];
    if (!h) return;
    const before = round2(h.s - h.d);
    const change = `分數 ${fmtScore(before)} → ${fmtScore(h.s)}`;
    let text;
    if (h.ok) {
        const f = timeFactor(h.sec);
        const speed = typeof h.sec === 'number' ? `，用時 ${h.sec} 秒${f !== 1 ? ` ×${f}` : ''}` : '';
        const gain = h.cool ? '10 分鐘內重複答對，這次不加分' : `本次 ${fmtScore(h.d)}（${h.level}${r.streak > 1 ? `，連對 ${r.streak} 次` : ''}${speed}）`;
        text = `✔ 答對了！${change} <small>${gain}</small>`;
    } else {
        text = `✘ 答錯了，正確答案是 (${q.answer})。${change}`;
    }
    if (isMastered(r)) text += ' <small>・ 已記住</small>';
    $('result').innerHTML = text;
    $('result').className = 'result ' + (h.ok ? 'ok' : 'ng');
}

/* ---------- 一輪測驗 ---------- */
const pct = (c, n) => n ? Math.round(c / n * 100) : 0;
function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
}
function renderSessionBar() {
    const bar = $('session-bar');
    if (!session) { bar.hidden = true; return; }
    bar.hidden = false;
    const n = session.limit ? `${session.answered} / ${session.limit}` : `${session.answered}`;
    // 進度：有題數時看已答幾題，題數不限時看這一輪出到第幾題
    const done = session.limit ? session.answered / session.limit : (pos + 1) / Math.max(queue.length, 1);
    bar.innerHTML =
        `<div class="session-progress" title="${session.limit ? '本輪進度' : `第 ${session.round} 輪：${pos + 1} / ${queue.length}`}"><span style="width:${Math.min(100, done * 100).toFixed(1)}%"></span></div>` +
        `<span>本輪得分 <b class="pts">${pct(session.correct, session.answered)}</b> / 100</span>` +
        `<span>已答 <b>${n}</b> 題</span>` +
        `<span>答對 <b>${session.correct}</b></span>` +
        `<span>答錯 <b>${session.answered - session.correct}</b></span>` +
        (session.skipped ? `<span>略過 <b>${session.skipped}</b></span>` : '') +
        (session.round > 1 ? `<span>第 <b>${session.round}</b> 輪</span>` : '');
}
function renderIdle() {
    $('more-summary').textContent = `（順序：${$('f-order').selectedOptions[0].textContent}）`;
    const n = allQuestions.filter(matches).length;
    const limit = parseInt(settings.limit, 10);
    $('start-info').textContent = n
        ? `符合條件 ${n} 題，${limit ? `這次出 ${Math.min(limit, n)} 題` : '題數不限，直到按中止'}`
        : '目前沒有符合條件的題目，請調整條件';
    $('start-btn').disabled = !n;
}
function setRunning(running) {
    $('setup').classList.toggle('filters-locked', running);
    $('start-btn').textContent = running ? '中止' : '開始';
    $('start-btn').classList.toggle('danger', running);
    $('start-btn').disabled = false;
    if (running) $('start-info').textContent = '測驗進行中，改條件會先詢問要不要結束本輪';
}
function start() {
    if (session) return;
    readFilters();
    buildQueue();
    const jump = parseInt($('f-jump').value, 10);
    if (jump) {
        const idx = queue.findIndex(q => q.num === jump);
        if (idx < 0) { alert(`目前的條件裡沒有第 ${jump} 題`); return; }
        queue = queue.slice(idx).concat(queue.slice(0, idx));   // 從這一題開始
        $('f-jump').value = '';
    }
    const limit = parseInt(settings.limit, 10) || null;
    if (limit) queue = queue.slice(0, limit);
    if (!queue.length) { renderIdle(); return; }
    session = { limit, round: 1, answers: {}, answered: 0, correct: 0, skipped: 0, startedAt: Date.now() };
    lastResult = null;
    pos = 0;
    setRunning(true);
    $('round-review').hidden = true;
    render();
    $('quiz').scrollIntoView({ block: 'start', behavior: 'smooth' });   // 開始後畫面以題目為主
}
function finish(reason) {
    if (!session) return;
    lastResult = { ...session, reason, endedAt: Date.now() };
    session = null;
    queue = [];
    setRunning(false);
    render();
    askRoundReview();
}
function stop() { finish('中止'); }
/* 換紀錄檔、匯入、清除後：結束目前這一輪，回到設定畫面 */
function resetView() {
    session = null;
    queue = [];
    setRunning(false);
    render();
    if (view === 'browse') renderBrowse(true);
}
function toggleStart() { session ? stop() : start(); }
/* 改了出題設定：本輪成績就不再顯示；測驗中先問要不要結束本輪，結束的話不顯示成績也不詢問檢討。
   回傳 false 表示不改（畫面上的設定已還原） */
function endRoundForChange() {
    if (session && !confirm('測驗進行中，改設定要先結束本輪。\n要結束本輪嗎？')) { showFilters(); return false; }
    lastResult = null;
    $('round-review').hidden = true;
    if (session) resetView();
    return true;
}

function render() {
    renderStats();
    renderSessionBar();
    const quizEls = ['.remark', '#score', '#nav'];
    const showQuizEls = show => quizEls.forEach(sel => document.querySelectorAll(sel).forEach(el => el.hidden = !show));
    if (!session) {
        renderIdle();
        showQuizEls(false);
        $('meta').classList.add('locked');
        $('options').innerHTML = '';
        $('result').textContent = '';
        $('progress').textContent = '';
        if (lastResult) {
            const r = lastResult;
            $('category').textContent = '本輪成績';
            $('question').innerHTML =
                `<div class="result-card"><span class="reason">${r.reason}</span>` +
                `<div class="big">${pct(r.correct, r.answered)}<small> / 100</small></div>` +
                `<div class="detail">作答 ${r.answered} 題，答對 ${r.correct} 題，答錯 ${r.answered - r.correct} 題` +
                (r.skipped ? `，略過 ${r.skipped} 題` : '') + `<br>用時 ${fmtDuration(r.endedAt - r.startedAt)}</div>` +
                `<div class="hint">可以調整條件後按「開始」再來一輪。</div>` +
                (roundReviewItems(r).length ? `<button class="btn light small" id="round-review-open">檢討本輪</button>` : '') + `</div>`;
            if ($('round-review-open')) $('round-review-open').onclick = () => showRoundReview();
        } else {
            $('category').textContent = '準備開始';
            $('question').innerHTML = '<div class="empty">設定好科目、條件和題數後，按上方的「開始」出題。</div>';
        }
        return;
    }
    showQuizEls(true);

    const q = queue[pos];
    answeredInView = false;
    shownAt = Date.now();
    $('undo-btn').hidden = true;
    $('meta').classList.add('locked');
    $('category').textContent = q.category;
    $('progress').textContent = `${pos + 1} / ${queue.length}`;
    $('question').textContent = `第 ${q.num} 題　${q.question}`;
    $('result').textContent = '';
    $('result').className = 'result';
    renderMeta(q);

    const box = $('options');
    box.innerHTML = '';
    q.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.append(optionLabel(i + 1, opt));
        btn.onclick = () => answer(i + 1);
        box.appendChild(btn);
    });
}

/* 選項內容：圓形題號 + 文字 */
function optionLabel(n, text) {
    const frag = document.createDocumentFragment();
    const no = document.createElement('span');
    no.className = 'opt-no';
    no.textContent = n;
    const t = document.createElement('span');
    t.className = 'opt-text';
    t.textContent = text;
    frag.append(no, t);
    return frag;
}

/* ---------- 作答 ---------- */
function answer(pick) {
    if (!session || answeredInView || pos >= queue.length) return;
    answeredInView = true;
    const q = queue[pos];
    const ok = pick === q.answer;
    const r = rec(q.id);
    // 本輪得分：每一輪每題只算第一次作答，回上一題重答不重複計算
    const key = `${session.round}:${q.id}`;
    const prevState = key in session.answers ? session.answers[key] : undefined;
    const counted = prevState === undefined || prevState === 'skip';
    if (counted) {
        if (prevState === 'skip') session.skipped--;
        session.answers[key] = ok;
        session.answered++;
        if (ok) session.correct++;
    }
    lastAnswer = { qid: q.id, key, counted, prevState, ok };   // 給「復原」用
    // 先以 MEDIUM 計分，答完選難度時再更新這一筆
    const sec = Math.round((Date.now() - shownAt) / 100) / 10;   // 作答秒數，計分時加權用
    r.history.push({ t: new Date().toISOString(), pick, ok, level: 'MEDIUM', sec });
    recompute(r);
    saveRecords();

    document.querySelectorAll('.option-btn').forEach((btn, i) => {
        btn.disabled = true;
        if (i + 1 === q.answer) btn.classList.add('correct');
        else if (i + 1 === pick) btn.classList.add('wrong');
    });
    $('meta').classList.remove('locked');
    $('undo-btn').hidden = false;
    renderResult(q);
    renderMeta(q);
    renderStats();
    renderSessionBar();
}

/* 復原：還停在這一題時，撤銷剛才的作答（點錯時用），題目回到未作答 */
function undoAnswer() {
    if (!session || !answeredInView || advancing || !lastAnswer) return;
    const q = queue[pos];
    if (lastAnswer.qid !== q.id) return;
    const r = rec(q.id);
    r.history.pop();
    recompute(r);
    if (lastAnswer.counted) {
        session.answered--;
        if (lastAnswer.ok) session.correct--;
        if (lastAnswer.prevState === 'skip') { session.answers[lastAnswer.key] = 'skip'; session.skipped++; }
        else delete session.answers[lastAnswer.key];
    }
    lastAnswer = null;
    saveRecords();
    render();
}

function setLevel(level) {
    if (!session || !answeredInView || advancing) return;
    const q = queue[pos];
    const r = rec(q.id);
    r.history[r.history.length - 1].level = level;   // 只改這一次作答的難度
    recompute(r);
    saveRecords(); renderResult(q); renderMeta(q); renderStats();
    // 選完難度直接進下一題，稍微停一下讓人看到選了什麼
    advancing = true;
    setTimeout(() => { advancing = false; next(); }, 250);
}
/* 加強複習 / 暫停複習：答完才能加上，但隨時都可以移除；兩者互斥 */
function toggleMark(key) {
    if (!session || advancing) return;
    const q = queue[pos];
    const current = peek(q.id)[key];
    if (!current && !answeredInView) return;
    const r = rec(q.id);
    r[key] = !current;
    r.markAt = new Date().toISOString();   // 合併兩台電腦的紀錄時，以較晚的標記為準
    if (r[key]) r[key === 'review' ? 'noReview' : 'review'] = false;
    saveRecords(); if (answeredInView) renderResult(q); renderMeta(q); renderStats();
}
function next() {
    if (!session || advancing) return;
    const key = `${session.round}:${queue[pos].id}`;
    if (!(key in session.answers)) { session.answers[key] = 'skip'; session.skipped++; }
    pos++;
    if (pos >= queue.length) {
        if (session.limit) return finish('完成');
        // 題數不限：照目前條件重新出一輪
        buildQueue();
        if (!queue.length) return finish('沒有符合條件的題目了');
        session.round++;
    }
    render();
}
function prev() { if (session && !advancing && pos > 0) { pos--; render(); } }

/* ---------- 本輪檢討 ---------- */
const ROUND_FILTERS = [['wrong', `${ICONS.everWrong} 答錯`], ['review', `${ICONS.review} 加強複習`], ['hard', `${ICONS.HARD} HARD`], ['all', `${ICONS.answered} 全部`]];
let roundFilter = 'wrong';
/* 本輪作答過的題目（依作答順序），從作答歷程取出本輪的每一次作答；復原掉的作答不在歷程裡 */
function roundReviewItems(r) {
    if (!r) return [];
    const from = Math.floor(r.startedAt / 1000) * 1000;   // 存檔的時間只到秒
    const byId = new Map(allQuestions.map(q => [q.id, q]));
    const seen = new Set(), items = [];
    for (const [key, v] of Object.entries(r.answers)) {
        const qid = key.slice(key.indexOf(':') + 1);
        if (v === 'skip' || seen.has(qid) || !byId.has(qid)) continue;
        seen.add(qid);
        const rec = peek(qid);
        const tries = rec.history.filter(h => !h.src && Date.parse(h.t) >= from && Date.parse(h.t) <= r.endedAt);
        if (tries.length) items.push({ q: byId.get(qid), tries, wrong: tries.some(h => !h.ok), hard: tries.some(h => h.level === 'HARD'), review: !!rec.review });
    }
    return items;
}
const roundCount = (items, key) => key === 'all' ? items.length : items.filter(it => it[key]).length;
/* 一輪結束時詢問要不要檢討；不用的話之後也可以從成績卡打開 */
function askRoundReview() {
    const items = roundReviewItems(lastResult);
    if (!items.length) return;
    const d = $('round-dialog');
    $('round-dialog-body').innerHTML =
        `本輪作答 <b>${items.length}</b> 題：` + ROUND_FILTERS.slice(0, 3).map(([k, label]) => `${label} <b>${roundCount(items, k)}</b>`).join(' ・ ') +
        `<br>要檢討本輪的作答嗎？可以看答錯的題目、正確答案和當時的選擇。`;
    if (typeof d.showModal !== 'function') { if (confirm($('round-dialog-body').innerText)) showRoundReview(); return; }
    $('round-dialog-review').onclick = () => { d.close(); showRoundReview(); };
    $('round-dialog-skip').onclick = () => d.close();
    d.showModal();
}
function showRoundReview(filter) {
    const items = roundReviewItems(lastResult);
    roundFilter = filter || ['wrong', 'review', 'hard'].find(k => roundCount(items, k)) || 'all';
    $('round-review').hidden = false;
    renderRoundReview();
    $('round-review').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function renderRoundReview() {
    const items = roundReviewItems(lastResult);
    const chips = $('rr-filters');
    chips.innerHTML = '';
    for (const [key, label] of ROUND_FILTERS) {
        const chip = el('button', 'chip' + (key === roundFilter ? ' on' : ''), `${label} `);
        chip.type = 'button';
        chip.dataset.key = key;
        chip.appendChild(el('small', 'cnt', `（${roundCount(items, key)}）`));
        chip.onclick = () => { roundFilter = key; renderRoundReview(); };
        chips.appendChild(chip);
    }
    const list = $('rr-list');
    list.innerHTML = '';
    const shown = items.filter(it => roundFilter === 'all' || it[roundFilter]);
    if (!shown.length) { list.appendChild(el('div', 'empty', '這一類沒有題目')); return; }
    for (const it of shown) list.appendChild(roundReviewCard(it));
}
function roundReviewCard({ q, tries, wrong, review }) {
    const card = el('div', 'qitem show');
    const head = el('div', 'qhead');
    const last = tries[tries.length - 1];
    head.append(el('span', 'badge', q.category), el('span', 'num', `第 ${q.num} 題`),
        el('span', 'tag ' + (wrong ? 'everWrong' : 'mastered'), wrong ? '答錯' : '答對'),
        el('span', `tag ${last.level}`, last.level));
    if (review) head.appendChild(el('span', 'tag review', '加強複習'));
    card.append(head, el('div', 'qtext', q.question));
    const picks = new Set(tries.filter(h => !h.ok).map(h => h.pick));
    const opts = el('ol', 'qopts');
    q.options.forEach((o, k) => opts.appendChild(el('li', k + 1 === q.answer ? 'ans' : picks.has(k + 1) ? 'mine' : '', `(${k + 1}) ${o}`)));
    card.appendChild(opts);
    card.appendChild(el('div', 'rr-tries', '本輪的選擇：' + tries.map(h => `選 (${h.pick}) ${h.ok ? '✓' : '✗'} ${h.level}`).join(' → ') + `　・　正確答案 (${q.answer})`));
    return card;
}
