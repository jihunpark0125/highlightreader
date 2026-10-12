"use client";

import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useDialog } from "@/components/DialogProvider";
import DocumentList from "@/components/library/DocumentList";
import UploadBox from "@/components/library/UploadBox";
import { SimpleTopbar } from "@/components/SimpleTopbar";
import { useLibrary } from "@/lib/library";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useSession();
  const router = useRouter();
  const { projects, docs, reload } = useLibrary(!!session);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const dialog = useDialog();

  if (!session || !projects || !docs) return null;
  const project = projects.find((p) => p.id === id);

  if (!project) {
    return (
      <>
        <SimpleTopbar />
        <main className="library">
          <h1>프로젝트를 찾을 수 없어요</h1>
          <p className="lead"><Link href="/" className="text-button" style={{ fontSize: 13 }}>← 내 서재로</Link></p>
        </main>
      </>
    );
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("projects").update({ name: name.trim() }).eq("id", id);
    if (error) return dialog.notify("이름을 바꾸지 못했어요");
    setRenaming(false);
    reload();
  }

  async function remove() {
    const ok = await dialog.confirm({
      title: `"${project!.name}" 프로젝트를 삭제할까요?`,
      message: "안에 있던 문서는 지워지지 않고 '분류 안 된 문서'로 옮겨져요.",
      confirmLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) return dialog.notify("프로젝트를 삭제하지 못했어요");
    router.replace("/");
  }

  const inProject = docs.filter((d) => d.project_id === id);

  return (
    <>
      <SimpleTopbar />
      <main className="library">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> 내 서재</Link>
        <div className="project-head">
          {renaming ? (
            <form onSubmit={rename} style={{ display: "flex", gap: 6, flex: 1 }}>
              <input className="field" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 0 }} />
              <button className="primary-button">저장</button>
              <button type="button" className="secondary-button" onClick={() => setRenaming(false)}>취소</button>
            </form>
          ) : (
            <>
              <h1>{project.name}</h1>
              <button className="icon-button" title="이름 바꾸기" aria-label="프로젝트 이름 바꾸기" onClick={() => { setName(project.name); setRenaming(true); }}>
                <Pencil size={15} />
              </button>
              <button className="icon-button" title="프로젝트 삭제" aria-label="프로젝트 삭제" onClick={remove}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
        <p className="lead">문서 {inProject.length}개 · 여기서 올린 PDF는 자동으로 이 프로젝트에 저장돼요.</p>

        <UploadBox userId={session.user.id} fixedProjectId={id} />

        <p className="section-title">문서</p>
        <DocumentList docs={inProject} projects={projects} empty="아직 이 프로젝트에 문서가 없어요." onChanged={reload} />
      </main>
    </>
  );
}
