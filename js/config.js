/* 常數、計分規則、出題條件與共用小工具 */
const STORAGE_KEY = 'pdf2quiz-records-v1';   // 舊版存在 localStorage 的位置，現在改存 IndexedDB，只在搬移時讀取
const SETTINGS_KEY = 'pdf2quiz-settings-v1';
const RECORD_VERSION = 3;   // 3：精簡格式（作答歷程改用陣列、不存算得出來的欄位）
const HISTORY_LIMIT = 200;   // 每題保留的作答歷史筆數，更早的會濃縮成起始分數

/* ---------- 計分規則 ---------- */
const SCORING = {
    base: { EASY: 2.5, MEDIUM: 1.5, HARD: 1.0 },   // 難度係數
    streak: [1, 1.5, 2],                            // 連續第 1、2、3 次以後的加成
    cap: 8,                                         // 分數上限
    wrongFactor: 0.5,                               // 答錯：分數 × 0.5 − 1
    wrongPenalty: 1,
    cooldownMs: 10 * 60 * 1000,                     // 10 分鐘內重複答對不加分
};
const DEFAULT_THRESHOLD = 5;

/* 隨機排序的權重：權重越高越容易先出現
   權重 = 作答次數因素 ^ a × 錯題因素 ^ b × 難度因素 ^ c
   弱點加權 a:b:c = 1:1:1；加強版把其中一項的重要性提高為 boost（1.5:1:1） */
const RANDOM_WEIGHT = {
    attempts: 2,                                   // 作答次數：1 + 2 ÷ (次數 + 1) → 沒作答 ×3、1 次 ×2、3 次 ×1.5
    scoreDiv: 6,                                   // 錯題：1 + (8 − 分數) ÷ 6 + 答錯次數 × 0.2
    wrongStep: 0.2,
    wrongMax: 5,                                   // 答錯次數最多算 5 次
    level: { EASY: 0.7, MEDIUM: 1, HARD: 1.5 },    // 難度：沒作答過的題目算 1
    boost: 1.5,
    modes: {                                       // 順序選項 → 加強哪一項
        random: null,
        randomNew: 'attempts',
        randomWrong: 'wrong',
        randomHard: 'level',
    },
};

/* 出題條件：每個條件可以是 不限 / 包含 / 排除 */
const CONDITIONS = [
    { key: 'new', label: '未作答', group: '進度' },
    { key: 'mastered', label: '已記住', group: '進度' },
    { key: 'everWrong', label: '曾經答錯', group: '進度' },
    { key: 'EASY', label: 'EASY', group: '難度' },
    { key: 'MEDIUM', label: 'MEDIUM', group: '難度' },
    { key: 'HARD', label: 'HARD', group: '難度' },
    { key: 'review', label: '加強複習', group: '標記' },
    { key: 'noReview', label: '暫停複習', group: '標記' },
];

const $ = id => document.getElementById(id);
const round2 = n => Math.round(n * 100) / 100;
const streakMult = s => SCORING.streak[Math.min(s, SCORING.streak.length) - 1];
