"use client";

import { MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  x: number; // 화면 픽셀 (쪽 왼쪽 위 기준)
  y: number;
  body: string;
  open: boolean;
  editable: boolean;
  isDraft?: boolean; // 막 꽂은 새 핀
  onOpen: () => void;
  onClose: () => void;
  onSave: (body: string) => void;
  onDelete?: () => void;
};

/** 쪽 위에 꽂힌 코멘트 핀과 그 말풍선 */
export default function CommentPin({ x, y, body, open, editable, isDraft, onOpen, onClose, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(!!isDraft);
  const [text, setText] = useState(body);

  useEffect(() => {
    if (!open) { setEditing(!!isDraft); setText(body); }
  }, [open, body, isDraft]);

  const save = () => {
    const value = text.trim();
    if (!value) return;
    onSave(value);
    setEditing(false);
  };

  return (
    <div data-comment className="comment-pin" style={{ left: x, top: y }} onMouseUp={(e) => e.stopPropagation()}>
      <button
        className={`comment-pin-icon ${open ? "open" : ""}`}
        aria-label="코멘트 보기" title={body.slice(0, 80) || "새 코멘트"}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <MessageSquareText size={14} />
      </button>
      {open && (
        <div className="comment-bubble">
          {editing ? (
            <>
              <textarea
                autoFocus maxLength={2000} rows={3} placeholder="코멘트를 입력하세요"
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
                  if (e.key === "Escape") onClose();
                }}
              />
              <div className="comment-actions">
                <span>Ctrl+Enter 저장</span>
                <button className="secondary-button" onClick={onClose}>취소</button>
                <button className="primary-button" onClick={save} disabled={!text.trim()}>저장</button>
              </div>
            </>
          ) : (
            <>
              <p>{body}</p>
              {editable && (
                <div className="comment-actions">
                  {onDelete && <button className="text-button danger" onClick={onDelete}>삭제</button>}
                  <button className="secondary-button" onClick={() => setEditing(true)}>수정</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
