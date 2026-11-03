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
        assert.deepEqual((await run(['OE'])).trail, [5]);                      // EASY 答對一次就記住
        assert.equal((await run(['OE'])).mastered, true);
        assert.deepEqual((await run(['OM', 'OM'])).trail, [2.5, 6.25]);       // MEDIUM 答對兩次就記住
        assert.equal((await run(['OM', 'OM'])).mastered, true);
        assert.deepEqual((await run(['OH', 'OM', 'OM'])).trail, [1, 4.75, 8]);
        assert.equal((await run(['OH', 'OM'])).mastered, false);              // 1 → 4.75，差一點
        assert.deepEqual((await run(['XE', 'OE'])).trail, [-1, 4]);          // 答錯過的 EASY 答對一次還不夠
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
        assert.deepEqual(r, [[2.5, false], [2.5, true], [0.25, false]]);
        await page.closeContext();
    });

    test('答題速度加權：12～20 秒平均、越快加越多、慢一點稍微扣、超過 60 秒或沒有秒數當成平均', async () => {
        const page = await openPage();
        const f = await page.evaluate(() => [undefined, 12, 16, 20, 11, 10, 8, 0.3, 24, 32, 40, 60, 61].map(timeFactor));
        assert.deepEqual(f, [1, 1, 1, 1, 1.05, 1.1, 1.2, 1.4, 0.95, 0.85, 0.75, 0.7, 1]);
        const trail = await page.evaluate(() => {
            const t0 = Date.UTC(2026, 0, 1), hour = 3600e3;
            const r = { history: [
                { t: new Date(t0).toISOString(), ok: true, level: 'HARD', sec: 2 },           // 1 × 1.4 = 1.4
                { t: new Date(t0 + hour).toISOString(), ok: true, level: 'MEDIUM', sec: 36 },  // 2.5 × 1.5（連對）× 0.8 = 3
                { t: new Date(t0 + 2 * hour).toISOString(), ok: false, level: 'MEDIUM', sec: 1 },   // 答錯不看速度
            ] };
            recompute(r);
            return r.history.map(h => h.s);
        });
        assert.deepEqual(trail, [1.4, 4.4, 1.2]);
        await page.closeContext();
    });

    test('練習時記錄作答秒數並顯示加權；存檔、讀檔、合併都保留秒數，舊紀錄格式不變', async () => {
        const page = await openPage();
        await page.click('#start-btn');
        await page.advance(1000);
        await page.keyboard.press('4');
        const r = await page.evaluate(() => ({ sec: peek(Q('ETH-0001')).history[0].sec, s: peek(Q('ETH-0001')).score }));
        assert.ok(r.sec >= 1 && r.sec < 2, `sec=${r.sec}`);
        assert.equal(r.s, 3.5);                                   // MEDIUM 2.5 × 1.4
        assert.match(await text(page, '#result'), /用時 1(\.\d)? 秒 ×1\.4/);
        const packed = await page.evaluate(() => [
            packHistory({ t: '2026-01-01T00:00:00Z', pick: 2, ok: true, level: 'EASY' }),
            packHistory({ t: '2026-01-01T00:00:00Z', pick: 2, ok: true, level: 'EASY', src: 'exam' }),
            packHistory({ t: '2026-01-01T00:00:00Z', pick: 2, ok: true, level: 'EASY', sec: 3.4 }),
            unpackHistory(packHistory({ t: '2026-01-01T00:00:00Z', pick: 2, ok: true, level: 'EASY', sec: 3.4 })).sec,
        ]);
        assert.equal(packed[0].length, 4);
        assert.deepEqual(packed[1].slice(4), ['x']);
        assert.deepEqual(packed[2].slice(4), [0, 3.4]);
        assert.equal(packed[3], 3.4);
        // 合併：同一筆作答只有一邊有秒數時保留秒數
        const merged = await page.evaluate(() => {
            const h = { t: '2026-01-01T00:00:00.000Z', pick: 2, ok: true, level: 'MEDIUM' };
            const a = { items: { X: { history: [h] } } }, b = { items: { X: { history: [{ ...h, sec: 4 }] } } };
            return [mergeRecordSets(a, b).items.X.history, mergeRecordSets(b, a).items.X.history].map(x => [x.length, x[0].sec]);
        });
        assert.deepEqual(merged, [[1, 4], [1, 4]]);
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
        const r = await page.evaluate(() => ({ rec: records.items[Q('MKT-0001')], s: settings }));
        assert.equal(r.rec.history[1].level, 'EASY');        // 題目層級的難度改記在最近一次作答
        assert.equal(r.rec.score, 8);                        // MEDIUM 2.5 → EASY 5 × 1.5，到上限 8
        assert.equal(r.rec.review, true);                    // 不清楚 併入 加強複習
        assert.equal('unclear' in r.rec, false);
        assert.equal(r.s.threshold, 5);                      // 門檻固定 5
        assert.deepEqual(r.s.include, []);                   // 尚未記住 → 排除已記住
        assert.ok(r.s.exclude.includes('mastered'));
        await sleep(100);
        assert.equal(await page.evaluate(() => localStorage.getItem(STORAGE_KEY)), null);   // 已搬到 IndexedDB
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

    test('上次答錯只看最近一次作答；曾經答錯包含後來答對的', async () => {
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0001': { history: history('XM', 'OM') },   // 錯過、上次答對
            'ETH-0002': { history: history('OM', 'XH') },   // 上次答錯
            'ETH-0003': { history: history('OE') },
        } } });
        assert.deepEqual(await count(page, ['lastWrong'], []), ['2']);
        assert.deepEqual(await count(page, ['everWrong'], []), ['1', '2']);
        assert.deepEqual(await count(page, ['everWrong'], ['lastWrong']), ['1']);
        assert.match(await text(page, '#f-chips'), /上次答錯/);
        await page.closeContext();
    });

    test('未作答的題目沒有難度：不符合任何難度條件，也不算進統計', async () => {
        const page = await openPage({ records });
        assert.deepEqual(await count(page, ['MEDIUM'], []), ['3', '4']);
        assert.equal((await count(page, [], ['MEDIUM'])).length, 1118);
        assert.equal(await page.evaluate(() => peek(Q('ETH-0006')).level), null);
        // 統計只算符合出題規則的題目：預設排除暫停複習，ETH-0005（EASY）不算
        assert.match(await text(page, '#stats'), /EASY 1\s*🟡 MEDIUM 2\s*🔴 HARD 1\s*⚪ 未分級（未作答）1115/);
        await page.closeContext();
    });

    test('統計跟著出題條件變：只算符合的題目，並附上目前科目的總題數', async () => {
        const page = await openPage({ records });
        const stats = () => page.evaluate(() => { renderStats(); return $('stats').innerText.replace(/\s+/g, ' '); });
        await page.evaluate(() => { settings.include = ['EASY']; settings.exclude = []; });
        let s = await stats();
        assert.match(s, /符合出題規則 2 \/ 1120 題（包含 EASY）/);
        assert.match(s, /最近答對率 100% 📈 歷來答對率 100%/);
        await page.evaluate(() => { settings.include = ['MEDIUM']; });
        // ETH-0003 答錯一次（最近一次也是答錯）、ETH-0004 答對兩次：最近 1/2 題，歷來 2/3 次
        assert.match(await stats(), /最近答對率 50% 📈 歷來答對率 67%/);
        await page.evaluate(() => { settings.include = ['EASY']; });
        assert.match(s, /已作答 2 🆕 未作答 0/);
        assert.match(s, /加強複習 0 ⏸️ 暫停複習 1/);
        assert.match(s, /EASY 2 🟡 MEDIUM 0 🔴 HARD 0 ⚪ 未分級（未作答）0/);
        await page.evaluate(() => { settings.include = ['new']; $('f-category').value = 'ETH'; readFilters(); });
        s = await stats();
        assert.match(s, /符合出題規則 611 \/ 616 題（包含 未作答）/);
        assert.match(s, /已作答 0 🆕 未作答 611/);
        assert.match(s, /最近答對率 — 📈 歷來答對率 —/);
        await page.evaluate(() => { settings.include = ['answered']; settings.exclude = ['noReview']; settings.min = '1'; settings.max = ''; });
        assert.match(await stats(), /（包含 已作答；排除 暫停複習；分數 1～8）/);
        await page.evaluate(() => { settings.include = []; settings.exclude = []; settings.min = ''; });
        assert.match(await stats(), /（全部題目）/);
        await page.closeContext();
    });

    test('按下開始後畫面捲到題目', async () => {
        const page = await openPage({ records });
        await page.setViewport({ width: 900, height: 600 });
        await page.click('#start-btn');
        await page.waitForFunction(() => Math.abs($('quiz').getBoundingClientRect().top) < 5, { timeout: 3000 });
        await page.click('.tab[data-view="exam"]');
        await page.evaluate(() => scrollTo(0, 0));
        await page.click('#x-start');
        await page.waitForFunction(() => Math.abs($('exam').getBoundingClientRect().top) < 5, { timeout: 3000 });
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

    test('已作答 = 排除未作答，兩者合起來是全部題目', async () => {
        const page = await openPage({ records });
        const answered = await count(page, ['answered'], []);
        assert.deepEqual(answered, await count(page, [], ['new']));
        assert.deepEqual(answered, ['1', '2', '3', '4', '5']);
        assert.equal(answered.length + (await count(page, ['new'], [])).length, 1120);
        assert.equal((await count(page, [], ['answered'])).length, 1115);
        await page.closeContext();
    });

    test('已作答的條件按鈕：不限 → 包含 → 排除 → 不限，設定重新載入後保留', async () => {
        const page = await openPage({ records });
        const state = () => page.evaluate(() => JSON.stringify([settings.include, settings.exclude]));
        await page.click('.chip[data-key="answered"]');
        assert.equal(await state(), '[["answered"],["noReview"]]');
        assert.equal(await page.$eval('.chip[data-key="answered"]', e => e.classList.contains('inc')), true);
        await page.click('.chip[data-key="answered"]');
        assert.equal(await state(), '[[],["noReview","answered"]]');
        await page.click('.chip[data-key="answered"]');
        assert.equal(await state(), '[[],["noReview"]]');
        await page.closeContext();
        const reloaded = await openPage({ records, settings: { include: ['answered'], exclude: ['noReview'] } });
        assert.deepEqual(await reloaded.evaluate(() => settings.include), ['answered']);   // loadSettings 認得新的 key
        await reloaded.closeContext();
    });

    test('隨機順序：1 小時內答過的排到最後、越早答的越前面；超過 1 小時恢復正常', async () => {
        const page = await openPage({ records });
        const order = () => page.evaluate(() => {
            settings.include = ['answered']; settings.exclude = []; settings.order = 'random';
            buildQueue(); return queue.map(q => q.id.slice(-1)).join('');
        });
        await page.evaluate(() => { settings.include = []; settings.exclude = []; settings.order = 'seq'; settings.category = 'all'; });
        await page.click('#start-btn');
        for (const id of ['ETH-0004', 'ETH-0002']) {   // 先答 4、再答 2
            await page.evaluate(id => { queue = [allQuestions.find(q => q.id === Q(id))]; pos = 0; render(); }, id);
            await page.evaluate(() => answer(1));
            await page.advance(60 * 1000);
        }
        for (let i = 0; i < 5; i++) assert.match(await order(), /^[135]{3}42$/);
        await page.advance(60 * 60 * 1000);
        const seen = new Set();
        for (let i = 0; i < 30; i++) seen.add((await order()).slice(-2));
        assert.ok(seen.size > 1);
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
            const w = (id, m) => randomWeight(peek(Q(id)), m);
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
        assert.equal(await page.evaluate(() => peek(Q('ETH-0001')).level), 'EASY');
        await page.closeContext();
    });

    test('復原：撤銷剛才的作答，題目回到未作答', async () => {
        const page = await openPage();
        await page.click('#start-btn');
        await page.keyboard.press('1');
        assert.equal(await page.evaluate(() => peek(Q('ETH-0001')).history.length), 1);
        await page.keyboard.press('z');
        assert.equal(await page.evaluate(() => peek(Q('ETH-0001')).history.length), 0);
        assert.equal(await page.$$eval('.option-btn:not(:disabled)', b => b.length), 4);
        assert.match(await text(page, '#session-bar'), /已答 0 題/);
        await page.keyboard.press('4');
        assert.match(await text(page, '#session-bar'), /本輪得分 100/);
        await page.closeContext();
    });

    test('第一次作答的題目不顯示「0（對 0 ・ 錯 0）」，答完才顯示分數', async () => {
        const page = await openPage({ records: { version: 2, items: { 'ETH-0002': { history: history('OM') } } } });
        await page.click('#start-btn');
        assert.equal(await text(page, '#score'), '🆕 第一次作答');
        await page.keyboard.press('4');
        assert.match(await text(page, '#score'), /^\+[\d.]+（對 1 ・ 錯 0）$/);
        await page.keyboard.press('Enter');
        assert.equal(await text(page, '#score'), '+2.5（對 1 ・ 錯 0）');   // 作答過的題目，作答前照樣顯示分數
        await page.closeContext();
    });

    test('難度：作答前沒有選取任何難度，答完預設 MEDIUM', async () => {
        const page = await openPage();
        await page.click('#start-btn');
        assert.equal(await page.$$eval('.remark[data-level].on', b => b.length), 0);
        await page.keyboard.press('4');
        assert.deepEqual(await page.$$eval('.remark[data-level].on', b => b.map(x => x.dataset.level)), ['MEDIUM']);
        await page.closeContext();
    });

    test('標記：加強複習擋住已記住；和暫停複習互斥；答完可以移除；作答前不顯示難度、分數與標記', async () => {
        const page = await openPage({ records: { version: 2, items: { 'ETH-0001': { history: history('OE', 'OE') } } } });
        await page.advance(3600e3);
        await page.click('#start-btn');
        await page.keyboard.press('4');
        await page.keyboard.press('r');
        let r = await page.evaluate(() => ({ review: peek(Q('ETH-0001')).review, mastered: isMastered(peek(Q('ETH-0001'))) }));
        assert.deepEqual(r, { review: true, mastered: false });
        await page.keyboard.press('s');
        r = await page.evaluate(() => [peek(Q('ETH-0001')).review, peek(Q('ETH-0001')).noReview]);
        assert.deepEqual(r, [false, true]);
        await page.keyboard.press('Escape');
        await page.click('#round-dialog-skip');           // 中止後詢問要不要檢討：不用
        await page.click('.chip[data-key="noReview"]');   // 取消預設的「排除暫停複習」，這題才會出現
        await page.click('#start-btn');           // 新的一輪：作答前看不到難度、分數與標記
        const visible = () => page.evaluate(() => ['#noreview-btn', '.remark.easy', '#score'].map(s => !!document.querySelector(s).offsetParent));
        assert.deepEqual(await visible(), [false, false, false]);
        await page.keyboard.press('4');           // 答完才出現，點 × 移除
        assert.deepEqual(await visible(), [true, true, true]);
        await page.click('#noreview-btn');
        assert.equal(await page.evaluate(() => peek(Q('ETH-0001')).noReview), false);
        await page.closeContext();
    });

    test('改設定：測驗中先問要不要結束本輪（結束不顯示成績）；閒置時清掉本輪成績', async () => {
        const page = await openPage();
        const changeCategory = v => page.evaluate(v => { const s = $('f-category'); s.value = v; s.dispatchEvent(new Event('change')); }, v);
        await page.click('#start-btn');
        await page.keyboard.press('1');
        await page.keyboard.press('Enter');
        // 不結束：設定還原，測驗繼續
        await page.evaluate(() => { window.confirm = () => false; });
        await changeCategory('ETH');
        assert.deepEqual(await page.evaluate(() => [!!session, settings.category, $('f-category').value]), [true, 'all', 'all']);
        await page.click('.chip[data-key="new"]');
        assert.deepEqual(await page.evaluate(() => [!!session, settings.include]), [true, []]);
        // 結束：不顯示本輪成績、不詢問檢討，作答紀錄保留
        await page.evaluate(() => { window.confirm = () => true; });
        await changeCategory('ETH');
        assert.deepEqual(await page.evaluate(() => [!!session, settings.category, lastResult, $('round-dialog').open, peek(Q('ETH-0001')).history.length]),
            [false, 'ETH', null, false, 1]);
        assert.equal(await text(page, '#category'), '準備開始');
        // 做完一輪後改設定：本輪成績清掉
        await page.type('#f-limit', '1');
        await page.click('#start-btn');
        await page.keyboard.press('4');
        await page.keyboard.press('Enter');
        await page.click('#round-dialog-skip');
        assert.equal(await text(page, '#category'), '本輪成績');
        await page.click('.chip[data-key="new"]');
        assert.equal(await text(page, '#category'), '準備開始');
        await page.closeContext();
    });
});

