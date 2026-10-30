// 標記範例建立樣板、樣板管理的端對端測試
const { test, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openPage, closeBrowser } = require('./helpers');

after(closeBrowser);

const SOURCE = path.join(__dirname, '..', 'source');
const MANAGE = { file: 'manage.html' };

/* 在頁面裡依文字標記：line 行裡第 n 次出現的 text（n 從 0 起算） */
const MARK = `window.markText = (kind, line, text, n = 0) => {
    const s = pdfWork.lines[line];
    let at = -1;
    for (let k = 0; k <= n; k++) at = s.indexOf(text, at + 1);
    if (at < 0) throw new Error('找不到 ' + text);
    return addTemplateMark(kind, line, at, at + text.length);
};`;

async function uploadText(page, name, lines) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2quiz-')), name);
    fs.writeFileSync(file, lines.join('\n'));
    await (await page.$('#p-text-file')).uploadFile(file);
    await page.waitForFunction(() => !$('p-work').hidden, { timeout: 5000 });
    await page.evaluate(MARK);
}

/* 合成的題目：答案寫在【 】裡、選項 (A)～(D)，內建樣板都拆不出來 */
const BRACKET_LINES = [
    '保險法規 第 1 頁',
    '第1題 下列何者是保險的基本原則？',
    '(A)最大誠信 (B)隨便 (C)不用告知 (D)以上皆非',
    '【答】A',
    '第2題 要保人應該',
    '(A)據實說明 (B)隱瞞 (C)誇大',
    '【答】C',
    '保險法規 第 2 頁',
    '第3題 保險契約的成立需要 (A)要約 (B)承諾',
    '【答】B',
];

