"use client";

import { LogOut } from "lucide-react";
import DocumentList from "@/components/library/DocumentList";
import ProjectGrid from "@/components/library/ProjectGrid";
import UploadBox from "@/components/library/UploadBox";
import { SimpleTopbar } from "@/components/SimpleTopbar";
import { useLibrary } from "@/lib/library";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export default function LibraryPage() {
  const session = useSession();
  const { projects, docs, reload } = useLibrary(!!session);

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
        <h1>내 서재</h1>
        <p className="lead">PDF를 올리면 AI가 핵심 문장과 그림에 하이라이트를 칩니다. 원문은 절대 바뀌지 않아요.</p>

        <UploadBox userId={session.user.id} projects={projects ?? []} />

        <p className="section-title">프로젝트</p>
        {projects && docs && <ProjectGrid projects={projects} docs={docs} onCreated={reload} />}

        <p className="section-title">분류 안 된 문서</p>
        {projects && docs && (
          <DocumentList
            docs={docs.filter((d) => !d.project_id)}
            projects={projects}
            empty="모든 문서가 프로젝트에 정리되어 있어요."
            onChanged={reload}
          />
        )}
      </main>
    </>
  );
}
