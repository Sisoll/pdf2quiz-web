/* 題目總覽：依目前的科目、分數區間與條件列出題目，可排序、顯示 / 隱藏答案 */
const BROWSE_PAGE = 50;   // 每頁幾題
let browsePage = 0;       // 目前在第幾頁（從 0 開始）

let browseQuery = '';     // 目前的關鍵字（不存檔）
const SEARCH_HISTORY_LIMIT = 20;
const SUGGEST_LIMIT = 12;

/* ---------- 關鍵字查詢 ---------- */
const normText = s => String(s).normalize('NFKC').toLowerCase();
const queryTerms = query => normText(query).split(/\s+/).filter(Boolean);
/* 各查詢範圍要比對的文字，題目換了（換題庫）才重算 */
let searchCache = { questions: null, texts: null };
function searchText(q, scope) {
    if (searchCache.questions !== allQuestions) searchCache = { questions: allQuestions, texts: new Map() };
    let t = searchCache.texts.get(q.id);
    if (!t) {
        t = { question: normText(q.question), answer: normText(q.options[q.answer - 1] || ''), options: normText(q.options.join('\n')) };
        t.all = t.question + '\n' + t.options;
        searchCache.texts.set(q.id, t);
    }
    return t[scope] ?? t.all;
}
const matchesQuery = (q, terms) => terms.every(term => searchText(q, settings.browseScope).includes(term));

