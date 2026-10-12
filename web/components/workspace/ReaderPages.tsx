"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Page } from "react-pdf";
import type { HighlightGroup, HighlightRow, Rect } from "@/lib/types";

export type NewHighlight = Pick<HighlightRow, "page" | "kind" | "rects" | "text">;
export type EditMode = "off" | "text" | "area";

type Props = {
  numPages: number;
  sizeOf: (page: number) => [number, number];
  zoom: number;
  groups: HighlightGroup[]; // 켜져 있는 하이라이트만
  selectedKey: string | null;
  mode: EditMode;
  editable: boolean;
  pageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  onSelect: (key: string | null) => void;
  onAdd: (items: NewHighlight[]) => void;
  onDeactivate: (key: string) => void;
};

/** 화면 좌표 사각형들을 PDF 좌표로 바꾸고, 같은 줄에 붙어 있는 조각은 하나로 합친다. */
function toLineRects(client: DOMRect[], page: DOMRect, scale: number): Rect[] {
  const rects: Rect[] = client
    .map((r): Rect => [
      (r.left - page.left) / scale,
      (r.top - page.top) / scale,
      (r.right - page.left) / scale,
      (r.bottom - page.top) / scale,
    ])
    .filter(([x0, y0, x1, y1]) => x1 - x0 > 0.5 && y1 - y0 > 0.5 && y1 - y0 < 50);

  const lines: Rect[] = [];
  for (const r of rects.sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const line = lines.find((l) => {
      const overlap = Math.min(l[3], r[3]) - Math.max(l[1], r[1]);
      const gap = Math.max(r[0] - l[2], l[0] - r[2]);
      return overlap > 0.5 * Math.min(l[3] - l[1], r[3] - r[1]) && gap < 12;
    });
    if (line) {
      line[0] = Math.min(line[0], r[0]);
      line[1] = Math.min(line[1], r[1]);
      line[2] = Math.max(line[2], r[2]);
      line[3] = Math.max(line[3], r[3]);
    } else {
      lines.push([...r]);
    }
  }
  return lines;
}

