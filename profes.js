/* CUAAK RESPONDE — Profes: reseñas anónimas */
(() => {
  "use strict";
  const { sb, ETIQUETAS, CICLOS, $, el, ls, huella, toast, hace, mensajeError } = window.CK;
  const P = window.PROFES || { carreras: {}, lista: [] };
  const PAGINA = 40;
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const titulo = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const porSlug = new Map(P.lista.map((p) => [p.s, p]));
  for (const p of P.lista) p.texto = norm(`${p.n} ${p.m.map((m) => m[1] + " " + m[0]).join(" ")}`);

  let resumen = {};            // slug -> {n, calidad, dificultad, volveria}
  let actual = null, resenas = [], ordenR = "recientes";
  let q = "", carrera = ls.get("cuaak.profes.carrera", ""), orden = "nombre", limite = PAGINA;
  const utiles = new Set(ls.get("cuaak.utiles", []));

  const tono = (v) => (v >= 4 ? "alto" : v >= 3 ? "medio" : "bajo");

  /* ---------------- datos ---------------- */
  async function cargarResumen() {
    if (!sb) return;
    const { data, error } = await sb.from("profes_resumen").select("*");
    if (error) { toast("No se pudieron cargar las calificaciones: " + mensajeError(error), true); return; }
    resumen = Object.fromEntries(data.map((r) => [r.profe, r]));
    const total = data.reduce((t, r) => t + r.n, 0);
    $("#meta").textContent = `${P.lista.length} profes · ${total} ${total === 1 ? "reseña" : "reseñas"}`;
    renderLista(false);
    if (actual) renderPerfil();
  }

  async function cargarResenas(slug) {
    const { data, error } = await sb.from("resenas_publicas").select("*").eq("profe", slug).order("creada", { ascending: false }).limit(500);
    if (error) { toast(mensajeError(error), true); return []; }
    return data;
  }

  /* ---------------- lista ---------------- */
  function llenarCarreras() {
    const sc = $("#p-carrera");
    const vistos = new Map();
    for (const [k, v] of Object.entries(P.carreras)) if (!vistos.has(v)) vistos.set(v, [k]); else vistos.get(v).push(k);
    [...vistos].sort((a, b) => a[0].localeCompare(b[0], "es"))
      .forEach(([nombre, claves]) => sc.append(el("option", { value: claves.join(",") }, nombre)));
    if ([...sc.options].some((o) => o.value === carrera)) sc.value = carrera; else carrera = "";
  }

  function filtrados() {
    const pal = norm(q).split(/\s+/).filter(Boolean);
    const cs = carrera ? carrera.split(",") : null;
    let l = P.lista.filter((p) => (!cs || p.c.some((c) => cs.includes(c))) && pal.every((w) => p.texto.includes(w)));
    if (orden === "mejor") l = [...l].sort((a, b) => (resumen[b.s]?.calidad || 0) - (resumen[a.s]?.calidad || 0) || (resumen[b.s]?.n || 0) - (resumen[a.s]?.n || 0));
    if (orden === "resenas") l = [...l].sort((a, b) => (resumen[b.s]?.n || 0) - (resumen[a.s]?.n || 0));
    return l;
  }

  function renderLista(reset = true) {
    if (reset) limite = PAGINA;
    const l = filtrados();
    $("#p-conteo").textContent = `${l.length} ${l.length === 1 ? "profe" : "profes"}`;
    const cont = $("#p-lista");
    if (!l.length) {
      cont.replaceChildren(el("div", { class: "vacio" }, el("b", {}, "No encontré a nadie"), "Prueba con el apellido o con el nombre de la materia."));
      $("#p-mas").hidden = true;
      return;
    }
    cont.replaceChildren(...l.slice(0, limite).map((p) => {
      const r = resumen[p.s];
      return el("button", {
        class: "profe-item" + (actual?.s === p.s ? " activo" : ""), type: "button", role: "listitem",
        onclick: () => abrir(p.s, true),
      },
        el("span", { class: "pi-nombre" }, p.n),
        el("span", { class: "pi-info" }, `${p.m.length} ${p.m.length === 1 ? "materia" : "materias"} este ciclo`),
        r ? el("span", { class: `nota-chica ${tono(r.calidad)}` }, `★ ${Number(r.calidad).toFixed(1)}`, el("small", {}, ` (${r.n})`))
          : el("span", { class: "nota-chica sin" }, "Sin reseñas"));
    }));
    $("#p-mas").hidden = l.length <= limite;
  }

  /* ---------------- perfil ---------------- */
  async function abrir(slug, desdeLista = false) {
    const p = porSlug.get(slug);
    if (!p) return;
    actual = p;
    try { history.replaceState(null, "", `#p=${slug}`); } catch { location.hash = `p=${slug}`; }
    renderLista(false);
    $("#perfil-cont").replaceChildren(el("div", { class: "vacio grande" }, el("b", {}, p.n), "Cargando reseñas…"));
    if (desdeLista && matchMedia("(max-width: 960px)").matches) $("#perfil").scrollIntoView({ behavior: "smooth" });
    resenas = sb ? await cargarResenas(slug) : [];
    if (actual !== p) return;
    renderPerfil();
  }

  function nombreMateria(clave) {
    const m = actual.m.find((x) => x[0] === clave);
    return m ? titulo(m[1]) : clave;
  }

  function renderPerfil(conForm = false) {
    const p = actual, r = resumen[p.s];
    const cuentaEt = {};
    for (const x of resenas) for (const e of x.etiquetas) cuentaEt[e] = (cuentaEt[e] || 0) + 1;
    const topEt = Object.entries(cuentaEt).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const lista = [...resenas].sort(ordenR === "utiles"
      ? (a, b) => b.utiles - a.utiles || new Date(b.creada) - new Date(a.creada)
      : (a, b) => new Date(b.creada) - new Date(a.creada));

    $("#perfil-cont").replaceChildren(...[
      el("div", { class: "panel-head" },
        el("h2", { class: "perfil-nombre" }, p.n),
        el("button", { class: "btn add", type: "button", onclick: () => mostrarForm() }, "Escribir reseña")),
      el("div", { class: "perfil-materias" }, p.m.map((m) => el("span", { class: "pill" }, titulo(m[1])))),
      r ? el("div", { class: "stats perfil-stats" },
        el("div", { class: `nota ${tono(r.calidad)}` }, el("b", {}, Number(r.calidad).toFixed(1)), el("span", {}, "calidad")),
        el("div", {}, el("b", {}, Number(r.dificultad).toFixed(1)), el("span", {}, "dificultad")),
        el("div", {}, el("b", {}, `${r.volveria}%`), el("span", {}, "lo volvería a tomar")),
        el("div", {}, el("b", {}, r.n), el("span", {}, r.n === 1 ? "reseña" : "reseñas")))
        : el("p", { class: "perfil-sin" }, "Todavía nadie opina de este profe. ¡Sé la primera persona!"),
      topEt.length ? el("div", { class: "perfil-etiquetas" }, topEt.map(([e, n]) => el("span", { class: "pill" }, `${ETIQUETAS[e] || e} · ${n}`))) : null,
      el("div", { id: "form-box" }),
      resenas.length ? el("div", { class: "resenas-head" },
        el("h3", {}, "Reseñas"),
        el("select", { class: "orden", "aria-label": "Ordenar reseñas", onchange: (e) => { ordenR = e.target.value; renderPerfil(); } },
          el("option", { value: "recientes", selected: ordenR === "recientes" }, "Más recientes"),
          el("option", { value: "utiles", selected: ordenR === "utiles" }, "Más útiles"))) : null,
      el("div", { class: "resenas" }, lista.map(tarjetaResena))].filter(Boolean));
    if (conForm) mostrarForm();
  }

  function tarjetaResena(x) {
    const ya = utiles.has(x.id);
    const ciclo = CICLOS.find((c) => c[0] === x.ciclo)?.[1];
    return el("article", { class: "resena" },
      el("div", { class: "resena-top" },
        el("span", { class: `nota-chica ${tono(x.calidad)}` }, `★ ${x.calidad}`),
        el("span", { class: "pill" }, `Dificultad ${x.dificultad}/5`),
        x.materia_clave ? el("span", { class: "resena-materia" }, nombreMateria(x.materia_clave)) : null,
        ciclo ? el("span", { class: "resena-ciclo" }, ciclo) : null),
      x.etiquetas.length ? el("div", { class: "resena-etiquetas" }, x.etiquetas.map((e) => el("span", { class: "pill" }, ETIQUETAS[e] || e))) : null,
      el("p", { class: "resena-txt" }, x.comentario),
      el("div", { class: "caso-pie" },
        el("span", {}, "¿Lo volvería a tomar? ", el("b", {}, x.volveria ? "Sí" : "No")),
        el("button", { class: "btn sm" + (ya ? " ghost" : ""), type: "button", disabled: ya, onclick: (e) => util(x, e.currentTarget) },
          `${ya ? "✓ " : ""}Me sirvió${x.utiles ? ` · ${x.utiles}` : ""}`),
        el("span", { class: "caso-fecha" }, hace(x.creada)),
        el("button", { class: "link reportar-abuso", type: "button", onclick: () => reportar(x) }, "Reportar")));
  }

  async function util(x, btn) {
    btn.disabled = true;
    const { error } = await sb.rpc("marcar_util", { p_id: x.id, p_huella: huella });
    if (error) { btn.disabled = false; return toast(mensajeError(error), true); }
    utiles.add(x.id); ls.set("cuaak.utiles", [...utiles]);
    x.utiles += 1;
    renderPerfil();
  }

  async function reportar(x) {
    if (!confirm("¿Esta reseña tiene insultos, datos personales, comentarios sobre el físico o la vida personal, o no es sobre la clase?\n\nSe ocultará de inmediato hasta que el equipo la revise.")) return;
    const { error } = await sb.rpc("reportar_resena", { p_id: x.id, p_huella: huella });
    if (error) return toast(mensajeError(error), true);
    resenas = resenas.filter((y) => y.id !== x.id);
    toast("Gracias. La reseña se ocultó y el equipo la revisará.");
    await cargarResumen();
    renderPerfil();
  }

  /* ---------------- formulario ---------------- */
  function escala(nombre, etiquetaMin, etiquetaMax, estrellas) {
    const grupo = el("div", { class: "escala", role: "radiogroup", "aria-label": nombre });
    for (let i = 1; i <= 5; i++) {
      grupo.append(el("label", { class: "escala-op" },
        el("input", { type: "radio", name: nombre, value: String(i) }),
        el("span", {}, estrellas ? "★".repeat(i) : String(i))));
    }
    return el("div", { class: "escala-wrap" }, grupo, el("div", { class: "escala-ext" }, el("span", {}, etiquetaMin), el("span", {}, etiquetaMax)));
  }

  function mostrarForm() {
    const box = $("#form-box");
    if (!box) return;
    if (box.firstChild) { box.firstChild.querySelector("select")?.focus(); return; }
    const p = actual;
    const sm = el("select", { id: "f-materia" }, el("option", { value: "" }, "Elige la materia"),
      p.m.map((m) => el("option", { value: m[0] }, titulo(m[1]))), el("option", { value: "-" }, "Otra / no aparece"));
    const sc = el("select", { id: "f-ciclo" }, el("option", { value: "" }, "¿Cuándo la tomaste?"), CICLOS.map(([v, n]) => el("option", { value: v }, n)));
    const etiquetas = el("div", { class: "chips", id: "f-etiquetas" }, Object.entries(ETIQUETAS).map(([k, n]) =>
      el("button", { class: "chip", type: "button", "aria-pressed": "false", "data-k": k, onclick: (e) => {
        const b = e.currentTarget, on = b.getAttribute("aria-pressed") === "true";
        if (!on && box.querySelectorAll('#f-etiquetas [aria-pressed="true"]').length >= 3) return toast("Máximo 3 etiquetas.");
        b.setAttribute("aria-pressed", String(!on));
      } }, n)));
    const txt = el("textarea", { id: "f-txt", rows: "5", maxlength: "1500",
      placeholder: "¿Cómo da la clase? ¿Qué tal sus proyectos, entregas y forma de calificar? ¿Qué le recomendarías a alguien que la va a tomar?" });
    const cuenta = el("small", { class: "contador" }, "0/1500");
    txt.addEventListener("input", () => (cuenta.textContent = `${txt.value.length}/1500`));

    const form = el("form", { class: "form-resena filtros", novalidate: true },
      el("h3", { class: "ancho" }, `Tu reseña de ${p.n}`),
      el("label", { class: "campo" }, el("span", {}, "Materia"), sm),
      el("label", { class: "campo" }, el("span", {}, "Ciclo"), sc),
      el("div", { class: "campo ancho" }, el("span", {}, "Calidad general"), escala("f-calidad", "Muy mala", "Excelente", true)),
      el("div", { class: "campo ancho" }, el("span", {}, "Dificultad"), escala("f-dificultad", "Muy fácil", "Muy difícil", false)),
      el("div", { class: "campo ancho" }, el("span", {}, "¿Lo volverías a tomar?"),
        el("div", { class: "chips" },
          el("label", { class: "escala-op si-no" }, el("input", { type: "radio", name: "f-volveria", value: "1" }), el("span", {}, "Sí")),
          el("label", { class: "escala-op si-no" }, el("input", { type: "radio", name: "f-volveria", value: "0" }), el("span", {}, "No")))),
      el("div", { class: "campo ancho" }, el("span", {}, "Etiquetas (hasta 3, opcional)"), etiquetas),
      el("label", { class: "campo ancho" }, el("span", {}, "Tu opinión"), txt, cuenta),
      el("div", { class: "reglas ancho" },
        el("b", {}, "Reglas"),
        el("ul", {},
          el("li", {}, "Es anónimo: no se guarda tu nombre, correo ni cuenta."),
          el("li", {}, "Opina sobre cómo da la clase. Nada de insultos, aspecto físico ni vida personal."),
          el("li", {}, "No pongas correos, teléfonos ni nombres de compañeros."),
          el("li", {}, el("b", {}, "Acoso, abuso u otras acusaciones graves no van aquí: "), "acude a la Defensoría de los Derechos Universitarios de la UdeG, donde sí pueden actuar."))),
      el("div", { class: "adm-acciones ancho" },
        el("button", { class: "btn add", type: "submit" }, "Publicar reseña"),
        el("button", { class: "btn ghost", type: "button", onclick: () => box.replaceChildren() }, "Cancelar")));

    form.addEventListener("submit", (e) => { e.preventDefault(); enviar(form); });
    box.replaceChildren(form);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function enviar(form) {
    const val = (n) => form.querySelector(`input[name="${n}"]:checked`)?.value;
    const materia = form.querySelector("#f-materia").value;
    const calidad = Number(val("f-calidad")), dificultad = Number(val("f-dificultad")), volveria = val("f-volveria");
    const comentario = form.querySelector("#f-txt").value.trim();
    const etiquetas = [...form.querySelectorAll('#f-etiquetas [aria-pressed="true"]')].map((b) => b.dataset.k);
    if (!materia) return toast("Elige la materia que tomaste.", true);
    if (!calidad) return toast("Califica la calidad (de 1 a 5 estrellas).", true);
    if (!dificultad) return toast("Indica la dificultad (1 a 5).", true);
    if (volveria == null) return toast("¿Lo volverías a tomar? Elige Sí o No.", true);
    if (comentario.length < 10) return toast("Escribe un poco más (mínimo 10 letras).", true);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Publicando…";
    const { error } = await sb.rpc("crear_resena", {
      p_profe: actual.s, p_materia: materia === "-" ? null : materia, p_ciclo: form.querySelector("#f-ciclo").value || null,
      p_calidad: calidad, p_dificultad: dificultad, p_volveria: volveria === "1", p_etiquetas: etiquetas,
      p_comentario: comentario, p_huella: huella,
    });
    btn.disabled = false; btn.textContent = "Publicar reseña";
    if (error) return toast(mensajeError(error), true);
    toast("¡Gracias! Tu reseña ya está publicada.");
    resenas = await cargarResenas(actual.s);
    await cargarResumen();
    renderPerfil();
  }

  /* ---------------- arranque ---------------- */
  llenarCarreras();
  let qt;
  $("#p-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value; renderLista(); }, 140); });
  $("#p-carrera").addEventListener("change", (e) => { carrera = e.target.value; ls.set("cuaak.profes.carrera", carrera); renderLista(); });
  $("#p-orden").addEventListener("change", (e) => { orden = e.target.value; renderLista(); });
  $("#p-mas").addEventListener("click", () => { limite += PAGINA; renderLista(false); });
  renderLista();
  const m = /p=([a-z0-9-]+)/.exec(location.hash);
  if (m && porSlug.has(m[1])) abrir(m[1]);
  cargarResumen();
})();
