"""把 source/ 裡的題庫 PDF 轉成網頁用的題庫檔。

輸出：
  questions.json  標準 JSON，給其他程式或伺服器使用
  questions.js    同樣內容，包成 window.QUIZ_DATA，讓 index.html 直接雙擊開啟也能載入

執行：
  python parse_pdf.py
  或（不用安裝 Python 套件）：uv run --with pdfplumber python parse_pdf.py
"""
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).parent
SOURCE_DIR = ROOT / "source"

# 檔名關鍵字 -> (分類名稱, 題目 id 前綴)
CATEGORIES = [
    ("金融市場常識", "MKT"),
    ("職業道德", "ETH"),
]

# 新題目的開頭：「(答案) 題號 題目...」，答案與題號之間一定有空白
QUESTION_START = re.compile(r"^\((?P<ans>[1-4])\)\s+(?P<num>\d+)\s+(?P<rest>.*)$")
PAGE_NUMBER = re.compile(r"^\d+$")
HEADER_HINTS = ("答案 題號 題目", "Part I")


def detect_category(pdf_path: Path):
    for name, prefix in CATEGORIES:
        if name in pdf_path.stem:
            return name, prefix
    return pdf_path.stem, re.sub(r"\W", "", pdf_path.stem)[:6] or "Q"


def read_lines(pdf_path: Path):
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").split("\n"):
                line = line.strip()
                if not line or PAGE_NUMBER.match(line):
                    continue
                if any(h in line for h in HEADER_HINTS):
                    continue
                yield line


def join_lines(lines):
    """中文折行直接接起來；兩端都是英數字時補一個空白。"""
    out = ""
    for line in lines:
        if out and re.match(r"[A-Za-z0-9]", line[0]) and re.match(r"[A-Za-z0-9]", out[-1]):
            out += " "
        out += line
    return out


def split_options(text: str):
    """從後往前找 (4)(3)(2)(1)，避免題幹裡的括號干擾。"""
    positions = []
    end = len(text)
    for n in (4, 3, 2, 1):
        pos = text.rfind(f"({n})", 0, end)
        if pos < 0:
            return None
        positions.append(pos)
        end = pos
    positions.reverse()  # (1)(2)(3)(4) 的位置
    question = text[: positions[0]].strip()
    options = []
    for i, pos in enumerate(positions):
        stop = positions[i + 1] if i + 1 < 4 else len(text)
        options.append(text[pos + 3 : stop].strip())
    if not question or any(not o for o in options):
        return None
    return question, options


def parse_pdf(pdf_path: Path):
    category, prefix = detect_category(pdf_path)
    blocks = []  # [ans, num, [lines]]
    for line in read_lines(pdf_path):
        m = QUESTION_START.match(line)
        expected = blocks[-1][1] + 1 if blocks else None
        if m and (expected is None or int(m.group("num")) == expected):
            blocks.append([int(m.group("ans")), int(m.group("num")), [m.group("rest")]])
        elif blocks:
            blocks[-1][2].append(line)

    questions, problems = [], []
    for ans, num, lines in blocks:
        parsed = split_options(join_lines(lines))
        if not parsed:
            problems.append(f"{category} 第 {num} 題：找不到四個選項 -> {join_lines(lines)[:60]}")
            continue
        question, options = parsed
        questions.append({
            "id": f"{prefix}-{num:04d}",
            "num": num,
            "category": category,
            "question": question,
            "options": options,
            "answer": ans,
        })
    return questions, problems


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    pdfs = sorted(SOURCE_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"在 {SOURCE_DIR} 找不到 PDF")
        return 1

    all_questions, all_problems = [], []
    for pdf_path in pdfs:
        qs, problems = parse_pdf(pdf_path)
        last = qs[-1]["num"] if qs else 0
        print(f"{pdf_path.name}: 解析出 {len(qs)} 題（題號到 {last}）")
        all_questions += qs
        all_problems += problems

    for p in all_problems:
        print("  ⚠", p)

    payload = json.dumps(all_questions, ensure_ascii=False, indent=2)
    (ROOT / "questions.json").write_text(payload, encoding="utf-8")
    (ROOT / "questions.js").write_text(
        "// 由 parse_pdf.py 自動產生，請勿手動修改\nwindow.QUIZ_DATA = " + payload + ";\n",
        encoding="utf-8",
    )
    print(f"共 {len(all_questions)} 題，已輸出 questions.json 與 questions.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
