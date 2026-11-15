-- =====================================================================
-- CUAAK RESPONDE · Campus (reportes de cosas que no funcionan)
-- Correr UNA vez en Supabase → SQL Editor → New query → Run.
-- Seguro de volver a correr: borra y recrea solo lo de este módulo
-- (las situaciones ya guardadas se conservan).
-- =====================================================================

-- ---------- administradores ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admin ve admins" on public.admins;
create policy "admin ve admins" on public.admins for select to authenticated using (public.es_admin());

-- ---------- situaciones (cada reporte) ----------
create table if not exists public.situaciones (
  id            bigint generated always as identity primary key,
  categoria     text not null check (categoria in
                  ('banos','iluminacion','mobiliario','material','limpieza','internet',
                   'agua','accesibilidad','seguridad','areas_verdes','otro')),
  lugar         text not null check (char_length(lugar) between 2 and 120),
  descripcion   text not null check (char_length(descripcion) between 10 and 1000),
  foto_path     text,
  foto_estado   text not null default 'ninguna'
                  check (foto_estado in ('ninguna','pendiente','aprobada','rechazada')),
  estado        text not null default 'reportado'
                  check (estado in ('reportado','oficio','proceso','solucionado')),
  oficio_path   text,
  video_url     text check (video_url is null or video_url ~* '^https://(www\.)?instagram\.com/'),
  nota          text check (nota is null or char_length(nota) <= 500),  -- nota pública del equipo
  oculta        boolean not null default false,   -- oculta por reporte de abuso o por ti
  duplicado_de  bigint references public.situaciones(id) on delete set null,
  huella        text,                              -- id aleatorio del dispositivo (no identifica a nadie)
  creada        timestamptz not null default now(),
  actualizada   timestamptz not null default now()
);
create index if not exists situaciones_creada_idx on public.situaciones (creada desc);
alter table public.situaciones enable row level security;

drop policy if exists "admin lee situaciones" on public.situaciones;
drop policy if exists "admin cambia situaciones" on public.situaciones;
drop policy if exists "admin borra situaciones" on public.situaciones;
create policy "admin lee situaciones"    on public.situaciones for select to authenticated using (public.es_admin());
create policy "admin cambia situaciones" on public.situaciones for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "admin borra situaciones"  on public.situaciones for delete to authenticated using (public.es_admin());

create or replace function public.tocar_actualizada() returns trigger language plpgsql as $$
begin new.actualizada := now(); return new; end $$;
drop trigger if exists situaciones_actualizada on public.situaciones;
create trigger situaciones_actualizada before update on public.situaciones
  for each row execute function public.tocar_actualizada();

-- ---------- "a mí también me afecta" ----------
create table if not exists public.afectados (
  situacion_id bigint not null references public.situaciones(id) on delete cascade,
  huella       text   not null,
  creado       timestamptz not null default now(),
  primary key (situacion_id, huella)
);
alter table public.afectados enable row level security;
drop policy if exists "admin lee afectados" on public.afectados;
create policy "admin lee afectados" on public.afectados for select to authenticated using (public.es_admin());

-- ---------- reportes de abuso (ocultan la situación) ----------
create table if not exists public.abusos (
  situacion_id bigint not null references public.situaciones(id) on delete cascade,
  huella       text   not null,
  creado       timestamptz not null default now(),
  primary key (situacion_id, huella)
);
alter table public.abusos enable row level security;
drop policy if exists "admin lee abusos" on public.abusos;
drop policy if exists "admin borra abusos" on public.abusos;
create policy "admin lee abusos"   on public.abusos for select to authenticated using (public.es_admin());
create policy "admin borra abusos" on public.abusos for delete to authenticated using (public.es_admin());

-- ---------- vista pública del tablero ----------
-- Solo lo visible: sin huella, sin fotos pendientes, sin ocultas ni duplicadas.
drop view if exists public.tablero;
create view public.tablero as
select s.id, s.categoria, s.lugar, s.descripcion,
       case when s.foto_estado = 'aprobada' then s.foto_path end as foto_path,
       s.estado, s.oficio_path, s.video_url, s.nota, s.creada, s.actualizada,
       (select count(distinct a.huella) from public.afectados a
          where a.situacion_id = s.id
             or a.situacion_id in (select d.id from public.situaciones d where d.duplicado_de = s.id)) as afectados
