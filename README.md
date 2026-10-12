# Luma (easy_read)

PDF를 올리면 **원문은 그대로 두고** 핵심 문장과 핵심 그림·표에만 형광펜을 칩니다.
화면은 Figma Make 디자인 "AI Highlighting PDF Reader"를 따릅니다 (브랜드명은 `web/components/Brand.tsx` 한 곳에서 바꿀 수 있음).
읽으면서 하이라이트를 더하거나 지운 뒤 최종 확정하면, 하이라이트가 들어간 PDF를 내려받을 수 있습니다.

## 원문을 바꾸지 않는 방법
- AI(OpenAI)에는 `[문장ID] 원문` 목록만 보내고 **ID만** 돌려받습니다. AI가 문장을 다시 쓰지 않습니다.
- 내려받는 PDF는 원본 파일 뒤에 표준 PDF 주석만 덧붙인 증분 저장본입니다. 파일 앞부분은 원본과 바이트 단위로 같고,
  Acrobat 등에서 주석을 끄면 원본 그대로 보입니다. (`tests/test_pipeline.py`에서 검증)

## 구성
| 폴더 | 내용 |
|---|---|
| `api/` | Python FastAPI + PyMuPDF. 문장·그림 추출(`extract.py`), AI 선별(`selector.py`), 주석 내보내기(`export.py`), 서버(`main.py`), 명령줄 도구(`cli.py`) |
| `web/` | Next.js 화면. 로그인, 업로드, 하이라이트 편집 뷰어, 다운로드 |
| `supabase_setup.sql` | Supabase `easy_read` 프로젝트의 테이블·RLS·저장소 (적용 완료) |

## 처음 설정
1. `.env.example`을 복사해 `.env`로 저장하고 `OPENAI_API_KEY`를 채웁니다.
2. `web/.env.local.example`을 복사해 `web/.env.local`로 저장합니다(값은 이미 채워져 있음).
3. 패키지 설치
   ```
   pip install -r requirements.txt
   cd web && npm install
   ```

## 실행 (두 개의 터미널)
```
# 1) API 서버 — highlight-reader 폴더에서
python -m uvicorn api.main:app --port 8000

# 2) 화면 — highlight-reader/web 폴더에서
npm run dev
```
브라우저에서 http://localhost:3000 을 엽니다.

## 명령줄로 PDF 하나만 처리
```
python -m api.cli 논문.pdf               # → 논문_highlighted.pdf
python -m api.cli 논문.pdf --ratio 0.08  # 하이라이트를 더 적게 (기본 0.12)
python -m api.cli 논문.pdf --offline     # API 키 없이 규칙 기반으로 시험
```

## 테스트
```
python -m pytest tests
```

## 화면 구성과 편집 방법
하이라이트는 **본문 위에서만** 보고, 칠하고, 해제합니다 (따로 모아 보는 패널 없음).
- **왼쪽 페이지 목록**: 실제 쪽 썸네일 + 하이라이트 위치 표시, 🔍로 문서 안 검색, 읽기 진행률.
- **본문**: 원본 PDF 위에 하이라이트만 덧칠. 확대·축소(퍼센트를 누르면 화면 맞춤), ⤢로 페이지 목록 접기.
  - `‹ 3 / 25 ›` 또는 ←/→ 키: 이전/다음 하이라이트로 이동(해당 줄이 화면 가운데로). 선택한 게 없으면 지금 보는 위치 기준.
  - `직접 하이라이트`를 켜고 문장을 드래그 → 추가. `그림 영역`을 켜고 그림·표 주위를 드래그 → 영역 추가.
  - 하이라이트를 클릭 → `하이라이트 해제` (또는 Delete). `Ctrl+Z` / ↶ 로 되돌리기.
- **최종본 확정 → PDF 내보내기**: 확정하지 않고 내보내면 자동으로 확정됩니다. `확정됨`을 누르면 다시 수정할 수 있습니다.
- `⋯` 메뉴 → `AI 하이라이트 다시 만들기`: 직접 추가한 하이라이트는 남기고 AI 하이라이트만 새로 만듭니다.

## AI 하이라이트 기준
`api/selector.py`의 `SYSTEM_PROMPT`가 기준입니다. 후보 문장의 약 12%(`--ratio`)를 고르며,
핵심 주장·연구 목적·정의·방법·주요 결과·결론·한계를 우선하고 제목·저자·출판 정보·반복 문장은 피합니다.
AI는 문장 ID·유형·관련도만 돌려주므로 원문은 바뀌지 않습니다.

## 정확도 측정
사용자의 수정 기록이 정답 데이터입니다 — AI가 칠했는데 해제됨 = 잘못 고름, 사용자가 직접 칠함 = 놓침.
Supabase SQL 편집기에서 아래 결과를 JSON으로 저장한 뒤 실행합니다.
```
select h.*, d.title, d.finalized_at from highlights h join documents d on d.id = h.document_id;
```
```
python -m api.eval_report rows.json --finalized-only
```
정밀도·재현율, 유형별·관련도 구간별 해제율이 나옵니다. 기준(지시문·비율)을 바꾸기 전후로 비교하는 데 씁니다.

## 알려진 한계 (MVP)
- 스캔본(글자가 이미지인) PDF는 지원하지 않습니다.
- 회전된 쪽은 하이라이트 위치가 어긋날 수 있습니다.
- PyMuPDF는 AGPL 라이선스입니다. 상용 서비스로 배포하려면 상용 라이선스 또는 소스 공개가 필요합니다.