export default function ReaderPages(props: Props) {
  const { numPages, sizeOf, zoom, groups, selectedKey, mode, editable, pageRefs, scrollRoot, onSelect, onAdd, onDeactivate } = props;
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1, 2]));
  const [draft, setDraft] = useState<{ page: number; start: [number, number]; end: [number, number] } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 화면 근처의 쪽만 그려서 긴 책도 가볍게
  useEffect(() => {
    if (!numPages) return;
    const io = new IntersectionObserver(
      (entries) => setVisible((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) next.add(idx);
          else next.delete(idx);
        }
        return next;
      }),
      { root: scrollRoot.current, rootMargin: "1200px 0px" },
    );
    pageRefs.current.slice(0, numPages).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [numPages, pageRefs, scrollRoot]);

  const byPage = useMemo(() => {
    const map = new Map<number, { group: HighlightGroup; row: HighlightRow }[]>();
    for (const group of groups) {
      for (const row of group.rows) {
        if (row.deleted) continue;
        map.set(row.page, [...(map.get(row.page) ?? []), { group, row }]);
      }
    }
    return map;
  }, [groups]);

  function handleMouseUp(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-popover]")) return;
    const selection = window.getSelection();

    if (editable && mode === "text" && selection && !selection.isCollapsed && selection.rangeCount) {
      const clientRects = Array.from(selection.getRangeAt(0).getClientRects());
      const text = selection.toString().replace(/\s+/g, " ").trim();
      const items: NewHighlight[] = [];
      pageRefs.current.slice(0, numPages).forEach((el, page) => {
        if (!el) return;
        const box = el.getBoundingClientRect();
        const inside = clientRects.filter((r) => {
          const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
          return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
        });
        const rects = toLineRects(inside, box, zoom);
        if (rects.length && text) items.push({ page, kind: "text", rects, text });
      });
      if (items.length) onAdd(items);
      selection.removeAllRanges();
      return;
    }
    if (selection && !selection.isCollapsed) return; // 읽기 모드에서의 일반 드래그 선택은 그대로 둔다

    // 클릭: 그 위치의 하이라이트를 선택
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
    if (!pageEl) return onSelect(null);
    const page = Number(pageEl.dataset.page);
    const box = pageEl.getBoundingClientRect();
    const x = (e.clientX - box.left) / zoom, y = (e.clientY - box.top) / zoom;
    const hit = (byPage.get(page) ?? []).find(({ row }) =>
      row.rects.some(([x0, y0, x1, y1]) => x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2),
    );
    onSelect(hit?.group.key ?? null);
  }

  function areaPoint(e: React.MouseEvent, page: number): [number, number] {
    const box = pageRefs.current[page]!.getBoundingClientRect();
    return [(e.clientX - box.left) / zoom, (e.clientY - box.top) / zoom];
  }

  function finishArea() {
    const d = draftRef.current;
    if (!d) return;
    setDraft(null);
    const [ax, ay] = d.start, [bx, by] = d.end;
    const rect: Rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    if (rect[2] - rect[0] > 10 && rect[3] - rect[1] > 10) onAdd([{ page: d.page, kind: "figure", rects: [rect], text: "" }]);
  }

  return (
    <div onMouseUp={handleMouseUp}>
      {Array.from({ length: numPages }, (_, page) => {
        const [w, h] = sizeOf(page);
        const items = byPage.get(page) ?? [];
        const selected = items.find(({ group }) => group.key === selectedKey);
        return (
          <div
            key={page}
            data-page={page}
            ref={(el) => { pageRefs.current[page] = el; }}
            className="pdf-page"
            style={{ width: w * zoom, height: h * zoom }}
          >
            {visible.has(page) && (
              <>
                <Page
                  pageNumber={page + 1}
                  width={w * zoom}
                  renderAnnotationLayer={false}
                  renderTextLayer
                  loading={null}
                />
                {/* 하이라이트 레이어: 원본 위에 덧칠만 하고, 글자 선택은 그 위 텍스트 레이어가 받는다 */}
                <div className="pointer-events-none absolute inset-0 z-[1]">
                  {items.map(({ group, row }) =>
                    row.rects.map(([x0, y0, x1, y1], i) => (
                      <div
                        key={`${row.id}-${i}`}
                        className={`${row.kind === "figure" ? "hl-figure" : "hl-text"} ${group.key === selectedKey ? "hl-selected" : ""}`}
                        style={{ left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom }}
                      />
                    )),
                  )}
                </div>
              </>
            )}

            {editable && mode === "area" && (
              <div
                className="absolute inset-0 z-[4] cursor-crosshair"
                onMouseDown={(e) => { const p = areaPoint(e, page); setDraft({ page, start: p, end: p }); }}
                onMouseMove={(e) => draft?.page === page && setDraft({ ...draft, end: areaPoint(e, page) })}
                onMouseUp={finishArea}
                onMouseLeave={finishArea}
              >
                {draft?.page === page && (
                  <div
                    className="area-draft"
                    style={{
                      left: Math.min(draft.start[0], draft.end[0]) * zoom,
                      top: Math.min(draft.start[1], draft.end[1]) * zoom,
                      width: Math.abs(draft.end[0] - draft.start[0]) * zoom,
                      height: Math.abs(draft.end[1] - draft.start[1]) * zoom,
                    }}
                  />
                )}
              </div>
            )}

            {editable && selected && (
              <div
                data-popover
                className="hl-popover"
                style={{ left: selected.row.rects[0][0] * zoom, top: selected.row.rects[0][1] * zoom - 6 }}
              >
                <button onClick={() => onDeactivate(selected.group.key)}>하이라이트 해제</button>
              </div>
            )}

            <span className="pdf-page-number">{page + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
