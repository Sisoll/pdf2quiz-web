/* 練習：出題、作答與一輪測驗 */
function renderMeta(q) {
    const r = peek(q.id);
    document.querySelectorAll('.remark[data-level]').forEach(b => b.classList.toggle('on', r.level === b.dataset.level));
    $('review-btn').classList.toggle('on', !!r.review);
    $('review-btn').title = r.review ? '移除加強複習（快捷鍵 R）' : '標記為加強複習，標記期間不算已記住（快捷鍵 R）';
    $('noreview-btn').classList.toggle('on', !!r.noReview);
    $('noreview-btn').title = r.noReview ? '移除暫停複習（快捷鍵 S）' : '標記為暫停複習（快捷鍵 S）';
    const s = $('score');
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
        const gain = h.cool ? '10 分鐘內重複答對，這次不加分' : `本次 ${fmtScore(h.d)}（${h.level}${r.streak > 1 ? `，連對 ${r.streak} 次` : ''}）`;
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
    bar.innerHTML =
        `<span>本輪得分 <b class="pts">${pct(session.correct, session.answered)}</b> / 100</span>` +
        `<span>已答 <b>${n}</b> 題</span>` +
        `<span>答對 <b>${session.correct}</b></span>` +
        `<span>答錯 <b>${session.answered - session.correct}</b></span>` +
        (session.skipped ? `<span>略過 <b>${session.skipped}</b></span>` : '') +
        (session.round > 1 ? `<span>第 <b>${session.round}</b> 輪</span>` : '');
}
function renderIdle() {
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
    if (running) $('start-info').textContent = '測驗進行中，要改條件請先按中止';
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
                `<div class="hint">可以調整條件後按「開始」再來一輪。</div></div>`;
        } else {
            $('category').textContent = '準備開始';
            $('question').innerHTML = '<div class="empty">設定好科目、條件和題數後，按上方的「開始」出題。</div>';
        }
        return;
    }
    showQuizEls(true);

    const q = queue[pos];
    answeredInView = false;
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
    r.history.push({ t: new Date().toISOString(), pick, ok, level: 'MEDIUM' });
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
