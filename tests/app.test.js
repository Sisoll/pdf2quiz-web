// 端對端測試：用真的瀏覽器開 index.html 操作
// 執行：npm test（需要 Chrome 或 Edge；可用 CHROME_PATH 指定路徑）
const { test, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, closeBrowser, history } = require('./helpers');

after(closeBrowser);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = (page, sel) => page.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim());

/* ---------- 計分 ---------- */
describe('計分公式', () => {
    test('各種作答順序的分數與已記住', async () => {
        const page = await openPage();
        const run = codes => page.evaluate(h => { const r = { history: h }; recompute(r); return { trail: r.history.map(x => x.s), score: r.score, mastered: isMastered(r) }; }, history(...codes));
        assert.deepEqual((await run(['OH', 'OM', 'OM'])).trail, [1, 3.25, 6.25]);
        assert.equal((await run(['OH', 'OM', 'OM'])).mastered, true);
        assert.deepEqual((await run(['OE', 'OE'])).trail, [2.5, 6.25]);
        assert.equal((await run(['OH', 'OE'])).mastered, false);              // 1 → 4.75，差一點
        assert.deepEqual((await run(['OH', 'OH', 'OH', 'OH'])).trail, [1, 2.5, 4.5, 6.5]);
        assert.equal((await run(['OE', 'OE', 'OE', 'OE', 'OE'])).score, 8);   // 上限 8
        assert.equal((await run(['OE', 'OE', 'OE', 'OE', 'XM'])).score, 3);   // 8 答錯 → 3
        const floor = await run(Array(12).fill('XM'));
        assert.ok(floor.score >= -2 && floor.score <= -1.99);                 // 一直錯會停在 −2 附近（四捨五入到小數兩位）
        await page.closeContext();
    });

    test('10 分鐘內重複答對不加分，答錯照扣', async () => {
        const page = await openPage();
        const r = await page.evaluate(() => {
            const t0 = Date.UTC(2026, 0, 1);
            const r = { history: [
                { t: new Date(t0).toISOString(), ok: true, level: 'MEDIUM' },
                { t: new Date(t0 + 5 * 60000).toISOString(), ok: true, level: 'MEDIUM' },
                { t: new Date(t0 + 6 * 60000).toISOString(), ok: false, level: 'MEDIUM' },
            ] };
            recompute(r);
            return r.history.map(h => [h.s, !!h.cool]);
        });
        assert.deepEqual(r, [[1.5, false], [1.5, true], [-0.25, false]]);
        await page.closeContext();
    });

    test('超過保留上限時，答對答錯總數不會少算', async () => {
        const page = await openPage();
        const r = await page.evaluate(() => {
            const r = { history: [] };
            for (let i = 0; i < 450; i++) { r.history.push({ t: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), ok: i % 3 !== 0, level: 'MEDIUM' }); recompute(r); }
            return { kept: r.history.length, correct: r.correct, wrong: r.wrong };
        });
        assert.deepEqual(r, { kept: 200, correct: 300, wrong: 150 });
        await page.closeContext();
    });
});

/* ---------- 舊資料相容 ---------- */
describe('舊版資料轉換', () => {
    test('已有舊紀錄時頁面能正常開啟，並轉成新格式', async () => {
        const page = await openPage({
            records: { version: 1, items: { 'MKT-0001': { correct: 2, wrong: 0, score: 2, unclear: true, level: 'EASY', history: [{ t: '2026-01-01T00:00:00Z', pick: 4, ok: true }, { t: '2026-01-02T00:00:00Z', pick: 4, ok: true }] } } },
            settings: { threshold: 3, status: 'notMastered' },
        });
        const r = await page.evaluate(() => ({ rec: records.items['MKT-0001'], s: settings }));
        assert.equal(r.rec.history[1].level, 'EASY');        // 題目層級的難度改記在最近一次作答
        assert.equal(r.rec.score, 5.25);                     // MEDIUM 1.5 → EASY 2.5 × 1.5
        assert.equal(r.rec.review, true);                    // 不清楚 併入 加強複習
        assert.equal('unclear' in r.rec, false);
        assert.equal(r.s.threshold, 5);                      // 門檻固定 5
        assert.deepEqual(r.s.include, []);                   // 尚未記住 → 排除已記住
        assert.ok(r.s.exclude.includes('mastered'));
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });
});

