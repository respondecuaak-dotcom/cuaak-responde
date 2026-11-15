/* CUAAK RESPONDE — planificador de horarios (sin servidor) */
(() => {
  "use strict";

  const DIAS = [["L", "Lun"], ["M", "Mar"], ["I", "Mié"], ["J", "Jue"], ["V", "Vie"], ["S", "Sáb"]];
  const DIA_NOMBRE = Object.fromEntries(DIAS);
  const HUES = [14, 222, 150, 42, 285, 190, 335, 95, 255, 28, 170, 305];
  const LS_KEY = "cuaak.v1";
  const PAGINA = 40;

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  };
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const aMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  /* ---------------- almacenamiento ---------------- */
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch { return null; } },
    save(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  /* ---------------- estado ---------------- */
  let DATA = null;          // objeto OFERTA
  let byNrc = new Map();    // nrc -> sección enriquecida
  let materias = [];        // agrupadas por clave
  let colorDe = new Map();  // clave -> hue
  let limite = PAGINA;

  const guardado = store.load() || {};
  const st = {
    planes: guardado.planes && Object.keys(guardado.planes).length ? guardado.planes : { p1: { nombre: "Plan A", nrcs: [] } },
    activo: guardado.activo || "p1",
    carrera: guardado.carrera || "",
    q: "", edificio: "", aula: "", dias: new Set(),
    cupo: false, conHorario: true, libres: false,
    hl: null,
  };
  if (!st.planes[st.activo]) st.activo = Object.keys(st.planes)[0];
  const plan = () => st.planes[st.activo];
  const persistir = () => store.save({ planes: st.planes, activo: st.activo, carrera: st.carrera });

  /* ---------------- datos ---------------- */
  function parsePeriodo(p) {
    const m = /(\d{2})\/(\d{2})\/(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2})/.exec(p || "");
    if (!m) return null;
    return [+`20${m[3]}${m[2]}${m[1]}`, +`20${m[6]}${m[5]}${m[4]}`];
  }

  function cargar(d) {
    DATA = d;
    byNrc = new Map();
    const porClave = new Map();
    for (const s of d.secciones) {
      s.bloques = [];
      for (const x of s.sesiones || []) {
        if (!x.inicio || !x.fin) continue;
        const ini = aMin(x.inicio), fin = aMin(x.fin) + 1; // SIIAU usa 0700-0855: fin inclusivo
        for (const dia of x.dias) s.bloques.push({ dia, ini, fin, edificio: x.edificio, aula: x.aula, periodo: parsePeriodo(x.periodo) });
      }
      s.profs = [...new Set((s.profesores || []).map((p) => p.nombre).filter(Boolean))];
      s.prof = s.profs.join(" · ");
      s.texto = norm(`${s.materia} ${s.clave} ${s.nrc} ${s.prof}`);
      s.edificios = new Set(s.sesiones.map((x) => x.edificio).filter(Boolean));
      s.aulas = new Set(s.sesiones.map((x) => `${x.edificio}|${x.aula}`).filter((a) => a !== "|"));
      byNrc.set(s.nrc, s);
      if (!porClave.has(s.clave)) porClave.set(s.clave, { clave: s.clave, materia: s.materia, creditos: s.creditos, secciones: [] });
      porClave.get(s.clave).secciones.push(s);
    }
    materias = [...porClave.values()].sort((a, b) => a.materia.localeCompare(b.materia, "es"));
    materias.forEach((m, i) => {
      m.secciones.sort((a, b) => a.seccion.localeCompare(b.seccion));
      colorDe.set(m.clave, HUES[(i * 5) % HUES.length]);
    });
    // limpiar NRC guardados que ya no existen
    for (const p of Object.values(st.planes)) p.nrcs = p.nrcs.filter((n) => byNrc.has(n));
    if (st.carrera && !(d.carreras || {})[st.carrera]) st.carrera = "";

    llenarSelects();
    const fecha = d.generado ? new Date(d.generado).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—";
    $("#meta").textContent = `Ciclo ${d.ciclo} · ${d.secciones.length.toLocaleString("es-MX")} NRC · Datos SIIAU del ${fecha}`;
    if (d.sede) $(".eyebrow").textContent = d.sede;
    renderTodo();
  }

  function llenarSelects() {
    const sc = $("#f-carrera");
    sc.length = 1;
    const cuenta = {};
    for (const s of DATA.secciones) for (const c of s.carreras || []) cuenta[c] = (cuenta[c] || 0) + 1;
    Object.entries(DATA.carreras || {})
      .sort((a, b) => a[1].localeCompare(b[1], "es") || (cuenta[b[0]] || 0) - (cuenta[a[0]] || 0))
      .forEach(([k, v]) => sc.append(el("option", { value: k }, `${v} (${k}) · ${cuenta[k] || 0}`)));
    sc.value = st.carrera;
    llenarEdificios();
  }

  function llenarEdificios() {
    const base = DATA.secciones.filter((s) => !st.carrera || s.carreras.includes(st.carrera));
    const eds = new Map();
    for (const s of base) for (const e of s.edificios) eds.set(e, (eds.get(e) || 0) + 1);
    const se = $("#f-edificio");
    se.length = 1;
    [...eds].sort((a, b) => a[0].localeCompare(b[0])).forEach(([e, n]) => se.append(el("option", { value: e }, `${e} · ${n}`)));
    if (!eds.has(st.edificio)) st.edificio = "";
    se.value = st.edificio;
    llenarAulas(base);
  }

  function llenarAulas(base) {
    base = base || DATA.secciones.filter((s) => !st.carrera || s.carreras.includes(st.carrera));
    const aulas = new Set();
    for (const s of base) for (const a of s.aulas) { const [e] = a.split("|"); if (!st.edificio || e === st.edificio) aulas.add(a); }
    const sa = $("#f-aula");
    sa.length = 1;
    [...aulas].sort((a, b) => a.localeCompare(b, "es", { numeric: true })).forEach((a) => {
      const [e, au] = a.split("|");
      sa.append(el("option", { value: a }, st.edificio ? au : `${e} · ${au}`));
    });
    if (!aulas.has(st.aula)) st.aula = "";
    sa.value = st.aula;
  }

  /* ---------------- empalmes ---------------- */
  const periodosCruzan = (a, b) => !a || !b || (a[0] <= b[1] && b[0] <= a[1]);
  function choquesEntre(s1, s2) {
    const out = [];
    for (const a of s1.bloques) for (const b of s2.bloques) {
      if (a.dia === b.dia && a.ini < b.fin && b.ini < a.fin && periodosCruzan(a.periodo, b.periodo))
        out.push({ dia: a.dia, ini: Math.max(a.ini, b.ini), fin: Math.min(a.fin, b.fin) });
    }
    return out;
  }
  function seccionesPlan() { return plan().nrcs.map((n) => byNrc.get(n)).filter(Boolean); }
  function choquesPlan() {
    const secs = seccionesPlan(), res = [];
    for (let i = 0; i < secs.length; i++) for (let j = i + 1; j < secs.length; j++) {
      const c = choquesEntre(secs[i], secs[j]);
      if (c.length) res.push({ a: secs[i], b: secs[j], c });
    }
    return res;
  }
  function conQuienChoca(s) {
    return seccionesPlan().filter((x) => x.nrc !== s.nrc && x.clave !== s.clave && choquesEntre(s, x).length);
  }

  /* ---------------- filtros / resultados ---------------- */
  function pasa(s) {
    if (st.carrera && !s.carreras.includes(st.carrera)) return false;
    if (st.conHorario && !s.bloques.length) return false;
    if (st.cupo && !(s.disponibles > 0)) return false;
    if (st.edificio && !s.edificios.has(st.edificio)) return false;
    if (st.aula && !s.aulas.has(st.aula)) return false;
    if (st.dias.size && s.bloques.some((b) => !st.dias.has(b.dia))) return false;
    if (st.libres && !plan().nrcs.includes(s.nrc) && conQuienChoca(s).length) return false;
    return true;
  }

  function renderResultados(reset = true) {
    if (reset) limite = PAGINA;
    const cont = $("#resultados");
    cont.innerHTML = "";
    const palabras = norm(st.q).split(/\s+/).filter(Boolean);
    const lista = [];
    let nSecs = 0;
    for (const m of materias) {
      const secs = m.secciones.filter((s) => pasa(s) && palabras.every((p) => s.texto.includes(p)));
      if (secs.length) { lista.push({ m, secs }); nSecs += secs.length; }
    }
    $("#conteo").textContent = `${lista.length.toLocaleString("es-MX")} materias · ${nSecs.toLocaleString("es-MX")} secciones`;
    if (!lista.length) {
      cont.append(el("div", { class: "vacio" }, el("b", {}, "Nada por aquí"), "Prueba con otra palabra o quita algún filtro."));
      $("#mas").hidden = true;
      return;
    }
    const abrir = lista.length <= 3 || palabras.some((p) => /^\d{4,}$/.test(p));
    const enPlan = new Set(seccionesPlan().map((s) => s.clave));
    for (const { m, secs } of lista.slice(0, limite)) {
      const det = el("details", { class: "materia", open: abrir },
        el("summary", {},
          el("span", { class: "m-nombre" }, m.materia),
          el("span", { class: "m-info" }, `${m.clave} · ${m.creditos ?? "?"} cr · ${secs.length} ${secs.length === 1 ? "sección" : "secciones"}`),
          el("span", { class: "m-badge" + (enPlan.has(m.clave) ? " en" : "") }, enPlan.has(m.clave) ? "EN PLAN" : `${secs.length}`)));
      const pintar = () => { if (!det.querySelector(".secciones")) det.append(el("div", { class: "secciones" }, secs.map(renderSeccion))); };
      if (abrir) pintar(); else det.addEventListener("toggle", pintar, { once: true });
      cont.append(det);
    }
    $("#mas").hidden = lista.length <= limite;
  }

  function lineasSesion(s) {
    if (!s.sesiones.length) return [el("div", { class: "ses" }, "Sin horario publicado")];
    return s.sesiones.map((x) =>
      el("div", { class: "ses" },
        el("span", { class: "d" }, x.dias.length ? x.dias.map((d) => DIA_NOMBRE[d]).join(" ") : "—"),
        x.inicio ? `${x.inicio}–${x.fin}` : "sin hora",
        x.edificio ? ` · ${x.edificio} ${x.aula}` : ""));
  }

  function renderSeccion(s) {
    const agregada = plan().nrcs.includes(s.nrc);
    const choca = agregada ? [] : conQuienChoca(s);
    const lugares = s.disponibles ?? 0;
    return el("div", { class: "sec" + (agregada ? " agregada" : ""), onmouseenter: () => previsualizar(s), onmouseleave: () => previsualizar(null) },
      el("div", { class: "sec-top" },
        el("span", { class: "nrc" }, s.nrc),
        el("span", { class: "pill" }, s.seccion),
        el("span", { class: "pill " + (lugares > 0 ? "hay" : "lleno") }, `${lugares}/${s.cupos ?? 0} lugares`)),
      ...lineasSesion(s),
      s.profs.length ? el("div", { class: "prof" }, s.profs.flatMap((n, i) => [i ? " · " : "", n, notaProfe(n)])) : null,
      choca.length ? el("div", { class: "empalme" }, `⚠ Se empalma con ${choca.map((x) => x.materia).join(", ")}`) : null,
      el("button", {
        class: "btn sm sec-btn " + (agregada ? "quitar" : "add"), type: "button",
        "aria-label": `${agregada ? "Quitar" : "Agregar"} ${s.materia} NRC ${s.nrc}`,
        onclick: () => (agregada ? quitar(s.nrc) : agregar(s)),
      }, agregada ? "Quitar" : "+ Agregar"));
  }

  /* ---------------- acciones del plan ---------------- */
  function agregar(s) {
    const p = plan();
    const misma = seccionesPlan().find((x) => x.clave === s.clave);
    if (misma) {
      if (!confirm(`Ya tienes ${s.materia} (NRC ${misma.nrc}, sección ${misma.seccion}).\n¿Cambiarla por la sección ${s.seccion} (NRC ${s.nrc})?`)) return;
      p.nrcs = p.nrcs.filter((n) => n !== misma.nrc);
    }
    const choca = conQuienChoca(s);
    p.nrcs.push(s.nrc);
    persistir();
    if (choca.length) toast(`⚠ ${s.materia} se empalma con ${choca.map((x) => x.materia).join(", ")}`, true);
    else toast(s.bloques.length ? `Agregada: ${s.materia}` : `Agregada: ${s.materia} (sin horario publicado)`);
    renderTodo(false);
  }
  function quitar(nrc) {
    plan().nrcs = plan().nrcs.filter((n) => n !== nrc);
    persistir();
    renderTodo(false);
  }

  /* ---------------- horario ---------------- */
  let previewSec = null;
  function previsualizar(s) {
    if (s && plan().nrcs.includes(s.nrc)) s = null;
    if (previewSec === s) return;
    previewSec = s;
    renderGrid();
  }

  function renderGrid() {
    const g = $("#grid");
    g.innerHTML = "";
    const secs = seccionesPlan();
    const todas = previewSec ? [...secs, previewSec] : secs;
    const bloquesTodos = todas.flatMap((s) => s.bloques);
    let hMin = 7, hMax = 21;
    for (const b of bloquesTodos) { hMin = Math.min(hMin, Math.floor(b.ini / 60)); hMax = Math.max(hMax, Math.ceil(b.fin / 60)); }
    const dias = DIAS;
    const hpx = parseFloat(getComputedStyle(g).getPropertyValue("--hpx")) || 46;
    const alto = (hMax - hMin) * hpx;
    g.style.gridTemplateColumns = `54px repeat(${dias.length}, minmax(0, 1fr))`;

    g.append(el("div", { class: "g-head" }, ""));
    for (const [, n] of dias) g.append(el("div", { class: "g-head" }, n));
    const horas = el("div", { class: "g-horas", style: `height:${alto}px` });
    for (let h = hMin + 1; h < hMax; h++) horas.append(el("span", { class: "g-hora", style: `top:${(h - hMin) * hpx}px` }, `${h}:00`));
    g.append(horas);

    const enChoque = new Set();
    for (const { a, b } of choquesPlan()) { enChoque.add(a.nrc); enChoque.add(b.nrc); }

    for (const [d] of dias) {
      const col = el("div", { class: "g-dia", style: `height:${alto}px` });
      const items = [];
      for (const s of todas) for (const b of s.bloques) if (b.dia === d) items.push({ s, b, preview: s === previewSec });
      // columnas lado a lado cuando se traslapan
      items.sort((x, y) => x.b.ini - y.b.ini || y.b.fin - x.b.fin);
      let grupo = [], finGrupo = -1;
      const cerrar = () => {
        const carriles = [];
        for (const it of grupo) {
          let k = carriles.findIndex((f) => f <= it.b.ini);
          if (k < 0) { k = carriles.length; carriles.push(0); }
          carriles[k] = it.b.fin; it.k = k;
        }
        for (const it of grupo) it.n = carriles.length;
        grupo = [];
      };
      for (const it of items) { if (it.b.ini >= finGrupo && grupo.length) cerrar(); grupo.push(it); finGrupo = Math.max(finGrupo, it.b.fin); }
      cerrar();
      for (const { s, b, preview, k, n } of items) {
        const top = ((b.ini - hMin * 60) / 60) * hpx;
        const h = Math.max(((b.fin - b.ini) / 60) * hpx - 2, 18);
        const ancho = 100 / n;
        const bl = el("div", {
          class: "bloque" + (enChoque.has(s.nrc) && !preview ? " choque" : "") + (preview ? " preview" : "") + (st.hl === s.nrc ? " hl" : ""),
          style: `--h:${colorDe.get(s.clave)};top:${top}px;height:${h}px;left:calc(${k * ancho}% + 3px);right:auto;width:calc(${ancho}% - 6px)`,
          title: `${s.materia}\nNRC ${s.nrc} · ${s.seccion}\n${fmtMin(b.ini)}–${fmtMin(b.fin - 1)} · ${b.edificio} ${b.aula}\n${s.prof}`,
          onclick: () => { st.hl = st.hl === s.nrc ? null : s.nrc; renderGrid(); renderLista(); },
        },
          el("b", {}, s.materia),
          el("span", { class: "bl-meta" }, `${fmtMin(b.ini)}–${fmtMin(b.fin - 1)} · ${b.edificio} ${b.aula}`));
        col.append(bl);
      }
      g.append(col);
    }
    if (!secs.length && !previewSec) {
      g.append(el("div", { class: "grid-vacio" }, "Tu semana está libre. Busca una materia y dale “+ Agregar”."));
    }
  }

  function renderAlertas() {
    const box = $("#alertas");
    box.innerHTML = "";
    const ch = choquesPlan();
    if (!ch.length) return;
    box.append(el("h3", {}, `⚠ ${ch.length} ${ch.length === 1 ? "empalme" : "empalmes"} en este plan`),
      el("ul", {}, ch.map(({ a, b, c }) => el("li", {},
        el("b", {}, a.materia), ` (${a.nrc}) y `, el("b", {}, b.materia), ` (${b.nrc}) — `,
        [...new Set(c.map((x) => `${DIA_NOMBRE[x.dia]} ${fmtMin(x.ini)}–${fmtMin(x.fin - 1)}`))].join(", ")))));
  }

  function renderLista() {
    const ul = $("#lista");
    ul.innerHTML = "";
    const secs = seccionesPlan();
    const enChoque = new Set();
    for (const { a, b } of choquesPlan()) { enChoque.add(a.nrc); enChoque.add(b.nrc); }
    let cred = 0, mins = 0;
    for (const s of secs) {
      cred += s.creditos || 0;
      mins += s.bloques.reduce((t, b) => t + (b.fin - b.ini), 0);
      ul.append(el("li", { class: enChoque.has(s.nrc) ? "choque" : "", style: `--h:${colorDe.get(s.clave)}` },
        el("span", { class: "l-n" }, s.materia),
        el("span", { class: "l-i" }, `NRC ${s.nrc} · ${s.seccion} · ${s.creditos ?? "?"} cr${s.bloques.length ? "" : " · sin horario"}${s.prof ? " · " + s.prof : ""}`),
        el("button", { class: "x", type: "button", "aria-label": `Quitar ${s.materia}`, title: "Quitar", onclick: () => quitar(s.nrc) }, "×")));
    }
    $("#s-materias").textContent = secs.length;
    $("#s-creditos").textContent = cred;
    $("#s-horas").textContent = Math.round(mins / 60 * 10) / 10;
  }

  function renderPlanes() {
    const cont = $("#planes");
    cont.innerHTML = "";
    for (const [id, p] of Object.entries(st.planes)) {
      cont.append(el("button", {
        class: "plan-tab", role: "tab", type: "button", "aria-selected": id === st.activo ? "true" : "false",
        title: p.nombre, onclick: () => { st.activo = id; st.hl = null; persistir(); renderTodo(false); },
      }, `${p.nombre} (${p.nrcs.length})`));
    }
    $("#p-del").disabled = Object.keys(st.planes).length < 2;
  }

  function renderTodo(reset = true) {
    renderPlanes();
    renderAlertas();
    renderGrid();
    renderLista();
    if (DATA) {
      const scroll = $("#resultados").scrollTop;
      const abiertos = new Set([...document.querySelectorAll(".materia[open] .m-nombre")].map((n) => n.textContent));
      renderResultados(reset);
      if (!reset) {
        document.querySelectorAll(".materia").forEach((d) => { if (abiertos.has(d.querySelector(".m-nombre").textContent)) d.open = true; });
        $("#resultados").scrollTop = scroll;
      }
    }
  }

  /* ---------------- utilidades UI ---------------- */
  let tTimer;
  function toast(msg, malo = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (malo ? " bad" : "");
    t.hidden = false;
    clearTimeout(tTimer);
    tTimer = setTimeout(() => (t.hidden = true), malo ? 4200 : 2200);
  }
  const nuevoId = () => "p" + Date.now().toString(36);
  const siguienteNombre = () => `Plan ${String.fromCharCode(65 + Object.keys(st.planes).length)}`;

  /* ---------------- eventos ---------------- */
  function conectar() {
    const chips = $("#f-dias");
    for (const [d, n] of DIAS) {
      chips.append(el("button", {
        class: "chip", type: "button", "aria-pressed": "false",
        onclick: (e) => {
          st.dias.has(d) ? st.dias.delete(d) : st.dias.add(d);
          e.currentTarget.setAttribute("aria-pressed", st.dias.has(d));
          renderResultados();
        },
      }, n));
    }
    $("#f-carrera").addEventListener("change", (e) => { st.carrera = e.target.value; persistir(); llenarEdificios(); renderResultados(); });
    let qt;
    $("#f-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value; renderResultados(); }, 140); });
    $("#f-edificio").addEventListener("change", (e) => { st.edificio = e.target.value; llenarAulas(); renderResultados(); });
    $("#f-aula").addEventListener("change", (e) => { st.aula = e.target.value; renderResultados(); });
    $("#f-cupo").addEventListener("change", (e) => { st.cupo = e.target.checked; renderResultados(); });
    $("#f-horario").addEventListener("change", (e) => { st.conHorario = e.target.checked; renderResultados(); });
    $("#f-libres").addEventListener("change", (e) => { st.libres = e.target.checked; renderResultados(); });
    $("#mas").addEventListener("click", () => { const sc = $("#resultados").scrollTop; limite += PAGINA; renderResultados(false); $("#resultados").scrollTop = sc; });
    $("#limpiar").addEventListener("click", () => {
      Object.assign(st, { q: "", edificio: "", aula: "", cupo: false, conHorario: true, libres: false });
      st.dias.clear();
      $("#f-q").value = ""; $("#f-cupo").checked = false; $("#f-horario").checked = true; $("#f-libres").checked = false;
      document.querySelectorAll("#f-dias .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      llenarEdificios(); renderResultados();
    });

    $("#p-nuevo").addEventListener("click", () => {
      const id = nuevoId(); st.planes[id] = { nombre: siguienteNombre(), nrcs: [] }; st.activo = id; persistir(); renderTodo(false);
    });
    $("#p-dup").addEventListener("click", () => {
      const id = nuevoId(); st.planes[id] = { nombre: `${plan().nombre} (copia)`, nrcs: [...plan().nrcs] }; st.activo = id; persistir(); renderTodo(false);
    });
    $("#p-ren").addEventListener("click", () => {
      const n = prompt("Nombre del plan:", plan().nombre);
      if (n && n.trim()) { plan().nombre = n.trim().slice(0, 30); persistir(); renderPlanes(); }
    });
    $("#p-del").addEventListener("click", () => {
      if (Object.keys(st.planes).length < 2) return;
      if (!confirm(`¿Borrar "${plan().nombre}"? No se puede deshacer.`)) return;
      delete st.planes[st.activo]; st.activo = Object.keys(st.planes)[0]; persistir(); renderTodo(false);
    });
    $("#vaciar").addEventListener("click", () => {
      if (plan().nrcs.length && confirm("¿Quitar todas las materias de este plan?")) { plan().nrcs = []; persistir(); renderTodo(false); }
    });
    $("#copiar").addEventListener("click", async () => {
      const txt = plan().nrcs.join(", ");
      if (!txt) return toast("Tu plan está vacío");
      try { await navigator.clipboard.writeText(txt); toast(`Copiados: ${txt}`); }
      catch { prompt("Copia tus NRC:", txt); }
    });
    $("#imprimir").addEventListener("click", () => window.print());
  }

  /* ---------------- calificaciones de Profes ---------------- */
  let NOTAS = {};
  const slugProfe = (n) => (n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function notaProfe(nombre) {
    const s = slugProfe(nombre), r = NOTAS[s];
    const href = `profes.html#p=${s}`;
    if (!r) return el("a", { class: "prof-nota sin", href, target: "_blank", rel: "noopener", title: "Ver o escribir reseñas" }, "opinar");
    const v = Number(r.calidad);
    return el("a", { class: `prof-nota ${v >= 4 ? "alto" : v >= 3 ? "medio" : "bajo"}`, href, target: "_blank", rel: "noopener",
      title: `${r.n} ${r.n === 1 ? "reseña" : "reseñas"} · ver en Profes` }, `★ ${v.toFixed(1)} (${r.n})`);
  }
  async function cargarNotas() {
    const c = window.CUAAK_CONFIG;
    if (!c) return;
    try {
      const r = await fetch(`${c.url}/rest/v1/profes_resumen?select=profe,n,calidad`, { headers: { apikey: c.key } });
      if (!r.ok) return;
      NOTAS = Object.fromEntries((await r.json()).map((x) => [x.profe, x]));
      if (DATA) renderTodo(false);
    } catch { /* sin conexión: el horario funciona igual */ }
  }

  conectar();
  renderTodo();
  cargarNotas();
  if (window.OFERTA && Array.isArray(window.OFERTA.secciones)) cargar(window.OFERTA);
  else {
    $("#meta").textContent = "Sin datos";
    $("#resultados").append(el("div", { class: "vacio" }, el("b", {}, "No se pudo cargar la oferta"),
      "Recarga la página en un momento."));
  }
})();
