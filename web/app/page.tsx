"use client";

import { FileUp, LogOut, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SimpleTopbar } from "@/components/SimpleTopbar";
import { startProcessing } from "@/lib/api";
import { BUCKET, supabase } from "@/lib/supabase";
import type { DocumentRow } from "@/lib/types";
import { useSession } from "@/lib/useSession";

const MAX_BYTES = 50 * 1024 * 1024;

function statusPill(doc: DocumentRow): { label: string; className: string } {
  if (doc.finalized_at) return { label: "확정", className: "final" };
  if (doc.status === "ready") return { label: "분석 완료", className: "ready" };
  if (doc.status === "failed") return { label: "실패", className: "failed" };
  return { label: "분석 중", className: "" };
}

export default function LibraryPage() {
  const session = useSession();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
    setDocs((data as DocumentRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  async function upload(file: File) {
    if (!session) return;
    setError(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDF 파일만 올릴 수 있어요.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("50MB 이하의 PDF만 올릴 수 있어요.");
      return;
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const path = `${session.user.id}/${id}.pdf`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf" });
      if (up.error) throw new Error(`업로드 실패: ${up.error.message}`);
      const ins = await supabase.from("documents").insert({ id, title: file.name, storage_path: path });
      if (ins.error) throw new Error(`저장 실패: ${ins.error.message}`);
      await startProcessing(id);
      router.push(`/doc/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function remove(doc: DocumentRow) {
    if (!confirm(`"${doc.title}" 문서와 하이라이트를 삭제할까요? 되돌릴 수 없어요.`)) return;
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
    load();
  }

  if (!session) return null;

  return (
    <>
      <SimpleTopbar
        right={
          <>
            <span className="save-state">{session.user.email}</span>
            <button className="icon-button" title="로그아웃" aria-label="로그아웃" onClick={() => supabase.auth.signOut()}>
              <LogOut size={17} />
            </button>
          </>
        }
      />
      <main className="library">
        <h1>내 문서</h1>
        <p className="lead">PDF를 올리면 AI가 핵심 문장과 그림에 하이라이트를 칩니다. 원문은 절대 바뀌지 않아요.</p>

        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && !busy) upload(file);
          }}
        >
          <FileUp size={26} color="var(--sage-dark)" />
          <strong>{busy ? "올리는 중…" : "PDF를 끌어다 놓거나 눌러서 선택하세요"}</strong>
          <span>책·논문 등 50MB, 300쪽 이하</span>
          <input
            ref={inputRef} type="file" accept="application/pdf,.pdf" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
          />
        </div>
        {error && <p className="form-note error">{error}</p>}

        <p className="section-title">최근 문서</p>
        {docs && docs.length === 0 && <p className="form-note">아직 올린 문서가 없어요.</p>}
        {docs && docs.length > 0 && (
          <div className="doc-list">
            {docs.map((doc) => {
              const pill = statusPill(doc);
              return (
                <div key={doc.id} className="doc-row">
                  <Link href={`/doc/${doc.id}`}>
                    <div className="title">{doc.title.replace(/\.pdf$/i, "")}</div>
                    <div className="meta">
                      {new Date(doc.created_at).toLocaleDateString("ko-KR")}
                      {doc.page_count ? ` · ${doc.page_count}쪽` : ""}
                    </div>
                  </Link>
                  <span className={`status-pill ${pill.className}`}>{pill.label}</span>
                  <button className="icon-button" title="삭제" aria-label="문서 삭제" onClick={() => remove(doc)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
