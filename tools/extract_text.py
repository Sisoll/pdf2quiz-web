"""用 pdfplumber 從 PDF 取出文字行，給題庫管理頁的「匯入 Python 取出的文字」使用（選用）。

只在 pdf.js 取出的文字有問題（例如中文斷行或順序亂掉），而且電腦上已經有 Python 時使用。
拆題、檢查都在網頁裡做，這裡只負責取出文字：一行一筆，頁碼與空行由網頁過濾。

執行：
  uv run --with pdfplumber python tools/extract_text.py 檔名.pdf > 檔名.txt
  或先安裝 pdfplumber：python -m pip install pdfplumber
"""
import sys

import pdfplumber


def main():
    if len(sys.argv) != 2:
        print("用法：python tools/extract_text.py 檔名.pdf > 檔名.txt", file=sys.stderr)
        return 1
    sys.stdout.reconfigure(encoding="utf-8")
    with pdfplumber.open(sys.argv[1]) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").split("\n"):
                if line.strip():
                    print(line.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
