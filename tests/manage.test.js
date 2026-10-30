// 題庫管理頁的端對端測試：匯入匯出、刪除、組合、完整備份與還原、和測驗頁的連動
const { test, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, closeBrowser, history } = require('./helpers');

after(closeBrowser);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MANAGE = { file: 'manage.html' };

/* 產生一份題庫檔：n 題，題目文字含 tag 方便區分 */
function bankFile({ id = 'INS-2025-ABCD', key = 'INS', name = '保險法規', year = 2025, n = 3, tag = '' } = {}) {
    return {
        format: 'pdf2quiz-bank', version: 4,
        bank: { id, key, name, year, source: 'test.pdf', template: null },
        questions: { columns: ['seq', 'num', 'question', 'options', 'answer'], rows: Array.from({ length: n }, (_, i) => [i + 1, i + 1, `${name}第 ${i + 1} 題${tag}`, ['甲', '乙', '丙', '丁'], (i % 4) + 1]) },
        corrections: { columns: ['seq', 'field', 'from', 'to', 'note'], rows: [] },
    };
}
const bankIds = page => page.evaluate(() => Object.keys(banks).sort());

describe('題庫', () => {
    test('清單列出內建題庫，可以匯出；內建題庫沒有刪除按鈕', async () => {
        const page = await openPage({ ...MANAGE, records: { version: 3, items: { 'ETH-0001': { h: [['tnnuw6', 4, 1, 'E']] } } } });
        const rows = await page.$$eval('#m-banks .item-row', rs => rs.map(r => r.innerText));
        assert.equal(rows.length, 2);
        assert.match(rows[0], /職業道德/);
        assert.match(rows[0], /616 題/);
        assert.match(rows[0], /有作答紀錄 1 題/);
        assert.equal(await page.$$eval('#m-banks .item-row button', bs => bs.filter(b => b.textContent === '刪除').length), 0);
        const exported = await page.evaluate(() => JSON.stringify(bankData(Object.keys(banks)[0])));
        assert.equal(JSON.parse(exported).format, 'pdf2quiz-bank');
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('匯入題庫：出現在清單與測驗頁；格式不對的檔案整份拒絕', async () => {
        const page = await openPage(MANAGE);
        const msg = await page.evaluate(f => importData(f), bankFile());
        assert.match(msg, /已匯入題庫「保險法規」（INS-2025-ABCD，3 題）/);
        assert.ok((await bankIds(page)).includes('INS-2025-ABCD'));
        // 答案超出選項範圍
        const bad = bankFile({ id: 'BAD-2025-ABCD', key: 'BAD', name: '壞檔' });
        bad.questions.rows[1][4] = 9;
        const err = await page.evaluate(f => importData(f).then(() => null, e => e.message), bad);
        assert.match(err, /第 2 題：答案超出選項範圍/);
        assert.ok(!(await bankIds(page)).includes('BAD-2025-ABCD'));
        // 測驗頁看得到新題庫
        const quiz = await page.openSibling('index.html');
        assert.ok(await quiz.evaluate(() => sourceList().some(s => s.id === 'INS-2025-ABCD')));
        await page.closeContext();
    });

    test('id 和內建題庫相同時一律另存；同一份檔案重複匯入不會多一份', async () => {
        const page = await openPage(MANAGE);
        const builtin = await page.evaluate(() => Object.keys(banks)[0]);
        const msg = await page.evaluate((f, id) => { f.bank.id = id; f.bank.key = id.split('-')[0]; f.bank.name = '職業道德'; return importData(f); }, bankFile(), builtin);
        assert.match(msg, /另存成新的 id/);
        assert.equal((await bankIds(page)).length, 3);
        assert.match(await page.evaluate(f => importData(f), bankFile()), /已匯入/);
        assert.match(await page.evaluate(f => importData(f), bankFile()), /內容相同，沒有變更/);
        assert.equal((await bankIds(page)).length, 4);
        await page.closeContext();
    });

    test('一個類別 key 只對應一個名稱', async () => {
        const page = await openPage(MANAGE);
        const err = await page.evaluate(f => importData(f).then(() => null, e => e.message), bankFile({ id: 'ETH-2025-ABCD', key: 'ETH', name: '倫理新制' }));
        assert.match(err, /類別 key「ETH」已經用在「職業道德」/);
        await page.closeContext();
    });

    test('舊版 questions.json：和內建題庫相同的不匯入，其他科目拆成新題庫', async () => {
        const page = await openPage(MANAGE);
        const msg = await page.evaluate(() => {
            const eth = banks[Object.keys(banks).find(id => id.startsWith('ETH'))].questions;
            const legacy = eth.map(q => ({ id: `ETH-${String(q.num).padStart(4, '0')}`, num: q.num, category: '職業道德', question: q.question, options: q.options, answer: q.answer }));
            legacy.push({ id: 'TAX-0001', num: 1, category: '稅務', question: '稅務第 1 題', options: ['a', 'b'], answer: 2 });
            return importData(legacy);
        });
        assert.match(msg, /「職業道德」和內建題庫 ETH-2024-\w{4} 的題目相同，不需要匯入/);
        assert.match(msg, /已匯入題庫「稅務」（TAX-0000-\w{4}，1 題）/);
        await page.closeContext();
    });

    test('刪除題庫：可以保留作答紀錄，再匯入同一份題庫時自動接回', async () => {
        const page = await openPage(MANAGE);
        await page.evaluate(f => importData(f), bankFile());
        await page.evaluate(() => { records.items['INS-2025-ABCD-0001'] = { history: [{ t: '2026-01-01T00:00:00.000Z', pick: 1, ok: true, level: 'EASY' }], review: false, noReview: false }; recompute(records.items['INS-2025-ABCD-0001']); return saveRecordsNow(); });
        await page.evaluate(() => deleteBank('INS-2025-ABCD', false));
        assert.ok(!(await bankIds(page)).includes('INS-2025-ABCD'));
        assert.equal(await page.$eval('#m-orphans-card', e => e.hidden), false);   // 對不到題庫的紀錄會列出
        assert.equal(await page.evaluate(() => records.items['INS-2025-ABCD-0001'].history.length), 1);
        await page.evaluate(f => importData(f), bankFile());
        assert.equal(await page.evaluate(() => recordCount('INS-2025-ABCD')), 1);
        assert.equal(await page.$eval('#m-orphans-card', e => e.hidden), true);
        // 一併刪除紀錄
        await page.evaluate(() => deleteBank('INS-2025-ABCD', true));
        assert.equal(await page.evaluate(() => 'INS-2025-ABCD-0001' in records.items), false);
        await page.closeContext();
    });
});

describe('組合', () => {
    test('建立組合：測驗頁可以選，模擬考預設值跟著組合；重複題目兩題都保留', async () => {
        const page = await openPage(MANAGE);
        await page.evaluate(f => importData(f), bankFile());
        await page.evaluate(f => importData(f), bankFile({ id: 'INS-2026-WXYZ', year: 2026, n: 4 }));   // 前 3 題和上一份文字相同
        const r = await page.evaluate(() => createCombo({ name: '保險全部', bankIds: ['INS-2025-ABCD', 'INS-2026-WXYZ'], exam: { perCategory: 2, pass: 60, minutes: 30 } }));
        assert.match(r.message, /有 3 題和其他題庫的題目文字相同，兩題都保留/);
        const quiz = await page.openSibling('index.html');
        await quiz.select('#f-source', r.combo.id);
        const s = await quiz.evaluate(() => ({
            n: allQuestions.length, cats: [...document.querySelectorAll('#f-category option')].map(o => o.value),
            exam: [...document.querySelectorAll('#x-counts input')].map(i => i.value), pass: $('x-pass').value, time: $('x-time').value,
        }));
        assert.deepEqual(s, { n: 7, cats: ['all', 'INS'], exam: ['2'], pass: '60', time: '30' });   // 同一個 key 算同一科
        await page.closeContext();
    });

    test('建立組合時沒有名稱或沒有勾選題庫會提示', async () => {
        const page = await openPage(MANAGE);
        assert.match(await page.evaluate(() => createCombo({ name: '', bankIds: Object.keys(banks), exam: {} }).catch(e => e.message)), /請輸入組合名稱/);
        assert.match(await page.evaluate(() => createCombo({ name: 'x', bankIds: [], exam: {} }).catch(e => e.message)), /請至少勾選一份題庫/);
        await page.closeContext();
    });
});

describe('完整備份', () => {
    test('備份後在另一個瀏覽器還原：題庫、組合、作答紀錄都在，紀錄完全相同', async () => {
        const page = await openPage({ ...MANAGE, records: { version: 2, items: {
            'ETH-0001': { history: history('OE', 'OH'), review: true, markAt: '2026-01-02T00:00:00.000Z' },
            'MKT-0003': { history: history('XM') },
        } } });
        await page.evaluate(f => importData(f), bankFile());
        await page.evaluate(() => createCombo({ name: '自訂', bankIds: ['INS-2025-ABCD'], exam: { perCategory: 3, pass: 70, minutes: 10 } }));
        const backup = await page.evaluate(() => buildBackup());
        const summary = p => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(records.items).map(([id, r]) => [id, [r.history.length, r.score, r.review, r.level]]))));
        const before = await summary(page);
        await page.closeContext();

        const fresh = await openPage(MANAGE);
        const msg = await fresh.evaluate(d => importData(d), JSON.parse(JSON.stringify(backup)));
        assert.match(msg, /已匯入題庫「保險法規」/);
        assert.match(msg, /組合：還原 1 個/);
        assert.match(msg, /新增 3 筆/);
        assert.equal(await summary(fresh), before);
        assert.ok((await bankIds(fresh)).includes('INS-2025-ABCD'));
        assert.equal(await fresh.evaluate(() => userCombos.length), 1);
        // 再還原一次不會變多
        assert.match(await fresh.evaluate(d => importData(d), JSON.parse(JSON.stringify(backup))), /檔案裡的作答都已經存在/);
        await fresh.closeContext();
    });

    test('有匯入的題庫但還沒備份時，提醒以醒目顏色顯示；備份後消失', async () => {
        const page = await openPage(MANAGE);
        assert.equal(await page.$eval('#m-backup-status', e => e.classList.contains('warn')), false);
        await page.evaluate(f => importData(f), bankFile());
        await page.evaluate(() => renderAll());
        assert.equal(await page.$eval('#m-backup-status', e => e.classList.contains('warn')), true);
        await page.evaluate(() => { meta.lastBackupAt = new Date().toISOString(); renderBackupStatus(); });
        assert.equal(await page.$eval('#m-backup-status', e => e.classList.contains('warn')), false);
        assert.match(await page.$eval('#m-backup-status', e => e.textContent), /上次完整備份：今天/);
        await page.closeContext();
    });
});

