"use client";

/**
 * 스캔본(글자 층이 없는 쪽)을 사용자 브라우저에서 글자 인식(OCR)한다.
 * 서버 비용 없이 사용자 컴퓨터의 CPU로 처리하고, 결과(단어와 위치)만 Supabase Storage에 저장한다.
 * 원본 PDF는 바꾸지 않는다. 서버(api/extract.py)는 글자가 없는 쪽에서만 이 결과를 쓴다.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjs } from "./pdfjs";
import { supabase } from "./supabase";

/** [x0, y0, x1, y1, 글자, 문단 번호, 줄 번호] — PDF 포인트, 좌상단 원점 */
export type OcrWord = [number, number, number, number, string, number, number];
export type OcrResult = {
  version: 1;
  engine: string;
  pages: Record<string, { words: OcrWord[] }>;
};

export const OCR_BUCKET = "ocr";
export const OCR_MIN_CHARS = 20; // api/extract.py 의 OCR_MIN_CHARS 와 같은 기준
export const MAX_OCR_PAGES = 60;
const RENDER_SCALE = 2; // 약 144dpi — 본문 글자 인식에 충분하고 빠르다
const MAX_WORKERS = 3;
const MAX_CANVAS_SIDE = 4000;
const MIN_CONFIDENCE = 30;

export const ocrPath = (userId: string, docId: string) => `${userId}/${docId}.json`;

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

/** 글자 층이 (거의) 없는 쪽 번호들 (0부터) */
export async function findScannedPages(pdf: PDFDocumentProxy): Promise<number[]> {
  const scanned: number[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const content = await (await pdf.getPage(i + 1)).getTextContent();
    const chars = content.items.reduce((n, it) => n + ("str" in it ? it.str.trim().length : 0), 0);
    if (chars < OCR_MIN_CHARS) scanned.push(i);
  }
  return scanned;
}

export type OcrProgress = { done: number; total: number; fraction: number };

const HANGUL = /[\uac00-\ud7a3]/;

/**
 * Tesseract 한국어 인식은 "주 기 에 서 의"처럼 음절마다 단어를 나누는 일이 많다.
 * 같은 줄에서 틈 없이 붙어 있는 한글 조각은 한 단어로 합친다.
 */
export function mergeHangulFragments(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && prev[6] === w[6]) {
      const height = Math.max(prev[3] - prev[1], w[3] - w[1]);
      const gap = w[0] - prev[2];
      const joinable = HANGUL.test(prev[4].slice(-1)) && HANGUL.test(w[4][0]);
      if (joinable && gap < height * 0.35) {
        out[out.length - 1] = [
          prev[0], Math.min(prev[1], w[1]), w[2], Math.max(prev[3], w[3]), prev[4] + w[4], prev[5], prev[6],
        ];
        continue;
      }
    }
    out.push(w);
  }
  return out;
}

/**
 * 2단 편집 쪽에서 Tesseract가 왼쪽·오른쪽 단을 한 줄로 읽어 문장이 섞이는 문제를 바로잡는다.
 * 1) 쪽 가운데 부근에서 단어가 거의 지나가지 않는 세로 틈(단 사이 여백)을 찾고
 * 2) 그 틈을 가로지르는 줄은 왼쪽·오른쪽 조각으로 나눈 뒤
 * 3) 위쪽 전체 폭(제목 등) → 왼쪽 단 → 오른쪽 단 → 아래쪽 전체 폭 순서로 다시 번호를 매긴다.
 */
export function fixColumnOrder(words: OcrWord[], pageWidth: number): OcrWord[] {
  if (words.length < 40) return words;
  const crossings = (x: number) => words.filter((w) => w[0] < x && w[2] > x).length;
  let gutter = -1, best = Infinity;
  for (let x = pageWidth * 0.35; x <= pageWidth * 0.65; x += 1) {
    const c = crossings(x);
    if (c < best) { best = c; gutter = x; }
  }
  const left = words.filter((w) => w[2] <= gutter).length;
  const right = words.filter((w) => w[0] >= gutter).length;
  // 가로지르는 단어가 거의 없고 양쪽에 글자가 충분해야 2단으로 본다
  if (best > words.length * 0.03 || left < words.length * 0.25 || right < words.length * 0.25) return words;

  type Segment = { col: "full" | "L" | "R"; y: number; para: number; words: OcrWord[] };
  const byLine = new Map<number, OcrWord[]>();
  for (const w of words) byLine.set(w[6], [...(byLine.get(w[6]) ?? []), w]);
  const segments: Segment[] = [];
  for (const lineWords of byLine.values()) {
    const para = lineWords[0][5];
    const crossesGutter = lineWords.some((w) => w[0] < gutter && w[2] > gutter);
    // 줄 전체가 틈을 가로지르는 단어를 가지면(제목·표 머리) 전체 폭 줄로 둔다
    if (crossesGutter) {
      segments.push({ col: "full", y: Math.min(...lineWords.map((w) => w[1])), para, words: lineWords });
      continue;
    }
    for (const col of ["L", "R"] as const) {
      const part = lineWords.filter((w) => (col === "L" ? w[2] <= gutter : w[0] >= gutter));
      if (part.length) segments.push({ col, y: Math.min(...part.map((w) => w[1])), para, words: part });
    }
  }
  const colTop = Math.min(...segments.filter((s) => s.col !== "full").map((s) => s.y));
  const byY = (a: Segment, b: Segment) => a.y - b.y;
  const ordered = [
    ...segments.filter((s) => s.col === "full" && s.y < colTop).sort(byY),
    ...segments.filter((s) => s.col === "L").sort(byY),
    ...segments.filter((s) => s.col === "R").sort(byY),
    ...segments.filter((s) => s.col === "full" && s.y >= colTop).sort(byY),
  ];

  const out: OcrWord[] = [];
  let paraNo = -1, prev: Segment | null = null;
  ordered.forEach((seg, lineNo) => {
    const h = Math.max(...seg.words.map((w) => w[3] - w[1]));
    const newPara = !prev || prev.col !== seg.col || prev.para !== seg.para || seg.y - prev.y > h * 2.2;
    if (newPara) paraNo++;
    for (const w of [...seg.words].sort((a, b) => a[0] - b[0])) out.push([w[0], w[1], w[2], w[3], w[4], paraNo, lineNo]);
    prev = seg;
  });
  return out;
}

