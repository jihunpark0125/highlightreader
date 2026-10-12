"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { startProcessing } from "@/lib/api";
import { BUCKET, supabase } from "@/lib/supabase";
import type { ProjectRow } from "@/lib/types";

const MAX_BYTES = 50 * 1024 * 1024;

type Props = {
  userId: string;
  /** 프로젝트 화면에서는 고정, 첫 화면에서는 null 로 두고 드롭다운으로 고른다 */
  fixedProjectId?: string;
  projects?: ProjectRow[];
};

export default function UploadBox({ userId, fixedProjectId, projects }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>("");

  async function upload(file: File) {
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
      const path = `${userId}/${id}.pdf`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf" });
      if (up.error) throw new Error(`업로드 실패: ${up.error.message}`);
      const ins = await supabase.from("documents").insert({
        id,
        title: file.name,
        storage_path: path,
        project_id: fixedProjectId ?? (projectId || null),
      });
      if (ins.error) throw new Error(`저장 실패: ${ins.error.message}`);
      await startProcessing(id);
      router.push(`/doc/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
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
        {!fixedProjectId && projects && projects.length > 0 && (
          <label className="dropzone-project" onClick={(e) => e.stopPropagation()}>
            저장할 프로젝트
            <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">분류 안 함</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <input
          ref={inputRef} type="file" accept="application/pdf,.pdf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
        />
      </div>
      {error && <p className="form-note error">{error}</p>}
    </>
  );
}
