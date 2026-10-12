"use client";

import { FolderOpen, FolderPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createProject } from "@/lib/library";
import type { DocumentRow, ProjectRow } from "@/lib/types";

type Props = {
  projects: ProjectRow[];
  docs: DocumentRow[];
  onCreated: () => void;
};

export default function ProjectGrid({ projects, docs, onCreated }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createProject(name);
      setName("");
      setAdding(false);
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  return (
    <div className="project-grid">
      {projects.map((p) => {
        const inProject = docs.filter((d) => d.project_id === p.id);
        const latest = inProject.find((d) => d.key_sentence);
        return (
          <Link key={p.id} href={`/project/${p.id}`} className="project-card">
            <div className="project-card-top">
              <FolderOpen size={17} color="var(--sage-dark)" />
              <span className="project-count">문서 {inProject.length}개</span>
            </div>
            <strong>{p.name}</strong>
            {latest?.key_sentence && <p>“{latest.key_sentence}”</p>}
          </Link>
        );
      })}

      {adding ? (
        <form className="project-card new" onSubmit={submit}>
          <input
            className="field" autoFocus maxLength={60} placeholder="프로젝트 이름 (예: 바이오)"
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="primary-button" disabled={busy || !name.trim()}>만들기</button>
            <button type="button" className="secondary-button" onClick={() => setAdding(false)}>취소</button>
          </div>
        </form>
      ) : (
        <button className="project-card new" onClick={() => setAdding(true)}>
          <FolderPlus size={20} color="var(--sage-dark)" />
          <strong>새 프로젝트</strong>
          <p>주제별로 논문을 나눠 보관하세요</p>
        </button>
      )}
    </div>
  );
}
