"use client";

import { Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { SimpleTopbar } from "@/components/SimpleTopbar";
import { startProcessing } from "@/lib/api";
import type { OcrResult } from "@/lib/ocr";
import { BUCKET, supabase } from "@/lib/supabase";
import type { CommentRow, DocumentRow, HighlightRow } from "@/lib/types";
import { useSession } from "@/lib/useSession";

// pdf.js는 브라우저에서만 동작
const Workspace = dynamic(() => import("@/components/workspace/Workspace"), { ssr: false });

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useSession();
  const [doc, setDoc] = useState<DocumentRow | null | undefined>(undefined);
  const [file, setFile] = useState<Blob | null>(null);
  const [rows, setRows] = useState<HighlightRow[] | null>(null);
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null | undefined>(undefined);
  const [version, setVersion] = useState(0); // AI 하이라이트를 다시 만들면 증가
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<{ label: string; fraction: number } | null>(null);
  const prepStarted = useRef(false);

  const loadDoc = useCallback(async () => {
    const { data } = await supabase.from("documents").select("*").eq("id", id).maybeSingle();
    setDoc(data as DocumentRow | null);
    return data as DocumentRow | null;
  }, [id]);

  const status = doc?.status;

  // 분석이 끝날 때까지 2초마다 진행률 확인
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      const d = await loadDoc();
      if (!stopped && d && (d.status === "processing" || d.status === "uploaded")) timer = setTimeout(tick, 2000);
    };
    if (status === undefined || status === "processing" || status === "uploaded") tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [session, loadDoc, status]);

  // 분석이 끝난 순간(처음 열 때 포함)마다 하이라이트를 새로 불러온다
  useEffect(() => {
    if (status === "ready") setVersion((v) => v + 1);
  }, [status]);

  // 준비되면 원본 PDF와 하이라이트(해제한 것 포함)를 불러온다
  useEffect(() => {
    if (!doc || doc.status !== "ready" || version === 0) return;
    if (!file) {
      supabase.storage.from(BUCKET).download(doc.storage_path).then(({ data, error }) => {
        if (error) setError("원본 PDF를 불러오지 못했어요.");
        else setFile(data);
      });
    }
    setRows(null);
    setComments(null);
    setOcr(undefined);
    import("@/lib/ocr").then((lib) => lib.loadOcr(doc.user_id, id)).then(setOcr, () => setOcr(null));
    supabase.from("highlights").select("*").eq("document_id", id).then(({ data, error }) => {
      if (error) setError("하이라이트를 불러오지 못했어요.");
      else setRows((data as HighlightRow[]) ?? []);
    });
    supabase.from("comments").select("*").eq("document_id", id).order("created_at").then(({ data, error }) => {
      if (error) setError("코멘트를 불러오지 못했어요.");
      else setComments((data as CommentRow[]) ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  /** 업로드 직후 준비: 스캔 쪽이 있으면 브라우저에서 글자 인식을 하고, 서버 분석을 시작한다 */
  const prepare = useCallback(async () => {
    if (!doc || !session) return;
    setError(null);
    try {
      const ocrLib = await import("@/lib/ocr");
      setPrep({ label: "문서를 살펴보는 중", fraction: 0 });
      const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(doc.storage_path);
      if (dlError || !blob) throw new Error("원본 PDF를 불러오지 못했어요.");
      setFile(blob);

      if (!(await ocrLib.loadOcr(session.user.id, id))) {
        const pdf = await ocrLib.openPdf(blob);
        const scanned = await ocrLib.findScannedPages(pdf);
        if (scanned.length > ocrLib.MAX_OCR_PAGES) {
          throw new Error(`글자 인식이 필요한 쪽이 ${scanned.length}쪽이에요. 스캔본은 ${ocrLib.MAX_OCR_PAGES}쪽까지 지원해요.`);
        }
        if (scanned.length > 0) {
          setPrep({ label: `글자 인식 준비 중 (스캔된 쪽 ${scanned.length}개)`, fraction: 0 });
          const result = await ocrLib.recognizePages(pdf, scanned, (p) =>
            setPrep({ label: `글자 인식 중 (${p.done}/${p.total}쪽 완료)`, fraction: p.fraction }),
          );
          await ocrLib.saveOcr(session.user.id, id, result);
        }
      }
      setPrep({ label: "AI 분석을 시작하는 중", fraction: 1 });
      await startProcessing(id);
      setPrep(null);
      setDoc((d) => (d ? { ...d, status: "processing", progress: 0, error: null } : d));
    } catch (e) {
      setPrep(null);
      prepStarted.current = false;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [doc, session, id]);

  useEffect(() => {
    if (status !== "uploaded" || !session || prepStarted.current) return;
    prepStarted.current = true;
    prepare();
  }, [status, session, prepare]);

  const retry = () => {
    prepStarted.current = true;
    prepare();
  };

  if (!session || doc === undefined) return null;

  if (doc === null) {
    return (
      <StatusScreen title="문서를 찾을 수 없어요">
        <p className="lead">삭제되었거나 다른 계정의 문서일 수 있어요.</p>
      </StatusScreen>
    );
  }

  if (doc.status === "failed") {
    return (
      <StatusScreen title={doc.title.replace(/\.pdf$/i, "")}>
        <p className="form-note error">{doc.error ?? "분석에 실패했어요."}</p>
        <button className="primary-button wide" style={{ marginTop: 18 }} onClick={retry}>다시 시도</button>
        {error && <p className="form-note error">{error}</p>}
      </StatusScreen>
    );
  }

  if (doc.status === "uploaded") {
    const pct = Math.round((prep?.fraction ?? 0) * 100);
    return (
      <StatusScreen title={doc.title.replace(/\.pdf$/i, "")}>
        <div className="eyebrow" style={{ marginTop: 4 }}><Sparkles size={12} /> 분석 준비</div>
        {error ? (
          <>
            <p className="form-note error">{error}</p>
            <button className="primary-button wide" style={{ marginTop: 18 }} onClick={retry}>다시 시도</button>
          </>
        ) : (
          <>
            <p className="lead">
              스캔된 쪽이 있으면 이 컴퓨터에서 글자를 인식해요. 끝날 때까지 이 탭을 열어 두세요.
            </p>
            <div className="progress-label"><span>{prep?.label ?? "준비 중"}</span><strong>{pct}%</strong></div>
            <div className="progress-track"><span style={{ width: `${Math.max(pct, 3)}%` }} /></div>
          </>
        )}
      </StatusScreen>
    );
  }

  if (doc.status !== "ready") {
    const pct = Math.round(doc.progress * 100);
    return (
      <StatusScreen title={doc.title.replace(/\.pdf$/i, "")}>
        <div className="eyebrow" style={{ marginTop: 4 }}><Sparkles size={12} /> AI 분석 중</div>
        <p className="lead">핵심 문장과 그림을 찾고 있어요. 긴 책은 몇 분 걸릴 수 있어요.</p>
        <div className="progress-label"><span>진행률</span><strong>{pct}%</strong></div>
        <div className="progress-track"><span style={{ width: `${Math.max(pct, 3)}%` }} /></div>
        {error && <p className="form-note error">{error}</p>}
      </StatusScreen>
    );
  }

  if (!file || !rows || !comments || ocr === undefined) {
    return (
      <StatusScreen title={doc.title.replace(/\.pdf$/i, "")}>
        <p className="lead">{error ?? "문서를 불러오는 중…"}</p>
      </StatusScreen>
    );
  }

  return (
    <Workspace
      key={version}
      doc={doc}
      file={file}
      initialRows={rows}
      initialComments={comments}
      ocr={ocr}
      onDocChange={(next) => setDoc(next)}
    />
  );
}

function StatusScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SimpleTopbar />
      <main className="page-center">
        <div className="panel-card">
          <h1 style={{ fontSize: 20, wordBreak: "keep-all" }}>{title}</h1>
          {children}
          <p className="form-note" style={{ marginTop: 22 }}>
            <Link href="/" className="text-button" style={{ fontSize: 12 }}>← 문서 목록</Link>
          </p>
        </div>
      </main>
    </>
  );
}
