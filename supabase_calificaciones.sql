-- ============================================================================
-- supabase_calificaciones.sql  (FullStatus)
-- Corre este archivo completo en Supabase → SQL Editor (es idempotente).
--
-- Guarda las calificaciones por UNIDAD de cada alumno (escala 1-10):
--   modelo "nuevo":    reprobado si total < 7
--   modelo "anterior": reprobado si total < 8
-- La columna "aprobado" se calcula sola a partir de total y minima.
--
-- Cada fila queda ligada a su alumno por nombre (sin acentos, mayúsculas ni orden,
-- igual que las asistencias) y, si existe public.alumnos(nombre, matricula), también
-- por matrícula.
-- ============================================================================

create extension if not exists unaccent;

-- ADMIN: cambia este correo si tu cuenta de administrador de Supabase es otra.
create or replace function public.fs_es_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'prismalmesh@gmail.com'
$$;

-- Clave de comparación de nombres: sin acentos, minúsculas y palabras ordenadas.
create or replace function public.fs_clave_nombre(t text) returns text
language sql immutable set search_path = public, extensions as $$
  select coalesce(string_agg(w, ' ' order by w), '')
  from unnest(string_to_array(trim(regexp_replace(lower(unaccent(coalesce(t, ''))), '\s+', ' ', 'g')), ' ')) as w
  where w <> ''
$$;

create table if not exists public.calificaciones (
  grupo_id      text         not null,   -- id del grupo en la app (localStorage)
  unidad_num    int          not null,   -- posición de la unidad (1, 2, 3…) por fecha inicial
  alumno_clave  text         not null,
  grupo         text         not null,
  materia       text         not null default '',
  unidad_nombre text         not null default '',
  alumno_nombre text         not null,
  matricula     text,
  modelo        text         not null check (modelo in ('nuevo', 'anterior')),
  minima        numeric(3,1) not null,   -- 7 (nuevo) u 8 (anterior)
  total         numeric(4,2) not null check (total between 0 and 10),
  asistencias   int          not null default 0,
  dias          int          not null default 0,
  aprobado      boolean generated always as (total >= minima) stored,
  actualizado   timestamptz  not null default now(),
  primary key (grupo_id, unidad_num, alumno_clave)
);

create index if not exists calificaciones_matricula_idx on public.calificaciones (matricula);

alter table public.calificaciones enable row level security;

drop policy if exists calificaciones_admin on public.calificaciones;
create policy calificaciones_admin on public.calificaciones
  for all to authenticated
  using (public.fs_es_admin()) with check (public.fs_es_admin());

-- Publicación desde FullStatus: reemplaza lo de cada grupo recibido (así también
-- desaparecen unidades o alumnos que se quitaron en la app).
create or replace function public.publicar_calificaciones(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  g jsonb; u jsonb; a jsonb;
  n int := 0;
  ids text[] := '{}';
  sin text[];
begin
  if not public.fs_es_admin() then
    raise exception 'Solo el administrador puede publicar calificaciones';
  end if;

  for g in select * from jsonb_array_elements(coalesce(p_payload -> 'grupos', '[]'::jsonb)) loop
    ids := ids || (g ->> 'id');
    delete from public.calificaciones where grupo_id = g ->> 'id';

    for u in select * from jsonb_array_elements(coalesce(g -> 'unidades', '[]'::jsonb)) loop
      for a in select * from jsonb_array_elements(coalesce(u -> 'alumnos', '[]'::jsonb)) loop
        insert into public.calificaciones
          (grupo_id, unidad_num, alumno_clave, grupo, materia, unidad_nombre, alumno_nombre,
           modelo, minima, total, asistencias, dias)
        values
          (g ->> 'id', (u ->> 'num')::int, public.fs_clave_nombre(a ->> 'nombre'),
           coalesce(g ->> 'nombre', ''), coalesce(g ->> 'materia', ''), coalesce(u ->> 'nombre', ''),
           a ->> 'nombre', g ->> 'modelo', (g ->> 'minima')::numeric,
           least(10, greatest(0, (a ->> 'total')::numeric)),
           coalesce((a ->> 'asistencias')::int, 0), coalesce((a ->> 'dias')::int, 0))
        on conflict (grupo_id, unidad_num, alumno_clave) do update set
          unidad_nombre = excluded.unidad_nombre, total = excluded.total, minima = excluded.minima,
          modelo = excluded.modelo, asistencias = excluded.asistencias, dias = excluded.dias,
          actualizado = now();
        n := n + 1;
      end loop;
    end loop;
  end loop;

  -- Grupos que ya no existen en la app (solo si el envío trae al menos uno).
  if array_length(ids, 1) > 0 then
    delete from public.calificaciones where grupo_id <> all (ids);
  end if;

  -- Liga la matrícula si existe public.alumnos(nombre, matricula). Si esa tabla tiene otra
  -- forma, se omite sin romper la publicación.
  begin
    update public.calificaciones c set matricula = x.matricula
    from (
      select public.fs_clave_nombre(nombre) as clave, min(matricula::text) as matricula
      from public.alumnos group by 1 having count(*) = 1
    ) x
    where c.alumno_clave = x.clave and c.grupo_id = any (ids);
  exception when others then
    null;
  end;

  select coalesce(array_agg(distinct alumno_nombre), '{}') into sin
  from public.calificaciones where grupo_id = any (ids) and matricula is null;

  return jsonb_build_object('registros', n, 'sin_matricula', to_jsonb(sin));
end;
$$;

revoke all on function public.publicar_calificaciones(jsonb) from public, anon;
grant execute on function public.publicar_calificaciones(jsonb) to authenticated;

-- Lectura para la app del alumno (ajústala a cómo se identifican en FullStatus Student).
-- Ejemplo si el alumno inicia sesión con un claim "matricula" en user_metadata:
-- create policy calificaciones_alumno on public.calificaciones for select to authenticated
--   using (matricula = auth.jwt() -> 'user_metadata' ->> 'matricula');
