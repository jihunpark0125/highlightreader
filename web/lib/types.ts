export type Rect = [number, number, number, number]; // x0, y0, x1, y1 (PDF 포인트, 좌상단 원점)

export type DocumentRow = {
  id: string;
  user_id: string;
  title: string;
  storage_path: string;
  page_count: number | null;
  page_sizes: [number, number][] | null;
  status: "uploaded" | "processing" | "ready" | "failed";
  progress: number;
  error: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HighlightRow = {
  id: string;
  document_id: string;
  page: number; // 0부터 시작
  kind: "text" | "figure";
  rects: Rect[];
  text: string;
  source: "ai" | "user";
  ref: string; // 여러 쪽에 걸친 하이라이트를 묶는 키
  category: string;
  relevance: number | null;
  deleted: boolean;
  created_at: string;
};

/** 화면의 하이라이트 카드 하나 = 같은 ref 로 묶인 하이라이트 행들 */
export type HighlightGroup = {
  key: string;
  rows: HighlightRow[];
  page: number;
  kind: "text" | "figure";
  text: string;
  source: "ai" | "user";
  category: string;
  relevance: number | null;
  active: boolean;
};

export const REVIEW_THRESHOLD = 70;

export function groupHighlights(rows: HighlightRow[]): HighlightGroup[] {
  const map = new Map<string, HighlightRow[]>();
  for (const row of rows) {
    const key = row.ref || row.id;
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return [...map.entries()]
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]);
      const first = sorted[0];
      return {
        key,
        rows: sorted,
        page: first.page,
        kind: first.kind,
        text: first.text,
        source: first.source,
        category: first.category,
        relevance: first.relevance,
        active: sorted.some((r) => !r.deleted),
      };
    })
    .sort((a, b) =>
      a.page - b.page
      || a.rows[0].rects[0][1] - b.rows[0].rects[0][1]
      || a.rows[0].rects[0][0] - b.rows[0].rects[0][0]);
}
