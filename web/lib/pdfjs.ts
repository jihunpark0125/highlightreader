"use client";

import { pdfjs } from "react-pdf";

// pdf.js 작업자(worker)는 한 번만 지정한다. 화면(react-pdf)과 글자 인식(lib/ocr.ts)이 함께 쓴다.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export { pdfjs };
