"""원본 PDF에서 문장(단어 좌표 포함)과 그림 영역을 추출합니다.

원본 PDF는 읽기만 하며 어떤 내용도 바꾸지 않습니다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import fitz  # PyMuPDF

from .models import ExtractedDocument, Figure, Rect, Sentence, Word

HEADER_FOOTER_RATIO = 0.07
TERMINALS = (".", "!", "?", "。", "！", "？", "…")
CLOSERS = ")]}\"'”’»」』"
ABBREVIATIONS = {
    "e.g.", "i.e.", "al.", "fig.", "figs.", "eq.", "eqs.", "ref.", "refs.", "sec.",
    "no.", "vs.", "cf.", "dr.", "mr.", "ms.", "prof.", "approx.", "resp.", "ch.",
    "vol.", "pp.", "p.", "st.", "jr.", "inc.", "ltd.", "co.", "u.s.", "tab.",
}
CAPTION_RE = re.compile(r"^(fig(ure)?s?\.?|table|tab\.|그림|표|도표|사진)\s*[0-9IVX]+", re.I)
REFERENCES_RE = re.compile(
    r"^([0-9IVX]+\.?\s*)?(references|bibliography|works cited|literature cited|참\s*고\s*문\s*헌)$",
    re.I,
)
APPENDIX_RE = re.compile(r"^([A-Z0-9]+\.?\s*)?(appendix|appendices|부\s*록)\b", re.I)


def _ends_sentence(word: str, next_word: str | None, sentence_len: int) -> bool:
    core = word.rstrip(CLOSERS)
    if not core.endswith(TERMINALS):
        return False
    if core.endswith("."):
        lower = core.lower()
        if lower in ABBREVIATIONS:
            return False
        if re.fullmatch(r"[A-Za-z]\.", core):  # 이니셜 (J. Smith)
            return False
        if sentence_len == 1 and re.fullmatch(r"[0-9]+(\.[0-9]+)*\.", core):  # 절 번호 (3.2.)
            return False
    if next_word and next_word[0].islower():
        return False
    return True


def _join(words: list[Word]) -> str:
    parts: list[str] = []
    for i, w in enumerate(words):
        if parts and i > 0:
            prev = words[i - 1]
            new_line = (prev.page, prev.block, prev.line) != (w.page, w.block, w.line)
            if new_line and parts[-1].endswith("-") and w.text[:1].islower():
                parts[-1] = parts[-1][:-1] + w.text
                continue
        parts.append(w.text)
    return " ".join(parts)


def _block_kind(text: str, rect: Rect, page_h: float, n_words: int) -> str:
    x0, y0, x1, y1 = rect
    if n_words <= 15 and (y1 <= page_h * HEADER_FOOTER_RATIO or y0 >= page_h * (1 - HEADER_FOOTER_RATIO)):
        return "margin"
    stripped = text.strip()
    if REFERENCES_RE.match(stripped):
        return "references"
    if n_words <= 8 and APPENDIX_RE.match(stripped):
        return "appendix"
    if CAPTION_RE.match(stripped):
        return "caption"
    return "body"


def _union(rects: list[Rect]) -> Rect:
    return (
        min(r[0] for r in rects), min(r[1] for r in rects),
        max(r[2] for r in rects), max(r[3] for r in rects),
    )


def _merge_rects(rects: list[Rect], gap: float = 6.0) -> list[Rect]:
    merged = [tuple(r) for r in rects]
    changed = True
    while changed:
        changed = False
        out: list[Rect] = []
        for r in merged:
            for i, o in enumerate(out):
                if r[0] <= o[2] + gap and o[0] <= r[2] + gap and r[1] <= o[3] + gap and o[1] <= r[3] + gap:
                    out[i] = _union([r, o])
                    changed = True
                    break
            else:
                out.append(r)
        merged = out
    return merged


def _figure_rects(page: fitz.Page) -> list[Rect]:
    pw, ph = page.rect.width, page.rect.height
    raw: list[Rect] = []
    for info in page.get_image_info():
        raw.append(tuple(info["bbox"]))
    try:
        raw.extend(tuple(r) for r in page.cluster_drawings())
    except Exception:  # 오래된 PyMuPDF 또는 손상된 도형
        pass

    clipped: list[Rect] = []
    for r in raw:
        x0, y0 = max(r[0], 0), max(r[1], 0)
        x1, y1 = min(r[2], pw), min(r[3], ph)
        if x1 > x0 and y1 > y0:
            clipped.append((x0, y0, x1, y1))

    result = []
    for r in _merge_rects(clipped):
        w, h = r[2] - r[0], r[3] - r[1]
        if w < pw * 0.15 or h < 40 or w * h < pw * ph * 0.02:
            continue  # 아이콘·구분선·로고 등
        if w * h > pw * ph * 0.9:
            continue  # 페이지 배경
        result.append(r)
    return result


def _attach_caption(fig: Rect, captions: list[tuple[Rect, str]]) -> str:
    best, best_gap = "", 90.0
    for rect, text in captions:
        overlap = min(fig[2], rect[2]) - max(fig[0], rect[0])
        if overlap < 0.3 * min(fig[2] - fig[0], rect[2] - rect[0]):
            continue
        gap = min(abs(rect[1] - fig[3]), abs(fig[1] - rect[3]))
        if gap < best_gap:
            best, best_gap = text, gap
    return best


@dataclass
class _BlockInfo:
    page: int
    rect: Rect
    height: float  # 평균 글자 높이 ≈ 글자 크기
    text: str


def _word_height(words: list[Word]) -> float:
    heights = sorted(w.rect[3] - w.rect[1] for w in words)
    return heights[len(heights) // 2]


def _continues(prev: _BlockInfo | None, cur: _BlockInfo) -> bool:
    """앞 블록에서 끝나지 않은 문장이 이 블록으로 이어지는지 (글자 크기·위치로 판단)."""
    if prev is None:
        return False
    if abs(cur.height - prev.height) > 0.18 * max(prev.height, cur.height):
        return False  # 제목→저자처럼 글자 크기가 다르면 다른 문장
    prev_w, cur_w = prev.rect[2] - prev.rect[0], cur.rect[2] - cur.rect[0]
    if prev_w < 0.6 * cur_w and len(prev.text) < 60:
        return False  # 짧고 마침표 없는 줄 = 소제목
    if cur.page == prev.page:
        gap = cur.rect[1] - prev.rect[3]
        overlap_x = min(prev.rect[2], cur.rect[2]) - max(prev.rect[0], cur.rect[0])
        if overlap_x > 0 and -2 <= gap <= 1.2 * prev.height:
            return True  # 같은 단의 다음 줄
        return cur.rect[0] >= prev.rect[2] - 5 and cur.rect[1] < prev.rect[1]  # 다음 단
    return cur.page == prev.page + 1  # 다음 쪽


OCR_MIN_CHARS = 20  # 이보다 글자가 적은 쪽은 스캔 쪽으로 보고 OCR 결과를 쓴다 (web/lib/ocr.ts 와 같은 기준)


def _page_words(page: fitz.Page, pno: int, ocr_pages: dict) -> list[tuple]:
    """쪽의 단어 목록 (x0, y0, x1, y1, 글자, 블록, 줄, 번호). 글자 층이 없는 스캔 쪽은 브라우저 OCR 결과를 쓴다."""
    words = page.get_text("words", sort=False)
    if sum(len(w[4]) for w in words) >= OCR_MIN_CHARS:
        return words
    ocr_words = (ocr_pages.get(str(pno)) or {}).get("words") or []
    if not ocr_words:
        return words
    return [
        (float(x0), float(y0), float(x1), float(y1), str(text), int(block), int(line), i)
        for i, (x0, y0, x1, y1, text, block, line) in enumerate(ocr_words)
        if str(text).strip()
    ]


def extract(pdf_bytes: bytes, ocr: dict | None = None) -> ExtractedDocument:
    """ocr: 브라우저에서 인식한 스캔 쪽 단어 {"pages": {"쪽번호": {"words": [[x0,y0,x1,y1,글자,블록,줄], ...]}}}"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    ocr_pages = (ocr or {}).get("pages") or {}
    result = ExtractedDocument(
        page_count=doc.page_count,
        page_sizes=[(p.rect.width, p.rect.height) for p in doc],
    )

    in_references = False
    current: list[Word] = []
    current_kind = "body"
    last_block: _BlockInfo | None = None

    def flush() -> None:
        nonlocal current
        if not current:
            return
        text = _join(current)
        skip = (
            current_kind in ("margin", "references", "appendix")
            or in_references
            or len(current) < 3
            or not re.search(r"[A-Za-z가-힣]", text)
        )
        result.sentences.append(Sentence(
            id=f"s{len(result.sentences)}",
            text=text,
            words=current,
            skip=skip,
            is_caption=current_kind == "caption",
        ))
        current = []

    for pno, page in enumerate(doc):
        page_h = page.rect.height
        blocks: dict[int, list[Word]] = {}
        for x0, y0, x1, y1, text, bno, lno, _wno in _page_words(page, pno, ocr_pages):
            blocks.setdefault(bno, []).append(Word(pno, (x0, y0, x1, y1), bno, lno, text))

        captions: list[tuple[Rect, str]] = []
        for bno in sorted(blocks):
            words = blocks[bno]
            block_text = _join(words)
            info = _BlockInfo(pno, _union([w.rect for w in words]), _word_height(words), block_text)
            kind = _block_kind(block_text, info.rect, page_h, len(words))
            if kind == "margin":
                # 머리글·바닥글은 진행 중인 문장을 끊지 않고 따로 기록만 한다.
                result.sentences.append(Sentence(f"s{len(result.sentences)}", block_text, words, skip=True))
                continue
            if kind == "references":
                flush()
                in_references = True
            elif kind == "appendix":
                in_references = False
            if kind == "caption":
                captions.append((info.rect, block_text[:300]))

            # 끝나지 않은 본문 문장은 이어지는 줄·다음 단·다음 쪽의 본문 블록으로 이어 붙인다.
            if current and (kind != "body" or current_kind != "body" or not _continues(last_block, info)):
                flush()
            current_kind = kind
            last_block = info

            for i, w in enumerate(words):
                current.append(w)
                nxt = words[i + 1].text if i + 1 < len(words) else None
                if _ends_sentence(w.text, nxt, len(current)):
                    flush()
            if kind != "body":
                flush()  # 제목·캡션은 블록 끝에서 문장을 닫는다

        for rect in _figure_rects(page):
            result.figures.append(Figure(
                id=f"f{len(result.figures)}",
                page=pno,
                rect=rect,
                caption=_attach_caption(rect, captions),
            ))
    flush()
    doc.close()
    return result


def sentence_rects(sentence: Sentence) -> dict[int, list[Rect]]:
    """문장의 단어 좌표를 줄 단위 사각형으로 합쳐 쪽별로 반환합니다."""
    lines: dict[tuple[int, int, int], list[Rect]] = {}
    for w in sentence.words:
        lines.setdefault((w.page, w.block, w.line), []).append(w.rect)
    pages: dict[int, list[Rect]] = {}
    for (page, _b, _l), rects in lines.items():
        pages.setdefault(page, []).append(_union(rects))
    return pages
