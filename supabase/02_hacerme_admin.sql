-- =====================================================================
-- CUAAK RESPONDE · darte permisos de administrador
-- 1) Supabase → Authentication → Users → Add user → Create new user
--    (tu correo anónimo + una contraseña; marca "Auto Confirm User").
-- 2) Cambia TU-CORREO abajo por ese correo y corre esto en SQL Editor.
-- =====================================================================
insert into public.admins (user_id)
select id from auth.users where email = 'TU-CORREO'
on conflict do nothing;

-- Comprobar: debe salir 1 fila con tu correo.
select u.email from public.admins a join auth.users u on u.id = a.user_id;
