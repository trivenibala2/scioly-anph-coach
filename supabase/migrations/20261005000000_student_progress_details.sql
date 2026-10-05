-- Extra progress tracking so the admin can see how each student is doing.
alter table public.student_week_progress
  add column if not exists flashcards_known smallint,
  add column if not exists flashcards_review smallint,
  add column if not exists test_attempts smallint not null default 0,
  add column if not exists best_test_score smallint check (best_test_score between 0 and 5),
  add column if not exists weak_concepts jsonb not null default '[]'::jsonb,
  add column if not exists last_activity_at timestamptz;

create index if not exists student_week_progress_week_idx
  on public.student_week_progress (study_week_id);