from public.situaciones s
where not s.oculta and s.duplicado_de is null;

-- ---------- funciones que puede usar cualquiera (anónimo) ----------
create or replace function public.crear_situacion(
  p_categoria text, p_lugar text, p_descripcion text, p_foto_path text, p_huella text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if char_length(coalesce(p_huella,'')) not between 8 and 64 then raise exception 'Falta identificador del dispositivo'; end if;
  if p_foto_path is not null and p_foto_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then
    raise exception 'Foto no válida';
  end if;
  if (select count(*) from situaciones where huella = p_huella and creada > now() - interval '1 hour') >= 5 then
    raise exception 'Ya enviaste varios reportes; intenta en un rato';
  end if;
  if (select count(*) from situaciones where creada > now() - interval '10 minutes') >= 200 then
    raise exception 'Hay muchos reportes en este momento; intenta en unos minutos';
  end if;
  insert into situaciones (categoria, lugar, descripcion, foto_path, foto_estado, huella)
  values (p_categoria, trim(p_lugar), trim(p_descripcion), p_foto_path,
          case when p_foto_path is null then 'ninguna' else 'pendiente' end, p_huella)
  returning id into v_id;
  insert into afectados (situacion_id, huella) values (v_id, p_huella) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.sumar_afectado(p_id bigint, p_huella text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_huella,'')) not between 8 and 64 then raise exception 'Falta identificador del dispositivo'; end if;
  if not exists (select 1 from situaciones where id = p_id and not oculta) then raise exception 'No existe'; end if;
  insert into afectados (situacion_id, huella) values (p_id, p_huella) on conflict do nothing;
end $$;

create or replace function public.reportar_abuso(p_id bigint, p_huella text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_huella,'')) not between 8 and 64 then raise exception 'Falta identificador del dispositivo'; end if;
  if (select count(*) from abusos where huella = p_huella and creado > now() - interval '1 day') >= 10 then
    raise exception 'Ya reportaste varias publicaciones hoy';
  end if;
  insert into abusos (situacion_id, huella) values (p_id, p_huella) on conflict do nothing;
  update situaciones set oculta = true where id = p_id;
end $$;

-- ---------- permisos ----------
revoke all on public.situaciones, public.afectados, public.abusos, public.admins from anon;
revoke all on public.tablero from anon, authenticated;
grant select on public.tablero to anon, authenticated;
grant select, update, delete on public.situaciones to authenticated;   -- limitado por las reglas de arriba
grant select on public.afectados, public.admins to authenticated;
grant select, delete on public.abusos to authenticated;
revoke all on function public.crear_situacion(text,text,text,text,text), public.sumar_afectado(bigint,text),
                public.reportar_abuso(bigint,text) from public;
grant execute on function public.crear_situacion(text,text,text,text,text), public.sumar_afectado(bigint,text),
                public.reportar_abuso(bigint,text) to anon, authenticated;
grant execute on function public.es_admin() to authenticated;

-- ---------- archivos: fotos y oficios ----------
-- Fotos: carpeta pública, pero el nombre es aleatorio y solo se muestra cuando la apruebas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 3145728, array['image/jpeg']),
       ('oficios', 'oficios', true, 10485760, array['application/pdf'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cualquiera sube foto" on storage.objects;
drop policy if exists "admin maneja fotos" on storage.objects;
drop policy if exists "admin maneja oficios" on storage.objects;
create policy "cualquiera sube foto" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'fotos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');
create policy "admin maneja fotos" on storage.objects for all to authenticated
  using (bucket_id = 'fotos' and public.es_admin()) with check (bucket_id = 'fotos' and public.es_admin());
create policy "admin maneja oficios" on storage.objects for all to authenticated
  using (bucket_id = 'oficios' and public.es_admin()) with check (bucket_id = 'oficios' and public.es_admin());
