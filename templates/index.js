// 內建樣板：描述題庫 PDF 的版面，由 js/templates.js 套用
// 欄位說明見 js/templates.js 開頭的註解
window.QUIZ_TEMPLATES = [
    {
        id: 'answer-first-paren-digit',
        name: '答案在題號前・選項 (1)～(4)',
        example: '(3) 12 下列何者正確？(1)股票(2)債券(3)基金(4)期貨',
        start: '^[(（](?<ans>[1-4])[)）]\\s*(?<num>\\d+)\\s+(?<rest>.*)$',
        sequential: 1,
        options: { marker: 'paren-digit', count: 4 },
        answer: { position: 'start' },
        ignore: ['答案 題號 題目', 'Part I'],
        ignorePattern: ['^\\d+$'],
    },
    {
        id: 'number-dot-paren-alpha-answer-after',
        name: '題號. 題目・選項 (A)～(D)・答案寫在選項後（答案：B）',
        example: '12. 下列何者正確？ (A)股票 (B)債券 (C)基金 (D)期貨 答案：C',
        start: '^(?<num>\\d+)\\s*[.．、]\\s*(?<rest>.*)$',
        sequential: 1,
        options: { marker: 'paren-alpha', count: 'auto' },
        answer: { position: 'pattern', pattern: '[【\\[]?答案?[】\\]]?\\s*[:：]?\\s*[(（]?(?<ans>[A-Ea-eＡ-Ｅ])[)）]?\\s*$' },
        ignorePattern: ['^\\d+$', '^第\\s*\\d+\\s*頁'],
    },
    {
        id: 'answer-first-circled',
        name: '答案在題號前・選項 ①～④',
        example: '(3) 12 下列何者正確？①股票②債券③基金④期貨',
        start: '^[(（](?<ans>[1-5①-⑤])[)）]\\s*(?<num>\\d+)\\s+(?<rest>.*)$',
        sequential: 1,
        options: { marker: 'circled', count: 'auto' },
        answer: { position: 'start' },
        ignorePattern: ['^\\d+$'],
    },
];
