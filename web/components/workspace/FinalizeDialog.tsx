"use client";

import { useMemo, useState } from "react";
import { createProject } from "@/lib/library";
import type { DocumentRow, HighlightGroup, ProjectRow } from "@/lib/types";

export type FinalizeChoice = { projectId: string | null; keySentence: string | null; download: boolean };

type Props = {
  doc: DocumentRow;
  projects: ProjectRow[];
  groups: HighlightGroup[]; // 켜진 하이라이트 (읽는 순서)
  onProjectCreated: (p: ProjectRow) => void;
  onCancel: () => void;
  onConfirm: (choice: FinalizeChoice) => Promise<void>;
};

const NONE = "__none__", CUSTOM = "__custom__";

/** 최종본 확정 창: 저장할 프로젝트와 기억할 핵심 한 문장을 고른다 */
export default function FinalizeDialog(props: Props) {
  const { doc, projects, groups, onProjectCreated, onCancel, onConfirm } = props;
  const sentences = useMemo(() => groups.filter((g) => g.kind === "text" && g.text.trim()), [groups]);
  const recommended = useMemo(() => {
    const ai = sentences.filter((g) => g.source === "ai" && g.relevance !== null);
    return ai.length ? ai.reduce((best, g) => ((g.relevance ?? 0) > (best.relevance ?? 0) ? g : best)).key : null;
  }, [sentences]);

  const existing = doc.key_sentence;
  const existingKey = existing ? sentences.find((g) => g.text === existing)?.key : undefined;
  const [projectId, setProjectId] = useState<string>(doc.project_id ?? "");
  const [newName, setNewName] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(existing ? (existingKey ?? CUSTOM) : NONE);
  const [custom, setCustom] = useState(existing && !existingKey ? existing : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addProject() {
    if (!newName?.trim()) return;
    try {
      const p = await createProject(newName);
      onProjectCreated(p);
      setProjectId(p.id);
      setNewName(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm(download: boolean) {
    const keySentence =
      choice === NONE ? null
        : choice === CUSTOM ? (custom.trim() || null)
          : sentences.find((g) => g.key === choice)?.text ?? null;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ projectId: projectId || null, keySentence, download });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label="최종본 확정" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">최종본 확정</div>
            <h3>{doc.title.replace(/\.pdf$/i, "")}</h3>
          </div>
        </div>

        <div className="modal-body">
          <h4>저장할 프로젝트</h4>
          {newName === null ? (
            <div className="row">
              <select className="select grow" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">분류 안 함</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="secondary-button" onClick={() => setNewName("")}>새 프로젝트</button>
            </div>
          ) : (
            <div className="row">
              <input
                className="field grow" autoFocus maxLength={60} placeholder="프로젝트 이름" value={newName}
                onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProject()}
              />
              <button className="primary-button" onClick={addProject} disabled={!newName.trim()}>만들기</button>
              <button className="secondary-button" onClick={() => setNewName(null)}>취소</button>
            </div>
          )}

          <h4>핵심 한 문장 <span>— 문서 목록에서 제목 아래에 보여요</span></h4>
          <div className="sentence-options">
            {sentences.map((g) => (
              <label key={g.key} className={`sentence-option ${choice === g.key ? "checked" : ""}`}>
                <input type="radio" name="key" checked={choice === g.key} onChange={() => setChoice(g.key)} />
                <span>
                  {g.key === recommended && <em className="badge">추천</em>}
                  <small>p. {g.page + 1}</small> {g.text}
                </span>
              </label>
            ))}
            <label className={`sentence-option ${choice === CUSTOM ? "checked" : ""}`}>
              <input type="radio" name="key" checked={choice === CUSTOM} onChange={() => setChoice(CUSTOM)} />
              <span>
                직접 쓰기
                {choice === CUSTOM && (
                  <input
                    className="field" autoFocus maxLength={200} placeholder="이 논문을 한 줄로 기억한다면?"
                    value={custom} onChange={(e) => setCustom(e.target.value)} style={{ marginTop: 8, marginBottom: 0 }}
                  />
                )}
              </span>
            </label>
            <label className={`sentence-option ${choice === NONE ? "checked" : ""}`}>
              <input type="radio" name="key" checked={choice === NONE} onChange={() => setChoice(NONE)} />
              <span>선택 안 함</span>
            </label>
          </div>
          {error && <p className="form-note error">{error}</p>}
        </div>

        <div className="modal-foot">
          <button className="secondary-button" onClick={onCancel}>취소</button>
          <button className="secondary-button" onClick={() => confirm(false)} disabled={busy || (choice === CUSTOM && !custom.trim())}>
            확정
          </button>
          <button className="primary-button" onClick={() => confirm(true)} disabled={busy || (choice === CUSTOM && !custom.trim())}>
            {busy ? "저장 중…" : "확정하고 PDF 받기"}
          </button>
        </div>
      </div>
    </div>
  );
}
