/* 全域狀態與初始化（最後載入） */
const allQuestions = window.QUIZ_DATA || [];
let settings = loadSettings();
let records = migrateRecords(loadRecords());
let queue = [];
let pos = 0;
let answeredInView = false;
let advancing = false;
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

function init() {
    if (!allQuestions.length) {
        $('question').textContent = '找不到題庫。請先執行 parse_pdf.py 產生 questions.js。';
        return;
    }
    const cats = [...new Set(allQuestions.map(q => q.category))];
    $('f-category').innerHTML = '<option value="all">全部科目</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
    $('f-category').value = cats.includes(settings.category) ? settings.category : 'all';
    $('f-order').value = settings.order;
    $('f-threshold').value = settings.threshold;
    $('f-min').value = settings.min;
    $('f-max').value = settings.max;
    $('f-limit').value = settings.limit;
    if (!Array.isArray(settings.include)) settings.include = [];
    if (!Array.isArray(settings.exclude)) settings.exclude = ['noReview'];
    buildChips();
    initBrowse();
    initExam();
    $('undo-btn').onclick = undoAnswer;
    document.querySelectorAll('#tabs .tab').forEach(t => { t.onclick = () => setView(t.dataset.view); });

    $('start-btn').onclick = toggleStart;
    $('stop-btn').onclick = stop;
    ['f-category', 'f-order', 'f-min', 'f-max', 'f-limit'].forEach(id => { $(id).onchange = onFiltersChanged; });
    ['f-min', 'f-max', 'f-limit'].forEach(id => { $(id).oninput = onFiltersChanged; });
    $('f-range-clear').onclick = () => { $('f-min').value = ''; $('f-max').value = ''; onFiltersChanged(); };
    $('f-chips-reset').onclick = () => { settings.include = []; settings.exclude = ['noReview']; onFiltersChanged(); };
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
        if (view === 'exam') return examKey(e);
        if (view !== 'quiz') return;   // 題目總覽頁不使用作答快捷鍵
        const k = e.key.toLowerCase();
        // Enter 一律由這裡處理（preventDefault 也會擋掉按鈕預設的點擊，避免重複觸發）
        if (e.key === 'Escape') stop();
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
}

window.onload = init;
