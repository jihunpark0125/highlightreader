"""원본 PDF 뒤에 하이라이트 주석만 덧붙여 내보냅니다.

증분 저장(incremental save)을 사용하므로 결과 파일의 앞부분은 원본 바이트와 완전히 같고,
하이라이트는 표준 PDF 주석으로만 추가됩니다. 본문·이미지·레이아웃은 건드리지 않습니다.
"""
from __future__ import annotations

import os
import tempfile

import fitz  # PyMuPDF

from .models import Highlight

AMBER = (0.949, 0.847, 0.475)  # #f2d879 — 화면 하이라이트와 같은 색
ANNOT_TITLE = "HighlightReader"


def _add_annotations(doc: fitz.Document, highlights: list[Highlight]) -> None:
    for h in highlights:
        if not 0 <= h.page < doc.page_count or not h.rects:
            continue
        page = doc[h.page]
        if h.kind == "figure":
            for r in h.rects:
                annot = page.add_rect_annot(fitz.Rect(r))
                annot.set_colors(stroke=AMBER, fill=AMBER)
                annot.set_border(width=1.5)
                annot.set_opacity(0.35)
                annot.set_info(title=ANNOT_TITLE, content=h.text[:300])
                annot.update()
        else:
            annot = page.add_highlight_annot(quads=[fitz.Rect(r).quad for r in h.rects])
            annot.set_colors(stroke=AMBER)
            annot.set_info(title=ANNOT_TITLE)
            annot.update()


def export_pdf(original: bytes, highlights: list[Highlight]) -> bytes:
    fd, path = tempfile.mkstemp(suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(original)
        doc = fitz.open(path)
        try:
            _add_annotations(doc, highlights)
            if not doc.can_save_incrementally():
                # 손상되었거나 암호화된 PDF는 증분 저장이 불가능해 전체를 다시 쓴다(내용은 동일).
                return doc.tobytes(garbage=0, deflate=False)
            doc.saveIncr()
        finally:
            doc.close()
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.remove(path)
