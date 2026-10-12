"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useDialog } from "@/components/DialogProvider";
import { deleteDocument, moveDocument } from "@/lib/library";
import type { DocumentRow, ProjectRow } from "@/lib/types";

function statusPill(doc: DocumentRow): { label: string; className: string } {
  if (doc.finalized_at) return { label: "확정", className: "final" };
  if (doc.status === "ready") return { label: "분석 완료", className: "ready" };
  if (doc.status === "failed") return { label: "실패", className: "failed" };
  return { label: "분석 중", className: "" };
}

type Props = {
  docs: DocumentRow[];
  projects: ProjectRow[];
  empty: string;
  onChanged: () => void;
};

export default function DocumentList({ docs, projects, empty, onChanged }: Props) {
  const dialog = useDialog();
  if (docs.length === 0) return <p className="form-note">{empty}</p>;

  async function move(doc: DocumentRow, projectId: string) {
    try {
      await moveDocument(doc.id, projectId || null);
      onChanged();
    } catch (e) {
      dialog.notify("옮기지 못했어요", e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(doc: DocumentRow) {
    const ok = await dialog.confirm({
      title: "문서를 삭제할까요?",
      message: `"${doc.title.replace(/\.pdf$/i, "")}"와 하이라이트·코멘트가 모두 지워지고 되돌릴 수 없어요.`,
      confirmLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDocument(doc);
      onChanged();
    } catch (e) {
      dialog.notify("삭제하지 못했어요", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="doc-list">
      {docs.map((doc) => {
        const pill = statusPill(doc);
        return (
          <div key={doc.id} className="doc-row">
            <Link href={`/doc/${doc.id}`}>
              <div className="title">{doc.title.replace(/\.pdf$/i, "")}</div>
              {doc.key_sentence && <blockquote className="key-sentence">{doc.key_sentence}</blockquote>}
              <div className="meta">
                {new Date(doc.created_at).toLocaleDateString("ko-KR")}
                {doc.page_count ? ` · ${doc.page_count}쪽` : ""}
              </div>
            </Link>
            <span className={`status-pill ${pill.className}`}>{pill.label}</span>
            <select
              className="select" aria-label="프로젝트로 옮기기" title="프로젝트로 옮기기"
              value={doc.project_id ?? ""} onChange={(e) => move(doc, e.target.value)}
            >
              <option value="">분류 안 함</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="icon-button" title="삭제" aria-label="문서 삭제" onClick={() => remove(doc)}>
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
