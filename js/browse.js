/* 題目總覽：依目前的科目、分數區間與條件列出題目，可排序、顯示 / 隱藏答案 */
const BROWSE_PAGE = 50;   // 每頁幾題
let browsePage = 0;       // 目前在第幾頁（從 0 開始）

function browseList() {
    const list = allQuestions.filter(q => matches(q));
    const r = q => peek(q.id);
    // Array.sort 是穩定排序，同分 / 同次數時維持題號順序
    switch (settings.browseSort) {
        case 'scoreAsc': list.sort((a, b) => r(a).score - r(b).score); break;
        case 'scoreDesc': list.sort((a, b) => r(b).score - r(a).score); break;
        case 'wrongDesc': list.sort((a, b) => r(b).wrong - r(a).wrong); break;
    }
    return list;
}

/* 每題依作答結果產生的標籤 */
function questionTags(r) {
    const tags = [];
    if (r.correct + r.wrong === 0) {
        tags.push(['new', '未作答']);
    } else {
        tags.push(['answered', '已作答']);
        if (isMastered(r)) tags.push(['mastered', '已記住']);
        if (r.wrong > 0) tags.push(['everWrong', `答錯 ${r.wrong} 次`]);
        tags.push([r.level, r.level]);
    }
    if (r.review) tags.push(['review', '加強複習']);
    if (r.noReview) tags.push(['noReview', '暫停複習']);
    return tags;
}

function questionCard(q) {
    const r = peek(q.id);
    const card = el('div', 'qitem');

    const head = el('div', 'qhead');
    head.append(el('span', 'badge', q.category), el('span', 'num', `第 ${q.num} 題`));
    const score = el('span', 'score' + (r.score > 0 ? ' pos' : r.score < 0 ? ' neg' : ''),
        `${fmtScore(r.score)}（對 ${r.correct} ・ 錯 ${r.wrong}）`);
    head.appendChild(score);
    for (const [cls, label] of questionTags(r)) head.appendChild(el('span', `tag ${cls}`, label));
    card.appendChild(head);

    card.appendChild(el('div', 'qtext', q.question));
    const opts = el('ol', 'qopts');
    q.options.forEach((o, i) => {
        const li = el('li', i + 1 === q.answer ? 'ans' : '', `(${i + 1}) ${o}`);
        opts.appendChild(li);
    });
    card.appendChild(opts);

    if (r.history.length) {
        const trail = r.history.slice(-10).map(h => `${h.ok ? '對' : '錯'}/${h.level}`).join('、');
        const more = r.history.length > 10 ? `（最近 10 次，共 ${r.history.length} 次）` : '';
        card.appendChild(el('div', 'qtrail', `作答歷程：${trail}${more} ・ 最後作答 ${new Date(r.lastAt).toLocaleString()}`));
    }

    // 答案隱藏時，點題目只看這一題的答案
    card.onclick = () => { if (!settings.showAnswers) card.classList.toggle('reveal'); };
    return card;
}

function renderBrowse(reset = false) {
    if (reset) browsePage = 0;
    const list = browseList();
    const pages = Math.max(1, Math.ceil(list.length / BROWSE_PAGE));
    browsePage = Math.min(Math.max(0, browsePage), pages - 1);
    const from = browsePage * BROWSE_PAGE;
    const to = Math.min(from + BROWSE_PAGE, list.length);
    $('browse-count').textContent = list.length
        ? `符合條件 ${list.length} 題（第 ${from + 1}–${to} 題）`
        : '符合條件 0 題';
    $('b-sort').value = settings.browseSort;
    applyAnswerVisibility();

    const box = $('browse-list');
    box.innerHTML = '';
    if (!list.length) {
        box.appendChild(el('div', 'empty', '目前沒有符合條件的題目，請調整上方的條件。'));
    } else {
        const frag = document.createDocumentFragment();
        list.slice(from, to).forEach(q => frag.appendChild(questionCard(q)));
        box.appendChild(frag);
    }
    renderPager($('b-pager-top'), pages);
    renderPager($('b-pager-bottom'), pages);
}

/* 分頁列：« ‹ 1 … 4 5 [6] 7 8 … 23 › »，加上跳頁輸入框 */
function renderPager(box, pages) {
    box.innerHTML = '';
    box.hidden = pages <= 1;
    if (pages <= 1) return;
    const cur = browsePage;
    const btn = (label, page, { active = false, disabled = false, title = '' } = {}) => {
        const b = el('button', 'pg' + (active ? ' on' : ''), label);
        b.type = 'button';
        b.disabled = disabled || active;
        if (title) b.title = title;
        b.onclick = () => goPage(page);
        box.appendChild(b);
    };
    btn('«', 0, { disabled: cur === 0, title: '第一頁' });
    btn('‹', cur - 1, { disabled: cur === 0, title: '上一頁' });
    const show = new Set([0, pages - 1]);
    for (let i = cur - 2; i <= cur + 2; i++) if (i >= 0 && i < pages) show.add(i);
    let last = -1;
    [...show].sort((a, b) => a - b).forEach(i => {
        if (i - last > 1) box.appendChild(el('span', 'pg-gap', '…'));
        btn(String(i + 1), i, { active: i === cur });
        last = i;
    });
    btn('›', cur + 1, { disabled: cur === pages - 1, title: '下一頁' });
    btn('»', pages - 1, { disabled: cur === pages - 1, title: '最後一頁' });

    const jump = el('span', 'pg-jump');
    const input = Object.assign(el('input'), { type: 'number', min: 1, max: pages, placeholder: String(cur + 1) });
    input.title = `輸入 1–${pages}，按 Enter 跳頁`;
    const go = () => { const n = parseInt(input.value, 10); if (n >= 1 && n <= pages) goPage(n - 1); else input.value = ''; };
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
    const goBtn = el('button', 'pg', '跳頁');
    goBtn.type = 'button';
    goBtn.onclick = go;
    jump.append('到第 ', input, ` / ${pages} 頁 `, goBtn);
    box.appendChild(jump);
}

function goPage(page) {
    browsePage = page;
    renderBrowse();
    $('browse').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function applyAnswerVisibility() {
    $('browse').classList.toggle('show-answers', !!settings.showAnswers);
    $('b-toggle').textContent = settings.showAnswers ? '隱藏答案' : '顯示答案';
}

/* 一鍵顯示 / 隱藏全部答案 */
function toggleAnswers() {
    settings.showAnswers = !settings.showAnswers;
    saveSettings();
    document.querySelectorAll('#browse-list .qitem.reveal').forEach(c => c.classList.remove('reveal'));
    applyAnswerVisibility();
}

function initBrowse() {
    $('b-sort').onchange = () => { settings.browseSort = $('b-sort').value; saveSettings(); renderBrowse(true); };
    $('b-toggle').onclick = toggleAnswers;
}