/* ---------- 題目總覽 ---------- */
describe('本輪檢討', () => {
    /* 第 1 題答錯標 HARD、第 2 題答對標加強複習、第 3 題先點錯再復原後答對，然後中止 */
    async function playRound(page) {
        await page.click('#start-btn');
        await page.keyboard.press('1');
        await page.keyboard.press('h'); await sleep(350);
        await page.keyboard.press('4');
        await page.keyboard.press('r');
        await page.keyboard.press('Enter');
        await page.keyboard.press('1');
        await page.keyboard.press('z');
        await page.keyboard.press('3');
        await page.keyboard.press('Escape');
    }
    const cards = page => page.$$eval('#rr-list .qitem', cs => cs.map(c => [c.querySelector('.num').textContent, c.querySelector('.rr-tries').textContent]));

    test('中止時詢問要不要檢討；選要才顯示，可以切換答錯、加強複習、HARD、全部', async () => {
        const page = await openPage();
        await playRound(page);
        assert.equal(await page.$eval('#round-dialog', d => d.open), true);
        assert.match(await text(page, '#round-dialog-body'), /本輪作答 3 題：❌ 答錯 1 ・ 📌 加強複習 1 ・ 🔴 HARD 1/);
        assert.equal(await page.$eval('#round-review', e => e.hidden), true);
        await page.keyboard.press('Enter');       // 預設聚焦「檢討本輪」；不會開始新的一輪
        assert.equal(await page.$eval('#round-dialog', d => d.open), false);
        assert.equal(await page.evaluate(() => session), null);
        assert.equal(await page.$eval('#round-review', e => e.hidden), false);
        assert.equal(await page.$eval('#rr-filters .chip.on', e => e.dataset.key), 'wrong');
        assert.deepEqual(await cards(page), [['第 1 題', '本輪的選擇：選 (1) ✗ HARD　・　正確答案 (4)']]);
        assert.deepEqual(await page.$$eval('#rr-list .qopts li', ls => ls.map(l => l.className)), ['mine', '', '', 'ans']);
        await page.click('#rr-filters .chip[data-key="review"]');
        assert.deepEqual((await cards(page)).map(c => c[0]), ['第 2 題']);
        await page.click('#rr-filters .chip[data-key="all"]');
        // 第 3 題點錯後復原，不算在本輪的選擇裡
        assert.deepEqual(await cards(page), [
            ['第 1 題', '本輪的選擇：選 (1) ✗ HARD　・　正確答案 (4)'],
            ['第 2 題', '本輪的選擇：選 (4) ✓ MEDIUM　・　正確答案 (4)'],
            ['第 3 題', '本輪的選擇：選 (3) ✓ MEDIUM　・　正確答案 (3)'],
        ]);
        // 下一輪開始時收起來
        await page.click('#start-btn');
        assert.equal(await page.$eval('#round-review', e => e.hidden), true);
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('選「不用」就不顯示，之後可以從成績卡打開；沒有作答就不詢問', async () => {
        const page = await openPage();
        await playRound(page);
        await page.click('#round-dialog-skip');
        assert.equal(await page.$eval('#round-review', e => e.hidden), true);
        await page.click('#round-review-open');
        assert.equal(await page.$eval('#round-review', e => e.hidden), false);
        assert.equal((await cards(page)).length, 1);
        await page.click('#start-btn');
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#round-dialog', d => d.open), false);
        assert.equal(await page.$('#round-review-open'), null);
        await page.closeContext();
    });

    test('紀錄檔裡舊版的解析會搬到解析，紀錄不再帶著；內建解析可以被使用者的修改蓋過', async () => {
        const id = 'ETH-2024-NX89-0003';
        const records = { format: 'pdf2quiz-records', version: 4, banks: { 'ETH-2024-NX89': { columns: ['seq', 'h', 'note'], rows: [[3, [['t0', 1, 1, 'M']], ['舊版解析', 't0']]] } }, exams: { columns: [], rows: [] } };
        const page = await openPage({ records });
        const r = await page.evaluate(id => [getNote(id) && getNote(id).text, 'note' in peek(id), JSON.stringify(packRecords()).includes('舊版解析'), peek(id).history.length], id);
        assert.deepEqual(r, ['舊版解析', false, false, 1]);
        // 內建解析：較晚的使用者修改優先
        const b = await page.evaluate(async () => {
            const id = Q('ETH-0004');
            BUILTIN_NOTES[id] = { text: '內建', at: '2026-01-01T00:00:00.000Z' };
            const before = getNote(id).text;
            await setNote(id, '');
            return [before, getNote(id), allNotes()[id].text];
        });
        assert.deepEqual(b, ['內建', null, '']);
        await page.closeContext();
    });

    test('連結解析檔：開啟時合併檔案裡的解析，之後每次修改自動寫回；data/notes.js 的格式讀寫一致', async () => {
        const page = await openPage();
        const r = await page.evaluate(async () => {
            const id = Q('ETH-0005');
            // 假的檔案 handle：檔案裡有一題較新的解析
            let content = notesFileContent('notes.js').replace('"notes": {', `"notes": {\n  "${id}": { "text": "檔案裡的", "at": "2030-01-01T00:00:00.000Z" },`);
            const handle = { name: 'notes.js', getFile: async () => ({ text: async () => content }), createWritable: async () => ({ write: async t => { content = t; }, close: async () => {} }) };
            await linkNotesHandle(handle, { load: true });
            const merged = getNote(id).text;
            await setNote(Q('ETH-0006'), '新寫的');
            await new Promise(res => setTimeout(res, 500));
            const back = parseNotesFile(content).notes;
            return [merged, back[id].text, back[Q('ETH-0006')].text, content.startsWith('// 由頁面'), $('notes-file-status').className];
        });
        assert.deepEqual(r, ['檔案裡的', '檔案裡的', '新寫的', true, 'linked']);
        await page.closeContext();
    });

    test('解析彈窗可以拖標題移動、可以調整大小；重新打開回到中間', async () => {
        const page = await openPage();
        await page.setViewport({ width: 1000, height: 800 });
        await page.click('.tab[data-view="browse"]');
        await page.click('#browse-list .qitem:first-child .note-btn');
        const rect = () => page.$eval('#note-dialog', d => { const r = d.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.height)]; });
        const [x0, y0, h0] = await rect();
        const t = await page.$eval('#note-title', e => { const r = e.getBoundingClientRect(); return [r.left + 20, r.top + 5]; });
        await page.mouse.move(t[0], t[1]);
        await page.mouse.down();
        await page.mouse.move(t[0] - 100, t[1] - 50, { steps: 5 });
        await page.mouse.up();
        assert.deepEqual(await rect(), [x0 - 100, y0 - 50, h0]);   // 移動後大小不變
        assert.equal(await page.$eval('#note-dialog', d => getComputedStyle(d).resize), 'both');
        await page.evaluate(() => $('note-dialog').close());
        await page.click('#browse-list .qitem:first-child .note-btn');
        assert.deepEqual(await rect(), [x0, y0, h0]);
        await page.closeContext();
    });

    test('複製題目：練習中、本輪檢討、題目總覽都可以只複製題目文字', async () => {
        const page = await openPage();
        const ctx = page.browserContext();
        await ctx.overridePermissions('file://', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
        // 不管用哪一種方式複製，都記下寫進剪貼簿的文字
        await page.evaluate(() => { window.__copied = []; const orig = copyText; copyText = async t => { window.__copied.push(t); return orig(t); }; });
        await page.click('#start-btn');
        await page.click('#copy-slot .copy-btn');
        await page.waitForFunction(() => $('copy-slot').firstChild.textContent === '✓ 已複製');
        await page.keyboard.press('1');
        await page.keyboard.press('Escape');
        await page.click('#round-dialog-review');
        await page.click('#rr-list .copy-btn');
        await page.click('.tab[data-view="browse"]');
        await page.click('#browse-list .qitem .copy-btn');
        const q1 = await page.evaluate(() => allQuestions[0].question);
        assert.deepEqual(await page.evaluate(() => window.__copied), [q1, q1, q1]);
        await page.closeContext();
    });

    test('解析：提供解析後按鈕變成查看說明，可以編輯、刪除；練習答完才出現；和作答紀錄分開存', async () => {
        const page = await openPage();
        await page.click('#start-btn');
        assert.equal(await page.$eval('#note-slot', e => e.hidden), true);   // 作答前不顯示
        await page.keyboard.press('1');
        assert.equal(await page.$eval('#note-slot .note-btn', e => e.textContent), '✏️ 提供解析');
        await page.click('#note-slot .note-btn');
        await page.type('#note-input', '第一版解析\n第二行');
        await page.keyboard.press('2');                       // 在輸入框打字不會被當成作答快捷鍵
        await page.click('#note-save');
        await page.waitForFunction(() => !$('note-view').hidden);
        assert.equal(await page.$eval('#note-text', e => e.textContent), '第一版解析\n第二行2');
        await page.click('#note-close');
        assert.equal(await page.$eval('#note-slot .note-btn', e => e.textContent), '📖 查看說明');
        const qid = await page.evaluate(() => queue[pos].id);
        // 題目總覽的同一題也是「查看說明」；編輯
        await page.keyboard.press('Escape');
        await page.click('#round-dialog-skip');
        await page.click('.tab[data-view="browse"]');
        const btn = `#browse-list .qitem:first-child .note-btn`;
        assert.equal(await page.$eval(btn, e => e.textContent), '📖 查看說明');
        await page.click(btn);
        await page.click('#note-edit-btn');
        await page.evaluate(() => { $('note-input').value = '改過的解析'; });
        await page.click('#note-save');
        await page.waitForFunction(() => !$('note-view').hidden);
        await page.click('#note-close');
        // 解析和作答紀錄分開：紀錄檔裡沒有解析；存在瀏覽器的 userNotes，重新整理後還在
        assert.equal(await page.evaluate(() => JSON.stringify(packRecords()).includes('改過的解析')), false);
        assert.equal(await page.evaluate(async id => (await idb('readonly', s => s.get('userNotes')))[id].text, qid), '改過的解析');
        // 匯入解析檔：同一題以較晚改的為準
        const r = await page.evaluate(async id => {
            const older = await mergeNotes({ [id]: { text: '舊的', at: '2020-01-01T00:00:00.000Z' } });
            const other = await mergeNotes({ [Q('ETH-0002')]: { text: '另一題', at: '2020-01-01T00:00:00.000Z' } });
            return [older, other, getNote(id).text, getNote(Q('ETH-0002')).text];
        }, qid);
        assert.deepEqual(r, [0, 1, '改過的解析', '另一題']);
        // 刪除：按鈕變回提供解析；再匯入舊的內容不會被補回來
        await page.advance(1000);
        await page.click(btn);
        await page.click('#note-delete-btn');
        await page.waitForFunction(b => document.querySelector(b).textContent === '✏️ 提供解析', {}, btn);
        assert.equal(await page.evaluate(async id => { await mergeNotes({ [id]: { text: '改過的解析', at: '2020-01-01T00:00:00.000Z' } }); return getNote(id); }, qid), null);
        await page.closeContext();
    });

    test('其他選項淡化、選錯的加刪除線；錯題重測只出本輪答錯的題目', async () => {
        const page = await openPage();
        await playRound(page);
        await page.click('#round-dialog-review');
        const styles = await page.$$eval('#rr-list .qopts li', ls => ls.map(l => [l.className, getComputedStyle(l).opacity, getComputedStyle(l).textDecorationLine]));
        assert.deepEqual(styles, [['mine', '0.6', 'line-through'], ['', '0.45', 'none'], ['', '0.45', 'none'], ['ans', '1', 'none']]);
        assert.equal(await text(page, '#rr-retry'), '🔁 錯題重測（1 題）');
        await page.click('#rr-retry');
        assert.deepEqual(await page.evaluate(() => [queue.map(q => q.num), session.limit, settings.limit]), [[1], 1, '']);
        assert.equal(await page.$eval('#round-review', e => e.hidden), true);
        await page.keyboard.press('4');
        await page.keyboard.press('Enter');
        assert.match(await text(page, '.result-card'), /錯題重測完成 100 \/ 100/);
        // 這輪沒有答錯：不顯示錯題重測
        await page.click('#round-dialog-review');
        assert.equal(await page.$eval('#rr-retry', e => e.hidden), true);
        await page.closeContext();
    });
});

describe('題目總覽', () => {
    test('關鍵字查詢：題目／答案／兩者、多個關鍵字、建議名詞、查詢紀錄可以刪除', async () => {
        const page = await openPage();
        await page.click('.tab[data-view="browse"]');
        const count = () => page.evaluate(() => browseList().length);
        // 依範圍自己算一次，和畫面的結果比較
        const expected = (terms, scope) => page.evaluate((terms, scope) => allQuestions.filter(q => matches(q) && terms.every(t => {
            const ans = q.options[q.answer - 1];
            return scope === 'question' ? q.question.includes(t) : scope === 'answer' ? ans.includes(t) : (q.question + q.options.join('')).includes(t);
        })).length, terms, scope);
        await page.focus('#b-q');
        await page.keyboard.type('公司');
        const sug = await page.$$eval('#b-suggest .suggest-item', rs => rs.map(r => r.querySelector('.suggest-text').textContent));
        assert.ok(sug.includes('公司債'), sug.join());
        assert.ok(sug.indexOf('公司債') < sug.indexOf('上市公司'), '開頭相同的排前面');
        assert.equal(await count(), await expected(['公司'], 'all'));
        // 選建議的名詞：換掉正在輸入的詞，並記進查詢紀錄
        await page.evaluate(() => [...document.querySelectorAll('#b-suggest .suggest-item')].find(r => r.textContent.includes('公司債')).click());
        assert.equal(await page.$eval('#b-q', e => e.value), '公司債');
        assert.equal(await count(), await expected(['公司債'], 'all'));
        assert.ok(await count() > 0);
        assert.ok(await page.$$eval('#browse-list .qitem mark', ms => ms.length > 0 && ms.every(m => m.textContent === '公司債')));
        // 查詢範圍
        for (const scope of ['question', 'answer', 'all']) {
            await page.select('#b-scope', scope);
            assert.equal(await count(), await expected(['公司債'], scope), scope);
        }
        // 多個關鍵字：全部都要符合；按 Enter 記錄
        await page.click('#b-q', { clickCount: 3 });
        await page.keyboard.type('客戶 保密');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Enter');
        assert.equal(await count(), await expected(['客戶', '保密'], 'all'));
        assert.match(await text(page, '#browse-count'), /符合條件與關鍵字 \d+ 題/);
        // 統計跟著關鍵字；標題改成篩選題目，不顯示出題用的欄位
        assert.match(await text(page, '.stats-main'), new RegExp(`符合篩選條件 ${await count()} / 1120 題（排除 暫停複習；關鍵字 客戶 保密）`));
        assert.equal(await text(page, '#setup-title'), '篩選題目');
        assert.deepEqual(await page.evaluate(() => ['#f-limit', '#more-settings', '#start-btn'].map(s => !!document.querySelector(s).offsetParent)), [false, false, false]);
        await page.click('.tab[data-view="quiz"]');
        assert.equal(await text(page, '#setup-title'), '出題設定');
        assert.match(await text(page, '.stats-main'), /符合出題規則 1120 \/ 1120 題（排除 暫停複習）/);
        assert.equal(await page.$eval('#b-q', e => !!e.offsetParent), false);
        await page.click('.tab[data-view="browse"]');
        assert.deepEqual(await page.evaluate(() => settings.searchHistory), ['客戶 保密', '公司債']);
        // 清空後顯示查詢紀錄，可以刪除單筆
        await page.click('#b-q', { clickCount: 3 });
        await page.keyboard.press('Backspace');
        assert.equal(await count(), await expected([], 'all'));
        assert.deepEqual(await page.$$eval('#b-suggest .suggest-item', rs => rs.map(r => r.querySelector('.suggest-text').textContent)), ['客戶 保密', '公司債']);
        await page.click('#b-suggest .suggest-item .suggest-del');
        assert.deepEqual(await page.evaluate(() => settings.searchHistory), ['公司債']);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'b-q');
        // 點查詢紀錄：整串換掉
        await page.click('#b-suggest .suggest-item');
        assert.equal(await page.$eval('#b-q', e => e.value), '公司債');
        // 重新整理後查詢紀錄還在
        await page.reload();
        assert.deepEqual(await page.evaluate(() => settings.searchHistory), ['公司債']);
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('每一題剛好有一個進度標籤：未作答或已作答', async () => {
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0001': { history: history('OE', 'OE') }, 'ETH-0002': { history: history('XH') },
        } } });
        await page.click('.tab[data-view="browse"]');
        const tags = await page.$$eval('.qitem', items => items.map(q => [...q.querySelectorAll('.tag')].map(t => t.className)));
        assert.equal(tags.length, 50);
        for (const t of tags) assert.equal(t.filter(c => c === 'tag new' || c === 'tag answered').length, 1);
        assert.deepEqual(tags.slice(0, 3).map(t => t[0]), ['tag answered', 'tag answered', 'tag new']);
        const all = await page.evaluate(() => allQuestions.map(q => questionTags(peek(q.id)).filter(([c]) => c === 'new' || c === 'answered').length));
        assert.ok(all.length === 1120 && all.every(n => n === 1));
        await page.closeContext();
    });

    test('依上次作答時間排序：新到舊、舊到新，未作答的都排在最後', async () => {
        const at = t => ({ history: [{ t, pick: 1, ok: false, level: 'MEDIUM' }] });
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0003': at('2026-01-01T00:00:00Z'), 'ETH-0001': at('2026-03-01T00:00:00Z'), 'ETH-0002': at('2026-02-01T00:00:00Z'),
        } } });
        await page.click('.tab[data-view="browse"]');
        const order = () => page.evaluate(() => browseList().map(q => q.num));
        await page.select('#b-sort', 'lastDesc');
        let o = await order();
        assert.deepEqual(o.slice(0, 4), [1, 2, 3, 4]);
        await page.select('#b-sort', 'lastAsc');
        o = await order();
        assert.deepEqual(o.slice(0, 4), [3, 2, 1, 4]);
        assert.equal(o.length, 1120);
        assert.equal(await page.evaluate(() => settings.browseSort), 'lastAsc');
        await page.closeContext();
    });

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

    test('沿用題目難度計分；記下題目可以從考試紀錄打開；檢討時改難度標籤不影響分數、可標加強複習；倒數時間條', async () => {
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0001': { history: history('XH') }, 'ETH-0002': { history: history('XE') },
        } }, settings: { include: ['answered'], exclude: [], order: 'seq', examPick: 'filter' } });
        await page.click('.tab[data-view="exam"]');
        await page.evaluate(() => { document.querySelectorAll('#x-counts input').forEach(i => i.value = 5); $('x-time').value = 20; });
        await page.click('#x-start');
        assert.equal(await page.$eval('#x-timebar', e => !e.hidden && e.firstChild.style.width), '100%');
        await page.advance(10 * 60 * 1000);
        await page.evaluate(() => tickExam());
        assert.equal(await page.$eval('#x-timebar', e => [e.firstChild.style.width, e.classList.contains('warn')].join()), '50%,false');
        // 20 分鐘：剩 25%（5:00）變橘色，剩 10%（2:00）才變紅色
        await page.advance(5 * 60 * 1000 + 1000);
        await page.evaluate(() => tickExam());
        assert.equal(await page.$eval('#x-timebar', e => [e.classList.contains('low'), e.classList.contains('warn')].join()), 'true,false');
        await page.advance(3 * 60 * 1000);
        await page.evaluate(() => tickExam());
        assert.equal(await page.$eval('#x-timebar', e => [e.classList.contains('low'), e.classList.contains('warn')].join()), 'true,true');
        assert.match(await text(page, '#x-timer'), /剩餘 1:59\s*已用 18:01/);
        await page.evaluate(() => { exam.items.forEach(it => { it.pick = it.q.answer; }); });
        await page.click('#x-submit');
        const after = () => page.evaluate(ids => ids.map(id => { const r = peek(Q(id)); return [r.level, r.score, r.review]; }), ['ETH-0001', 'ETH-0002']);
        assert.deepEqual(await after(), [['HARD', 0, false], ['EASY', 4, false]]);   // −1 + 1（HARD）、−1 + 5（EASY）
        // 檢討：ETH-0001 改成 EASY（只改標籤）、標加強複習
        const tools = '#x-review .qitem:nth-child(1) .x-tools';
        await page.click(`${tools} .chip:nth-of-type(1)`);
        await page.click(`${tools} .chip:nth-of-type(4)`);
        assert.deepEqual(await after(), [['EASY', 0, true], ['EASY', 4, false]]);
        assert.match(await page.$eval(tools, e => e.querySelector('.chip.on').textContent), /EASY/);
        // 存檔再讀回來，標籤還在
        const back = await page.evaluate(() => { const r = normalizeRecords(JSON.parse(JSON.stringify(packRecords()))).items[Q('ETH-0001')]; return [r.level, r.score]; });
        assert.deepEqual(back, ['EASY', 0]);
        // 之後再練習作答，以新的作答為準
        await page.advance(60 * 1000);
        assert.equal(await page.evaluate(() => { const r = rec(Q('ETH-0001')); r.history.push({ t: new Date().toISOString(), pick: 9, ok: false, level: 'MEDIUM' }); recompute(r); return r.level; }), 'MEDIUM');
        // 考試紀錄：記下題目與作答，可以打開
        assert.deepEqual(await page.evaluate(() => records.exams[0].items.map(([id, pick]) => [id.slice(-4), pick !== null])), [['0001', true], ['0002', true]]);
        await page.click('#x-back');
        await page.click('#x-history .x-history-row.open');
        assert.match(await text(page, '#x-summary'), /考試紀錄/);
        assert.equal(await page.$$eval('#x-review .qitem', c => c.length), 2);
        await page.closeContext();
    });

    test('依抽題範圍：只抽符合條件的題目、照順序先抽；完全隨機不受條件影響，也不顯示上方區塊', async () => {
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0001': { history: history('XM') }, 'ETH-0002': { history: history('XH') }, 'ETH-0003': { history: history('OM') },
        } }, settings: { include: ['lastWrong'], exclude: [], order: 'seq' } });
        await page.click('.tab[data-view="exam"]');
        const visible = () => page.$eval('#setup', e => !e.hidden && getComputedStyle(e).display !== 'none');
        assert.equal(await visible(), false);
        await page.select('#x-pick', 'filter');
        assert.equal(await visible(), true);
        assert.equal(await text(page, '#setup-title'), '抽題範圍');
        assert.match(await text(page, '#x-counts'), /符合 2 ／ 共 616 題/);
        assert.equal(await page.$eval('#f-limit', e => e.offsetParent), null);   // 題數、開始按鈕不顯示
        assert.equal(await page.$eval('#start-btn', e => e.offsetParent), null);
        await page.evaluate(() => { document.querySelectorAll('#x-counts input').forEach(i => i.value = 5); });
        await page.click('#x-start');
        assert.equal(await visible(), false);   // 考試中不顯示
        assert.deepEqual(await page.evaluate(() => exam.items.map(it => it.q.id.slice(-4))), ['0001', '0002']);
        await page.click('#x-submit');
        await page.click('#x-back');
        assert.equal(await visible(), true);
        await page.select('#x-pick', 'random');
        assert.equal(await visible(), false);
        await page.click('#x-start');
        assert.equal(await page.evaluate(() => exam.items.length), 10);
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
            return { first, second, h1: records.items[Q('ETH-0001')].history.length, h3: records.items[Q('ETH-0003')].history.length, exams: records.exams.length, score1: records.items[Q('ETH-0001')].score };
        });
        assert.deepEqual(r.first, { added: 2, total: 4 });
        assert.deepEqual(r.second, { added: 0, total: 4 });
        assert.equal(r.h1, 2);
        assert.equal(r.h3, 1);
        assert.equal(r.exams, 2);
        assert.equal(r.score1, 6.25);       // 連對 2 次：2.5 + 3.75
        await page.closeContext();
    });

    test('標記衝突以較晚修改的為準', async () => {
        const page = await openPage();
        const r = await page.evaluate(() => {
            const a = normalizeRecords({ version: 2, items: { 'ETH-0001': { history: [], review: true, markAt: '2026-01-01T00:00:00Z' } } });
            const b = normalizeRecords({ version: 2, items: { 'ETH-0001': { history: [], review: false, noReview: true, markAt: '2026-01-03T00:00:00Z' } } });
            const m = mergeRecordSets(a, b).items[Q('ETH-0001')];
            return [m.review, m.noReview];
        });
        assert.deepEqual(r, [false, true]);
        await page.closeContext();
    });

    test('取代匯入會蓋掉目前的紀錄', async () => {
        const page = await openPage({ records: { version: 2, items: { 'ETH-0009': { history: history('OM') } } } });
        const r = await page.evaluate(() => { adoptRecords({ version: 2, items: { 'ETH-0001': { history: [] } } }); return [Object.keys(records.items), Q('ETH-0001')]; });
        assert.deepEqual(r[0], [r[1]]);
        await page.closeContext();
    });
});