/**
 * 소제목("1. 연구대상")처럼 짧고 마침표 없이 끝나는 줄은 Tesseract가 다음 본문과 한 문단으로 묶는 일이 많다.
 * 그런 줄은 따로 문단으로 떼어, 서버가 소제목을 본문 문장에 붙이지 않게 한다.
 */
export function splitHeadingLines(words: OcrWord[]): OcrWord[] {
  const lines = new Map<number, OcrWord[]>();
  for (const w of words) lines.set(w[6], [...(lines.get(w[6]) ?? []), w]);
  const widths = [...lines.values()].map((l) => Math.max(...l.map((w) => w[2])) - Math.min(...l.map((w) => w[0])));
  const typical = [...widths].sort((a, b) => a - b)[Math.floor(widths.length * 0.75)] ?? 0;
  if (!typical) return words;

  const out: OcrWord[] = [];
  let para = -1, prevPara: number | null = null, forceNew = false;
  [...lines.values()].forEach((line, i) => {
    const text = line.map((w) => w[4]).join(" ");
    const isHeading = widths[i] < typical * 0.5 && !/[.!?。다]$/.test(text) && line.length <= 8;
    if (isHeading || forceNew || line[0][5] !== prevPara) para++;
    forceNew = isHeading;
    prevPara = line[0][5];
    for (const w of line) out.push([w[0], w[1], w[2], w[3], w[4], para, w[6]]);
  });
  return out;
}

async function renderPage(pdf: PDFDocumentProxy, pageIndex: number): Promise<{ canvas: HTMLCanvasElement; scale: number; width: number }> {
  const page = await pdf.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(RENDER_SCALE, MAX_CANVAS_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // intent "print": 화면 갱신 신호(requestAnimationFrame)를 기다리지 않고 그린다 →
  // 사용자가 다른 탭으로 옮겨 가도(브라우저가 숨은 탭의 화면 갱신을 멈춰도) 인식이 계속된다.
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport, intent: "print" }).promise;
  return { canvas, scale, width: base.width };
}

export async function recognizePages(
  pdf: PDFDocumentProxy,
  pages: number[],
  onProgress: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const { createScheduler, createWorker } = await import("tesseract.js");
  const total = pages.length;
  let done = 0;
  const inFlight = new Map<string, number>(); // 작업자별 현재 쪽 진행률
  const report = () => {
    const partial = [...inFlight.values()].filter((v) => v < 1).reduce((a, b) => a + b, 0);
    onProgress({ done, total, fraction: Math.min((done + partial) / total, 1) });
  };

  // 사용자 컴퓨터의 CPU 코어를 나눠 여러 쪽을 동시에 인식한다 (최대 3개, 메모리 고려)
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const workerCount = Math.max(1, Math.min(MAX_WORKERS, cores - 1, total));
  const scheduler = createScheduler();
  const result: OcrResult = { version: 1, engine: "tesseract.js@6 kor+eng", pages: {} };

  try {
    const workers = await Promise.all(
      Array.from({ length: workerCount }, () =>
        createWorker(["kor", "eng"], 1, {
          logger: (m: { status: string; progress: number; workerId?: string }) => {
            if (m.status === "recognizing text" && m.workerId) {
              inFlight.set(m.workerId, m.progress);
              report();
            }
          },
        }),
      ),
    );
    for (const w of workers) {
      await w.setParameters({ preserve_interword_spaces: "1" });
      scheduler.addWorker(w);
    }
    report();

    await Promise.all(pages.map(async (pageIndex) => {
      const { canvas, scale, width } = await renderPage(pdf, pageIndex);
      const { data } = await scheduler.addJob("recognize", canvas, {}, { blocks: true });
      canvas.width = canvas.height = 0; // 메모리 해제

      const pt = (v: number) => Math.round((v / scale) * 100) / 100;
      const words: OcrWord[] = [];
      let paragraphNo = 0, lineNo = 0;
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              const text = w.text.trim();
              if (!text || w.confidence < MIN_CONFIDENCE) continue;
              words.push([pt(w.bbox.x0), pt(w.bbox.y0), pt(w.bbox.x1), pt(w.bbox.y1), text, paragraphNo, lineNo]);
            }
            lineNo++;
          }
          paragraphNo++;
        }
      }
      result.pages[String(pageIndex)] = { words: mergeHangulFragments(splitHeadingLines(fixColumnOrder(words, width))) };
      done++;
      report();
    }));
  } finally {
    await scheduler.terminate();
  }
  onProgress({ done: total, total, fraction: 1 });
  return result;
}

export async function saveOcr(userId: string, docId: string, ocr: OcrResult): Promise<void> {
  const body = new Blob([JSON.stringify(ocr)], { type: "application/json" });
  const { error } = await supabase.storage.from(OCR_BUCKET).upload(ocrPath(userId, docId), body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(`글자 인식 결과를 저장하지 못했어요: ${error.message}`);
}

export async function loadOcr(userId: string, docId: string): Promise<OcrResult | null> {
  const { data, error } = await supabase.storage.from(OCR_BUCKET).download(ocrPath(userId, docId));
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as OcrResult;
  } catch {
    return null;
  }
}
