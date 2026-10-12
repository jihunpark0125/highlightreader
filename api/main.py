"""easy_read API 서버.

업로드·하이라이트 편집·진행률 조회는 프론트가 Supabase에 직접 하고,
이 서버는 무거운 작업 두 가지만 맡습니다.
- POST /documents/{id}/process : PDF 분석 → AI 핵심 선별 → 하이라이트 저장
- GET  /documents/{id}/export  : 원본 PDF + 하이라이트 주석을 내려받기

실행: uvicorn api.main:app --reload --port 8000
"""
from __future__ import annotations

import os
import traceback
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .config import load_dotenv
from .export import export_pdf
from .extract import extract
from .models import Highlight
from .selector import DEFAULT_RATIO, select_highlights
from .supabase_client import SupabaseError, UserSupabase

load_dotenv()

BUCKET = "originals"
MAX_PAGES = int(os.environ.get("MAX_PAGES") or "300")
STALE_AFTER = timedelta(minutes=5)

app = FastAPI(title="easy_read API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in (os.environ.get("WEB_ORIGINS") or "http://localhost:3000").split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)


def user_client(authorization: str = Header(default="")) -> UserSupabase:
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "로그인이 필요합니다.")
    client = UserSupabase(token)
    try:
        client.get_user()
    except SupabaseError:
        raise HTTPException(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.")
    return client


def _owned_document(client: UserSupabase, doc_id: str) -> dict:
    doc = client.get_document(doc_id)  # RLS: 본인 문서만 조회됨
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다.")
    return doc


def _process(client: UserSupabase, doc: dict, ratio: float) -> None:
    doc_id = doc["id"]
    try:
        original = client.download(BUCKET, doc["storage_path"])
        extracted = extract(original)
        if extracted.page_count > MAX_PAGES:
            raise ValueError(f"{MAX_PAGES}쪽을 넘는 문서는 아직 지원하지 않습니다.")
        if not extracted.candidates:
            raise ValueError("텍스트를 찾지 못했습니다. 스캔본(이미지) PDF는 아직 지원하지 않습니다.")
        client.update_document(doc_id, {
            "page_count": extracted.page_count,
            "page_sizes": [list(s) for s in extracted.page_sizes],
            "progress": 0.05,
        })

        def on_progress(done: int, total: int) -> None:
            client.update_document(doc_id, {"progress": round(0.05 + 0.9 * done / total, 3)})

        highlights = select_highlights(extracted, ratio=ratio, on_progress=on_progress)
        client.replace_ai_highlights(doc_id, [
            {**h.to_dict(), "document_id": doc_id, "source": "ai"} for h in highlights
        ])
        client.update_document(doc_id, {"status": "ready", "progress": 1, "error": None})
    except Exception as exc:  # 실패 원인을 화면에 보여주기 위해 저장
        traceback.print_exc()
        message = str(exc) if isinstance(exc, ValueError) else "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
        try:
            client.update_document(doc_id, {"status": "failed", "error": message})
        except Exception:
            traceback.print_exc()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/documents/{doc_id}/process", status_code=202)
def process_document(
    doc_id: str,
    background: BackgroundTasks,
    ratio: float = DEFAULT_RATIO,
    client: UserSupabase = Depends(user_client),
) -> dict:
    doc = _owned_document(client, doc_id)
    if doc["status"] == "processing":
        updated = datetime.fromisoformat(doc["updated_at"])
        if datetime.now(timezone.utc) - updated < STALE_AFTER:
            return {"status": "processing"}
        # 서버 재시작 등으로 멈춘 작업은 다시 시작한다.
    if doc.get("finalized_at"):
        raise HTTPException(409, "이미 확정된 문서입니다.")
    ratio = min(max(ratio, 0.03), 0.4)
    client.update_document(doc_id, {"status": "processing", "progress": 0, "error": None})
    background.add_task(_process, client, doc, ratio)
    return {"status": "processing"}


@app.get("/documents/{doc_id}/export")
def export_document(doc_id: str, client: UserSupabase = Depends(user_client)) -> Response:
    doc = _owned_document(client, doc_id)
    original = client.download(BUCKET, doc["storage_path"])
    highlights = [Highlight.from_dict(row) for row in client.list_highlights(doc_id)]
    data = export_pdf(original, highlights)
    title = doc["title"].removesuffix(".pdf")
    filename = quote(f"{title}_highlighted.pdf")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
