from api.eval_report import build_report, format_report


def row(id, source="ai", deleted=False, ref="", category="주요 결과", relevance=90, doc="d1", finalized=True):
    return {
        "id": id, "document_id": doc, "source": source, "deleted": deleted, "ref": ref,
        "category": category, "relevance": relevance, "title": "논문", "finalized_at": "2026-10-12" if finalized else None,
    }


def test_precision_and_recall_from_user_edits():
    rows = [
        row("a1"), row("a2"), row("a3", deleted=True, category="방법", relevance=65),
        # 두 쪽에 걸친 AI 하이라이트 하나 (ref 공유) — 한 개로 센다
        row("a4p1", ref="s9"), row("a4p2", ref="s9"),
        row("u1", source="user", category="", relevance=None),
        row("u2", source="user", deleted=True, category="", relevance=None),  # 칠했다 지운 것은 무시
    ]
    report = build_report(rows)
    o = report.overall
    assert (o.kept, o.removed, o.missed) == (3, 1, 1)
    assert o.precision == 3 / 4
    assert o.recall == 3 / 4
    assert report.by_category["방법"].removal_rate == 1.0
    assert report.by_relevance["70 미만"].removed == 1
    assert "정밀도 75%" in format_report(report)


def test_finalized_only_filter():
    rows = [row("a1"), row("b1", doc="d2", deleted=True, finalized=False)]
    assert build_report(rows, finalized_only=True).overall.ai_total == 1
    assert build_report(rows).overall.ai_total == 2
