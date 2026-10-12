"use client";

import Link from "next/link";
import { Brand } from "./Brand";

/** 문서 목록·로그인·진행 화면에 쓰는 상단 바 */
export function SimpleTopbar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" style={{ color: "inherit", textDecoration: "none" }}><Brand /></Link>
      </div>
      <div className="topbar-actions">{right}</div>
    </header>
  );
}
