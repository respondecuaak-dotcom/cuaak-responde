-- =====================================================================
-- CUAAK RESPONDE · reseñas: mínimo de 10 letras (antes 20)
-- Correr en Supabase → SQL Editor → New query → Run.
-- No borra ni cambia ninguna reseña.
-- =====================================================================
alter table public.resenas drop constraint if exists resenas_comentario_check;
alter table public.resenas add constraint resenas_comentario_check
  check (char_length(comentario) between 10 and 1500);
