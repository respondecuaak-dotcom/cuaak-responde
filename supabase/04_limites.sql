-- =====================================================================
-- CUAAK RESPONDE · subir los límites generales anti-spam
--   reportes del campus: 200 cada 10 minutos (antes 60)
--   reseñas de profes:   500 cada 10 minutos (antes 80)
-- Correr en Supabase → SQL Editor → New query → Run.
-- Solo reemplaza estas dos funciones; no toca tablas ni datos.
-- (01_campus.sql y 03_profes.sql ya traen estos valores.)
-- =====================================================================
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
  if (select count(*) from resenas where creada > now() - interval '10 minutes') >= 500 then
    raise exception 'Hay muchas reseñas en este momento; intenta en unos minutos';
  end if;
  insert into resenas (profe, materia_clave, ciclo, calidad, dificultad, volveria, etiquetas, comentario, huella)
  values (p_profe, nullif(upper(trim(p_materia)), ''), nullif(p_ciclo, ''), p_calidad, p_dificultad, p_volveria,
          coalesce(p_etiquetas, '{}'), trim(p_comentario), p_huella)
  returning id into v_id;
  return v_id;
end $$;
