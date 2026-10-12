"use client";

import { PanelLeftClose, Search, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import { Page } from "react-pdf";
import type { OcrResult } from "@/lib/ocr";
import type { CommentRow, HighlightGroup } from "@/lib/types";

const THUMB_WIDTH = 97;

type Props = {
  pdf: PDFDocumentProxy | null;
  numPages: number;
  sizeOf: (page: number) => [number, number];
  groups: HighlightGroup[];
  comments: CommentRow[];
  ocrPages: OcrResult["pages"] | null;
  currentPage: number;
  onJump: (page: number) => void;
  onClose: () => void;
};

const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export default function PageRail({ pdf, numPages, sizeOf, groups, comments, ocrPages, currentPage, onJump, onClose }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5]));
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[] | null>(null);
  const textCache = useRef(new Map<number, string>());

  useEffect(() => {
    if (!numPages) return;
    const io = new IntersectionObserver(
      (entries) => setVisible((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.thumb);
          if (e.isIntersecting) next.add(idx);
        }
        return next;
      }),
      { root: listRef.current, rootMargin: "400px 0px" },
    );
    rowRefs.current.slice(0, numPages).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [numPages, matches]);

  // 현재 쪽 썸네일이 보이도록
  useEffect(() => {
    rowRefs.current[currentPage]?.scrollIntoView({ block: "nearest" });
  }, [currentPage]);

  // 문서 안 검색: 글자가 들어 있는 쪽만 남긴다
  useEffect(() => {
    const q = normalize(query);
    if (!pdf || !q) { setMatches(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found: number[] = [];
      for (let i = 0; i < numPages && !cancelled; i++) {
        let text = textCache.current.get(i);
        if (text === undefined) {
          const content = await (await pdf.getPage(i + 1)).getTextContent();
          const ocrWords = ocrPages?.[String(i)]?.words ?? [];
          text = normalize(content.items.map((it) => ("str" in it ? it.str : "")).join("") + ocrWords.map((w) => w[4]).join(""));
          textCache.current.set(i, text);
        }
        if (text.includes(q)) found.push(i);
      }
      if (!cancelled) setMatches(found);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, pdf, numPages, ocrPages]);

  const marksByPage = useMemo(() => {
    const map = new Map<number, [number, number, number, number][]>();
    for (const g of groups) for (const row of g.rows) {
      if (row.deleted) continue;
      map.set(row.page, [...(map.get(row.page) ?? []), ...row.rects]);
    }
    return map;
  }, [groups]);

  const pages = matches ?? Array.from({ length: numPages }, (_, i) => i);
  const progress = numPages ? Math.round(((currentPage + 1) / numPages) * 100) : 0;

  return (
    <aside className="page-rail">
      <div className="rail-tools">
        <button className="icon-button" aria-label="사이드바 닫기" title="사이드바 닫기" onClick={onClose}>
          <PanelLeftClose size={17} />
        </button>
        <span className="rail-title">페이지</span>
        <button
          className="icon-button" aria-label="문서에서 검색" title="문서에서 검색"
          onClick={() => { setSearchOpen(!searchOpen); setQuery(""); }}
        >
          {searchOpen ? <X size={16} /> : <Search size={16} />}
        </button>
      </div>
      {searchOpen && (
        <div className="rail-search">
          <input autoFocus placeholder="문서에서 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          {matches && <p>{matches.length ? `${matches.length}개 쪽에서 찾았어요` : "찾은 결과가 없어요"}</p>}
        </div>
      )}

      <div className="thumbnails" ref={listRef}>
        {pages.map((page) => {
          const [w, h] = sizeOf(page);
          const scale = THUMB_WIDTH / w;
          return (
            <button
              key={page}
              data-thumb={page}
              ref={(el) => { rowRefs.current[page] = el; }}
              className={`thumbnail-row ${page === currentPage ? "active" : ""}`}
              onClick={() => onJump(page)}
            >
              <span className="page-number">{page + 1}</span>
              <span className="thumbnail" style={{ height: h * scale }}>
                {visible.has(page) && (
                  <Page pageNumber={page + 1} width={THUMB_WIDTH} renderTextLayer={false} renderAnnotationLayer={false} loading={null} />
                )}
                {(marksByPage.get(page) ?? []).map(([x0, y0, x1, y1], i) => (
                  <span
                    key={i}
                    className="thumb-mark"
                    style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: Math.max((y1 - y0) * scale, 2) }}
                  />
                ))}
                {comments.filter((c) => c.page === page).map((c) => (
                  <span key={c.id} className="thumb-comment" style={{ left: c.x * scale, top: c.y * scale }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="document-progress">
        <div className="progress-label"><span>읽기 진행</span><strong>{progress}%</strong></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        <span>{numPages} 페이지 중 {currentPage + 1} 페이지</span>
      </div>
    </aside>
  );
}
