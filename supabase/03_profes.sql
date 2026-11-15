-- =====================================================================
-- CUAAK RESPONDE · Profes (reseñas anónimas)
-- Correr UNA vez en Supabase → SQL Editor → New query → Run
-- (después de 01_campus.sql; usa la función es_admin() de ahí).
-- =====================================================================

create table if not exists public.resenas (
  id             bigint generated always as identity primary key,
  profe          text not null check (profe ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(profe) <= 120),
  materia_clave  text check (materia_clave is null or materia_clave ~ '^[A-Z0-9]{3,8}$'),
  ciclo          text check (ciclo is null or ciclo ~ '^(20[0-9]{2}[AB]|antes)$'),
  calidad        smallint not null check (calidad between 1 and 5),
  dificultad     smallint not null check (dificultad between 1 and 5),
  volveria       boolean  not null,
  etiquetas      text[]   not null default '{}' check (cardinality(etiquetas) <= 3 and etiquetas <@ array[
                   'explica_bien','dinamica','retroalimentacion','accesible','justo','flexible','criterios_claros',
                   'inspira','mucha_tarea','muchos_proyectos','examenes_dificiles','exigente','asistencia','impuntual']),
  comentario     text not null check (char_length(comentario) between 20 and 1500),
  oculta         boolean not null default false,
  huella         text,
  creada         timestamptz not null default now()
);
create index if not exists resenas_profe_idx on public.resenas (profe, creada desc);
alter table public.resenas enable row level security;

drop policy if exists "admin lee resenas" on public.resenas;
drop policy if exists "admin cambia resenas" on public.resenas;
drop policy if exists "admin borra resenas" on public.resenas;
create policy "admin lee resenas"    on public.resenas for select to authenticated using (public.es_admin());
create policy "admin cambia resenas" on public.resenas for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "admin borra resenas"  on public.resenas for delete to authenticated using (public.es_admin());

create table if not exists public.resena_utiles (
  resena_id bigint not null references public.resenas(id) on delete cascade,
  huella    text   not null,
  creado    timestamptz not null default now(),
  primary key (resena_id, huella)
);
alter table public.resena_utiles enable row level security;

create table if not exists public.resena_abusos (
  resena_id bigint not null references public.resenas(id) on delete cascade,
  huella    text   not null,
  creado    timestamptz not null default now(),
  primary key (resena_id, huella)
);
alter table public.resena_abusos enable row level security;
drop policy if exists "admin lee abusos resenas" on public.resena_abusos;
drop policy if exists "admin borra abusos resenas" on public.resena_abusos;
create policy "admin lee abusos resenas"   on public.resena_abusos for select to authenticated using (public.es_admin());
create policy "admin borra abusos resenas" on public.resena_abusos for delete to authenticated using (public.es_admin());

-- ---------- vistas públicas ----------
drop view if exists public.resenas_publicas;
create view public.resenas_publicas as
select r.id, r.profe, r.materia_clave, r.ciclo, r.calidad, r.dificultad, r.volveria, r.etiquetas, r.comentario, r.creada,
       (select count(*) from public.resena_utiles u where u.resena_id = r.id) as utiles
from public.resenas r
where not r.oculta;

drop view if exists public.profes_resumen;
create view public.profes_resumen as
select profe,
       count(*)                                         as n,
       round(avg(calidad)::numeric, 1)                  as calidad,
       round(avg(dificultad)::numeric, 1)               as dificultad,
       round(100.0 * avg(case when volveria then 1 else 0 end))::int as volveria
from public.resenas
where not oculta
group by profe;

-- ---------- funciones para cualquiera (anónimo) ----------
create or replace function public.crear_resena(
  p_profe text, p_materia text, p_ciclo text, p_calidad int, p_dificultad int,
  p_volveria boolean, p_etiquetas text[], p_comentario text, p_huella text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_txt text := translate(lower(coalesce(p_comentario, '')), 'áéíóúüñ', 'aeiouun');
begin
  if char_length(coalesce(p_huella,'')) not between 8 and 64 then raise exception 'Falta identificador del dispositivo'; end if;
  -- nada de datos personales ni insultos
  if v_txt ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then raise exception 'No incluyas correos en la reseña'; end if;
  if v_txt ~ '(\d[\s.-]?){10}' then raise exception 'No incluyas teléfonos en la reseña'; end if;
  if v_txt ~ '\m(pendej\w*|put[oa]s?|idiota\w*|estupid\w*|imbecil\w*|culer[oa]s?|mamon\w*|verga\w*|naco\w*|zorra\w*|marica\w*|jot[oa]s?|retrasad\w*|mierda\w*|gord[oa]s?)\M' then
    raise exception 'Tu reseña tiene palabras ofensivas. Opina sobre la clase sin insultos.';
  end if;
  if exists (select 1 from resenas where huella = p_huella and profe = p_profe and creada > now() - interval '120 days') then
    raise exception 'Ya publicaste una reseña de este profe hace poco';
  end if;
  if (select count(*) from resenas where huella = p_huella and creada > now() - interval '1 day') >= 8 then
    raise exception 'Llegaste al límite de reseñas por hoy';
  end if;
  if (select count(*) from resenas where creada > now() - interval '10 minutes') >= 80 then
    raise exception 'Hay muchas reseñas en este momento; intenta en unos minutos';
  end if;
  insert into resenas (profe, materia_clave, ciclo, calidad, dificultad, volveria, etiquetas, comentario, huella)
  values (p_profe, nullif(upper(trim(p_materia)), ''), nullif(p_ciclo, ''), p_calidad, p_dificultad, p_volveria,
          coalesce(p_etiquetas, '{}'), trim(p_comentario), p_huella)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.marcar_util(p_id bigint, p_huella text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_huella,'')) not between 8 and 64 then raise exception 'Falta identificador del dispositivo'; end if;
  if not exists (select 1 from resenas where id = p_id and not oculta) then raise exception 'No existe'; end if;
  insert into resena_utiles (resena_id, huella) values (p_id, p_huella) on conflict do nothing;
end $$;

create or replace function public.reportar_resena(p_id bigint, p_huella text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_huella,'')) not between 8 and 64 then raise exception 'Falta identificador del dispositivo'; end if;
  if (select count(*) from resena_abusos where huella = p_huella and creado > now() - interval '1 day') >= 10 then
    raise exception 'Ya reportaste varias reseñas hoy';
  end if;
  insert into resena_abusos (resena_id, huella) values (p_id, p_huella) on conflict do nothing;
  update resenas set oculta = true where id = p_id;
end $$;

-- ---------- permisos ----------
revoke all on public.resenas, public.resena_utiles, public.resena_abusos from anon;
revoke all on public.resenas_publicas, public.profes_resumen from anon, authenticated;
grant select on public.resenas_publicas, public.profes_resumen to anon, authenticated;
grant select, update, delete on public.resenas to authenticated;
grant select, delete on public.resena_abusos to authenticated;
revoke all on function public.crear_resena(text,text,text,int,int,boolean,text[],text,text),
                public.marcar_util(bigint,text), public.reportar_resena(bigint,text) from public;
grant execute on function public.crear_resena(text,text,text,int,int,boolean,text[],text,text),
                public.marcar_util(bigint,text), public.reportar_resena(bigint,text) to anon, authenticated;
