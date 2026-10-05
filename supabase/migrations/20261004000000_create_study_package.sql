create extension if not exists pgcrypto;

create table if not exists public.study_weeks (
  id uuid primary key default gen_random_uuid(),
  week_number integer not null unique check (week_number >= 0),
  title text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'error')),
  error_message text,
  unlock_delay_days smallint not null default 1 check (unlock_delay_days >= 0),
  generated_content jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  study_week_id uuid not null references public.study_weeks(id) on delete cascade,
  title text not null,
  file_name text not null,
  file_path text not null unique,
  extracted_text text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  study_week_id uuid not null unique references public.study_weeks(id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.flashcard_decks (
  id uuid primary key default gen_random_uuid(),
  study_week_id uuid not null unique references public.study_weeks(id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  study_week_id uuid not null unique references public.study_weeks(id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists study_weeks_status_number_idx
  on public.study_weeks (status, week_number);
create index if not exists study_materials_study_week_id_idx
  on public.study_materials (study_week_id);

alter table public.study_weeks enable row level security;
alter table public.study_materials enable row level security;
alter table public.lessons enable row level security;
alter table public.flashcard_decks enable row level security;
alter table public.tests enable row level security;

revoke all on public.study_weeks, public.study_materials, public.lessons, public.flashcard_decks, public.tests from anon, authenticated;
grant all on public.study_weeks, public.study_materials, public.lessons, public.flashcard_decks, public.tests to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-materials', 'study-materials', false, 20971520, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;