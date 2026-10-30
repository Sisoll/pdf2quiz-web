/* 全域狀態與初始化（最後載入） */
let allQuestions = [];    // 目前選用的題庫或組合的題目
let currentSource = null; // 目前選用的題庫或組合
let settings = loadSettings();
let records = emptyRecords();   // init() 載入題庫後從 IndexedDB 載入
let queue = [];
let pos = 0;
let answeredInView = false;
let advancing = false;
let shownAt = 0;         // 目前這題顯示的時間，用來算作答秒數
let lastAnswer = null;   // 最近一次作答，給「復原」用
let session = null;      // 進行中的一輪：{ limit, round, answers, answered, correct, skipped, startedAt }
let lastResult = null;   // 上一輪的成績
let view = 'quiz';       // 目前的分頁：quiz（練習）或 browse（題目總覽）

/* 切換分頁；回到練習時不重畫題目，避免已作答的畫面被清掉 */
function setView(v) {
    view = v;
    document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
    $('quiz').hidden = v !== 'quiz';
    $('browse').hidden = v !== 'browse';
    $('exam').hidden = v !== 'exam';
    $('setup').hidden = v === 'exam';   // 模擬考有自己的設定
    document.body.classList.toggle('view-browse', v === 'browse');
    if (v === 'browse') renderBrowse(true);
    else if (v === 'exam') { if (!exam && $('exam-result').hidden) renderExamHistory(); }
    else renderStats();
}

/* 換題庫或組合：題目、科目選單、模擬考各科題數跟著換 */
function applySource(src) {
    currentSource = src;
    settings.source = src.id;
    allQuestions = sourceQuestions(src);
    const cats = categoryList(allQuestions);
    // 舊版設定存的是科目名稱，換成類別 key
    const byName = cats.find(c => c.name === settings.category);
    if (byName) settings.category = byName.key;
    if (!cats.some(c => c.key === settings.category)) settings.category = 'all';
    $('f-category').innerHTML = '<option value="all">全部科目</option>' + cats.map(c => `<option value="${c.key}">${c.name}</option>`).join('');
    $('f-category').value = settings.category;
    $('f-source').title = src.combo ? `組合：${sourceBanksText(src)}` : '';
    document.querySelector('.brand-sub').textContent = src.name;
    document.querySelector('.brand-sub').title = src.combo ? `包含：${sourceBanksText(src)}` : '';
    renderExamCounts();
}
/* 題庫選單：組合題庫和單一題庫分成兩組；滑鼠移到組合上顯示包含的題庫 */
function renderSourceSelect() {
    const sel = $('f-source');
    sel.innerHTML = '';
    for (const [label, list] of [['組合題庫', sourceList().filter(s => s.combo)], ['單一題庫', sourceList().filter(s => !s.combo)]]) {
        if (!list.length) continue;
        const group = Object.assign(document.createElement('optgroup'), { label });
        for (const s of list) group.appendChild(Object.assign(document.createElement('option'), { value: s.id, textContent: s.name, title: s.combo ? `包含：${sourceBanksText(s)}` : '' }));
        sel.appendChild(group);
    }
}
function onSourceChanged() {
    if (exam) { $('f-source').value = currentSource.id; return; }
    if (!endRoundForChange()) return;
    applySource(findSource($('f-source').value));
    saveSettings();
    resetView();
}

