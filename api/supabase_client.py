"""사용자 로그인 토큰으로 Supabase REST·Storage를 호출합니다.

서비스 롤(관리자) 키를 쓰지 않으므로 모든 요청에 사용자 본인의 RLS 정책이 그대로 적용됩니다.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from urllib.parse import quote

import requests

TIMEOUT = 60


class SupabaseError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"Supabase {status}: {message[:500]}")
        self.status = status


def _env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise RuntimeError(f"환경 변수 {name} 가 설정되지 않았습니다.")
    return value.rstrip("/")


class UserSupabase:
    def __init__(self, access_token: str):
        self.url = _env("SUPABASE_URL")
        self.headers = {
            "apikey": _env("SUPABASE_PUBLISHABLE_KEY"),
            "Authorization": f"Bearer {access_token}",
        }

    def _check(self, response: requests.Response) -> requests.Response:
        if response.status_code >= 400:
            raise SupabaseError(response.status_code, response.text)
        return response

    def get_user(self) -> dict:
        return self._check(requests.get(f"{self.url}/auth/v1/user", headers=self.headers, timeout=TIMEOUT)).json()

    def get_document(self, doc_id: str) -> dict | None:
        rows = self._check(requests.get(
            f"{self.url}/rest/v1/documents",
            params={"id": f"eq.{doc_id}", "select": "*"},
            headers=self.headers,
            timeout=TIMEOUT,
        )).json()
        return rows[0] if rows else None

    def update_document(self, doc_id: str, fields: dict) -> None:
        self._check(requests.patch(
            f"{self.url}/rest/v1/documents",
            params={"id": f"eq.{doc_id}"},
            json={**fields, "updated_at": datetime.now(timezone.utc).isoformat()},
            headers={**self.headers, "Prefer": "return=minimal"},
            timeout=TIMEOUT,
        ))

    def download(self, bucket: str, path: str) -> bytes:
        return self._check(requests.get(
            f"{self.url}/storage/v1/object/{bucket}/{quote(path)}",
            headers=self.headers,
            timeout=TIMEOUT * 3,
        )).content

    def list_highlights(self, doc_id: str) -> list[dict]:
        return self._check(requests.get(
            f"{self.url}/rest/v1/highlights",
            params={"document_id": f"eq.{doc_id}", "deleted": "eq.false", "select": "*", "order": "page,created_at"},
            headers=self.headers,
            timeout=TIMEOUT,
        )).json()

    def replace_ai_highlights(self, doc_id: str, rows: list[dict]) -> None:
        self._check(requests.delete(
            f"{self.url}/rest/v1/highlights",
            params={"document_id": f"eq.{doc_id}", "source": "eq.ai"},
            headers=self.headers,
            timeout=TIMEOUT,
        ))
        for start in range(0, len(rows), 500):
            self._check(requests.post(
                f"{self.url}/rest/v1/highlights",
                json=rows[start:start + 500],
                headers={**self.headers, "Prefer": "return=minimal"},
                timeout=TIMEOUT,
            ))
