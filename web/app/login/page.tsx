"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SimpleTopbar } from "@/components/SimpleTopbar";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage({ text: "이메일 또는 비밀번호가 올바르지 않습니다.", error: true });
      else router.replace("/");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        // 초대 목록에 없는 이메일은 DB 트리거가 막고, Supabase는 "Database error saving new user"로 돌려준다
        const invite = /database error/i.test(error.message);
        setMessage({ text: invite ? "초대받은 이메일만 가입할 수 있어요. 관리자에게 초대를 요청해 주세요." : error.message, error: true });
      } else if (data.session) router.replace("/");
      else setMessage({ text: "확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.", error: false });
    }
    setBusy(false);
  }

  return (
    <>
      <SimpleTopbar />
      <main className="page-center">
        <div className="panel-card">
          <h1>{mode === "signin" ? "다시 오셨네요" : "시작해 볼까요"}</h1>
          <p className="lead">
            원문은 그대로, 핵심에만 하이라이트.<br />
            {mode === "signup" ? "초대받은 이메일로만 가입할 수 있어요." : "책과 논문을 더 빠르게 파악하세요."}
          </p>
          <form onSubmit={submit}>
            <input
              className="field" type="email" required placeholder="이메일" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            />
            <input
              className="field" type="password" required minLength={6} placeholder="비밀번호 (6자 이상)"
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
            <button className="primary-button wide" disabled={busy}>
              {mode === "signin" ? "로그인" : "회원가입"}
            </button>
          </form>
          {message && <p className={`form-note ${message.error ? "error" : ""}`}>{message.text}</p>}
          <p className="form-note">
            <button
              type="button" className="text-button" style={{ fontSize: 12 }}
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(null); }}
            >
              {mode === "signin" ? "처음이신가요? 회원가입" : "이미 계정이 있나요? 로그인"}
            </button>
          </p>
        </div>
      </main>
    </>
  );
}
