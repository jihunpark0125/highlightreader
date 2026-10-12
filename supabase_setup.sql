-- easy_read: 문서·하이라이트 테이블, RLS, 원본 PDF 저장소

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  storage_path text not null,
  page_count int,
  page_sizes jsonb,                       -- [[width, height], ...] (PDF 포인트)
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  progress real not null default 0,
  error text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page int not null,
  kind text not null default 'text' check (kind in ('text', 'figure')),
  rects jsonb not null,                   -- [[x0, y0, x1, y1], ...] (PDF 포인트, 좌상단 원점)
  text text not null default '',
  source text not null default 'user' check (source in ('ai', 'user')),
  ref text not null default '',
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists documents_user_idx on public.documents (user_id, created_at desc);
create index if not exists highlights_document_idx on public.highlights (document_id, page);

alter table public.documents enable row level security;
alter table public.highlights enable row level security;

create policy "documents: owner all" on public.documents
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "highlights: owner all" on public.highlights
  for all to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.documents d
                      where d.id = document_id and d.user_id = (select auth.uid())));

-- 원본 PDF 저장소: originals/{user_id}/{document_id}.pdf, 본인 폴더만 접근
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('originals', 'originals', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "originals: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "originals: owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "originals: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 2차: 하이라이트 유형·관련도 (디자인의 하이라이트 카드용)
alter table public.highlights
  add column if not exists category text not null default '',
  add column if not exists relevance int check (relevance between 0 and 100);

-- 3차: 초대한 이메일만 가입 (초대 추가: insert into public.allowed_emails(email) values ('친구@example.com');)
create table if not exists public.allowed_emails (
  email text primary key check (email = lower(email)),
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon, authenticated;

create schema if not exists private;
create or replace function private.enforce_invite_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.allowed_emails a where a.email = lower(new.email)) then
    raise exception 'invite_only: % 은(는) 초대되지 않은 이메일입니다.', new.email using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_invite_only() from public, anon, authenticated;
drop trigger if exists enforce_invite_only on auth.users;
create trigger enforce_invite_only before insert on auth.users
  for each row execute function private.enforce_invite_only();

-- 4차: 프로젝트(폴더) · 핵심 한 문장 · 코멘트 핀
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, created_at);
alter table public.projects enable row level security;
create policy "projects: owner all" on public.projects
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.documents
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists key_sentence text check (key_sentence is null or char_length(key_sentence) <= 1000);
create index if not exists documents_project_idx on public.documents (project_id);

-- 문서를 다른 사람의 프로젝트에 넣지 못하게 프로젝트 소유도 확인
drop policy if exists "documents: owner all" on public.documents;
create policy "documents: owner all" on public.documents
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (
      select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  );

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page int not null,
  x real not null,                        -- 핀 위치 (PDF 포인트, 좌상단 원점)
  y real not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists comments_document_idx on public.comments (document_id, page);
alter table public.comments enable row level security;
create policy "comments: owner all" on public.comments
  for all to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.documents d
                      where d.id = document_id and d.user_id = (select auth.uid())));
