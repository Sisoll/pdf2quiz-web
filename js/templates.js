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

/* ---------- 從標記的範例推出樣板 ----------
   marks：[{ kind: 'num' | 'option' | 'answer' | 'ignore', line, start, end }]，line 是第幾行（0 起算），start／end 是該行的字元位置。
   每一題範例以「題號」標記開頭；同一行或之後各行的選項、答案標記都屬於最近的那一題（答案在題號前也算同一行）。 */
const MARKER_RES = {
    'paren-digit': /[(（]\s*[1-9]\s*[)）]/,
    'paren-alpha': /[(（]\s*[A-Ea-e]\s*[)）]/,
    circled: /[①-⑤]/,
};
const ANSWER_CHARS = { digit: '1-9', alpha: 'A-Ea-eＡ-Ｅａ-ｅ', circled: '①-⑤' };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* 範例裡的文字轉成規則：空白可多可少、全形半形的括號與標點都接受 */
function literalPattern(s, { space = '\\s*', digits = false } = {}) {
    let out = '';
    for (const part of s.match(/\s+|\d+|./gu) || []) {
        if (/^\s+$/.test(part)) out += space;
        else if (digits && /^\d+$/.test(part)) out += '\\d+';
        else if ('(（'.includes(part)) out += '[(（]';
        else if (')）'.includes(part)) out += '[)）]';
        else if ('.．'.includes(part)) out += '[.．]';
        else if (':：'.includes(part)) out += '[:：]';
        else out += escapeRe(part);
    }
    return out.replace(/(\\s\*)+/g, '\\s*');
}
function commonPrefix(list) {
    let s = list[0];
    for (const x of list.slice(1)) { while (s && !x.startsWith(s)) s = s.slice(0, -1); }
    return s;
}
function commonSuffix(list) {
    let s = list[0];
    for (const x of list.slice(1)) { while (s && !x.endsWith(s)) s = s.slice(1); }
    return s;
}
/* 選項標記：選取範圍本身以標記開頭，或標記緊接在選取範圍前面 */
function optionMarker(line, m) {
    for (const [name, re] of Object.entries(MARKER_RES)) {
        const head = new RegExp('^\\s*' + re.source).exec(line.slice(m.start, m.end));
        if (head) return { name, contentStart: m.start + head[0].length };
        if (new RegExp(re.source + '\\s*$').test(line.slice(0, m.start))) return { name, contentStart: m.start };
    }
    return null;
}
/* 答案標記裡真正的答案字元（選取時可能連括號一起選） */
function answerCore(line, m) {
    const text = line.slice(m.start, m.end);
    const i = text.search(/[1-9A-Ea-eＡ-Ｅａ-ｅ①-⑤]/u);
    if (i < 0) return null;
    const ch = text[i];
    const kind = /[1-9]/.test(ch) ? 'digit' : /[①-⑤]/.test(ch) ? 'circled' : 'alpha';
    return { at: m.start + i, end: m.start + i + 1, value: answerIndex(ch), kind };
}
function inferTemplate(lines, marks, { name = '自訂樣板', id = 'user-new' } = {}) {
    const errors = [];
    const sorted = [...marks].sort((a, b) => a.line - b.line || a.start - b.start);
    const nums = sorted.filter(m => m.kind === 'num');
    if (nums.length < 2) return { errors: [`至少要標 2 題範例（目前 ${nums.length} 題），程式才分得出哪些是固定格式`] };
    const samples = nums.map(m => ({ num: m, options: [], answers: [] }));
    for (const m of sorted) {
        if (m.kind === 'num' || m.kind === 'ignore') continue;
        const owner = [...samples].reverse().find(s => s.num.line <= m.line);
        if (!owner) { errors.push(`第 ${m.line + 1} 行的標記在第一個題號之前`); continue; }
        (m.kind === 'option' ? owner.options : owner.answers).push(m);
    }
    for (const s of samples) {
        s.label = lines[s.num.line].slice(s.num.start, s.num.end).trim();
        s.value = /^\d+$/.test(s.label) ? Number(s.label) : null;
        if (s.value === null) errors.push(`第 ${s.num.line + 1} 行標成題號的「${s.label}」不是數字`);
        if (s.options.length < 2) errors.push(`第 ${s.label} 題至少要標 2 個選項`);
        if (s.answers.length !== 1) errors.push(`第 ${s.label} 題要標 1 個答案（目前 ${s.answers.length} 個）`);
    }
    if (errors.length) return { errors };

    // 選項標記的樣式與數量
    const markers = new Set();
    for (const s of samples) for (const o of s.options) {
        const mk = optionMarker(lines[o.line], o);
        if (!mk) { errors.push(`第 ${s.label} 題的選項「${lines[o.line].slice(o.start, o.end)}」前面找不到 (1)、(A)、① 這類標記`); continue; }
        markers.add(mk.name);
        o.content = lines[o.line].slice(mk.contentStart, o.end).trim();
    }
    if (markers.size > 1) errors.push('範例的選項標記樣式不一致（例如有的是 (1)、有的是 (A)）');
    const counts = new Set(samples.map(s => s.options.length));
    if (Math.max(...counts) > 5) errors.push('選項最多 5 個');

    // 答案：在題號前（同一行）或在其他位置（用答案前面固定的文字辨認）
    const kinds = new Set();
    for (const s of samples) {
        const a = s.answers[0];
        s.core = answerCore(lines[a.line], a);
        if (!s.core) { errors.push(`第 ${s.label} 題標成答案的文字裡找不到 1～9、A～E 或 ①～⑤`); continue; }
        kinds.add(s.core.kind);
        if (s.core.value > s.options.length) errors.push(`第 ${s.label} 題的答案 (${lines[a.line][s.core.at]}) 超出標記的選項數`);
        s.answerFirst = a.line === s.num.line && s.core.end <= s.num.start;
    }
    if (errors.length) return { errors };
    if (new Set(samples.map(s => s.answerFirst)).size > 1) return { errors: ['範例的答案位置不一致（有的在題號前、有的不是）'] };
    const ansClass = `[${[...kinds].map(k => ANSWER_CHARS[k]).join('')}]`;
    const answerFirst = samples[0].answerFirst;

    // 題目開頭：題號前後的文字。題號後面接的文字取各範例共同的開頭，到空白為止（例如「題 」「. 」），最多 2 個字；
    // 沒有空白時（中文字之間的空白已經去掉）只接受「題」和標點，避免把題目剛好相同的開頭當成格式
    const shared = commonPrefix(samples.map(s => lines[s.num.line].slice(s.num.end)));
    const upToSpace = /^(\S{0,2})\s+/.exec(shared);
    const sep = upToSpace ? upToSpace[0] : /^題?[.．、:：)）]*/.exec(shared)[0];
    const startOf = s => {
        const line = lines[s.num.line];
        const sepRe = /^\s+$/.test(sep) ? '\\s+' : sep ? literalPattern(sep) : '\\s*';
        const head = answerFirst
            ? `^${literalPattern(line.slice(0, s.core.at))}(?<ans>${ansClass})${literalPattern(line.slice(s.core.end, s.num.start))}`
            : `^${literalPattern(line.slice(0, s.num.start))}`;
        return `${head}(?<num>\\d+)${sepRe}(?<rest>.*)$`;
    };
    const starts = new Set(samples.map(startOf));
    if (starts.size > 1) return { errors: ['範例的題號格式不一致：' + [...starts].join(' ／ ')] };

    let answer = { position: 'start' };
    if (!answerFirst) {
        // 答案前面固定的文字（例如「答案：」）：取各範例共同的結尾，只看最後一個選項之後的部分
        const befores = samples.map(s => {
            const a = s.answers[0], line = lines[a.line];
            const optEnd = Math.max(0, ...s.options.filter(o => o.line === a.line && o.end <= s.core.at).map(o => o.end));
            const numEnd = a.line === s.num.line && s.num.end <= s.core.at ? s.num.end : 0;
            return line.slice(Math.max(optEnd, numEnd), s.core.at).replace(/[(（【[]\s*$/, '');
        });
        let label = commonSuffix(befores);
        const ws = label.search(/\S+\s*$/);
        label = (ws > 0 ? label.slice(ws) : label).trim();
        if (!label) return { errors: ['答案前面沒有固定的文字（例如「答案：」），無法辨認答案的位置'] };
        const atEnd = samples.every(s => !lines[s.answers[0].line].slice(s.core.end).replace(/[)）】\]]/, '').trim());
        answer = { position: 'pattern', pattern: `${literalPattern(label)}\\s*[(（【\\[]?\\s*(?<ans>${ansClass})\\s*[)）】\\]]?${atEnd ? '\\s*$' : ''}` };
    }

    // 忽略的行：純數字（頁碼）一律忽略；含數字的行把數字換成任意數字
    const ignore = [], ignorePattern = ['^\\d+$'];
    for (const m of sorted.filter(x => x.kind === 'ignore')) {
        const t = lines[m.line].trim();
        if (!t || /^\d+$/.test(t)) continue;
        if (/\d/.test(t)) { const p = `^\\s*${literalPattern(t, { digits: true })}\\s*$`; if (!ignorePattern.includes(p)) ignorePattern.push(p); }
        else if (!ignore.includes(t)) ignore.push(t);
    }
    const template = {
        id, name,
        example: lines[samples[0].num.line],
        start: [...starts][0],
        sequential: 1,
        options: { marker: [...markers][0], count: counts.size === 1 ? [...counts][0] : 'auto' },
        answer,
        ignore, ignorePattern,
    };
    return { template, samples: samples.map(s => ({ num: s.value, answer: s.core.value, options: s.options.map(o => o.content) })), errors: [] };
}
/* 推出的樣板套回範例本身，結果要和標記一致 */
function verifyTemplate(lines, template, samples) {
    const { questions } = parseWithTemplate(lines, template);
    const norm = s => s.replace(/\s+/g, '');
    const out = [];
    for (const s of samples) {
        const q = questions.find(x => x.num === s.num);
        if (!q) { out.push(`第 ${s.num} 題：套用樣板後沒有拆出這一題`); continue; }
        if (q.options.length !== s.options.length) out.push(`第 ${s.num} 題：拆出 ${q.options.length} 個選項，標記的是 ${s.options.length} 個`);
        else if (s.options.some((o, i) => !norm(q.options[i]).startsWith(norm(o)))) out.push(`第 ${s.num} 題：拆出的選項和標記的不同`);
        if (q.answer !== s.answer) out.push(`第 ${s.num} 題：拆出的答案是 (${q.answer})，標記的是 (${s.answer})`);
    }
    return out;
}
/* 樣板設定的檢查（匯入或手動修改時） */
function validateTemplate(t) {
    if (!t || typeof t !== 'object') return '不是樣板';
    if (!t.id || typeof t.id !== 'string') return '樣板缺少 id';
    if (!t.name || typeof t.name !== 'string') return '樣板缺少名稱';
    const re = (src, groups, what) => {
        let r;
        try { r = new RegExp(src); } catch (e) { return `${what}不是正確的正規表達式：${e.message}`; }
        const missing = groups.filter(g => !new RegExp(`\\(\\?<${g}>`).test(src));
        return missing.length ? `${what}缺少具名群組 ${missing.join('、')}` : (r && null);
    };
    if (typeof t.start !== 'string') return '樣板缺少 start';
    const pos = t.answer && t.answer.position;
    if (!['start', 'pattern'].includes(pos)) return 'answer.position 要是 start 或 pattern';
    const e1 = re(t.start, pos === 'start' ? ['num', 'rest', 'ans'] : ['num', 'rest'], 'start ');
    if (e1) return e1;
    if (pos === 'pattern') { const e2 = re(String(t.answer.pattern || ''), ['ans'], 'answer.pattern '); if (e2) return e2; }
    if (!t.options || !MARKERS[t.options.marker]) return `options.marker 要是 ${Object.keys(MARKERS).join('、')} 其中之一`;
    if (!(t.options.count === 'auto' || (Number.isInteger(t.options.count) && t.options.count >= 2 && t.options.count <= 5))) return 'options.count 要是 2～5 或 auto';
    if (t.sequential !== undefined && !(Number.isInteger(t.sequential) && t.sequential >= 0)) return 'sequential 要是 0 以上的整數';
    if (t.ignore !== undefined && !(Array.isArray(t.ignore) && t.ignore.every(x => typeof x === 'string'))) return 'ignore 要是文字的陣列';
    if (t.ignorePattern !== undefined) {
        if (!Array.isArray(t.ignorePattern)) return 'ignorePattern 要是陣列';
        for (const p of t.ignorePattern) { try { new RegExp(p); } catch (e) { return `ignorePattern「${p}」不是正確的正規表達式`; } }
    }
    return null;
}