describe('標記範例建立樣板', () => {
    test('用真實 PDF 標兩題：推出的樣板和內建樣板拆出相同的 504 題', async () => {
        const page = await openPage(MANAGE);
        await (await page.$('#p-pdf-file')).uploadFile(path.join(SOURCE, fs.readdirSync(SOURCE).find(f => f.startsWith('金融市場常識'))));
        await page.waitForFunction(() => !$('p-work').hidden, { timeout: 20000 });
        await page.evaluate(MARK);
        await page.evaluate(() => { $('t-builder').open = true; });
        const r = await page.evaluate(() => {
            // 第 1 題（第 3、4 行）
            markText('answer', 2, '(4)'); markText('num', 2, '1');
            markText('option', 2, '(1)提供金融工具交易的場所'); markText('option', 2, '(2)擔任資金需求者與');
            markText('option', 3, '(3)促進投資活動的效率，提升經濟發展'); markText('option', 3, '(4)提供交易者投機的場所');
            // 第 2 題（第 5 行）
            markText('answer', 4, '(4)'); markText('num', 4, '2');
            for (const o of ['(1)商業本票', '(2)銀行存款', '(3)股票', '(4)古董與藝術品']) markText('option', 4, o);
            $('t-name').value = '測試樣板';
            const d = inferFromMarks();
            return { errors: d.errors, msg: $('t-msg').textContent, start: d.template && d.template.start };
        });
        assert.deepEqual(r.errors, []);
        assert.match(r.msg, /結果和標記一致。套用到整份文字：解析出 504 題、無法解析 0 段/);
        await page.click('#t-save');
        await page.waitForFunction(() => /已儲存樣板/.test($('p-result').textContent));
        const after = await page.evaluate(() => {
            const builtin = parseWithTemplate(pdfWork.lines, BUILTIN_TEMPLATES[0]).questions;
            const t = pdfWork.ranked[pdfWork.chosen].template;
            return { name: t.name, id: t.id, same: JSON.stringify(builtin) === JSON.stringify(pdfWork.questions), saved: userTemplates.length, list: $('t-list').textContent };
        });
        assert.equal(after.name, '測試樣板');
        assert.match(after.id, /^user-[A-Z2-9]{4}$/);
        assert.equal(after.same, true);
        assert.equal(after.saved, 1);
        assert.match(after.list, /測試樣板/);
        // 建立的題庫記下用的樣板 id；重新開啟後樣板還在
        await page.evaluate(() => { $('p-key').value = 'TST'; onKeyInput(); });
        await page.click('#p-create');
        await page.waitForFunction(() => /已匯入題庫/.test($('p-result').textContent));
        assert.equal(await page.evaluate(() => Object.values(userBankData)[0].bank.template), after.id);
        await page.reload();
        await page.waitForFunction(() => typeof userTemplates !== 'undefined' && userTemplates.length === 1);
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('答案在選項後的格式：用滑鼠選取文字標記、忽略頁首，推出的樣板能拆出全部 3 題', async () => {
        const page = await openPage(MANAGE);
        await uploadText(page, '保險法規.txt', BRACKET_LINES);
        assert.equal(await page.evaluate(() => pdfWork.ranked[0].result.questions.length), 0);   // 內建樣板都不合
        await page.evaluate(() => { $('t-builder').open = true; renderMarkLines(); });
        // 用真的選取範圍標記第 1 題的題號
        await page.evaluate(() => {
            const text = document.querySelector('.t-text[data-line="1"]').firstChild;
            const r = document.createRange();
            r.setStart(text, 1); r.setEnd(text, 2);
            getSelection().removeAllRanges(); getSelection().addRange(r);
        });
        await page.click('#t-num');
        assert.deepEqual(await page.evaluate(() => tplMarks), [{ kind: 'num', line: 1, start: 1, end: 2 }]);
        assert.equal(await page.$eval('.t-text[data-line="1"] mark.mk-num', e => e.textContent), '1');
        // 只標一題時提示多標
        await page.evaluate(() => { for (const o of ['(A)最大誠信', '(B)隨便', '(C)不用告知', '(D)以上皆非']) markText('option', 2, o); markText('answer', 3, 'A'); });
        assert.match(await page.evaluate(() => inferFromMarks().errors.join()), /至少要標 2 題/);
        // 第 2 題；頁首點一下那一行再按「忽略這行」
        await page.evaluate(() => {
            markText('num', 4, '2');
            for (const o of ['(A)據實說明', '(B)隱瞞', '(C)誇大']) markText('option', 5, o);
            markText('answer', 6, 'C');
            const text = document.querySelector('.t-text[data-line="0"]').firstChild;
            const r = document.createRange();
            r.setStart(text, 2); r.collapse(true);
            getSelection().removeAllRanges(); getSelection().addRange(r);
        });
        await page.click('#t-ignore');
        const r = await page.evaluate(() => {
            const d = inferFromMarks();
            return { t: d.template, msg: $('t-msg').textContent, ignored: !!document.querySelector('.t-line.t-ignored') };
        });
        assert.equal(r.ignored, true);
        assert.equal(r.t.options.count, 'auto');
        assert.equal(r.t.answer.position, 'pattern');
        assert.match(r.msg, /解析出 3 題、無法解析 0 段/);
        await page.click('#t-save');
        await page.waitForFunction(() => /已儲存樣板/.test($('p-result').textContent));
        const qs = await page.evaluate(() => pdfWork.questions.map(q => [q.num, q.question, q.options.length, q.answer]));
        assert.deepEqual(qs, [[1, '下列何者是保險的基本原則？', 4, 1], [2, '要保人應該', 3, 3], [3, '保險契約的成立需要', 2, 2]]);
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('修改後套回範例結果不一致時不儲存；重疊的標記不接受', async () => {
        const page = await openPage(MANAGE);
        await uploadText(page, '保險法規.txt', BRACKET_LINES);
        await page.evaluate(() => { $('t-builder').open = true; });
        const r = await page.evaluate(() => {
            const overlap = [markText('num', 1, '1'), markText('num', 1, '1')];
            for (const o of ['(A)最大誠信', '(B)隨便', '(C)不用告知', '(D)以上皆非']) markText('option', 2, o);
            markText('answer', 3, 'A');
            markText('num', 4, '2'); markText('option', 5, '(A)據實說明'); markText('option', 5, '(B)隱瞞'); markText('answer', 6, 'C');
            return { overlap, errors: inferFromMarks().errors };
        });
        assert.equal(r.overlap[0], null);
        assert.match(r.overlap[1], /重疊/);
        // 標的答案 C 超出標記的 2 個選項
        assert.match(r.errors.join(), /第 2 題的答案 \(C\) 超出標記的選項數/);
        await page.evaluate(() => { markText('option', 5, '(C)誇大'); inferFromMarks(); });
        // 把答案的規則改壞
        await page.evaluate(() => { const t = JSON.parse($('t-json').value); t.answer.pattern = '答案：(?<ans>[A-E])'; $('t-json').value = JSON.stringify(t); });
        await page.click('#t-save');
        assert.match(await page.$eval('#t-msg', e => e.textContent), /結果不一致，沒有儲存/);
        assert.equal(await page.evaluate(() => userTemplates.length), 0);
        await page.closeContext();
    });
});

describe('樣板管理', () => {
    const TEMPLATE = { id: 'user-ABCD', name: '我的樣板', start: '^(?<num>\\d+)[.．]\\s*(?<rest>.*)$', sequential: 1, options: { marker: 'circled', count: 'auto' }, answer: { position: 'pattern', pattern: '答案[:：](?<ans>[①-⑤])$' }, ignore: [], ignorePattern: [] };

    test('匯入、重複匯入、和內建 id 相同另存、格式錯誤、刪除', async () => {
        const page = await openPage(MANAGE);
        const r = await page.evaluate(async t => {
            const file = { format: TEMPLATE_FORMAT, version: 1, template: t };
            const out = [await importData(file), await importData(file)];
            out.push(await importData({ ...file, template: { ...t, id: BUILTIN_TEMPLATES[0].id, name: '撞名' } }));
            out.push(await importData({ ...file, template: { ...t, start: '^(?<num>\\d+)' } }).catch(e => e.message));
            out.push(await importData({ ...file, template: { ...t, options: { marker: 'star', count: 4 } } }).catch(e => e.message));
            return { out, ids: userTemplates.map(x => x.id) };
        }, TEMPLATE);
        assert.match(r.out[0], /已匯入樣板「我的樣板」（user-ABCD）/);
        assert.match(r.out[1], /內容相同，沒有變更/);
        assert.match(r.out[2], /另存成新的 id/);
        assert.match(r.out[3], /缺少具名群組 rest/);
        assert.match(r.out[4], /options\.marker/);
        assert.equal(r.ids.length, 2);
        assert.ok(!r.ids.includes(await page.evaluate(() => BUILTIN_TEMPLATES[0].id)));
        await page.evaluate(() => [...document.querySelectorAll('#t-list .item-row')].find(r => r.textContent.includes('user-ABCD')).querySelector('button:last-child').click());
        await page.waitForFunction(() => userTemplates.length === 1);
        await page.closeContext();
    });

    test('完整備份帶著樣板；其他分頁改了樣板，題庫管理頁跟著更新、測驗頁不重新整理', async () => {
        const page = await openPage(MANAGE);
        const quiz = await page.openSibling('index.html');
        await quiz.evaluate(() => { window.notReloaded = true; });
        const other = await page.openSibling('manage.html');
        await other.evaluate(t => importData({ format: TEMPLATE_FORMAT, version: 1, template: t }), TEMPLATE);
        await page.bringToFront();
        await page.waitForFunction(() => userTemplates.length === 1 && /我的樣板/.test($('t-list').textContent), { polling: 100, timeout: 5000 });
        await new Promise(r => setTimeout(r, 300));
        assert.equal(await quiz.evaluate(() => window.notReloaded), true);
        const backup = await page.evaluate(() => buildBackup());
        assert.equal(backup.templates.length, 1);
        await page.closeContext();
        const fresh = await openPage(MANAGE);
        assert.match(await fresh.evaluate(d => importData(d), backup), /已匯入樣板「我的樣板」/);
        assert.deepEqual(await fresh.evaluate(() => userTemplates.map(t => t.id)), ['user-ABCD']);
        await fresh.closeContext();
    });
});
