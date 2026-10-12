"""테스트용 PDF를 코드로 생성합니다 (2단 영문 논문, 한국어 문서)."""
from __future__ import annotations

import fitz

EN_PARAGRAPHS = [
    "Reading long documents is slow. Many readers skim papers to find the main idea. "
    "In this paper, we propose a method that highlights only the key sentences of a document. "
    "The method keeps the original layout untouched.",
    "Prior work summarizes documents by rewriting them, e.g. with abstractive models. "
    "However, rewriting can change the meaning of the source. Readers also lose the context of the original page.",
    "Our results show that readers found the main claims 42% faster with highlights. "
    "The improvement was significant across all twelve participants. "
    "Accuracy on comprehension questions did not decrease.",
    "In conclusion, highlighting key sentences is a simple and faithful way to speed up reading. "
    "Future work will study books and scanned documents.",
]

KO_PARAGRAPHS = [
    "정보가 너무 많아 핵심을 파악하기 어렵다. 독자는 긴 글에서 중요한 문장을 찾느라 시간을 쓴다.",
    "본 연구는 원문을 바꾸지 않고 핵심 문장에만 형광펜을 칠하는 방법을 제안한다. "
    "실험 결과 독자가 핵심 내용을 찾는 시간이 30% 줄어든 것으로 나타났다.",
    "결론적으로 하이라이트는 원문의 맥락을 지키면서 읽기 속도를 높인다.",
]


def make_english_paper() -> bytes:
    doc = fitz.open()
    for pno in range(2):
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 30), "Journal of Fast Reading, Vol. 3", fontsize=8)  # 머리글
        page.insert_text((290, 820), str(pno + 1), fontsize=8)  # 쪽 번호
        if pno == 0:
            page.insert_textbox(fitz.Rect(50, 50, 545, 90), "Highlighting Key Sentences", fontsize=18)
            cols = [fitz.Rect(50, 100, 290, 500), fitz.Rect(305, 100, 545, 500)]
            for i, rect in enumerate(cols):
                text = "\n\n".join(EN_PARAGRAPHS[i * 2:(i + 1) * 2])
                page.insert_textbox(rect, text, fontsize=10)
            # 그림(벡터 도형)과 캡션
            page.draw_rect(fitz.Rect(100, 520, 495, 720), color=(0, 0, 0), fill=(0.8, 0.9, 1.0))
            page.draw_line((120, 700), (470, 540), color=(1, 0, 0), width=2)
            page.insert_textbox(
                fitz.Rect(100, 728, 495, 760),
                "Figure 1. Reading time with and without highlights.",
                fontsize=9,
            )
        else:
            page.insert_textbox(fitz.Rect(50, 60, 545, 400), "\n\n".join(EN_PARAGRAPHS), fontsize=10)
            page.insert_textbox(fitz.Rect(50, 420, 545, 445), "References", fontsize=12)
            page.insert_textbox(
                fitz.Rect(50, 450, 545, 520),
                "[1] A. Author. A study of skimming. Proc. of Reading, 2020.\n"
                "[2] B. Author. Summaries change meaning. Journal of Text, 2021.",
                fontsize=9,
            )
    return doc.tobytes()


def make_korean_doc() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_textbox(fitz.Rect(50, 60, 545, 400), "\n\n".join(KO_PARAGRAPHS), fontsize=11, fontname="korea")
    return doc.tobytes()


def make_korean_two_column_lines() -> bytes:
    """한 줄마다 별도 블록인 한국어 2단 논문 (실제 학술지 PDF에서 흔한 구조)."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((60, 80), "월경주기에 따른 성호르몬 변화가 여성의 균형에 미치는 영향", fontsize=16, fontname="korea")
    page.insert_text((60, 110), "김지현, 신원섭", fontsize=11, fontname="korea")
    left = [
        "대부분의 선행 연구들은 운동선수를 대상으로",
        "하였으며, 성호르몬이 비운동선수 여성에게 정적 균형",
        "에 미치는 영향을 연구한 논문은 부족한 실정이다.",
        "따라서 본 연구는 월경주기에 따른 변화를 규명하",
    ]
    right = ["는 데 목적이 있다.", "실험 결과 배란기에 균형 능력이 향상되었다."]
    for x, lines in ((60, left), (320, right)):
        for i, line in enumerate(lines):
            page.insert_text((x, 160 + i * 15.6), line, fontsize=9, fontname="korea")
    return doc.tobytes()
