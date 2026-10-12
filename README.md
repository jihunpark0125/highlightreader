# Rewiter 리위터 (easy_read)

PDF를 올리면 **원문은 그대로 두고** 핵심 문장과 핵심 그림·표에만 형광펜을 칩니다.
화면은 Figma Make 디자인 "AI Highlighting PDF Reader"를 따릅니다 (로고는 "readwithhighlighter"에서 r·e·w·i·t·e·r에만 하이라이트를 칠해 "Rewiter"로 읽히게 함 — `web/components/Brand.tsx`).
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
   pip install -r requirements-dev.txt
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

## 스캔본 PDF (글자 인식)
글자 층이 없는 쪽(스캔한 종이)은 **사용자 브라우저에서** Tesseract.js(한국어+영어)로 글자를 인식합니다 (`web/lib/ocr.ts`).
- 서버 비용 0원. 사용자 컴퓨터 CPU 코어를 최대 3개 써서 여러 쪽을 동시에 인식 (10쪽 약 1분 반).
- 2단 편집은 단 사이 여백을 찾아 왼쪽 단 → 오른쪽 단 순서로 다시 정렬, 음절 단위로 끊긴 한글은 단어로 합치고, 소제목 줄은 따로 뗍니다.
- 결과(단어와 위치)는 Supabase Storage `ocr/{user_id}/{document_id}.json`에 저장되고, 서버(`api/extract.py`)는 글자가 없는 쪽에서만 이것을 씁니다.
- 뷰어는 인식한 글자를 보이지 않는 글자 층으로 깔아 스캔 쪽에서도 드래그 하이라이트·검색이 됩니다.
- 내보낸 PDF에는 인식 글자를 넣지 않습니다(원본 보존). 인식 중에는 그 탭을 열어 두어야 하며, 다른 탭으로 옮겨도 인식은 계속됩니다.
- 스캔된 쪽은 60쪽까지 지원합니다.

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

## 온라인 배포 (Vercel + Render)
화면(web/)은 Vercel, AI 서버(api/)는 Render에 올립니다. 둘 다 이 GitHub 저장소에 push하면 자동으로 다시 배포됩니다.

1. **Render (AI 서버)** — render.com에 GitHub로 로그인 → New → **Blueprint** → 이 저장소 선택 (`render.yaml`을 읽음)
   - 입력 창: `OPENAI_API_KEY` = OpenAI 키, `WEB_ORIGINS` = 일단 `http://localhost:3000`
   - 배포가 끝나면 주소(예: `https://luma-api-xxxx.onrender.com`)의 `/health`가 `{"ok":true}`인지 확인
   - 무료 플랜은 15분 동안 요청이 없으면 잠들어 첫 분석이 30~60초 늦습니다. 항상 켜려면 Starter($7/월).
2. **Vercel (화면)** — vercel.com에 GitHub로 로그인 → Add New → Project → 이 저장소 Import
   - **Root Directory: `web`**
   - Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY` (`web/.env.local.example` 값),
     `NEXT_PUBLIC_API_URL` = 1번의 Render 주소
3. **Render**로 돌아가 `WEB_ORIGINS`를 Vercel 주소(예: `https://luma-reader.vercel.app`)로 바꿈 → 자동 재배포
4. **Supabase** 대시보드 → Authentication → URL Configuration
   - Site URL = Vercel 주소, Redirect URLs에 `Vercel 주소/**` 추가 (가입 확인 메일 링크가 여기로 돌아옴)

### 사람 초대하기
가입은 `allowed_emails`에 있는 이메일만 됩니다. Supabase SQL 편집기에서:
```
insert into public.allowed_emails (email, note) values ('friend@example.com', '친구');
```
초대 취소는 `delete from public.allowed_emails where email = '...';` (이미 가입한 계정은 Authentication → Users에서 삭제)

## 알려진 한계 (MVP)
- 회전된 쪽은 하이라이트 위치가 어긋날 수 있습니다.
- PyMuPDF는 AGPL 라이선스입니다. 상용 서비스로 배포하려면 상용 라이선스 또는 소스 공개가 필요합니다.
