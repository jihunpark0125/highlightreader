"""추출한 문장·그림 중 핵심만 고릅니다.

AI에는 문장 ID와 원문만 보내고, 응답으로는 ID만 받습니다.
AI가 문장을 다시 쓰지 않으므로 원문 내용은 바뀌지 않습니다.
"""
from __future__ import annotations

import json
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

import requests

from .extract import sentence_rects
from .models import ExtractedDocument, Figure, Highlight, Sentence

OPENAI_API_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = "gpt-5.4-mini"
OPENAI_MAX_ATTEMPTS = int((os.environ.get("OPENAI_MAX_ATTEMPTS") or "3").strip() or "3")
CHUNK_MAX_PAGES = 12
CHUNK_MAX_CHARS = 30000
MAX_SENTENCE_CHARS = 600
DEFAULT_RATIO = 0.12

SYSTEM_PROMPT = """당신은 책과 논문을 빠르게 훑어보는 독자를 돕는 전문 편집자입니다.
주어진 문장 목록에서 독자가 하이라이트만 읽어도 글의 핵심을 파악할 수 있는 문장을 고르세요.

우선 고를 문장:
- 글의 핵심 주장, 연구 질문, 목적
- 새로 제안하는 방법·개념의 정의
- 핵심 결과, 수치, 발견
- 결론, 시사점, 한계

피할 문장:
- 논문·책 제목, 저자 이름, 소속, 학술지·출판 정보, 인용 표기, 저작권 안내
- 배경 설명의 반복, 일반론, 인사말, 목차
- 같은 내용을 반복하는 문장 (가장 명확한 하나만 고르기)

그림·표는 본문 이해에 꼭 필요한 핵심 결과나 구조를 보여주는 것만 고르세요.
각 문장에는 유형(category)과 관련도(relevance, 0~100: 글의 핵심을 이해하는 데 얼마나 필요한지)를 매기세요.
확신이 없거나 맥락에 따라 덜 중요할 수 있는 문장은 관련도를 70 미만으로 주세요.
반드시 목록에 있는 ID만 그대로 반환하고, 문장을 새로 쓰거나 고치지 마세요."""

CATEGORIES = ["핵심 주장", "연구 목적", "정의", "방법", "주요 결과", "인사이트", "한계", "결론"]

OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sentences", "figures"],
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "category", "relevance"],
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "relevance": {"type": "integer"},
                },
            },
        },
        "figures": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "relevance"],
                "properties": {"id": {"type": "string"}, "relevance": {"type": "integer"}},
            },
        },
    },
}

ProgressFn = Callable[[int, int], None]


def _chunks(doc: ExtractedDocument) -> list[tuple[list[Sentence], list[Figure]]]:
    chunks: list[tuple[list[Sentence], list[Figure]]] = []
    sentences: list[Sentence] = []
    start_page, chars = 0, 0
    for s in doc.candidates:
        if sentences and (s.page - start_page >= CHUNK_MAX_PAGES or chars + len(s.text) > CHUNK_MAX_CHARS):
            chunks.append((sentences, []))
            sentences, chars = [], 0
        if not sentences:
            start_page = s.page
        sentences.append(s)
        chars += min(len(s.text), MAX_SENTENCE_CHARS)
    if sentences:
        chunks.append((sentences, []))
    if not chunks:
        chunks.append(([], []))

    for fig in doc.figures:
        if not fig.caption:
            continue  # 캡션 없는 이미지(표지·로고·배너)는 후보에서 제외
        target = chunks[0]
        for chunk in chunks:
            if chunk[0] and chunk[0][0].page <= fig.page:
                target = chunk
        target[1].append(fig)
    return chunks


def _output_text(data: dict) -> str:
    for item in data.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return content.get("text", "")
    raise RuntimeError("OpenAI 응답에 텍스트가 없습니다.")


def _request_openai(user_prompt: str) -> dict:
    api_key = os.environ["OPENAI_API_KEY"]
    payload = {
        "model": (os.environ.get("OPENAI_MODEL") or "").strip() or DEFAULT_MODEL,
        "max_output_tokens": 4000,
        "input": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "key_highlights",
                "strict": True,
                "schema": OUTPUT_SCHEMA,
            }
        },
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    for attempt in range(1, OPENAI_MAX_ATTEMPTS + 1):
        try:
            response = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=180)
            if response.status_code >= 400:
                print(f"[OpenAI API 오류] status={response.status_code} body={response.text[:1000]}")
            if response.status_code == 429 and any(
                token in response.text.lower() for token in ("insufficient_quota", "billing", "quota")
            ):
                response.raise_for_status()  # 잔액 문제는 재시도해도 해결되지 않음
            response.raise_for_status()
            return json.loads(_output_text(response.json()))
        except requests.RequestException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            body = (getattr(getattr(exc, "response", None), "text", "") or "").lower()
            if status == 429 and "quota" in body:
                raise
            retryable = status in {408, 409, 429, 500, 502, 503, 504} or status is None
            if not retryable or attempt >= OPENAI_MAX_ATTEMPTS:
                raise
            delay = min(30.0, (2 ** (attempt - 1)) * 3.0 + random.uniform(0.0, 1.5))
            print(f"[OpenAI 재시도] {attempt}/{OPENAI_MAX_ATTEMPTS} ({status or 'network'}) → {delay:.1f}초 후")
            time.sleep(delay)
    raise RuntimeError("OpenAI 요청에 실패했습니다.")