function browseList() {
    const terms = queryTerms(browseQuery);
    const list = allQuestions.filter(q => matches(q) && matchesQuery(q, terms));   // 和統計的 shownInView 相同
    const r = q => peek(q.id);
    // Array.sort 是穩定排序，同分 / 同次數時維持題號順序
    switch (settings.browseSort) {
        case 'scoreAsc': list.sort((a, b) => r(a).score - r(b).score); break;
        case 'scoreDesc': list.sort((a, b) => r(b).score - r(a).score); break;
        case 'wrongDesc': list.sort((a, b) => r(b).wrong - r(a).wrong); break;
        case 'lastDesc': case 'lastAsc': {
            // 上次作答時間；未作答的題目不論哪個方向都排在最後
            const dir = settings.browseSort === 'lastDesc' ? -1 : 1;
            const at = q => (r(q).lastAt ? Date.parse(r(q).lastAt) : null);
            list.sort((a, b) => at(a) === null || at(b) === null ? (at(a) === null) - (at(b) === null) : dir * (at(a) - at(b)));
            break;
        }
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
    head.append(copyQuestionButton(() => q), noteButton(() => q));
    card.appendChild(head);

    const terms = queryTerms(browseQuery);
    const scope = settings.browseScope;
    card.appendChild(highlight(el('div', 'qtext'), q.question, scope === 'answer' ? [] : terms));
    const opts = el('ol', 'qopts');
    q.options.forEach((o, i) => {
        const isAns = i + 1 === q.answer;
        const marked = scope === 'question' || (scope === 'answer' && !isAns) ? [] : terms;
        opts.appendChild(highlight(el('li', isAns ? 'ans' : '', `(${i + 1}) `), o, marked));
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
    const label = browseQuery.trim() ? `符合條件與關鍵字` : '符合條件';
    $('browse-count').textContent = list.length
        ? `${label} ${list.length} 題（第 ${from + 1}–${to} 題）`
        : `${label} 0 題`;
    $('b-sort').value = settings.browseSort;
    applyAnswerVisibility();

    const box = $('browse-list');
    box.innerHTML = '';
    if (!list.length) {
        box.appendChild(el('div', 'empty', browseQuery.trim() ? '沒有符合關鍵字的題目，可以換個關鍵字或查詢範圍。' : '目前沒有符合條件的題目，請調整上方的條件。'));
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

/* 把文字裡符合關鍵字的部分包上 <mark>，加在 node 後面 */
function highlight(node, text, terms) {
    const re = terms.length ? new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi') : null;
    const norm = text.normalize('NFKC');
    const src = norm.length === text.length ? norm : text;   // 正規化後長度變了就直接比對原文，位置才對得上
    let last = 0;
    if (re) for (const m of src.matchAll(re)) {
        if (!m[0]) continue;
        node.append(text.slice(last, m.index), el('mark', '', text.slice(m.index, m.index + m[0].length)));
        last = m.index + m[0].length;
    }
    node.append(text.slice(last));
    return node;
}

/* ---------- 查詢紀錄與關鍵字建議 ---------- */
function searchHistory() { return Array.isArray(settings.searchHistory) ? settings.searchHistory : (settings.searchHistory = []); }
function addSearchHistory(query) {
    const q = query.trim().replace(/\s+/g, ' ');
    if (!q) return;
    settings.searchHistory = [q, ...searchHistory().filter(h => h !== q)].slice(0, SEARCH_HISTORY_LIMIT);
    saveSettings();
}
function removeSearchHistory(query) {
    settings.searchHistory = searchHistory().filter(h => h !== query);
    saveSettings();
}
/* 目前題庫（不看篩選）在這個查詢範圍裡有幾題含有這個詞 */
const termHits = term => allQuestions.filter(q => searchText(q, settings.browseScope).includes(normText(term))).length;
/* 建議：先列包含輸入文字的查詢紀錄，再列關鍵字清單裡包含最後一個詞的名詞（開頭相同的優先、題數多的優先） */
function suggestions(query) {
    const words = query.split(/\s+/);
    const lastWord = normText(words[words.length - 1] || '');
    const history = searchHistory().filter(h => !query.trim() || normText(h).includes(normText(query.trim()))).map(h => ({ kind: 'history', text: h }));
    if (!lastWord) return history.slice(0, SUGGEST_LIMIT);
    const used = new Set(queryTerms(query).slice(0, -1));
    const terms = (window.QUIZ_KEYWORDS || []).filter(t => normText(t).includes(lastWord) && normText(t) !== lastWord && !used.has(normText(t)))
        .map(t => ({ kind: 'term', text: t, hits: termHits(t), prefix: normText(t).startsWith(lastWord) }))
        .filter(t => t.hits > 0)
        .sort((a, b) => (b.prefix - a.prefix) || (b.hits - a.hits) || (a.text.length - b.text.length));
    return [...history.slice(0, 4), ...terms].slice(0, SUGGEST_LIMIT);
}
let suggestItems = [], suggestPos = -1;
function renderSuggest() {
    const box = $('b-suggest');
    suggestItems = suggestions($('b-q').value);
    box.innerHTML = '';
    box.hidden = !suggestItems.length || document.activeElement !== $('b-q');
    if (box.hidden) return;
    if (suggestPos >= suggestItems.length) suggestPos = -1;
    if (!$('b-q').value.trim()) box.appendChild(el('div', 'suggest-title', '查詢紀錄'));
    suggestItems.forEach((it, i) => {
        const row = el('div', 'suggest-item' + (it.kind === 'history' ? ' history' : '') + (i === suggestPos ? ' on' : ''));
        row.append(el('span', 'suggest-icon', it.kind === 'history' ? '🕘' : '🔍'), el('span', 'suggest-text', it.text));
        if (it.kind === 'term') row.appendChild(el('small', 'cnt', `${it.hits} 題`));
        else {
            const del = el('button', 'suggest-del', '×');
            del.type = 'button';
            del.title = '刪除這筆查詢紀錄';
            del.onmousedown = e => e.preventDefault();   // 不讓輸入框失去焦點
            del.onclick = e => { e.stopPropagation(); removeSearchHistory(it.text); renderSuggest(); };
            row.appendChild(del);
        }
        row.onmousedown = e => e.preventDefault();
        row.onclick = () => pickSuggestion(it);
        box.appendChild(row);
    });
    if (!$('b-q').value.trim()) {
        const clear = el('button', 'linkbtn suggest-clear', '清除全部查詢紀錄');
        clear.type = 'button';
        clear.onmousedown = e => e.preventDefault();
        clear.onclick = () => { if (confirm('確定要清除全部查詢紀錄嗎？')) { settings.searchHistory = []; saveSettings(); renderSuggest(); } };
        box.appendChild(clear);
    }
}
/* 查詢紀錄：整串換掉；關鍵字：換掉正在輸入的最後一個詞 */
function pickSuggestion(it) {
    const input = $('b-q');
    if (it.kind === 'history') input.value = it.text;
    else input.value = input.value.replace(/\S*$/, it.text);
    suggestPos = -1;
    setBrowseQuery(input.value, true);
    renderSuggest();
}
function setBrowseQuery(query, remember) {
    browseQuery = query;
    if (remember) addSearchHistory(query);
    renderStats();
    renderBrowse(true);
}
function onSearchKey(e) {
    const box = $('b-suggest');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!suggestItems.length) return;
        e.preventDefault();
        const n = suggestItems.length;
        suggestPos = e.key === 'ArrowDown' ? (suggestPos + 1) % n : (suggestPos <= 0 ? n - 1 : suggestPos - 1);
        renderSuggest();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!box.hidden && suggestPos >= 0) pickSuggestion(suggestItems[suggestPos]);
        else { setBrowseQuery($('b-q').value, true); box.hidden = true; }
    } else if (e.key === 'Escape' && !box.hidden) {
        e.preventDefault();   // 建議開著時只關掉建議，不清空關鍵字（第二次按 Esc 才清空）
        box.hidden = true;
        suggestPos = -1;
    }
}

function initBrowse() {
    $('b-sort').onchange = () => { settings.browseSort = $('b-sort').value; saveSettings(); renderBrowse(true); };
    $('b-toggle').onclick = toggleAnswers;
    if (!['all', 'question', 'answer'].includes(settings.browseScope)) settings.browseScope = 'all';
    $('b-scope').value = settings.browseScope;
    $('b-scope').onchange = () => { settings.browseScope = $('b-scope').value; saveSettings(); renderStats(); renderBrowse(true); };
    const input = $('b-q');
    input.oninput = () => { suggestPos = -1; setBrowseQuery(input.value, false); renderSuggest(); };
    input.onchange = () => addSearchHistory(input.value);   // 離開輸入框時記下這次查詢
    input.onfocus = renderSuggest;
    input.onblur = () => { $('b-suggest').hidden = true; suggestPos = -1; };
    input.onkeydown = onSearchKey;
}
