/* 分數計算：依作答歷程重算 */
/* 依序重算一題的分數；每筆歷史都會標上作答後的分數 s 與本次增減 d */
function replay(r) {
    let score = r.base ? r.base.score : 0;
    let streak = r.base ? r.base.streak : 0;
    let prevT = r.base ? r.base.t : null;
    for (const h of r.history) {
        const before = score;
        const t = Date.parse(h.t);
        if (h.ok) {
            h.cool = prevT !== null && t - prevT < SCORING.cooldownMs;
            if (!h.cool) {
                streak++;
                score = Math.min(SCORING.cap, score + SCORING.base[h.level || 'MEDIUM'] * streakMult(streak) * timeFactor(h.sec));
            }
        } else {
            h.cool = false;
            streak = 0;
            score = score * SCORING.wrongFactor - SCORING.wrongPenalty;
        }
        score = round2(score);
        h.s = score;
        h.d = round2(score - before);
        prevT = t;
    }
    return { score, streak, prevT };
}
function recompute(r) {
    if (r.history.length > HISTORY_LIMIT) {
        const old = { history: r.history.slice(0, r.history.length - HISTORY_LIMIT), base: r.base };
        const s = replay(old);
        r.base = {
            score: s.score, streak: s.streak, t: s.prevT,
            correct: (r.base?.correct || 0) + old.history.filter(h => h.ok).length,
            wrong: (r.base?.wrong || 0) + old.history.filter(h => !h.ok).length,
        };
        r.history = r.history.slice(-HISTORY_LIMIT);
    }
    const s = replay(r);
    r.score = s.score;
    r.streak = s.streak;
    r.correct = (r.base?.correct || 0) + r.history.filter(h => h.ok).length;
    r.wrong = (r.base?.wrong || 0) + r.history.filter(h => !h.ok).length;
    const last = r.history[r.history.length - 1];
    r.level = last ? (last.level || 'MEDIUM') : null;   // 未作答的題目沒有難度
    r.last = last ? (last.ok ? 'correct' : 'wrong') : null;
    r.lastAt = last ? last.t : null;
}
