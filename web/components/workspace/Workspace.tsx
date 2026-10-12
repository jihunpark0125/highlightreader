"use client";

import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Download, Expand, Highlighter, MoreHorizontal, PanelLeftOpen,
  Shrink, SquareDashed, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import Link from "next/link";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Brand } from "@/components/Brand";
import { downloadHighlighted, startProcessing } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { groupHighlights, type DocumentRow, type HighlightGroup, type HighlightRow } from "@/lib/types";
import PageRail from "./PageRail";
import ReaderPages, { type EditMode, type NewHighlight } from "./ReaderPages";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const DEFAULT_SIZE: [number, number] = [595, 842];
const MIN_ZOOM = 0.5, MAX_ZOOM = 2.5;

type UndoAction =
  | { type: "toggle"; ids: string[]; deleted: boolean } // 되돌릴 때 deleted 값을 이것으로
  | { type: "add"; ids: string[] };

type Toast = { text: string; error?: boolean; undo?: boolean };

type Props = {
  doc: DocumentRow;
  file: Blob;
  initialRows: HighlightRow[];
  onDocChange: (doc: DocumentRow) => void;
};

export default function Workspace({ doc, file, initialRows, onDocChange }: Props) {
  const [rows, setRows] = useState<HighlightRow[]>(initialRows);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [firstSize, setFirstSize] = useState<[number, number] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>("off");
  const [zoom, setZoom] = useState<number | null>(null); // null = 화면 너비에 맞춤
  const [fitZoom, setFitZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [railOpen, setRailOpen] = useState(true);
  const [saving, setSaving] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const finalized = !!doc.finalized_at;
  const editable = !finalized;
  const groups = useMemo(() => groupHighlights(rows), [rows]);
  const activeGroups = useMemo(() => groups.filter((g) => g.active), [groups]);

  const sizeOf = useCallback(
    (page: number): [number, number] => doc.page_sizes?.[page] ?? doc.page_sizes?.[0] ?? firstSize ?? DEFAULT_SIZE,
    [doc.page_sizes, firstSize],
  );
  const effectiveZoom = zoom ?? fitZoom;

  // 화면 너비에 맞춘 배율
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setFitZoom(Math.min(Math.max((width - 8) / sizeOf(0)[0], MIN_ZOOM), 1.35));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sizeOf, numPages]);

  // 지금 보고 있는 쪽
  const onScroll = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const line = el.getBoundingClientRect().top + el.clientHeight * 0.35;
    let page = 0;
    pageRefs.current.slice(0, numPages).forEach((p, i) => { if (p && p.getBoundingClientRect().top <= line) page = i; });
    setCurrentPage(page);
  }, [numPages]);

  const jumpTo = useCallback((page: number) => {
    pageRefs.current[page]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const showToast = useCallback((t: Toast) => setToast(t), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(timer);
  }, [hint]);

  /** 저장 중 표시와 오류 처리를 감싼다 */
  const persist = useCallback(async (fn: () => PromiseLike<{ error: unknown }>, failText: string) => {
    setSaving((n) => n + 1);
    const { error } = await fn();
    setSaving((n) => n - 1);
    if (error) showToast({ text: failText, error: true });
    return !error;
  }, [showToast]);

  const setGroupActive = useCallback(async (group: HighlightGroup, active: boolean, record = true) => {
    const ids = group.rows.map((r) => r.id);
    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, deleted: !active } : r)));
    if (record) setUndoStack((s) => [...s.slice(-29), { type: "toggle", ids, deleted: active }]);
    if (!active) {
      setSelectedKey(null);
      if (record) showToast({ text: "하이라이트를 해제했어요", undo: true });
    }
    const ok = await persist(
      () => supabase.from("highlights").update({ deleted: !active }).in("id", ids),
      "변경 내용을 저장하지 못했어요.",
    );
    if (!ok) setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, deleted: active } : r)));
  }, [persist, showToast]);

  const addHighlights = useCallback(async (items: NewHighlight[]) => {
    const ref = crypto.randomUUID();
    const payload = items.map((h) => ({ ...h, document_id: doc.id, source: "user", ref }));
    setSaving((n) => n + 1);
    const { data, error } = await supabase.from("highlights").insert(payload).select();
    setSaving((n) => n - 1);
    if (error || !data) return showToast({ text: "하이라이트를 저장하지 못했어요.", error: true });
    const inserted = data as HighlightRow[];
    setRows((prev) => [...prev, ...inserted]);
    setUndoStack((s) => [...s.slice(-29), { type: "add", ids: inserted.map((r) => r.id) }]);
    setSelectedKey(ref);
  }, [doc.id, showToast]);

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last || !editable) return;
    setUndoStack((s) => s.slice(0, -1));
    setToast(null);
    if (last.type === "toggle") {
      setRows((prev) => prev.map((r) => (last.ids.includes(r.id) ? { ...r, deleted: last.deleted } : r)));
      await persist(() => supabase.from("highlights").update({ deleted: last.deleted }).in("id", last.ids), "되돌리지 못했어요.");
    } else {
      setRows((prev) => prev.filter((r) => !last.ids.includes(r.id)));
      await persist(() => supabase.from("highlights").delete().in("id", last.ids), "되돌리지 못했어요.");
    }
  }, [undoStack, editable, persist]);

  // ── 이전/다음 하이라이트 이동 ──
  /** 하이라이트 첫 줄의 캔버스 안 세로 위치 */
  const offsetOf = useCallback((g: HighlightGroup) => {
    const pageEl = pageRefs.current[g.page];
    const row = g.rows.find((r) => !r.deleted) ?? g.rows[0];
    return pageEl ? pageEl.offsetTop + row.rects[0][1] * effectiveZoom : 0;
  }, [effectiveZoom]);

  const selectedIndex = activeGroups.findIndex((g) => g.key === selectedKey);

  const goTo = useCallback((dir: 1 | -1) => {
    const canvas = canvasRef.current;
    if (!canvas || !activeGroups.length) return;
    let idx: number;
    if (selectedIndex >= 0) {
      idx = selectedIndex + dir;
    } else {
      // 선택된 게 없으면 지금 화면 가운데를 기준으로 가장 가까운 다음/이전 하이라이트
      const center = canvas.scrollTop + canvas.clientHeight / 2;
      const offsets = activeGroups.map(offsetOf);
      idx = dir > 0
        ? offsets.findIndex((y) => y > center + 1)
        : offsets.reduce((found, y, i) => (y < center - 1 ? i : found), -1);
    }
    const target = activeGroups[idx];
    if (!target) return;
    setSelectedKey(target.key);
    canvas.scrollTo({ top: Math.max(0, offsetOf(target) - canvas.clientHeight / 2), behavior: "smooth" });
  }, [activeGroups, selectedIndex, offsetOf]);

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedKey && editable) {
        const g = groups.find((x) => x.key === selectedKey);
        if (g?.active) setGroupActive(g, false);
      }
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(-1); }
      if (e.key === "Escape") { setSelectedKey(null); setMode("off"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, selectedKey, editable, groups, setGroupActive, goTo]);

  function chooseMode(next: EditMode) {
    const value = mode === next ? "off" : next;
    setMode(value);
    if (value === "text") setHint("문장을 드래그하면 하이라이트가 추가돼요");
    if (value === "area") setHint("그림이나 표 주위를 드래그해 영역을 표시하세요");
  }

  async function setFinalized(final: boolean) {
    const finalized_at = final ? new Date().toISOString() : null;
    const ok = await persist(() => supabase.from("documents").update({ finalized_at }).eq("id", doc.id), "상태를 바꾸지 못했어요.");
    if (!ok) return false;
    onDocChange({ ...doc, finalized_at });
    setMode("off");
    setSelectedKey(null);
    return true;
  }

  async function toggleFinal() {
    if (finalized) {
      if (confirm("확정을 풀고 다시 수정할까요?")) await setFinalized(false);
    } else if (await setFinalized(true)) {
      showToast({ text: "최종본으로 확정했어요. 이제 PDF로 내보낼 수 있어요." });
    }
  }

  async function exportPdf() {
    setExporting(true);
    try {
      if (!finalized && !(await setFinalized(true))) return;
      await downloadHighlighted(doc.id, doc.title.replace(/\.pdf$/i, "") + "_highlighted.pdf");
      showToast({ text: finalized ? "PDF를 내보냈어요." : "최종본으로 확정하고 PDF를 내보냈어요." });
    } catch (e) {
      showToast({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setExporting(false);
    }
  }

  async function regenerate() {
    setMenuOpen(false);
    if (!confirm("AI 하이라이트를 처음부터 다시 만들까요?\n직접 추가한 하이라이트는 그대로 남고, AI 하이라이트를 해제한 기록은 사라져요.")) return;
    try {
      await startProcessing(doc.id);
      onDocChange({ ...doc, status: "processing", progress: 0 });
    } catch (e) {
      showToast({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  const zoomBy = (delta: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((effectiveZoom + delta) * 10) / 10)));
  const created = new Date(doc.created_at).toLocaleDateString("ko-KR");

  return (
    <div style={{ height: "100vh", overflow: "hidden" }}>
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/" className="icon-button" aria-label="문서 목록으로 돌아가기" title="문서 목록">
            <ArrowLeft size={18} />
          </Link>
          <Brand />
          <div className="header-divider" />
          <div className="document-title">
            <span>{doc.title.replace(/\.pdf$/i, "")}</span>
            <span className="document-meta">{numPages || doc.page_count || "-"}쪽 · {created}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="save-state">
            <span className={`save-dot ${saving ? "saving" : ""}`} />
            {saving ? "저장 중…" : "변경사항 저장됨"}
          </div>
          <button className={`secondary-button ${finalized ? "done" : ""}`} onClick={toggleFinal} title={finalized ? "확정 해제" : undefined}>
            <Check size={15} /> {finalized ? "확정됨" : "최종본 확정"}
          </button>
          <button className="primary-button" onClick={exportPdf} disabled={exporting}>
            <Download size={15} /> {exporting ? "만드는 중…" : "PDF 내보내기"}
          </button>
          <button className="icon-button" aria-label="더 보기" onClick={() => setMenuOpen(!menuOpen)}>
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="top-menu" onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={regenerate} disabled={finalized}>AI 하이라이트 다시 만들기</button>
              <button className="danger" onClick={() => supabase.auth.signOut()}>로그아웃</button>
            </div>
          )}
        </div>
      </header>

      <Document
        file={file}
        className={`workspace ${railOpen ? "" : "no-rail"}`}
        onLoadSuccess={async (p) => {
          setPdf(p);
          setNumPages(p.numPages);
          const vp = (await p.getPage(1)).getViewport({ scale: 1 });
          setFirstSize([vp.width, vp.height]);
        }}
        loading={<div className="page-center"><p className="form-note">PDF를 여는 중…</p></div>}
        error={<div className="page-center"><p className="form-note error">PDF를 열지 못했어요.</p></div>}
      >
        <PageRail
          pdf={pdf}
          numPages={numPages}
          sizeOf={sizeOf}
          groups={activeGroups}
          currentPage={currentPage}
          onJump={jumpTo}
          onClose={() => setRailOpen(false)}
        />

        <section className="reader">
          <div className="reader-toolbar">
            <div className="tool-group">
              {!railOpen && (
                <button className="icon-button" aria-label="페이지 목록 열기" title="페이지 목록" onClick={() => setRailOpen(true)}>
                  <PanelLeftOpen size={17} />
                </button>
              )}
              <button className="icon-button" aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" onClick={undo} disabled={!undoStack.length || !editable}>
                <Undo2 size={16} />
              </button>
              <span className="toolbar-divider" />
              <button className="icon-button" aria-label="축소" onClick={() => zoomBy(-0.1)}><ZoomOut size={16} /></button>
              <button className="zoom-value" title="화면에 맞추기" onClick={() => setZoom(null)}>{Math.round(effectiveZoom * 100)}%</button>
              <button className="icon-button" aria-label="확대" onClick={() => zoomBy(0.1)}><ZoomIn size={16} /></button>
              <button
                className="icon-button" aria-label="전체 화면" title={railOpen ? "문서에 집중" : "페이지 목록 다시 열기"}
                onClick={() => setRailOpen(!railOpen)}
              >
                {railOpen ? <Expand size={15} /> : <Shrink size={15} />}
              </button>
            </div>

            <div className="page-status">{numPages ? currentPage + 1 : "-"}<span>/ {numPages || "-"}</span></div>

            <div className="tool-group" style={{ gap: 6 }}>
              <div className="hl-nav" aria-label="하이라이트 이동">
                <button
                  className="icon-button" aria-label="이전 하이라이트" title="이전 하이라이트 (←)"
                  onClick={() => goTo(-1)} disabled={!activeGroups.length || selectedIndex === 0}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>{selectedIndex >= 0 ? selectedIndex + 1 : "–"}<em>/ {activeGroups.length}</em></span>
                <button
                  className="icon-button" aria-label="다음 하이라이트" title="다음 하이라이트 (→)"
                  onClick={() => goTo(1)} disabled={!activeGroups.length || selectedIndex === activeGroups.length - 1}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <span className="toolbar-divider" />
              <button
                className={`highlight-tool ${mode === "text" ? "active" : ""}`} disabled={!editable}
                onClick={() => chooseMode("text")} title={editable ? "문장을 드래그해 하이라이트" : "확정된 문서는 수정할 수 없어요"}
              >
                <Highlighter size={14} /> 직접 하이라이트 <span className="color-swatch" />
              </button>
              <button
                className={`highlight-tool ${mode === "area" ? "active" : ""}`} disabled={!editable}
                onClick={() => chooseMode("area")} title="그림·표 영역 표시"
              >
                <SquareDashed size={14} /> 그림 영역
              </button>
            </div>
          </div>

          <div className="canvas" ref={canvasRef} onScroll={onScroll}>
            <ReaderPages
              numPages={numPages}
              sizeOf={sizeOf}
              zoom={effectiveZoom}
              groups={activeGroups}
              selectedKey={selectedKey}
              mode={mode}
              editable={editable}
              pageRefs={pageRefs}
              scrollRoot={canvasRef}
              onSelect={setSelectedKey}
              onAdd={addHighlights}
              onDeactivate={(key) => { const g = groups.find((x) => x.key === key); if (g) setGroupActive(g, false); }}
            />
          </div>
        </section>

      </Document>

      {hint && <div className="selection-hint"><Highlighter size={14} />{hint}</div>}

      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`}>
          {toast.text}
          {toast.undo && <button onClick={undo}>되돌리기</button>}
        </div>
      )}

    </div>
  );
}
