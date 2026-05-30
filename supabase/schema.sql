-- Esquema de la base de datos del Corrector de Pruebas (OMR).
-- Pega TODO esto en Supabase → SQL Editor → New query → Run.
-- Cada profesor (cuenta de auth) solo ve y maneja SUS datos (RLS).

-- ============ Tablas ============

create table if not exists public.cursos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  nombre     text not null,
  materia    text,
  created_at timestamptz not null default now()
);

create table if not exists public.alumnos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  curso_id   uuid not null references public.cursos(id) on delete cascade,
  nombre     text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  curso_id      uuid references public.cursos(id) on delete set null,
  alumno_id     uuid references public.alumnos(id) on delete set null,
  alumno_nombre text,                 -- copia del nombre por si se borra el alumno
  prueba        text,                 -- titulo de la prueba
  correctas     int,
  total         int,
  nota          numeric(2,1),
  fecha         timestamptz not null default now()
);

create index if not exists idx_alumnos_curso on public.alumnos(curso_id);
create index if not exists idx_notas_curso   on public.notas(curso_id);

-- ============ Seguridad por fila (RLS) ============
-- Sin esto, cualquiera con la anon key podria leer datos de otros profes.

alter table public.cursos  enable row level security;
alter table public.alumnos enable row level security;
alter table public.notas   enable row level security;

drop policy if exists "cursos_propios"  on public.cursos;
drop policy if exists "alumnos_propios" on public.alumnos;
drop policy if exists "notas_propias"   on public.notas;

create policy "cursos_propios" on public.cursos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "alumnos_propios" on public.alumnos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notas_propias" on public.notas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
