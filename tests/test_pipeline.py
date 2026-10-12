import fitz

from api.export import export_pdf
from api.extract import extract
from api.models import Comment, Highlight
from api.selector import select_highlights
from tests.samples import make_english_paper, make_korean_doc, make_korean_two_column_lines


def _texts(doc):
    return [s.text for s in doc.sentences]


def test_sentences_are_split_without_breaking_abbreviations():
    doc = extract(make_english_paper())
    texts = _texts(doc)
    assert any(t.startswith("In this paper, we propose a method") for t in texts)
    assert any("e.g. with abstractive models." in t for t in texts)


def test_margins_and_references_are_not_candidates():
    doc = extract(make_english_paper())
    candidates = [s.text for s in doc.candidates]
    assert not any("Journal of Fast Reading" in t for t in candidates)
    assert not any("A study of skimming" in t for t in candidates)
    assert not any(t.strip() == "References" for t in candidates)


def test_figure_detected_with_caption():
    doc = extract(make_english_paper())
    assert len(doc.figures) == 1
    assert doc.figures[0].caption.startswith("Figure 1.")


def test_korean_sentences():
    doc = extract(make_korean_doc())
    texts = _texts(doc)
    assert "본 연구는 원문을 바꾸지 않고 핵심 문장에만 형광펜을 칠하는 방법을 제안한다." in texts
    assert len(doc.candidates) == 5


def test_export_keeps_original_bytes_and_only_adds_annotations():
    original = make_english_paper()
    doc = extract(original)
    highlights = select_highlights(doc, offline=True)
    assert any(h.kind == "text" for h in highlights)
    assert any(h.kind == "figure" for h in highlights)

    exported = export_pdf(original, highlights)
    assert exported.startswith(original)  # 증분 저장: 원본 바이트 그대로 + 주석만 뒤에 추가

    before, after = fitz.open(stream=original), fitz.open(stream=exported)
    assert before.page_count == after.page_count
    for p_before, p_after in zip(before, after):
        assert p_before.get_text() == p_after.get_text()
        assert p_before.read_contents() == p_after.read_contents()
    n_annots = sum(len(list(p.annots())) for p in after)
    assert n_annots == len(highlights)


def test_highlight_rects_cover_the_selected_sentence():
    original = make_english_paper()
    doc = extract(original)
    target = next(s for s in doc.sentences if s.text.startswith("Our results show"))
    from api.extract import sentence_rects

    pdf = fitz.open(stream=original)
    for page, rects in sentence_rects(target).items():
        covered = " ".join(
            pdf[page].get_textbox(fitz.Rect(r)).replace("\n", " ") for r in rects
        )
        assert "42% faster" in covered


def test_user_highlight_roundtrip():
    h = Highlight(page=0, kind="text", rects=[(1, 2, 3, 4)], text="x", source="user")
    assert Highlight.from_dict(h.to_dict()) == h


def test_korean_lines_join_across_lines_and_columns():
    doc = extract(make_korean_two_column_lines())
    texts = [s.text for s in doc.candidates]
    assert texts[0] == "월경주기에 따른 성호르몬 변화가 여성의 균형에 미치는 영향"  # 제목은 저자와 섞이지 않음
    assert any(t.startswith("대부분의 선행 연구들은") and t.endswith("부족한 실정이다.") for t in texts)
    assert any(t.startswith("따라서 본 연구는") and t.endswith("목적이 있다.") for t in texts)  # 다음 단으로 이어짐
    assert not any("김지현" in t for t in texts)


def test_export_with_comments_keeps_original_and_adds_notes():
    original = make_english_paper()
    highlights = select_highlights(extract(original), offline=True)
    comments = [Comment(page=0, x=520, y=120, body="이 문장 다시 읽기"), Comment(page=1, x=5000, y=-3, body="범위 밖 좌표")]
    exported = export_pdf(original, highlights, comments)
    assert exported.startswith(original)
    pdf = fitz.open(stream=exported)
    notes = []
    for page in pdf:
        for a in page.annots():
            if a.type[1] == "Text":
                notes.append((a.info["content"], page.rect.contains(a.rect.tl)))
    assert [n[0] for n in notes] == ["이 문장 다시 읽기", "범위 밖 좌표"]
    assert all(inside for _text, inside in notes)  # 범위 밖 좌표는 쪽 안으로 옮겨짐
