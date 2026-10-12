"use client";

import { useCallback, useEffect, useState } from "react";
import { BUCKET, supabase } from "./supabase";
import type { DocumentRow, ProjectRow } from "./types";

/** 문서 목록 화면들이 함께 쓰는 프로젝트·문서 불러오기와 변경 */
export function useLibrary(enabled: boolean) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);

  const reload = useCallback(async () => {
    const [p, d] = await Promise.all([
      supabase.from("projects").select("*").order("created_at"),
      supabase.from("documents").select("*").order("created_at", { ascending: false }),
    ]);
    setProjects((p.data as ProjectRow[]) ?? []);
    setDocs((d.data as DocumentRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  return { projects, docs, reload };
}

export async function createProject(name: string): Promise<ProjectRow> {
  const { data, error } = await supabase.from("projects").insert({ name: name.trim() }).select().single();
  if (error) throw new Error("프로젝트를 만들지 못했어요.");
  return data as ProjectRow;
}

export async function moveDocument(docId: string, projectId: string | null): Promise<void> {
  const { error } = await supabase.from("documents").update({ project_id: projectId }).eq("id", docId);
  if (error) throw new Error("문서를 옮기지 못했어요.");
}

export async function deleteDocument(doc: DocumentRow): Promise<void> {
  await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  if (error) throw new Error("문서를 삭제하지 못했어요.");
}
