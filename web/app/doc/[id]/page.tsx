"use client";

import { Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { SimpleTopbar } from "@/components/SimpleTopbar";
import { startProcessing } from "@/lib/api";
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
  const [version, setVersion] = useState(0); // AI 하이라이트를 다시 만들면 증가
  const [error, setError] = useState<string | null>(null);

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

  async function retry() {
    setError(null);
    try {
      await startProcessing(id);
      setDoc((d) => (d ? { ...d, status: "processing", progress: 0, error: null } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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

  if (doc.status !== "ready") {
    const pct = Math.round(doc.progress * 100);
    return (
      <StatusScreen title={doc.title.replace(/\.pdf$/i, "")}>
        <div className="eyebrow" style={{ marginTop: 4 }}><Sparkles size={12} /> AI 분석 중</div>
        <p className="lead">핵심 문장과 그림을 찾고 있어요. 긴 책은 몇 분 걸릴 수 있어요.</p>
        <div className="progress-label"><span>진행률</span><strong>{pct}%</strong></div>
        <div className="progress-track"><span style={{ width: `${Math.max(pct, 3)}%` }} /></div>
        {doc.status === "uploaded" && (
          <button className="primary-button wide" style={{ marginTop: 18 }} onClick={retry}>분석 시작</button>
        )}
        {error && <p className="form-note error">{error}</p>}
      </StatusScreen>
    );
  }

  if (!file || !rows || !comments) {
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
