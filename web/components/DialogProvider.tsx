"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
};

type DialogState = ConfirmOptions & { kind: "confirm" | "notify"; resolve: (ok: boolean) => void };

type DialogApi = {
  /** 예/아니오를 묻는다. 브라우저 기본 confirm() 대신 쓴다 (내장 브라우저·차단 설정에서 자동으로 '취소'되는 문제 방지). */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** 알림만 보여 준다. 브라우저 기본 alert() 대신 쓴다. */
  notify: (title: string, message?: string) => Promise<void>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useDialog 는 DialogProvider 안에서만 쓸 수 있어요.");
  return api;
}

export default function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, kind: "confirm", resolve })),
    [],
  );
  const notify = useCallback(
    (title: string, message?: string) =>
      new Promise<void>((resolve) => setState({ title, message, kind: "notify", resolve: () => resolve() })),
    [],
  );

  const close = useCallback((ok: boolean) => {
    setState((s) => {
      s?.resolve(ok);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, close]);

  return (
    <DialogContext.Provider value={{ confirm, notify }}>
      {children}
      {state && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal dialog" role="alertdialog" aria-modal="true" aria-label={state.title} onClick={(e) => e.stopPropagation()}>
            <div className="modal-body dialog-body">
              <h3>{state.title}</h3>
              {state.message && <p>{state.message}</p>}
            </div>
            <div className="modal-foot">
              {state.kind === "confirm" && (
                <button className="secondary-button" onClick={() => close(false)}>취소</button>
              )}
              <button
                ref={okRef}
                className={`primary-button ${state.danger ? "danger" : ""}`}
                onClick={() => close(true)}
              >
                {state.kind === "confirm" ? state.confirmLabel ?? "확인" : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
