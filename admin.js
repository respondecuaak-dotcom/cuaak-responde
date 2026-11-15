/* CUAAK RESPONDE — panel privado del equipo */
(() => {
  "use strict";
  const { sb, CATEGORIAS, ESTADOS, $, el, toast, publico, hace, mensajeError } = window.CK;
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  let casos = [], afect = {}, abusos = {};
  let filtro = "revisar", q = "";

  /* ---------------- sesión ---------------- */
  async function iniciar() {
    const { data } = await sb.auth.getSession();
    if (data.session && await esAdmin()) return mostrarPanel(data.session);
    $("#login").hidden = false;
  }
  async function esAdmin() {
    const { data, error } = await sb.rpc("es_admin");
    return !error && data === true;
  }
  $("#f-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#l-btn"); btn.disabled = true; btn.textContent = "Entrando…";
    const { data, error } = await sb.auth.signInWithPassword({ email: $("#l-correo").value.trim(), password: $("#l-pass").value });
    btn.disabled = false; btn.textContent = "Entrar";
    if (error) return toast("Correo o contraseña incorrectos.", true);
    if (!(await esAdmin())) { await sb.auth.signOut(); return toast("Esta cuenta no tiene permisos de administrador.", true); }
    $("#l-pass").value = "";
    mostrarPanel(data.session);
  });
  $("#salir").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  async function mostrarPanel(sesion) {
    $("#login").hidden = true; $("#panel").hidden = false;
    $("#quien").textContent = sesion.user.email;
    await cargar();
  }

  /* ---------------- datos ---------------- */
  async function cargar() {
    const [s, a, b] = await Promise.all([
      sb.from("situaciones").select("*").order("creada", { ascending: false }).limit(2000),
      sb.from("afectados").select("situacion_id").limit(50000),
      sb.from("abusos").select("situacion_id").limit(50000),
    ]);
    if (s.error) return toast(mensajeError(s.error), true);
    casos = s.data;
    afect = {}; abusos = {};
    for (const r of a.data || []) afect[r.situacion_id] = (afect[r.situacion_id] || 0) + 1;
    for (const r of b.data || []) abusos[r.situacion_id] = (abusos[r.situacion_id] || 0) + 1;
    render();
  }

  const FILTROS = {
    revisar: ["Por revisar", (c) => c.foto_estado === "pendiente" || c.oculta],
    todos: ["Todos", () => true],
    ...Object.fromEntries(Object.entries(ESTADOS).map(([k, n]) => [k, [n, (c) => c.estado === k && !c.oculta && !c.duplicado_de]])),
    ocultos: ["Ocultos", (c) => c.oculta],
  };

  function render() {
    $("#a-filtros").replaceChildren(...Object.entries(FILTROS).map(([k, [n, f]]) =>
      el("button", { class: `chip est-${k}`, type: "button", "aria-pressed": String(filtro === k),
        onclick: () => { filtro = k; render(); } }, `${n} · ${casos.filter(f).length}`)));
    const pal = norm(q).split(/\s+/).filter(Boolean);
    const l = casos.filter(FILTROS[filtro][1]).filter((c) =>
      pal.every((p) => p.startsWith("#") ? String(c.id) === p.slice(1) : norm(`${c.lugar} ${c.descripcion}`).includes(p)));
    $("#a-casos").replaceChildren(...(l.length ? l.map(tarjeta)
      : [el("div", { class: "vacio" }, el("b", {}, filtro === "revisar" ? "Todo al día ✓" : "Nada aquí"),
          filtro === "revisar" ? "No hay fotos ni publicaciones ocultas por revisar." : "")]));
  }

  /* ---------------- tarjeta editable ---------------- */
  function tarjeta(c) {
    const foto = publico("fotos", c.foto_path);
    const oficio = publico("oficios", c.oficio_path);
    const f = {};
    const campo = (lbl, nodo, ancho) => el("label", { class: "campo" + (ancho ? " ancho" : "") }, el("span", {}, lbl), nodo);

    f.estado = el("select", {}, Object.entries(ESTADOS).map(([k, n]) => el("option", { value: k, selected: c.estado === k }, n)));
    f.video = el("input", { type: "url", value: c.video_url || "", placeholder: "https://www.instagram.com/reel/…" });
    f.dup = el("input", { type: "number", min: "1", value: c.duplicado_de || "", placeholder: "Nº del reporte original" });
    f.nota = el("textarea", { rows: "2", maxlength: "500", placeholder: "Se muestra en el tablero. Ej. Oficio entregado a Servicios Generales el 20/11." }, c.nota || "");
    f.oficio = el("input", { type: "file", accept: "application/pdf" });

    return el("article", { class: `caso adm-caso est-${c.estado}` + (c.oculta ? " oculta" : "") },
      el("div", { class: "caso-top" },
        el("span", { class: `estado est-${c.estado}` }, ESTADOS[c.estado]),
        el("span", { class: "pill" }, CATEGORIAS[c.categoria] || c.categoria),
        c.oculta ? el("span", { class: "marca" }, "OCULTA") : null,
        abusos[c.id] ? el("span", { class: "marca" }, `${abusos[c.id]} reporte(s) de abuso`) : null,
        c.foto_estado === "pendiente" ? el("span", { class: "marca" }, "FOTO POR REVISAR") : null,
        c.duplicado_de ? el("span", { class: "marca gris" }, `Duplicado de #${c.duplicado_de}`) : null,
        el("span", { class: "caso-id" }, `#${c.id} · ${hace(c.creada)}`)),
      el("h3", { class: "caso-lugar" }, c.lugar),
      el("p", { class: "caso-desc" }, c.descripcion),
      el("span", { class: "afect" }, el("b", {}, afect[c.id] || 0), " personas afectadas"),

      foto && c.foto_estado !== "rechazada" ? el("div", { class: "adm-foto" },
        el("a", { href: foto, target: "_blank", rel: "noopener" }, el("img", { src: foto, alt: "Foto del reporte", loading: "lazy" })),
        el("div", { class: "adm-acciones" },
          c.foto_estado === "aprobada" ? el("span", { class: "pill hay" }, "Foto publicada") : null,
          c.foto_estado !== "aprobada" ? el("button", { class: "btn sm add", type: "button", onclick: () => foto_(c, true) }, "Aprobar foto") : null,
          el("button", { class: "btn sm ghost danger", type: "button", onclick: () => foto_(c, false) },
            c.foto_estado === "aprobada" ? "Quitar foto" : "Rechazar foto"))) : null,

      el("div", { class: "adm-grid" },
        campo("Estado", f.estado),
        campo("Video de Instagram (cuando se solucione)", f.video),
        campo("Nota pública del equipo", f.nota, true),
        el("div", { class: "campo" }, el("span", {}, "Oficio (PDF)"),
          oficio ? el("div", { class: "adm-acciones" },
            el("a", { class: "btn sm", href: oficio, target: "_blank", rel: "noopener" }, "Ver oficio"),
            el("button", { class: "btn sm ghost danger", type: "button", onclick: () => quitarOficio(c) }, "Quitar")) : null,
          f.oficio),
        campo("Es duplicado de…", f.dup)),

      el("div", { class: "adm-acciones" },
        el("button", { class: "btn sm add", type: "button", onclick: (e) => guardar(c, f, e.currentTarget) }, "Guardar cambios"),
        el("button", { class: "btn sm", type: "button", onclick: () => visibilidad(c) }, c.oculta ? "Mostrar en tablero" : "Ocultar"),
        el("button", { class: "btn sm ghost danger", type: "button", onclick: () => borrar(c) }, "Borrar definitivamente")));
  }

  /* ---------------- acciones ---------------- */
  async function actualizar(c, cambios, ok) {
    const { error } = await sb.from("situaciones").update(cambios).eq("id", c.id);
    if (error) { toast(mensajeError(error), true); return false; }
    Object.assign(c, cambios);
    if (ok) toast(ok);
    render();
    return true;
  }

  async function guardar(c, f, btn) {
    const video = f.video.value.trim() || null;
    if (video && !/^https:\/\/(www\.)?instagram\.com\//i.test(video)) return toast("El video debe ser un enlace de instagram.com", true);
    const dup = f.dup.value ? Number(f.dup.value) : null;
    if (dup && (dup === c.id || !casos.some((x) => x.id === dup))) return toast("Ese número de reporte no existe.", true);
    btn.disabled = true;
    const cambios = { estado: f.estado.value, video_url: video, nota: f.nota.value.trim() || null, duplicado_de: dup };
    try {
      const pdf = f.oficio.files[0];
      if (pdf) {
        if (pdf.type !== "application/pdf") throw new Error("El oficio debe ser PDF.");
        if (pdf.size > 10 * 1024 * 1024) throw new Error("El PDF pesa más de 10 MB.");
        const path = `caso-${c.id}-${Date.now()}.pdf`;
        const up = await sb.storage.from("oficios").upload(path, pdf, { contentType: "application/pdf", upsert: false });
        if (up.error) throw up.error;
        if (c.oficio_path) await sb.storage.from("oficios").remove([c.oficio_path]);
        cambios.oficio_path = path;
        if (cambios.estado === "reportado") cambios.estado = "oficio";
      }
      await actualizar(c, cambios, "Guardado ✓");
    } catch (err) { toast(mensajeError(err), true); }
    finally { btn.disabled = false; }
  }

  async function foto_(c, aprobar) {
    if (aprobar) return actualizar(c, { foto_estado: "aprobada" }, "Foto publicada ✓");
    if (!confirm("¿Quitar esta foto? Se borrará y no se puede recuperar.")) return;
    const r = await sb.storage.from("fotos").remove([c.foto_path]);
    if (r.error) return toast(mensajeError(r.error), true);
    actualizar(c, { foto_estado: "rechazada", foto_path: null }, "Foto quitada");
  }

  async function quitarOficio(c) {
    if (!confirm("¿Quitar el oficio de este reporte?")) return;
    await sb.storage.from("oficios").remove([c.oficio_path]);
    actualizar(c, { oficio_path: null }, "Oficio quitado");
  }

  async function visibilidad(c) {
    if (c.oculta) {
      // al regresarla se limpian los reportes de abuso, para que un nuevo reporte la vuelva a ocultar
      await sb.from("abusos").delete().eq("situacion_id", c.id);
      delete abusos[c.id];
      return actualizar(c, { oculta: false }, "Visible de nuevo en el tablero");
    }
    actualizar(c, { oculta: true }, "Oculta del tablero");
  }

  async function borrar(c) {
    if (!confirm(`¿Borrar definitivamente el reporte #${c.id}?\n\nSe eliminan también su foto y su oficio. No se puede deshacer.`)) return;
    if (c.foto_path) await sb.storage.from("fotos").remove([c.foto_path]);
    if (c.oficio_path) await sb.storage.from("oficios").remove([c.oficio_path]);
    const { error } = await sb.from("situaciones").delete().eq("id", c.id);
    if (error) return toast(mensajeError(error), true);
    casos = casos.filter((x) => x.id !== c.id);
    toast(`Reporte #${c.id} borrado`);
    render();
  }

  let qt;
  $("#a-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value; render(); }, 150); });
  if (!sb) { toast("No se pudo cargar Supabase.", true); return; }
  iniciar();
})();
