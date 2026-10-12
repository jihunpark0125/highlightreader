import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다.");
  return { Authorization: `Bearer ${token}` };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.detail ?? `요청 실패 (${res.status})`;
  } catch {
    return `요청 실패 (${res.status})`;
  }
}

export async function startProcessing(docId: string, ratio?: number): Promise<void> {
  const query = ratio ? `?ratio=${ratio}` : "";
  const res = await fetch(`${API_URL}/documents/${docId}/process${query}`, {
    method: "POST",
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function downloadHighlighted(docId: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_URL}/documents/${docId}/export`, { headers: await authHeader() });
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