/* ---------- 儲存 ---------- */
describe('儲存', () => {
    test('作答後以欄位式格式存進 IndexedDB，重新整理後還在', async () => {
        const page = await openPage();
        await page.click('#start-btn');
        await page.keyboard.press('4');
        await page.keyboard.press('h'); await sleep(350);
        await page.evaluate(() => browserWriting);
        const saved = await page.evaluate(() => idb('readonly', s => s.get(RECORDS_IDB_KEY)));
        assert.equal(saved.format, 'pdf2quiz-records');
        assert.equal(saved.version, 4);
        const bankId = await page.evaluate(() => splitQid(Q('ETH-0001')).bankId);
        assert.deepEqual(Object.keys(saved.banks), [bankId]);          // 沒資料的題目不存
        const t = saved.banks[bankId];
        assert.deepEqual(t.columns, ['seq', 'h', 'review', 'noReview', 'markAt', 'base', 'tag']);   // 不存分數等算得出來的欄位
        assert.equal(t.rows.length, 1);
        assert.equal(t.rows[0][0], 1);
        assert.deepEqual(t.rows[0][1][0].slice(1, 5), [4, 1, 'H', 0]);   // 第 5 欄 0：不是模擬考
        assert.equal(typeof t.rows[0][1][0][5], 'number');               // 第 6 欄：作答秒數
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#f-chips .chip'));
        const r = await page.evaluate(() => ({ level: peek(Q('ETH-0001')).level, score: peek(Q('ETH-0001')).score }));
        assert.deepEqual(r, { level: 'HARD', score: 1.4 });              // HARD 1.0 × 速度 1.4（立刻作答）
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('紀錄檔不縮排，讀回來分數相同；和毫秒格式的舊紀錄合併不會重複', async () => {
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0001': { history: [{ t: '2026-01-01T00:00:00.123Z', pick: 4, ok: true, level: 'EASY' }, { t: '2026-01-02T00:00:00.456Z', pick: 4, ok: true, level: 'HARD' }] },
            'ETH-0002': { history: [{ t: '2026-01-01T01:00:00.789Z', pick: 1, ok: false, level: 'MEDIUM', src: 'exam' }], review: true, markAt: '2026-01-01T02:00:00.000Z' },
        } } });
        const r = await page.evaluate(() => {
            const text = recordPayload();
            const back = normalizeRecords(JSON.parse(text));
            const merged = mergeInto(JSON.parse(text));
            return {
                newline: text.includes('\n'),
                scores: [back.items[Q('ETH-0001')].score, back.items[Q('ETH-0002')].score],
                src: back.items[Q('ETH-0002')].history[0].src,
                review: back.items[Q('ETH-0002')].review,
                merged,
            };
        });
        assert.equal(r.newline, false);
        assert.deepEqual(r.scores, [6.5, -1]);   // EASY 5 + HARD 1.0 × 1.5
        assert.equal(r.src, 'exam');
        assert.equal(r.review, true);
        assert.deepEqual(r.merged, { added: 0, total: 3 });
        await page.closeContext();
    });
});

