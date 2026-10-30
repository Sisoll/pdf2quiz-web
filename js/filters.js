/* 出題條件、條件按鈕與統計 */
/* ---------- 篩選與題目佇列 ---------- */
function inScoreRange(r) {
    const min = settings.min === '' ? -Infinity : Number(settings.min);
    const max = settings.max === '' ? Infinity : Number(settings.max);
    return r.score >= min && r.score <= max;
}
/* 題目是否符合某個條件；「包含」和「排除」共用 */
function test(r, key) {
    switch (key) {
        case 'new': return r.correct + r.wrong === 0;
        case 'answered': return r.correct + r.wrong > 0;
        case 'mastered': return isMastered(r);
        case 'everWrong': return r.wrong > 0;
        case 'review': return !!r.review;
        case 'noReview': return !!r.noReview;
        case 'EASY': case 'MEDIUM': case 'HARD': return r.level === key;   // 未作答的題目 level 為 null，不符合任何難度
        default: return true;
    }
}
/* 科目與分數區間：括號內題數的計算範圍 */
function inScope(q) {
    if (settings.category !== 'all' && q.categoryKey !== settings.category) return false;
    return inScoreRange(peek(q.id));
}
/* 出題規則：符合任一個「包含」（沒勾就是全部），且不符合任何「排除」 */
function matches(q) {
    if (!inScope(q)) return false;
    const r = peek(q.id);
    if (settings.include.length && !settings.include.some(key => test(r, key))) return false;
    return !settings.exclude.some(key => test(r, key));
}
function buildQueue() {
    queue = allQuestions.filter(q => matches(q));
    // 分數排序：同分維持題號順序（Array.sort 是穩定排序）
    if (settings.order === 'scoreAsc') queue.sort((a, b) => peek(a.id).score - peek(b.id).score);
    if (settings.order === 'scoreDesc') queue.sort((a, b) => peek(b.id).score - peek(a.id).score);
    if (settings.order in RANDOM_WEIGHT.modes) {
        // 加權隨機排列：每題抽 random^(1/權重)，由大到小排，權重越高越容易排前面
        const boosted = RANDOM_WEIGHT.modes[settings.order];
        queue = queue.map(q => [Math.pow(Math.random(), 1 / randomWeight(peek(q.id), boosted)), q])
            .sort((a, b) => b[0] - a[0]).map(x => x[1]);
    }
    pos = 0;
}
/* 三個因素，見 config.js 的 RANDOM_WEIGHT */
function randomFactors(r) {
    const W = RANDOM_WEIGHT;
    const n = r.correct + r.wrong;
    return {
        attempts: 1 + W.attempts / (n + 1),
        wrong: 1 + (SCORING.cap - r.score) / W.scoreDiv + Math.min(r.wrong, W.wrongMax) * W.wrongStep,
        level: n ? W.level[r.level] || 1 : 1,
    };
}
function randomWeight(r, boosted = null) {
    const f = randomFactors(r);
    return Object.entries(f).reduce((w, [k, v]) => w * Math.pow(v, k === boosted ? RANDOM_WEIGHT.boost : 1), 1);
}

/* ---------- 畫面 ---------- */
function chipState(key) {
    return settings.include.includes(key) ? 'inc' : settings.exclude.includes(key) ? 'exc' : '';
}
function buildChips() {
    const box = $('f-chips');
    box.innerHTML = '';
    const groups = [...new Set(CONDITIONS.map(c => c.group))];
    for (const g of groups) {
        const wrap = Object.assign(document.createElement('div'), { className: 'chip-group' });
        wrap.appendChild(Object.assign(document.createElement('span'), { className: 'chip-group-title', textContent: g }));
        for (const c of CONDITIONS.filter(c => c.group === g)) {
            const chip = Object.assign(document.createElement('button'), { className: 'chip', type: 'button' });
            chip.dataset.key = c.key;
            chip.append(`${c.label} `, Object.assign(document.createElement('small'), { className: 'cnt' }));
            chip.onclick = () => cycleChip(c.key);
            wrap.appendChild(chip);
        }
        box.appendChild(wrap);
    }
    renderChips();
}
/* 不限 → 包含 → 排除 → 不限 */
function cycleChip(key) {
    if (session) return;
    const state = chipState(key);
    settings.include = settings.include.filter(k => k !== key);
    settings.exclude = settings.exclude.filter(k => k !== key);
    if (state === '') settings.include.push(key);
    else if (state === 'inc') settings.exclude.push(key);
    onFiltersChanged();
}
function renderChips() {
    const scope = allQuestions.filter(inScope).map(q => peek(q.id));
    document.querySelectorAll('#f-chips .chip').forEach(chip => {
        const key = chip.dataset.key;
        const state = chipState(key);
        chip.className = 'chip' + (state ? ' ' + state : '');
        chip.title = state === 'inc' ? '包含：再點一下改成排除' : state === 'exc' ? '排除：再點一下改成不限' : '不限：點一下改成包含';
        chip.querySelector('.cnt').textContent = `（${scope.filter(r => test(r, key)).length}）`;
    });
}

function renderStats() {
    renderChips();
    const scope = allQuestions.filter(q => settings.category === 'all' || q.categoryKey === settings.category);
    let done = 0, mastered = 0, review = 0, noReview = 0, easy = 0, medium = 0, hard = 0, correct = 0, wrong = 0;
    for (const q of scope) {
        const r = peek(q.id);
        if (r.correct + r.wrong > 0) done++;
        if (isMastered(r)) mastered++;
        if (r.review) review++;
        if (r.noReview) noReview++;
        if (r.level === 'EASY') easy++;
        if (r.level === 'MEDIUM') medium++;
        if (r.level === 'HARD') hard++;
        correct += r.correct; wrong += r.wrong;
    }
    const rate = correct + wrong ? Math.round(correct / (correct + wrong) * 100) + '%' : '—';
    $('stats').innerHTML =
        `<span>符合出題規則 <b>${allQuestions.filter(matches).length}</b></span>` +
        `<span>題數 <b>${scope.length}</b></span>` +
        `<span>已作答 <b>${done}</b></span>` +
        `<span>已記住 <b>${mastered}</b></span>` +
        `<span>加強複習 <b>${review}</b> ・ 暫停複習 <b>${noReview}</b></span>` +
        `<span>EASY <b>${easy}</b> ・ MEDIUM <b>${medium}</b> ・ HARD <b>${hard}</b></span>` +
        `<span>累計答對率 <b>${rate}</b></span>`;
}

function readThreshold() { return DEFAULT_THRESHOLD; }   // 目前固定，輸入框已停用
function readRange() {
    let min = $('f-min').value.trim(), max = $('f-max').value.trim();
    if (min !== '' && max !== '' && Number(min) > Number(max)) { [min, max] = [max, min]; $('f-min').value = min; $('f-max').value = max; }
    settings.min = min; settings.max = max;
}
/* 從畫面讀出條件；包含 / 排除由條件按鈕直接寫進 settings */
function readFilters() {
    settings.category = $('f-category').value;
    settings.order = $('f-order').value;
    const limit = parseInt($('f-limit').value, 10);
    settings.limit = limit > 0 ? String(limit) : '';
    if (!settings.limit) $('f-limit').value = '';
    settings.threshold = readThreshold();
    readRange();
    saveSettings();
}
/* 條件改變時只更新題數，不會開始出題 */
function onFiltersChanged() {
    if (session) return;
    readFilters();
    render();
    if (view === 'browse') renderBrowse(true);
}
