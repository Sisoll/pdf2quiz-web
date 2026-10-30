/* 樣板：依版面設定把取出的文字行拆成題目，並檢查結果
   樣板欄位（見 templates/index.js）：
     start         題目開頭的正規表達式，必須有具名群組 num（題號）與 rest（同一行的其餘文字）；答案在題號前時另有 ans
     sequential    題號必須比上一題大，而且最多跳幾號才算新題目（避免題目內容剛好像題號）；0 表示不檢查
     options       { marker: 'paren-digit' | 'paren-alpha' | 'circled', count: 數字或 'auto'（2～5 自動判斷） }
     answer        { position: 'start' }（答案在 start 的 ans 群組）或 { position: 'pattern', pattern: 含 ans 群組的正規表達式 }
     ignore        含這些文字的行忽略；ignorePattern 符合這些正規表達式的行忽略 */
const BUILTIN_TEMPLATES = (window.QUIZ_TEMPLATES || []).map(t => ({ ...t, builtin: true }));
const MARKERS = {
    'paren-digit': n => [`(${n})`, `（${n}）`],
    'paren-alpha': n => { const c = 'ABCDE'[n - 1]; return [`(${c})`, `（${c}）`, `(${c.toLowerCase()})`]; },
    circled: n => ['①②③④⑤'[n - 1]],
};

/* 中文折行直接接起來；兩端都是英數字時補一個空白（和舊版 parse_pdf.py 相同） */
function joinLines(lines) {
    let out = '';
    for (const l of lines) {
        if (out && /[A-Za-z0-9]/.test(l[0]) && /[A-Za-z0-9]/.test(out.slice(-1))) out += ' ';
        out += l;
    }
    return out;
}
/* 從後往前找選項標記，避免題幹裡的括號干擾；找不到全部 count 個標記時回傳 null */
function splitOptions(text, marker, count) {
    const pos = [];
    let end = text.length;
    for (let n = count; n >= 1; n--) {
        let best = -1, len = 0;
        for (const m of MARKERS[marker](n)) {
            const p = text.lastIndexOf(m, end - 1);
            if (p > best) { best = p; len = m.length; }
        }
        if (best < 0) return null;
        pos.unshift({ at: best, len });
        end = best;
    }
    const question = text.slice(0, pos[0].at).trim();
    const options = pos.map((p, i) => text.slice(p.at + p.len, i + 1 < pos.length ? pos[i + 1].at : text.length).trim());
    return !question || options.some(o => !o) ? null : { question, options };
}
/* 答案轉成第幾個選項（1 起算）：數字、英文字母（含全形）、圈號都可以 */
function answerIndex(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim().normalize('NFKC').toUpperCase();
    if (/^[1-9]$/.test(s)) return Number(s);
    if (/^[A-E]$/.test(s)) return s.charCodeAt(0) - 64;
    const c = '①②③④⑤'.indexOf(String(v).trim());
    return c >= 0 ? c + 1 : null;
}

function parseWithTemplate(lines, tpl) {
    const start = new RegExp(tpl.start);
    const ignoreRes = (tpl.ignorePattern || []).map(p => new RegExp(p));
    const kept = lines.filter(l => !(tpl.ignore || []).some(h => l.includes(h)) && !ignoreRes.some(r => r.test(l)));
    const blocks = [];
    for (const l of kept) {
        const m = start.exec(l);
        const last = blocks[blocks.length - 1];
        const num = m && m.groups && Number(m.groups.num);
        const isNext = m && Number.isFinite(num) && (!tpl.sequential || !last || (num > last.num && num - last.num <= tpl.sequential));
        if (isNext) blocks.push({ num, ans: m.groups.ans, lines: [m.groups.rest || ''] });
        else if (last) last.lines.push(l);
    }
    const questions = [], problems = [];
    for (const b of blocks) {
        let text = joinLines(b.lines.filter(Boolean));
        let ans = b.ans;
        if (tpl.answer.position === 'pattern') {
            const mm = new RegExp(tpl.answer.pattern).exec(text);
            if (mm) { ans = mm.groups.ans; text = (text.slice(0, mm.index) + text.slice(mm.index + mm[0].length)).trim(); }
        }
        let parsed = null;
        const counts = tpl.options.count === 'auto' ? [5, 4, 3, 2] : [tpl.options.count];
        for (const n of counts) if ((parsed = splitOptions(text, tpl.options.marker, n))) break;
        const answer = answerIndex(ans);
        if (!parsed) problems.push({ num: b.num, reason: '找不到選項', text });
        else if (!answer) problems.push({ num: b.num, reason: '找不到答案', text });
        else if (answer > parsed.options.length) problems.push({ num: b.num, reason: `答案 (${ans}) 超出選項範圍`, text });
        else questions.push({ seq: questions.length + 1, num: b.num, question: parsed.question, options: parsed.options, answer });
    }
    return { questions, problems, checks: checkQuestions(questions, blocks.map(b => b.num)) };
}

/* 檢查：題號跳號、重複，題目文字重複（只提示，不擋） */
function checkQuestions(questions, nums) {
    const notes = [];
    const seen = new Set(), dup = new Set();
    for (const n of nums) { if (seen.has(n)) dup.add(n); seen.add(n); }
    if (dup.size) notes.push(`題號重複：${[...dup].slice(0, 10).join('、')}${dup.size > 10 ? '…' : ''}（題目 id 用流水號，不影響）`);
    const sorted = [...seen].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 1) gaps.push(`${sorted[i - 1] + 1}${sorted[i] - sorted[i - 1] > 2 ? `～${sorted[i] - 1}` : ''}`);
    if (gaps.length) notes.push(`題號跳號：缺 ${gaps.slice(0, 10).join('、')}${gaps.length > 10 ? '…' : ''}`);
    const texts = new Map();
    let sameText = 0;
    for (const q of questions) {
        const k = q.question.replace(/\s+/g, '');
        if (texts.has(k)) sameText++; else texts.set(k, q.num);
    }
    if (sameText) notes.push(`有 ${sameText} 題的題目文字和其他題相同`);
    return notes;
}

/* 所有樣板都試一次，依解析出的題數多、失敗少排序 */
function rankTemplates(lines, templates) {
    return templates.map(t => {
        let result;
        try { result = parseWithTemplate(lines, t); } catch (e) { result = { questions: [], problems: [{ num: null, reason: `樣板有誤：${e.message}`, text: '' }], checks: [] }; }
        const total = result.questions.length + result.problems.length;
        return { template: t, result, rate: total ? result.questions.length / total : 0 };
    }).sort((a, b) => b.result.questions.length - a.result.questions.length || a.result.problems.length - b.result.problems.length);
}