/* ---------- 題庫與舊 id 轉換 ---------- */
describe('題庫與 id 轉換', () => {
    test('模擬考成績、對不到題庫的紀錄，經過欄位式格式後完整保留', async () => {
        const exams = [{ at: '2026-01-01T05:00:00.000Z', durationMs: 120000, timeUp: false, passScore: 70, pass: true, recorded: true,
            subjects: [{ category: '職業道德', n: 2, correct: 2, score: 100 }, { category: '金融市場常識', n: 1, correct: 0, score: 0 }] }];
        const page = await openPage({ records: { version: 2, items: {
            'ETH-0001': { history: history('OE') },
            'ZZZ-0001': { history: history('XM'), review: true, markAt: '2026-01-01T02:00:00.000Z' },   // 對不到任何題庫
        }, exams } });
        const r = await page.evaluate(() => {
            const payload = JSON.parse(recordPayload());
            const back = normalizeRecords(payload);
            return { other: payload.other && payload.other.rows.map(x => x[0]), exams: back.exams, zzz: back.items['ZZZ-0001'], eth: !!back.items[Q('ETH-0001')] };
        });
        assert.deepEqual(r.other, ['ZZZ-0001']);
        assert.deepEqual(r.exams, exams);
        assert.equal(r.zzz.history.length, 1);
        assert.equal(r.zzz.review, true);
        assert.equal(r.eth, true);
        await page.closeContext();
    });

    test('新舊 id 混在一起時合併成同一題，同一筆作答不重複', async () => {
        const page = await openPage();
        const r = await page.evaluate(() => {
            const h = [{ t: '2026-01-01T00:00:00.000Z', pick: 4, ok: true, level: 'MEDIUM' }];
            const h2 = [...h, { t: '2026-01-02T00:00:00.000Z', pick: 1, ok: false, level: 'MEDIUM' }];
            const data = normalizeRecords({ version: 3, items: { 'ETH-0001': { history: h }, [Q('ETH-0001')]: { history: h2 } } });
            return { keys: Object.keys(data.items), n: data.items[Q('ETH-0001')].history.length, id: Q('ETH-0001') };
        });
        assert.deepEqual(r.keys, [r.id]);
        assert.equal(r.n, 2);
        await page.closeContext();
    });

    test('切換題庫：題目、科目與模擬考各科跟著換，設定記住選擇', async () => {
        const page = await openPage();
        assert.equal(await page.evaluate(() => allQuestions.length), 1120);
        const single = await page.evaluate(() => sourceList().find(s => s.bankIds.length === 1 && s.bankIds[0].startsWith('MKT')).id);
        await page.select('#f-source', single);
        const r = await page.evaluate(() => ({
            n: allQuestions.length, source: settings.source,
            cats: [...document.querySelectorAll('#f-category option')].map(o => o.value),
            exam: document.querySelectorAll('#x-counts input').length,
        }));
        assert.deepEqual(r, { n: 504, source: single, cats: ['all', 'MKT'], exam: 1 });
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#f-chips .chip'));
        assert.equal(await page.evaluate(() => allQuestions.length), 504);
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('題庫選單：組合題庫和單一題庫分開，滑鼠移到組合上顯示包含的題庫', async () => {
        const page = await openPage();
        const r = await page.evaluate(() => [...document.querySelectorAll('#f-source optgroup')].map(g => [g.label, [...g.children].map(o => [o.textContent, o.title])]));
        assert.deepEqual(r, [
            ['組合題庫', [['金融市場常識與職業道德測驗（1120 題）', '包含：職業道德-2024（616 題）、金融市場常識-2024（504 題）']]],
            ['單一題庫', [['職業道德-2024（616 題）', ''], ['金融市場常識-2024（504 題）', '']]],
        ]);
        assert.equal(await page.$eval('#f-source', e => e.title), '組合：職業道德-2024（616 題）、金融市場常識-2024（504 題）');
        assert.equal(await text(page, '.brand-sub'), '金融市場常識與職業道德測驗');
        await page.select('#f-source', await page.evaluate(() => sourceList().find(s => !s.combo).id));
        assert.equal(await page.$eval('#f-source', e => e.title), '');
        await page.closeContext();
    });

    test('舊版設定的科目名稱轉成類別 key', async () => {
        const page = await openPage({ settings: { category: '職業道德' } });
        assert.deepEqual(await page.evaluate(() => [settings.category, $('f-category').value, allQuestions.filter(matches).length]), ['ETH', 'ETH', 616]);
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

    test('手機：答完後難度按鈕固定在畫面底部，作答前不固定；頁面不會出現橫向捲軸', async () => {
        const page = await openPage({ width: 390 });
        await page.click('#start-btn');
        assert.equal(await page.$eval('#meta', e => getComputedStyle(e).position), 'static');
        await page.keyboard.press('4');
        assert.equal(await page.$eval('#meta', e => getComputedStyle(e).position), 'fixed');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
        assert.deepEqual(page.errors, []);
        await page.closeContext();
    });

    test('更多設定顯示目前的順序；頁首顯示目前的題庫或組合；排除的條件沒有刪除線', async () => {
        const page = await openPage();
        assert.equal(await text(page, '#more-summary'), '（順序：依題號）');
        await page.select('#f-order', 'random');
        assert.equal(await text(page, '#more-summary'), '（順序：弱點加權）');
        assert.equal(await text(page, '.brand-sub'), '金融市場常識與職業道德測驗');
        assert.equal(await page.$eval('.chip.exc', e => getComputedStyle(e).textDecorationLine), 'none');
        await page.closeContext();
    });
});