/* ---------- 出題條件 ---------- */
describe('出題條件', () => {
    const records = { version: 2, items: {
        'ETH-0001': { history: history('OE', 'OE') },               // 已記住 EASY
        'ETH-0002': { history: history('OH') },                     // HARD
        'ETH-0003': { history: history('XM') },                     // 曾答錯
        'ETH-0004': { history: history('OM', 'OM'), review: true },  // 加強複習
        'ETH-0005': { history: history('OE', 'OE'), noReview: true },// 暫停複習
    } };
    const count = (page, include, exclude) => page.evaluate((i, e) => { settings.include = i; settings.exclude = e; return allQuestions.filter(matches).map(q => q.id.slice(-1)); }, include, exclude);

    test('包含任一、且不符合任何排除', async () => {
        const page = await openPage({ records });
        assert.equal((await count(page, [], [])).length, 1120);
        assert.equal((await count(page, [], ['noReview'])).length, 1119);   // 預設排除暫停複習
        assert.deepEqual(await count(page, ['EASY'], []), ['1', '5']);
        assert.deepEqual(await count(page, ['EASY', 'HARD'], []), ['1', '2', '5']);
        assert.deepEqual(await count(page, ['EASY'], ['noReview']), ['1']);
        assert.deepEqual(await count(page, [], ['new', 'EASY']), ['2', '3', '4']);
        assert.deepEqual(await count(page, ['EASY'], ['EASY']), []);
        await page.closeContext();
    });

    test('條件按鈕：不限 → 包含 → 排除 → 不限', async () => {
        const page = await openPage({ records });
        const state = () => page.evaluate(() => JSON.stringify([settings.include, settings.exclude]));
        await page.click('.chip[data-key="EASY"]');
        assert.equal(await state(), '[["EASY"],["noReview"]]');
        await page.click('.chip[data-key="EASY"]');
        assert.equal(await state(), '[[],["noReview","EASY"]]');
        await page.click('.chip[data-key="EASY"]');
        assert.equal(await state(), '[[],["noReview"]]');
        await page.closeContext();
    });

    test('弱點加權隨機：每題都會出現一次，只改變順序', async () => {
        const page = await openPage({ records });
        const r = await page.evaluate(() => {
            settings.include = []; settings.exclude = [];
            let allOnce = true;
            for (const mode of ['random', 'randomNew', 'randomWrong', 'randomHard']) {
                settings.order = mode; buildQueue();
                if (new Set(queue.map(q => q.id)).size !== allQuestions.length) allOnce = false;
            }
            const w = (id, m) => randomWeight(peek(id), m);
            return { allOnce, newBoost: w('ETH-0006', 'attempts') > w('ETH-0006'), masteredLow: w('ETH-0001') < w('ETH-0006') };
        });
        assert.deepEqual(r, { allOnce: true, newBoost: true, masteredLow: true });
        await page.closeContext();
    });
});