Pick = dict[str, dict]  # ID → {"category": ..., "relevance": ...}


def _clamp(value: object) -> int:
    try:
        return max(0, min(100, int(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 50


def _select_chunk_ai(sentences: list[Sentence], figures: list[Figure], ratio: float) -> tuple[Pick, Pick]:
    if not sentences and not figures:
        return {}, {}
    target = max(1, round(len(sentences) * ratio))
    lines = [f"[{s.id}] {s.text[:MAX_SENTENCE_CHARS]}" for s in sentences]
    fig_lines = [f"[{f.id}] (p.{f.page + 1}) {f.caption}" for f in figures]
    prompt = (
        f"문장 {len(sentences)}개 중 약 {target}개(최소 {max(1, round(target * 0.7))}개, "
        f"최대 {max(1, round(target * 1.3))}개)를 고르세요.\n"
        f"그림·표는 {len(figures)}개이며 핵심인 것만 고르세요(없으면 빈 배열).\n\n"
        "## 문장\n" + "\n".join(lines) + "\n\n## 그림·표\n" + ("\n".join(fig_lines) or "(없음)")
    )
    data = _request_openai(prompt)
    valid_s = {s.id for s in sentences}
    valid_f = {f.id for f in figures}
    picked_s = {
        item["id"]: {"category": item.get("category", ""), "relevance": _clamp(item.get("relevance"))}
        for item in data.get("sentences", []) if item.get("id") in valid_s
    }
    picked_f = {
        item["id"]: {"category": "주요 그림", "relevance": _clamp(item.get("relevance"))}
        for item in data.get("figures", []) if item.get("id") in valid_f
    }
    return picked_s, picked_f


CUE_RE = re.compile(
    r"\b(we (propose|present|show|find|found|introduce|demonstrate)|our (results|findings|method)|"
    r"in (conclusion|summary)|results (show|indicate|suggest)|this (paper|study|work)|significant(ly)?|"
    r"key|main|important)\b|결론|결과|제안|핵심|중요|요약|보여준다|밝혔다|확인했다|나타났다",
    re.I,
)


def _select_chunk_heuristic(sentences: list[Sentence], figures: list[Figure], ratio: float) -> tuple[Pick, Pick]:
    """API 키 없이 파이프라인을 시험할 때 쓰는 단순 규칙 기반 선별."""
    target = max(1, round(len(sentences) * ratio)) if sentences else 0
    scored = []
    for idx, s in enumerate(sentences):
        score = len(CUE_RE.findall(s.text)) * 2 + (1 if re.search(r"\d", s.text) else 0)
        scored.append((score, -idx, s.id))
    scored.sort(reverse=True)
    picked = {sid: {"category": "핵심 주장", "relevance": min(100, 60 + score * 5)} for score, _i, sid in scored[:target]}
    figs = {f.id: {"category": "주요 그림", "relevance": 70} for f in figures}
    return picked, figs


def select_highlights(
    doc: ExtractedDocument,
    ratio: float = DEFAULT_RATIO,
    offline: bool = False,
    on_progress: ProgressFn | None = None,
    max_workers: int = 4,
) -> list[Highlight]:
    chunks = _chunks(doc)
    picker = _select_chunk_heuristic if offline else _select_chunk_ai
    picked_s: Pick = {}
    picked_f: Pick = {}
    done = 0

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(picker, s, f, ratio) for s, f in chunks]
        for future in futures:
            s_ids, f_ids = future.result()
            picked_s.update(s_ids)
            picked_f.update(f_ids)
            done += 1
            if on_progress:
                on_progress(done, len(chunks))

    highlights: list[Highlight] = []
    for s in doc.sentences:
        if s.id not in picked_s:
            continue
        meta = picked_s[s.id]
        for page, rects in sentence_rects(s).items():
            highlights.append(Highlight(page=page, kind="text", rects=rects, text=s.text, ref=s.id, **meta))
    for f in doc.figures:
        if f.id in picked_f:
            highlights.append(Highlight(
                page=f.page, kind="figure", rects=[f.rect], text=f.caption, ref=f.id, **picked_f[f.id],
            ))
    return highlights
