"""PDF 한 개를 하이라이트 처리하는 명령줄 도구.

예) python -m api.cli paper.pdf -o paper_highlighted.pdf
    python -m api.cli paper.pdf --offline   # API 키 없이 규칙 기반으로 시험
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .config import load_dotenv
from .export import export_pdf
from .extract import extract
from .selector import DEFAULT_RATIO, select_highlights


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="PDF 핵심 문장 하이라이트")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--ratio", type=float, default=DEFAULT_RATIO, help="하이라이트할 문장 비율 (기본 0.12)")
    parser.add_argument("--offline", action="store_true", help="OpenAI 없이 규칙 기반으로 선별")
    parser.add_argument("--json", type=Path, help="하이라이트 데이터를 JSON으로 저장")
    args = parser.parse_args()

    original = args.pdf.read_bytes()
    started = time.time()
    doc = extract(original)
    print(f"[추출] {doc.page_count}쪽, 문장 {len(doc.sentences)}개(후보 {len(doc.candidates)}개), 그림 {len(doc.figures)}개")

    highlights = select_highlights(
        doc,
        ratio=args.ratio,
        offline=args.offline,
        on_progress=lambda done, total: print(f"[선별] {done}/{total}"),
    )
    n_text = len({h.ref for h in highlights if h.kind == "text"})
    n_fig = sum(1 for h in highlights if h.kind == "figure")
    print(f"[선별] 문장 {n_text}개, 그림 {n_fig}개")

    output = args.output or args.pdf.with_name(f"{args.pdf.stem}_highlighted.pdf")
    output.write_bytes(export_pdf(original, highlights))
    if args.json:
        args.json.write_text(
            json.dumps([h.to_dict() for h in highlights], ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(f"[완료] {output} ({time.time() - started:.1f}초)")


if __name__ == "__main__":
    main()