/* ---------- 練習 ---------- */
describe('練習', () => {
    test('按開始才出題；題數 3 做完顯示成績；回上一題重答不重複計分', async () => {
        const page = await openPage();
        assert.equal(await page.$$eval('.option-btn', b => b.length), 0);
        await page.type('#f-limit', '3');
        await page.click('#start-btn');
        assert.equal(await page.$$eval('.option-btn', b => b.length), 4);
        assert.equal(await page.$eval('#setup', e => e.classList.contains('filters-locked')), true);
        await page.keyboard.press('4');           // 第 1 題正解是 (4)
        await page.keyboard.press('e'); await sleep(350);
        await page.keyboard.press('1');           // 第 2 題答錯
        await page.keyboard.press('Enter');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('4');           // 回去重答：不重複計
        await page.keyboard.press('Enter');
        assert.match(await text(page, '#session-bar'), /本輪得分 50 \/ 100 已答 2 \/ 3 題/);
        await page.keyboard.press('Enter');       // 第 3 題略過 → 結束
        const card = await text(page, '.result-card');
        assert.match(card, /完成 50 \/ 100/);
        assert.match(card, /略過 1 題/);
        assert.equal(await page.evaluate(() => peek('ETH-0001').level), 'EASY');
        await page.closeContext();
    });

    test('復原：撤銷剛才的作答，題目回到未作答', async () => {
        const page = await openPage();
        await page.click('#start-btn');
        await page.keyboard.press('1');
        assert.equal(await page.evaluate(() => peek('ETH-0001').history.length), 1);
        await page.keyboard.press('z');
        assert.equal(await page.evaluate(() => peek('ETH-0001').history.length), 0);
        assert.equal(await page.$$eval('.option-btn:not(:disabled)', b => b.length), 4);
        assert.match(await text(page, '#session-bar'), /已答 0 題/);
        await page.keyboard.press('4');
        assert.match(await text(page, '#session-bar'), /本輪得分 100/);
        await page.closeContext();
    });

    test('標記：加強複習擋住已記住；和暫停複習互斥；作答前可以移除', async () => {
        const page = await openPage({ records: { version: 2, items: { 'ETH-0001': { history: history('OE', 'OE') } } } });
        await page.advance(3600e3);
        await page.click('#start-btn');
        await page.keyboard.press('4');
        await page.keyboard.press('r');
        let r = await page.evaluate(() => ({ review: peek('ETH-0001').review, mastered: isMastered(peek('ETH-0001')) }));
        assert.deepEqual(r, { review: true, mastered: false });
        await page.keyboard.press('s');
        r = await page.evaluate(() => [peek('ETH-0001').review, peek('ETH-0001').noReview]);
        assert.deepEqual(r, [false, true]);
        await page.keyboard.press('Escape');
        await page.click('.chip[data-key="noReview"]');   // 取消預設的「排除暫停複習」，這題才會出現
        await page.click('#start-btn');           // 新的一輪：作答前點 × 移除
        await page.click('#noreview-btn');
        assert.equal(await page.evaluate(() => peek('ETH-0001').noReview), false);
        await page.closeContext();
    });
});

/* ---------- 題目總覽 ---------- */
describe('題目總覽', () => {
    test('排序、分頁、顯示 / 隱藏答案', async () => {
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0001': { history: history('OE', 'OE') }, 'ETH-0002': { history: history('XH', 'XH', 'XH') }, 'ETH-0003': { history: history('XM', 'OM') },
        } } });
        await page.click('.tab[data-view="browse"]');
        assert.match(await text(page, '#browse-count'), /符合條件 1120 題（第 1–50 題）/);
        await page.evaluate(() => [...document.querySelectorAll('#b-pager-top .pg')].find(b => b.textContent === '»').click());
        assert.match(await text(page, '#browse-count'), /第 1101–1120 題/);
        await page.select('#b-sort', 'wrongDesc');
        assert.equal(await page.$eval('.qitem .num', e => e.innerText), '第 2 題');
        const ansBg = () => page.$eval('.qitem .qopts li.ans', li => getComputedStyle(li).borderTopWidth);
        assert.equal(await ansBg(), '1px');
        await page.click('#b-toggle');
        assert.equal(await ansBg(), '3px');
        await page.click('#b-toggle');
        await page.click('.qitem');               // 只看這一題
        assert.equal(await ansBg(), '3px');
        await page.closeContext();
    });
});

