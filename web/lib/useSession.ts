"use client";

import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** 로그인 세션을 돌려주고, 로그인하지 않았으면 /login 으로 보낸다. */
export function useSession(): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) router.replace("/login");
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  return session;
}