describe('和測驗頁同時開著', () => {
    test('管理頁合併作答紀錄後，測驗頁自動更新；測驗頁作答後，管理頁的紀錄數跟著變', async () => {
        const manage = await openPage(MANAGE);
        const quiz = await manage.openSibling('index.html');
        await manage.evaluate(() => importData({ version: 2, items: { 'ETH-0002': { history: [{ t: '2026-01-01T00:00:00.000Z', pick: 1, ok: true, level: 'EASY' }] } } }));
        await quiz.waitForFunction(() => peek(Q('ETH-0002')).history.length === 1, { timeout: 3000, polling: 100 });
        await quiz.bringToFront();
        await quiz.click('#start-btn');
        await quiz.keyboard.press('4');
        await manage.waitForFunction(() => recordCount(Object.keys(banks).find(id => id.startsWith('ETH'))) === 2, { timeout: 3000, polling: 100 });
        assert.deepEqual(quiz.errors, []);
        assert.deepEqual(manage.errors, []);
        await manage.closeContext();
    });

    test('管理頁新增題庫時，閒置的測驗頁重新整理後就看得到', async () => {
        const manage = await openPage(MANAGE);
        const quiz = await manage.openSibling('index.html');
        await manage.evaluate(f => importData(f), bankFile());
        await quiz.waitForFunction(() => document.querySelector(`#f-source option[value="INS-2025-ABCD"]`), { timeout: 5000, polling: 100 });
        await manage.closeContext();
    });
});
