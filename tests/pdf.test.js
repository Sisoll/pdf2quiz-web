// 從 PDF 建立題庫與修正題目的端對端測試
const { test, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openPage, closeBrowser, history } = require('./helpers');

after(closeBrowser);

const SOURCE = path.join(__dirname, '..', 'source');
const MANAGE = { file: 'manage.html' };
const pdfs = fs.readdirSync(SOURCE).filter(f => f.endsWith('.pdf'));

/* 合成的題目文字：題號. 題目 (A)～(D) 答案：X */
const ALPHA_LINES = [
    '保險法規題庫',
    '1. 下列何者是保險的基本原則？',
    '(A)最大誠信 (B)隨便 (C)不用告知 (D)以上皆非 答案：A',
    '2. 要保人應該 (A)據實說明 (B)隱瞞 (C)誇大 (D)省略 答案：A',
    '3. 這一題沒有選項 答案：B',
    '4. 保險契約的成立需要 (A)要約 (B)承諾 (C)兩者都要 答案：C',
];

describe('從 PDF 取出文字並套用樣板', () => {
    test('兩份真實 PDF：自動選到正確樣板，題目和內建題庫一致（只差 ETH 第 279 題的人工修正）', async () => {
        const page = await openPage(MANAGE);
        for (const f of pdfs) {
            const b64 = fs.readFileSync(path.join(SOURCE, f)).toString('base64');
            const r = await page.evaluate(async b64 => {
                const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                const { lines } = await extractPdfLines(bytes.buffer);
                const top = rankTemplates(lines, BUILTIN_TEMPLATES)[0];
                const bank = Object.values(banks).find(b => b.questions.length === top.result.questions.length);
                const norm = s => s.replace(/\s+/g, '');
                const diffs = top.result.questions.filter((q, i) => {
                    const o = bank.questions[i];
                    return !(o.num === q.num && norm(o.question) === norm(q.question) && o.options.map(norm).join('|') === q.options.map(norm).join('|') && o.answer === q.answer);
                }).map(q => `${bank.bank.key}-${q.num}`);
                return { template: top.template.id, n: top.result.questions.length, problems: top.result.problems.length, diffs };
            }, b64);
            assert.equal(r.template, 'answer-first-paren-digit');
            assert.equal(r.problems, 0);
            assert.deepEqual(r.diffs, f.startsWith('職業道德') ? ['ETH-279'] : []);
            assert.equal(r.n, f.startsWith('職業道德') ? 616 : 504);
        }
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('用介面選 PDF 建立題庫：猜出名稱與年份，建立後可以在測驗頁選', async () => {
        const page = await openPage(MANAGE);
        const input = await page.$('#p-pdf-file');
        await input.uploadFile(path.join(SOURCE, pdfs.find(f => f.startsWith('金融市場常識'))));
        await page.waitForFunction(() => !$('p-work').hidden, { timeout: 20000 });
        assert.match(await page.$eval('#p-summary', e => e.textContent), /解析出 504 題，無法解析 0 段/);
        assert.deepEqual(await page.evaluate(() => [$('p-name').value, $('p-year').value]), ['金融市場常識', '2024']);
        // 已經用過的 key：名稱帶入且不能改
        await page.type('#p-key', 'mkt');
        assert.deepEqual(await page.evaluate(() => [$('p-key').value, $('p-name').readOnly]), ['MKT', true]);
        await page.evaluate(() => { $('p-key').value = 'TST'; onKeyInput(); });
        await page.click('#p-create');
        await page.waitForFunction(() => /已匯入題庫/.test($('p-result').textContent), { timeout: 5000 });
        const bank = await page.evaluate(() => { const b = Object.values(banks).find(x => x.bank.key === 'TST'); return { id: b.bank.id, n: b.questions.length, template: b.bank.template, source: b.bank.source }; });
        assert.match(bank.id, /^TST-2024-[A-Z2-9]{4}$/);
        assert.deepEqual([bank.n, bank.template, bank.source], [504, 'answer-first-paren-digit', '金融市場常識-113.pdf']);
        const quiz = await page.openSibling('index.html');
        assert.ok(await quiz.evaluate(id => sourceList().some(s => s.id === id), bank.id));
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('匯入 Python 取出的文字檔；無法解析的段落可以手動整理成題目，並記進 corrections', async () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2quiz-')), '保險法規-2025.txt');
        fs.writeFileSync(file, ALPHA_LINES.join('\n'));
        const page = await openPage(MANAGE);
        await (await page.$('#p-text-file')).uploadFile(file);
        await page.waitForFunction(() => !$('p-work').hidden, { timeout: 5000 });
        const r = await page.evaluate(() => ({ template: pdfWork.ranked[pdfWork.chosen].template.id, n: pdfWork.questions.length, q4: pdfWork.questions[2] }));
        assert.equal(r.template, 'number-dot-paren-alpha-answer-after');
        assert.equal(r.n, 3);
        assert.deepEqual([r.q4.num, r.q4.options, r.q4.answer], [4, ['要約', '承諾', '兩者都要'], 3]);
        assert.match(await page.$eval('#p-summary', e => e.textContent), /無法解析 1 段/);
        // 手動整理第 3 題
        await page.click('#p-problems .item-row button');
        await page.evaluate(() => {
            const [q, o] = document.querySelectorAll('#p-problems .q-edit');
            q.value = '這一題原本沒有選項';
            o.value = '甲\n乙';
            document.querySelector('#p-problems input[type=number]').value = 2;
        });
        await page.click('#p-problems .btn.small');
        assert.match(await page.$eval('#p-summary', e => e.textContent), /解析出 4 題（含手動整理 1 題），無法解析 0 段/);
        // 修正第 1 題的答案
        await page.evaluate(() => { document.querySelector('#p-preview .linkbtn').click(); });
        await page.evaluate(() => { document.querySelector('#p-preview input[type=number]').value = 2; });
        await page.click('#p-preview .btn.small');
        await page.evaluate(() => { $('p-key').value = 'INS'; onKeyInput(); });
        await page.click('#p-create');
        await page.waitForFunction(() => /已匯入題庫/.test($('p-result').textContent), { timeout: 5000 });
        const saved = await page.evaluate(() => { const id = Object.keys(userBankData)[0]; return { year: userBankData[id].bank.year, corr: userBankData[id].corrections.rows.map(r => [r[0], r[1]]), q1: banks[id].questions[0].answer, n: banks[id].questions.length }; });
        assert.deepEqual(saved, { year: 2025, corr: [[4, 'manual'], [1, 'answer']], q1: 2, n: 4 });
        await page.closeContext();
    });

    test('取不到文字（掃描檔）時明確提示', async () => {
        const page = await openPage(MANAGE);
        assert.match(await page.evaluate(() => startPdfWork({ name: 'scan.pdf' }, []).catch(e => e.message)), /可能是掃描檔/);
        await page.closeContext();
    });

    test('圈號選項的樣板', async () => {
        const page = await openPage(MANAGE);
        const r = await page.evaluate(() => {
            const lines = ['(2) 1 下列何者正確？①甲②乙③丙', '(1) 2 第二題①是②否'];
            const top = rankTemplates(lines, BUILTIN_TEMPLATES)[0];
            return [top.template.id, top.result.questions.map(q => [q.options.length, q.answer])];
        });
        assert.deepEqual(r, ['answer-first-circled', [[3, 2], [2, 1]]]);
        await page.closeContext();
    });
});

describe('修正題目', () => {
    test('修正內建題庫：存在使用者資料裡，測驗頁跟著變；過去的作答不重新判定；備份還原後仍在', async () => {
        const page = await openPage({ ...MANAGE, records: { version: 2, items: { 'ETH-0001': { history: history('OE') } } } });
        const ethId = await page.evaluate(() => Object.keys(banks).find(id => id.startsWith('ETH')));
        const msg = await page.evaluate(id => { const q = banks[id].questions[0]; return correctQuestion(id, 1, { ...q, answer: q.answer === 1 ? 2 : 1 }); }, ethId);
        assert.match(msg, /已修正第 1 題（答案）。過去的作答維持當時的判定/);
        const quiz = await page.openSibling('index.html');
        const r = await quiz.evaluate(id => ({ answer: banks[id].questions[0].answer, ok: peek(Q('ETH-0001')).history[0].ok, file: window.QUIZ_BANKS[id].questions.rows[0][4] }), ethId);
        assert.equal(r.ok, true);                 // 過去的作答維持答對
        assert.notEqual(r.answer, r.file);        // 內建題庫檔本身沒變，載入時套上修正
        // 匯出的內建題庫帶著修正
        const exported = await page.evaluate(id => { const d = bankData(id); return [d.questions.rows[0][4], d.corrections.rows.length]; }, ethId);
        assert.deepEqual(exported, [r.answer, 2]);
        // 備份還原到新的瀏覽器
        const backup = await page.evaluate(() => buildBackup());
        await page.closeContext();
        const fresh = await openPage(MANAGE);
        assert.match(await fresh.evaluate(d => importData(d), backup), /內建題庫的修正：還原 1 筆/);
        assert.equal(await fresh.evaluate(id => banks[id].questions[0].answer, ethId), r.answer);
        await fresh.closeContext();
    });

    test('內建題庫更新後和修正對不上時提示衝突', async () => {
        const page = await openPage(MANAGE);
        const ethId = await page.evaluate(() => Object.keys(banks).find(id => id.startsWith('ETH')));
        await page.evaluate(async id => {
            builtinCorrections[id] = { columns: CORRECTION_COLUMNS, rows: [[1, 'answer', 9, 1, '']] };   // 修正前的值和題庫不同
            await idb('readwrite', s => s.put(builtinCorrections, BUILTIN_CORRECTIONS_KEY));
            await reloadAll();
        }, ethId);
        assert.match(await page.$eval('#m-conflicts', e => e.hidden ? '' : e.textContent), /有 1 處和你的修正對不上/);
        await page.closeContext();
    });

    test('修正匯入的題庫：直接改題庫檔並記進 corrections', async () => {
        const page = await openPage(MANAGE);
        const r = await page.evaluate(async () => {
            await importData({ format: 'pdf2quiz-bank', version: 4, bank: { id: 'INS-2025-ABCD', key: 'INS', name: '保險法規', year: 2025 },
                questions: { columns: ['seq', 'num', 'question', 'options', 'answer'], rows: [[1, 1, '舊題目', ['a', 'b'], 1]] }, corrections: { columns: ['seq', 'field', 'from', 'to', 'note'], rows: [] } });
            await correctQuestion('INS-2025-ABCD', 1, { question: '新題目', options: ['a', 'b'], answer: 1 });
            return [userBankData['INS-2025-ABCD'].questions.rows[0][2], userBankData['INS-2025-ABCD'].corrections.rows];
        });
        assert.deepEqual(r, ['新題目', [[1, 'question', '舊題目', '新題目', '']]]);
        await page.closeContext();
    });
});
