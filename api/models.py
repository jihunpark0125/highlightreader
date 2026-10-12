"""PDF에서 추출한 문장·그림과 하이라이트를 표현하는 데이터 구조."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

Rect = tuple[float, float, float, float]  # x0, y0, x1, y1 (PDF 포인트, 좌상단 원점)


@dataclass
class Word:
    page: int
    rect: Rect
    block: int
    line: int
    text: str


@dataclass
class Sentence:
    id: str
    text: str
    words: list[Word]
    skip: bool = False  # 머리글·바닥글·참고문헌·제목 등 하이라이트 후보에서 제외
    is_caption: bool = False

    @property
    def page(self) -> int:
        return self.words[0].page


@dataclass
class Figure:
    id: str
    page: int
    rect: Rect
    caption: str = ""


@dataclass
class ExtractedDocument:
    page_count: int
    page_sizes: list[tuple[float, float]]
    sentences: list[Sentence] = field(default_factory=list)
    figures: list[Figure] = field(default_factory=list)

    @property
    def candidates(self) -> list[Sentence]:
        return [s for s in self.sentences if not s.skip]


@dataclass
class Highlight:
    page: int
    kind: str  # "text" | "figure"
    rects: list[Rect]
    text: str = ""
    source: str = "ai"  # "ai" | "user"
    ref: str = ""  # 원본 문장/그림 ID (여러 쪽에 걸친 하이라이트를 묶는 키)
    category: str = ""  # 핵심 주장·주요 결과 등
    relevance: int | None = None  # AI가 매긴 관련도 0~100

    def to_dict(self) -> dict:
        data = asdict(self)
        data["rects"] = [list(r) for r in self.rects]
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Highlight":
        return cls(
            page=int(data["page"]),
            kind=data.get("kind", "text"),
            rects=[tuple(float(v) for v in r) for r in data["rects"]],
            text=data.get("text", ""),
            source=data.get("source", "ai"),
            ref=data.get("ref") or "",
            category=data.get("category") or "",
            relevance=data.get("relevance"),
        )