async function init() {
    await loadBanks();
    const src = findSource(settings.source);
    if (!src) {
        $('question').textContent = '找不到題庫。請確認 banks/ 資料夾裡有題庫檔。';
        return;
    }
    records = await loadRecords();
    renderSourceSelect();
    $('f-source').value = src.id;
    applySource(src);
    showFilters();
    if (!Array.isArray(settings.include)) settings.include = [];
    if (!Array.isArray(settings.exclude)) settings.exclude = ['noReview'];
    buildChips();
    initBrowse();
    initExam();
    $('f-source').onchange = onSourceChanged;
    $('undo-btn').onclick = undoAnswer;
    document.querySelectorAll('#tabs .tab').forEach(t => { t.onclick = () => setView(t.dataset.view); });

    $('start-btn').onclick = toggleStart;
    $('stop-btn').onclick = stop;
    ['f-category', 'f-order', 'f-min', 'f-max', 'f-limit'].forEach(id => { $(id).onchange = onFiltersChanged; });
    ['f-min', 'f-max', 'f-limit'].forEach(id => { $(id).oninput = onFiltersChanged; });
    $('f-range-clear').onclick = () => { $('f-min').value = ''; $('f-max').value = ''; onFiltersChanged(); };
    $('f-chips-reset').onclick = () => { if (!endRoundForChange()) return; settings.include = []; settings.exclude = ['noReview']; onFiltersChanged(); };
    ['f-jump', 'f-limit'].forEach(id => { $(id).onkeydown = e => { if (e.key === 'Enter') { onFiltersChanged(); start(); } }; });
    $('next-btn').onclick = next;
    $('prev-btn').onclick = prev;
    document.querySelectorAll('.remark[data-level]').forEach(b => b.onclick = () => setLevel(b.dataset.level));
    $('review-btn').onclick = () => toggleMark('review');
    $('noreview-btn').onclick = () => toggleMark('noReview');
    $('export-json').onclick = exportJson;
    $('export-csv').onclick = exportCsv;
    let importMode = 'merge';
    $('import-merge').onclick = () => { importMode = 'merge'; $('import-file').click(); };
    $('import-replace').onclick = () => { importMode = 'replace'; $('import-file').click(); };
    $('import-file').onchange = e => { if (e.target.files[0]) importJson(e.target.files[0], importMode); e.target.value = ''; };
    $('reset-btn').onclick = () => {
        if (confirm('確定要清除所有作答紀錄、難度與標記嗎？建議先匯出備份。')) {
            records = emptyRecords(); saveRecords(); resetView();
        }
    };

    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if ($('round-dialog').open) return;   // 彈窗開著時交給彈窗處理（Enter 按下聚焦的按鈕、Esc 關閉）
        if (view === 'exam') return examKey(e);
        if (view !== 'quiz') return;   // 題目總覽頁不使用作答快捷鍵
        const k = e.key.toLowerCase();
        // Enter 一律由這裡處理（preventDefault 也會擋掉按鈕預設的點擊，避免重複觸發）
        if (e.key === 'Escape') { e.preventDefault(); stop(); }   // 擋掉預設動作，否則剛跳出的檢討彈窗會被同一次 Esc 關掉
        else if (!session && e.key === 'Enter') { e.preventDefault(); start(); }
        else if (['1', '2', '3', '4'].includes(e.key)) answer(+e.key);
        else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft') prev();
        else if (k === 'e') setLevel('EASY');
        else if (k === 'm') setLevel('MEDIUM');
        else if (k === 'h') setLevel('HARD');
        else if (k === 'r' || k === 'u') toggleMark('review');
        else if (k === 's') toggleMark('noReview');
        else if (k === 'z') undoAnswer();
    });

    saveRecords();   // 舊紀錄轉換後寫回
    readFilters();
    render();        // 先顯示設定畫面，按「開始」才出題
    initRecordFile();
    onDataChanged(onOtherTabChanged);
}

/* 其他分頁（例如題庫管理頁）改了資料：作答紀錄直接重新讀取；題庫變了要重新整理頁面，進行中的練習或考試先不打斷 */
async function onOtherTabChanged(kind) {
    if (kind === 'records') {
        records = await loadRecords();
        lastAnswer = null;   // 紀錄換過了，不能再復原上一筆
        renderStats();
        if (view === 'browse') renderBrowse();
        return;
    }
    if (kind === 'templates') return;   // 樣板只有題庫管理頁用得到
    if (session || exam) { alert('題庫或組合在其他分頁更新了，這一輪結束後請重新整理頁面。'); return; }
    location.reload();
}

window.onload = init;
