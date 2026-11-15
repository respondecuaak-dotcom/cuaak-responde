/* CUAAK RESPONDE — Campus: reportar y tablero público */
(() => {
  "use strict";
  const { sb, CATEGORIAS, ESTADOS, $, el, ls, uuid, huella, toast, publico, hace, prepararFoto, mensajeError } = window.CK;
  const PAGINA = 20;
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  let casos = [];
  let filtro = "todos", q = "", orden = "recientes", limite = PAGINA;
  let fotoBlob = null;
  const votados = new Set(ls.get("cuaak.afectados", []));
  const guardarVotos = () => ls.set("cuaak.afectados", [...votados]);

  /* ---------------- tablero ---------------- */
  async function cargar() {
    if (!sb) { $("#meta").textContent = "Sin conexión con la base de datos"; return; }
    const { data, error } = await sb.from("tablero").select("*").order("creada", { ascending: false }).limit(1000);
    if (error) {
      $("#meta").textContent = "No se pudieron cargar los reportes";
      $("#casos").replaceChildren(el("div", { class: "vacio" }, el("b", {}, "No se pudo cargar el tablero"), mensajeError(error)));
      return;
    }
    casos = data;
    const abiertos = casos.filter((c) => c.estado !== "solucionado").length;
    const resueltos = casos.length - abiertos;
    $("#meta").textContent = `${casos.length} ${casos.length === 1 ? "reporte" : "reportes"} · ${resueltos} ${resueltos === 1 ? "solucionado" : "solucionados"}`;
    renderEstados();
    renderCasos();
  }

  function renderEstados() {
    const cuenta = { todos: casos.length };
    for (const c of casos) cuenta[c.estado] = (cuenta[c.estado] || 0) + 1;
    const cont = $("#t-estados");
    cont.replaceChildren(...[["todos", "Todos"], ...Object.entries(ESTADOS)].map(([k, n]) =>
      el("button", {
        class: `chip est-${k}`, type: "button", "aria-pressed": String(filtro === k),
        onclick: () => { filtro = k; limite = PAGINA; renderEstados(); renderCasos(); },
      }, `${n} · ${cuenta[k] || 0}`)));
  }

  function visibles() {
    const pal = norm(q).split(/\s+/).filter(Boolean);
    let l = casos.filter((c) => (filtro === "todos" || c.estado === filtro)
      && pal.every((p) => norm(`${c.lugar} ${c.descripcion} ${CATEGORIAS[c.categoria] || ""}`).includes(p)));
    if (orden === "afectados") l = [...l].sort((a, b) => b.afectados - a.afectados || new Date(b.creada) - new Date(a.creada));
    return l;
  }

  function tarjeta(c, compacta = false) {
    const ya = votados.has(c.id);
    const foto = publico("fotos", c.foto_path);
    const oficio = publico("oficios", c.oficio_path);
    return el("article", { class: `caso est-${c.estado}`, id: `caso-${c.id}` },
      el("div", { class: "caso-top" },
        el("span", { class: `estado est-${c.estado}` }, ESTADOS[c.estado]),
        el("span", { class: "pill" }, CATEGORIAS[c.categoria] || c.categoria),
        el("span", { class: "caso-id" }, `#${c.id}`)),
      el("h3", { class: "caso-lugar" }, c.lugar),
      compacta ? null : el("p", { class: "caso-desc" }, c.descripcion),
      foto && !compacta ? el("a", { class: "caso-foto", href: foto, target: "_blank", rel: "noopener" },
        el("img", { src: foto, alt: `Foto del reporte en ${c.lugar}`, loading: "lazy" })) : null,
      c.nota && !compacta ? el("p", { class: "caso-nota" }, el("b", {}, "Equipo CUAAK: "), c.nota) : null,
      (oficio || c.video_url) && !compacta ? el("div", { class: "caso-links" },
        oficio ? el("a", { class: "btn sm", href: oficio, target: "_blank", rel: "noopener" }, "Ver oficio (PDF)") : null,
        c.video_url ? el("a", { class: "btn sm add", href: c.video_url, target: "_blank", rel: "noopener" }, "Ver video en Instagram") : null) : null,
      el("div", { class: "caso-pie" },
        el("span", { class: "afect" }, el("b", {}, c.afectados), ` ${c.afectados === 1 ? "persona afectada" : "personas afectadas"}`),
        c.estado === "solucionado" ? null : el("button", {
          class: "btn sm" + (ya ? " ghost" : ""), type: "button", disabled: ya,
          onclick: (e) => meAfecta(c, e.currentTarget),
        }, ya ? "✓ Te afecta" : "A mí también"),
        el("span", { class: "caso-fecha" }, hace(c.creada)),
        compacta ? null : el("button", { class: "link reportar-abuso", type: "button", onclick: () => reportarAbuso(c) }, "Reportar")));
  }

  function renderCasos() {
    const cont = $("#casos");
    const l = visibles();
    if (!l.length) {
      cont.replaceChildren(el("div", { class: "vacio" },
        el("b", {}, casos.length ? "Nada con ese filtro" : "Aún no hay reportes"),
        casos.length ? "Prueba con otro estado o búsqueda." : "Sé la primera persona en reportar algo."));
      $("#t-mas").hidden = true;
      return;
    }
    cont.replaceChildren(...l.slice(0, limite).map((c) => tarjeta(c)));
    $("#t-mas").hidden = l.length <= limite;
  }

  async function meAfecta(c, btn) {
    btn.disabled = true;
    const { error } = await sb.rpc("sumar_afectado", { p_id: c.id, p_huella: huella });
    if (error) { btn.disabled = false; return toast(mensajeError(error), true); }
    votados.add(c.id); guardarVotos();
    c.afectados += 1;
    renderCasos(); renderParecidos();
    toast("Sumado. Entre más personas, más peso tiene el oficio.");
  }

  async function reportarAbuso(c) {
    if (!confirm("¿Esta publicación tiene insultos, nombres de personas o no es sobre el campus?\n\nSe ocultará de inmediato hasta que el equipo la revise.")) return;
    const { error } = await sb.rpc("reportar_abuso", { p_id: c.id, p_huella: huella });
    if (error) return toast(mensajeError(error), true);
    casos = casos.filter((x) => x.id !== c.id);
    renderEstados(); renderCasos();
    toast("Gracias. La publicación se ocultó y el equipo la revisará.");
  }

  /* ---------------- reportes parecidos (evitar duplicados) ---------------- */
  function renderParecidos() {
    const box = $("#parecidos");
    const pal = norm($("#r-lugar").value).split(/[\s,.·-]+/).filter((p) => p.length >= 3);
    const cat = $("#r-cat").value;
    if (!pal.length) { box.hidden = true; return; }
    const l = casos.filter((c) => c.estado !== "solucionado" && (!cat || c.categoria === cat)
      && pal.some((p) => norm(c.lugar).includes(p))).slice(0, 3);
    if (!l.length) { box.hidden = true; return; }
    box.replaceChildren(el("p", {}, el("b", {}, "¿Ya lo reportaron?"), " Si es lo mismo, súmate en lugar de crear otro:"),
      ...l.map((c) => tarjeta(c, true)));
    box.hidden = false;
  }

  /* ---------------- formulario ---------------- */
  function conectarForm() {
    const sc = $("#r-cat");
    for (const [k, v] of Object.entries(CATEGORIAS)) sc.append(el("option", { value: k }, v));
    let pt;
    const parecidos = () => { clearTimeout(pt); pt = setTimeout(renderParecidos, 200); };
    $("#r-lugar").addEventListener("input", parecidos);
    sc.addEventListener("change", parecidos);
    $("#r-desc").addEventListener("input", (e) => ($("#r-cuenta").textContent = e.target.value.length));

    $("#r-foto").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      $("#foto-txt").textContent = "Preparando foto…";
      try {
        fotoBlob = await prepararFoto(f);
        const prev = $("#foto-prev");
        prev.src = URL.createObjectURL(fotoBlob); prev.hidden = false;
        $("#foto-txt").textContent = "Cambiar foto";
        $("#foto-quitar").hidden = false;
      } catch {
        fotoBlob = null;
        $("#foto-txt").textContent = "+ Agregar foto";
        toast("No se pudo leer esa imagen. Prueba con otra (JPG o PNG).", true);
      }
      e.target.value = "";
    });
    $("#foto-quitar").addEventListener("click", () => {
      fotoBlob = null;
      $("#foto-prev").hidden = true; $("#foto-prev").removeAttribute("src");
      $("#foto-txt").textContent = "+ Agregar foto";
      $("#foto-quitar").hidden = true;
    });

    $("#form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const cat = $("#r-cat").value, lugar = $("#r-lugar").value.trim(), desc = $("#r-desc").value.trim();
      if (!cat) return falta("#r-cat", "Elige qué tipo de problema es.");
      if (lugar.length < 2) return falta("#r-lugar", "Escribe dónde está el problema.");
      if (desc.length < 10) return falta("#r-desc", "Cuéntanos un poco más (mínimo 10 letras).");
      if (!sb) return toast("Sin conexión con la base de datos.", true);

      const btn = $("#enviar");
      btn.disabled = true; btn.textContent = "Enviando…";
      try {
        let path = null;
        if (fotoBlob) {
          path = `${uuid()}.jpg`;
          const up = await sb.storage.from("fotos").upload(path, fotoBlob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
          if (up.error) throw up.error;
        }
        const { data: id, error } = await sb.rpc("crear_situacion", {
          p_categoria: cat, p_lugar: lugar, p_descripcion: desc, p_foto_path: path, p_huella: huella,
        });
        if (error) throw error;
        votados.add(id); guardarVotos();
        $("#form").reset(); $("#r-cuenta").textContent = "0"; $("#foto-quitar").click(); $("#parecidos").hidden = true;
        toast(path ? "¡Reporte enviado! La foto aparecerá cuando el equipo la revise." : "¡Reporte enviado! Ya está en el tablero.");
        await cargar();
        $(`#caso-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (err) {
        toast(mensajeError(err), true);
      } finally {
        btn.disabled = false; btn.textContent = "Enviar reporte";
      }
    });
  }
  function falta(sel, msg) { toast(msg, true); $(sel).focus(); }

  /* ---------------- arranque ---------------- */
  conectarForm();
  $("#t-orden").addEventListener("change", (e) => { orden = e.target.value; renderCasos(); });
  let qt;
  $("#t-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value; limite = PAGINA; renderCasos(); }, 150); });
  $("#t-mas").addEventListener("click", () => { limite += PAGINA; renderCasos(); });
  if (location.hash === "#reportar") setTimeout(() => $("#r-cat").focus({ preventScroll: true }), 300);
  cargar();
})();
