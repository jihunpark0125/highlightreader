"use client";

import { useMemo } from "react";
import type { OcrWord } from "@/lib/ocr";

const FONT = "sans-serif";
let measureCtx: CanvasRenderingContext2D | null = null;

function measure(text: string, fontSize: number): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * fontSize * 0.6;
  measureCtx.font = `${fontSize}px ${FONT}`;
  return measureCtx.measureText(text).width || 1;
}

/**
 * 스캔 쪽 위에 인식한 글자를 보이지 않게 깔아, 일반 PDF처럼 드래그로 선택할 수 있게 한다.
 * 단어마다 원본 그림 속 위치·크기에 맞춰 늘이거나 줄인다 (pdf.js 텍스트 레이어와 같은 방식).
 */
export default function OcrTextLayer({ words, zoom }: { words: OcrWord[]; zoom: number }) {
  const spans = useMemo(
    () =>
      words.map(([x0, y0, x1, y1, text], i) => {
        const height = Math.max((y1 - y0) * zoom, 1);
        const fontSize = height * 0.92;
        const scaleX = ((x1 - x0) * zoom) / measure(text, fontSize);
        const next = words[i + 1];
        // 같은 줄의 다음 단어가 있으면 띄어쓰기를 넣어 복사·선택한 문장이 이어지게 한다
        const space = next && next[6] === words[i][6] ? " " : "\n";
        return { key: i, left: x0 * zoom, top: y0 * zoom, height, fontSize, scaleX, text: text + space };
      }),
    [words, zoom],
  );

  return (
    <div className="ocr-layer">
      {spans.map((s) => (
        <span
          key={s.key}
          style={{
            left: s.left, top: s.top, height: s.height, fontSize: s.fontSize, lineHeight: `${s.height}px`,
            transform: `scaleX(${s.scaleX})`,
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}
