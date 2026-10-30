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
            chip.append(`${ICONS[c.key]} ${c.label} `, Object.assign(document.createElement('small'), { className: 'cnt' }));
            chip.onclick = () => cycleChip(c.key);
            wrap.appendChild(chip);
        }
        box.appendChild(wrap);
    }
    renderChips();
}
/* 不限 → 包含 → 排除 → 不限 */
function cycleChip(key) {
    if (!endRoundForChange()) return;
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

/* 統計：只算符合出題規則的題目，題數旁邊附上目前科目的總題數 */
function renderStats() {
    renderChips();
    const total = allQuestions.filter(q => settings.category === 'all' || q.categoryKey === settings.category).length;
    const list = allQuestions.filter(matches);
    const n = { lastOk: 0, done: 0, mastered: 0, review: 0, noReview: 0, EASY: 0, MEDIUM: 0, HARD: 0, correct: 0, wrong: 0 };
    for (const q of list) {
        const r = peek(q.id);
        if (r.correct + r.wrong > 0) n.done++;
        if (r.last === 'correct') n.lastOk++;
        if (isMastered(r)) n.mastered++;
        if (r.review) n.review++;
        if (r.noReview) n.noReview++;
        if (['EASY', 'MEDIUM', 'HARD'].includes(r.level)) n[r.level]++;
        n.correct += r.correct; n.wrong += r.wrong;
    }
    const none = list.length - n.EASY - n.MEDIUM - n.HARD;
    // 最近答對率：已作答的題目中，最近一次答對的比例（目前的程度）；歷來答對率：所有作答次數的答對比例
    const rate = n.done ? Math.round(n.lastOk / n.done * 100) + '%' : '—';
    const allRate = n.correct + n.wrong ? Math.round(n.correct / (n.correct + n.wrong) * 100) + '%' : '—';
    const pct = v => list.length ? (v / list.length * 100).toFixed(2) + '%' : '0';
    // 卡片底部的比例條：題數是佔符合題數的比例，答對率就是答對率本身
    const stat = (icon, label, value, ratio, title = '') => `<div class="stat"${title ? ` title="${title}"` : ''}><span class="stat-icon">${icon}</span><div class="stat-body"><div class="stat-label">${label}</div><b>${value}</b>` +
        `<div class="stat-bar"><span style="width:${(Math.min(1, ratio || 0) * 100).toFixed(1)}%"></span></div></div></div>`;
    const of = v => list.length ? v / list.length : 0;
    $('stats').innerHTML =
        `<div class="stats-head"><span class="stats-main">${ICONS.matched} 符合出題規則 <b>${list.length}</b> <small>/ ${total} 題（${ruleText()}）</small></span>` +
        (list.length ? '' : `<span class="stats-note">沒有符合條件的題目</span>`) + `</div>` +
        `<div class="stats-grid">` +
        stat(ICONS.answered, '已作答', n.done, of(n.done)) +
        stat(ICONS.new, '未作答', list.length - n.done, of(list.length - n.done)) +
        stat(ICONS.mastered, '已記住', n.mastered, of(n.mastered)) +
        stat(ICONS.review, '加強複習', n.review, of(n.review)) +
        stat(ICONS.noReview, '暫停複習', n.noReview, of(n.noReview)) +
        stat(ICONS.rate, '最近答對率', rate, n.done && n.lastOk / n.done, `已作答的 ${n.done} 題中，最近一次答對 ${n.lastOk} 題`) +
        stat(ICONS.history, '歷來答對率', allRate, (n.correct + n.wrong) && n.correct / (n.correct + n.wrong), `所有作答 ${n.correct + n.wrong} 次中，答對 ${n.correct} 次`) +
        `</div>` +
        `<div class="level-bar" aria-hidden="true">` +
        ['EASY', 'MEDIUM', 'HARD'].map(k => `<span class="lv-${k.toLowerCase()}" style="width:${pct(n[k])}"></span>`).join('') +
        `<span class="lv-none" style="width:${pct(none)}"></span></div>` +
        `<div class="level-legend">` +
        ['EASY', 'MEDIUM', 'HARD'].map(k => `<span>${ICONS[k]} ${k} <b>${n[k]}</b></span>`).join('') +
        `<span>${ICONS.none} 未分級（未作答）<b>${none}</b></span></div>`;
}
/* 目前的出題規則，例如「包含 已作答；排除 暫停複習；分數 1～8」 */
function ruleText() {
    const label = key => CONDITIONS.find(c => c.key === key).label;
    const parts = [];
    if (settings.include.length) parts.push(`包含 ${settings.include.map(label).join('、')}`);
    if (settings.exclude.length) parts.push(`排除 ${settings.exclude.map(label).join('、')}`);
    if (settings.min !== '' || settings.max !== '') parts.push(`分數 ${settings.min === '' ? '−2' : settings.min}～${settings.max === '' ? SCORING.cap : settings.max}`);
    return parts.join('；') || '全部題目';
}

function readThreshold() { return DEFAULT_THRESHOLD; }   // 目前固定，輸入框已停用
function readRange() {
    let min = $('f-min').value.trim(), max = $('f-max').value.trim();
    if (min !== '' && max !== '' && Number(min) > Number(max)) { [min, max] = [max, min]; $('f-min').value = min; $('f-max').value = max; }
    settings.min = min; settings.max = max;
}
/* 把 settings 顯示回畫面（不改設定時還原用） */
function showFilters() {
    $('f-source').value = currentSource.id;
    $('f-category').value = settings.category;
    $('f-order').value = settings.order;
    $('f-min').value = settings.min;
    $('f-max').value = settings.max;
    $('f-limit').value = settings.limit;
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
    if (!endRoundForChange()) return;
    readFilters();
    render();
    if (view === 'browse') renderBrowse(true);
}
