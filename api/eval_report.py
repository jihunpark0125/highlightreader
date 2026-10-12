"""AI 하이라이트가 얼마나 정확했는지, 사용자의 수정 기록으로 측정합니다.

사용자가 본문에서 한 수정이 곧 정답 데이터입니다.
- AI가 칠했고 사용자가 남긴 것   = 맞춤 (kept)
- AI가 칠했는데 사용자가 해제한 것 = 잘못 고름 (removed)
- 사용자가 직접 칠한 것           = AI가 놓침 (missed)

정밀도 = kept / (kept + removed)   — AI가 칠한 것 중 맞은 비율
재현율 = kept / (kept + missed)    — 사용자가 원한 것 중 AI가 찾은 비율 (근사)

입력은 highlights 행 JSON 배열입니다. 관리자 키를 프로젝트에 두지 않도록 Supabase SQL 결과를 파일로 넘깁니다.
예) select h.*, d.title, d.finalized_at from highlights h join documents d on d.id = h.document_id;

실행: python -m api.eval_report rows.json [--finalized-only]
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

RELEVANCE_BUCKETS = [(90, 101, "90~100"), (80, 90, "80~89"), (70, 80, "70~79"), (0, 70, "70 미만")]


@dataclass
class Counts:
    kept: int = 0
    removed: int = 0
    missed: int = 0

    @property
    def ai_total(self) -> int:
        return self.kept + self.removed

    @property
    def precision(self) -> float | None:
        return self.kept / self.ai_total if self.ai_total else None

    @property
    def recall(self) -> float | None:
        total = self.kept + self.missed
        return self.kept / total if total else None

    @property
    def removal_rate(self) -> float | None:
        return self.removed / self.ai_total if self.ai_total else None


@dataclass
class Report:
    overall: Counts = field(default_factory=Counts)
    by_document: dict[str, Counts] = field(default_factory=lambda: defaultdict(Counts))
    by_category: dict[str, Counts] = field(default_factory=lambda: defaultdict(Counts))
    by_relevance: dict[str, Counts] = field(default_factory=lambda: defaultdict(Counts))
    titles: dict[str, str] = field(default_factory=dict)


def _bucket(relevance: int | None) -> str:
    if relevance is None:
        return "없음"
    for low, high, label in RELEVANCE_BUCKETS:
        if low <= relevance < high:
            return label
    return "없음"


def build_report(rows: list[dict], finalized_only: bool = False) -> Report:
    """여러 쪽에 걸친 하이라이트(같은 ref)는 하나로 셉니다."""
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    report = Report()
    for row in rows:
        if finalized_only and not row.get("finalized_at"):
            continue
        doc_id = row["document_id"]
        report.titles.setdefault(doc_id, row.get("title") or doc_id[:8])
        groups[(doc_id, row.get("ref") or row["id"])].append(row)

    for (doc_id, _ref), group in groups.items():
        first = group[0]
        active = any(not r.get("deleted") for r in group)
        if first.get("source") == "ai":
            outcome = "kept" if active else "removed"
            buckets = [report.overall, report.by_document[doc_id],
                       report.by_category[first.get("category") or "(유형 없음)"],
                       report.by_relevance[_bucket(first.get("relevance"))]]
        else:
            if not active:
                continue  # 사용자가 칠했다가 지운 것은 판단 근거가 아님
            outcome = "missed"
            buckets = [report.overall, report.by_document[doc_id]]
        for counts in buckets:
            setattr(counts, outcome, getattr(counts, outcome) + 1)
    return report


def _pct(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:.0f}%"


def format_report(report: Report) -> str:
    lines = []
    o = report.overall
    lines.append("== 전체 ==")
    lines.append(f"AI 하이라이트 {o.ai_total}개 · 남김 {o.kept} · 해제 {o.removed} · 사용자 추가 {o.missed}")
    lines.append(f"정밀도 {_pct(o.precision)} · 재현율 {_pct(o.recall)}")

    lines.append("\n== 문서별 ==")
    lines.append(f"{'정밀도':>6} {'재현율':>6} {'AI':>4} {'해제':>4} {'추가':>4}  문서")
    for doc_id, c in report.by_document.items():
        lines.append(f"{_pct(c.precision):>6} {_pct(c.recall):>6} {c.ai_total:>4} {c.removed:>4} {c.missed:>4}  {report.titles[doc_id]}")

    lines.append("\n== 유형별 해제율 (높을수록 AI가 과하게 고르는 유형) ==")
    for name, c in sorted(report.by_category.items(), key=lambda kv: -(kv[1].removal_rate or 0)):
        lines.append(f"{_pct(c.removal_rate):>6}  {name} ({c.removed}/{c.ai_total})")

    lines.append("\n== 관련도 구간별 해제율 (관련도가 믿을 만하면 낮은 구간일수록 해제율이 높아야 함) ==")
    order = [label for _l, _h, label in RELEVANCE_BUCKETS] + ["없음"]
    for label in order:
        if label in report.by_relevance:
            c = report.by_relevance[label]
            lines.append(f"{_pct(c.removal_rate):>6}  관련도 {label} ({c.removed}/{c.ai_total})")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="AI 하이라이트 정확도 측정")
    parser.add_argument("rows", type=Path, help="highlights 행 JSON 배열 (title, finalized_at 포함 권장)")
    parser.add_argument("--finalized-only", action="store_true", help="사용자가 최종 확정한 문서만 집계")
    args = parser.parse_args()
    rows = json.loads(args.rows.read_text(encoding="utf-8"))
    print(format_report(build_report(rows, finalized_only=args.finalized_only)))


if __name__ == "__main__":
    main()
