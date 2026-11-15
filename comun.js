/* CUAAK RESPONDE — utilidades compartidas por Campus y el panel */
(() => {
  "use strict";
  const cfg = window.CUAAK_CONFIG;

  const CATEGORIAS = {
    banos: "Baños",
    iluminacion: "Iluminación / electricidad",
    mobiliario: "Mobiliario (bancas, mesas, sillas)",
    material: "Material y equipo",
    limpieza: "Limpieza / basura",
    internet: "Internet / WiFi",
    agua: "Agua / bebederos",
    accesibilidad: "Accesibilidad",
    seguridad: "Seguridad",
    areas_verdes: "Áreas verdes",
    otro: "Otro",
  };
  const ESTADOS = {
    reportado: "Reportado",
    oficio: "Oficio enviado",
    proceso: "En proceso",
    solucionado: "Solucionado",
  };

  const $ = (s, r = document) => r.querySelector(s);
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

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  // id aleatorio del dispositivo: sirve para limitar spam y votos repetidos; no identifica a nadie
  let huella = ls.get("cuaak.huella", null);
  if (!huella) { huella = uuid(); ls.set("cuaak.huella", huella); }

  let tTimer;
  function toast(msg, malo = false) {
    let t = $("#toast");
    if (!t) { t = el("div", { id: "toast", class: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg;
    t.className = "toast" + (malo ? " bad" : "");
    t.hidden = false;
    clearTimeout(tTimer);
    tTimer = setTimeout(() => (t.hidden = true), malo ? 5000 : 2600);
  }

  const publico = (bucket, path) => path ? `${cfg.url}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}` : null;

  function hace(fecha) {
    const s = (Date.now() - new Date(fecha).getTime()) / 1000;
    if (s < 60) return "hace un momento";
    const m = s / 60, h = m / 60, d = h / 24;
    if (m < 60) return `hace ${Math.round(m)} min`;
    if (h < 24) return `hace ${Math.round(h)} h`;
    if (d < 30) return `hace ${Math.round(d)} ${Math.round(d) === 1 ? "día" : "días"}`;
    return new Date(fecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  }

  /* Reduce la foto a máx. 1600 px en JPEG: pesa menos y se le quitan los
     metadatos (ubicación GPS, modelo del teléfono, etc.). */
  async function prepararFoto(file) {
    let img;
    try { img = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      img = await new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
      });
    }
    const max = 1600, esc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("foto"))), "image/jpeg", 0.82));
  }

  const sb = window.supabase && cfg ? window.supabase.createClient(cfg.url, cfg.key) : null;

  const mensajeError = (e) => {
    const m = (e && (e.message || e.error_description)) || "";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
    return m || "Algo salió mal. Intenta de nuevo.";
  };

  window.CK = { cfg, sb, CATEGORIAS, ESTADOS, $, el, ls, uuid, huella, toast, publico, hace, prepararFoto, mensajeError };
})();