/* ---------- 模擬考 ---------- */
describe('模擬考', () => {
    test('抽題、不顯示答案、交卷評分並計入紀錄', async () => {
        const page = await openPage();
        await page.click('.tab[data-view="exam"]');
        await page.evaluate(() => { document.querySelectorAll('#x-counts input').forEach(i => i.value = 5); });
        await page.click('#x-start');
        assert.equal(await page.evaluate(() => exam.items.length), 10);
        for (let i = 0; i < 4; i++) {
            const ans = await page.evaluate(() => exam.items[exam.idx].q.answer);
            await page.keyboard.press(String(i < 3 ? ans : (ans === 1 ? 2 : 1)));   // 3 對 1 錯
            await page.keyboard.press('ArrowRight');
        }
        assert.equal(await page.$('.option-btn.correct'), null);   // 考試中不顯示答案
        await page.click('#x-submit');
        const summary = await text(page, '#x-summary');
        assert.match(summary, /不及格/);
        assert.match(summary, /未作答 6 題/);
        const r = await page.evaluate(() => ({ exams: records.exams.length, recorded: Object.values(records.items).filter(r => r.history.some(h => h.src === 'exam')).length }));
        assert.deepEqual(r, { exams: 1, recorded: 4 });
        await page.click('#x-wrong-only');
        assert.equal(await page.$$eval('#x-review .qitem', c => c.length), 7);   // 1 錯 + 6 未答
        await page.closeContext();
    });
});

/* ---------- 合併兩台電腦的紀錄 ---------- */
describe('合併紀錄', () => {
    test('A、B 各自練習後合併：兩邊都保留；重複匯入不會變多', async () => {
        const page = await openPage();
        const r = await page.evaluate(() => {
            const H = (t, ok) => ({ t, pick: ok ? 4 : 1, ok, level: 'MEDIUM' });
            const A = { version: 2, items: { 'ETH-0001': { history: [H('2026-01-01T00:00:00Z', true)] }, 'ETH-0002': { history: [H('2026-01-01T01:00:00Z', false)] } }, exams: [{ at: '2026-01-01T05:00:00Z', subjects: [] }] };
            // B 先從 A 匯入，再自己多答兩題
            const B = JSON.parse(JSON.stringify(A));
            B.items['ETH-0001'].history.push(H('2026-01-02T00:00:00Z', true));
            B.items['ETH-0003'] = { history: [H('2026-01-02T01:00:00Z', true)] };
            B.exams.push({ at: '2026-01-02T05:00:00Z', subjects: [] });
            records = normalizeRecords(A);
            const first = mergeInto(B);     // A 合併 B
            const second = mergeInto(B);    // 再合併一次同一個檔案
            return { first, second, h1: records.items['ETH-0001'].history.length, h3: records.items['ETH-0003'].history.length, exams: records.exams.length, score1: records.items['ETH-0001'].score };
        });
        assert.deepEqual(r.first, { added: 2, total: 4 });
        assert.deepEqual(r.second, { added: 0, total: 4 });
        assert.equal(r.h1, 2);
        assert.equal(r.h3, 1);
        assert.equal(r.exams, 2);
        assert.equal(r.score1, 3.75);       // 連對 2 次：1.5 + 2.25
        await page.closeContext();
    });

    test('標記衝突以較晚修改的為準', async () => {
        const page = await openPage();
        const r = await page.evaluate(() => {
            const a = normalizeRecords({ version: 2, items: { 'ETH-0001': { history: [], review: true, markAt: '2026-01-01T00:00:00Z' } } });
            const b = normalizeRecords({ version: 2, items: { 'ETH-0001': { history: [], review: false, noReview: true, markAt: '2026-01-03T00:00:00Z' } } });
            const m = mergeRecordSets(a, b).items['ETH-0001'];
            return [m.review, m.noReview];
        });
        assert.deepEqual(r, [false, true]);
        await page.closeContext();
    });

    test('取代匯入會蓋掉目前的紀錄', async () => {
        const page = await openPage({ records: { version: 2, items: { 'ETH-0009': { history: history('OM') } } } });
        const r = await page.evaluate(() => { adoptRecords({ version: 2, items: { 'ETH-0001': { history: [] } } }); return Object.keys(records.items); });
        assert.deepEqual(r, ['ETH-0001']);
        await page.closeContext();
    });
});

/* ---------- 版面 ---------- */
describe('版面', () => {
    test('手機寬度不會出現橫向捲軸，隱藏的元素真的隱藏', async () => {
        const page = await openPage({ width: 390 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
        assert.equal(await page.$eval('#session-bar', e => e.offsetParent === null), true);
        assert.equal(await page.$eval('#nav', e => e.offsetParent === null), true);
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });
});
