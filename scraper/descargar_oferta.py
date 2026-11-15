# -*- coding: utf-8 -*-
"""
CUAAK RESPONDE - descarga de la oferta academica del CUAAD desde la
consulta publica del SIIAU (sin login).

Uso:
    python descargar_oferta.py                 # descarga todo (usa cache si existe)
    python descargar_oferta.py --sin-cache     # fuerza volver a descargar
    python descargar_oferta.py --ciclo 202710 --pausa 3

Que hace:
  1. Descarga TODA la oferta del centro (cup=A) del ciclo, pagina por pagina.
  2. Descarga la lista de carreras del centro y consulta la oferta de cada una
     para saber a que carrera(s) pertenece cada NRC (el listado general del
     SIIAU no trae la carrera).
  3. Guarda ../data/oferta_cuaad_<ciclo>.json (todo el centro) y
     ../data/reporte_sedes.txt con carreras y edificios detectados.
  4. Filtra con sede_huentitan.json (solo licenciaturas de Huentitan) y guarda
     ../data/oferta_huentitan_<ciclo>.json y ../data/oferta.js (lo que carga
     la pagina; .js para que funcione abriendo el HTML sin servidor).

Se hacen pausas entre peticiones para no saturar el servidor de la UdeG.
"""
import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

BASE = "http://consulta.siiau.udg.mx/wco/"
URL_OFERTA = BASE + "sspseca.consulta_oferta"
URL_CARRERAS = BASE + "sspseca.lista_carreras"
ENCODING = "latin-1"          # la pagina del SIIAU viene en ISO-8859-1
POR_PAGINA = 500
DIAS = ["L", "M", "I", "J", "V", "S"]   # posiciones del campo de dias del SIIAU
UA = "Mozilla/5.0 (compatible; planificador-horarios-estudiantil)"

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "raw" / "cache"
DATA = RAIZ / "data"


# ----------------------------------------------------------------- red

class Cliente:
    def __init__(self, pausa, usar_cache):
        self.pausa = pausa
        self.usar_cache = usar_cache
        self._ultima = 0.0
        self.peticiones = 0
        self.mas_antigua = time.time()   # fecha del dato mas viejo usado (cache o descarga)
        CACHE.mkdir(parents=True, exist_ok=True)

    def _esperar(self):
        falta = self.pausa - (time.time() - self._ultima)
        if falta > 0:
            time.sleep(falta)

    def pedir(self, url, campos=None):
        """GET (campos=None) o POST x-www-form-urlencoded. Devuelve texto."""
        cuerpo = urllib.parse.urlencode(campos).encode(ENCODING) if campos else None
        clave = hashlib.sha1((url + "|" + (cuerpo or b"").decode(ENCODING)).encode("utf-8")).hexdigest()[:16]
        archivo = CACHE / f"{clave}.html"
        if self.usar_cache and archivo.exists():
            self.mas_antigua = min(self.mas_antigua, archivo.stat().st_mtime)
            return archivo.read_bytes().decode(ENCODING)

        for intento in range(1, 5):
            self._esperar()
            try:
                req = urllib.request.Request(url, data=cuerpo, headers={"User-Agent": UA})
                if cuerpo:
                    req.add_header("Content-Type", "application/x-www-form-urlencoded")
                with urllib.request.urlopen(req, timeout=180) as r:
                    crudo = r.read()
                self._ultima = time.time()
                self.peticiones += 1
                archivo.write_bytes(crudo)
                return crudo.decode(ENCODING)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                self._ultima = time.time()
                espera = self.pausa * 4 * intento
                print(f"   ! error ({e}); reintento {intento}/4 en {espera:.0f}s", file=sys.stderr)
                time.sleep(espera)
        raise RuntimeError(f"No se pudo descargar {url}")


# ------------------------------------------------------------- parseo

def limpio(s):
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


RE_FILA = re.compile(r'<TR style="background-color:#[0-9a-fA-F]+;">(.*?)</TR>\s*(?=<TR style="background-color|</TABLE>\s*<BR>)', re.S | re.I)
RE_TD_DATO = re.compile(r"<TD class=tddatos>(.*?)</TD>", re.S | re.I)
RE_DEPTO = re.compile(r"subclavep=([A-Z0-9]+),", re.I)
RE_SESION = re.compile(
    r'<TD width="1%">(.*?)</TD><TD width="10%" nowrap>(.*?)</TD><TD width="10%" nowrap>(.*?)</TD>'
    r'<TD width="30%">(.*?)</TD><TD width="40%">(.*?)</TD><TD width="10%" nowrap>(.*?)</TD>', re.S | re.I)
RE_PROF = re.compile(r'<TD width="1%" class="tdprofesor">(.*?)</TD>\s*<TD class="tdprofesor">(.*?)</TD>', re.S | re.I)


def a_int(s):
    try:
        return int(s)
    except ValueError:
        return None


def parse_dias(s):
    """'L M I J . .' o '. . . . V .' -> ['L','M','I','J']"""
    partes = s.split()
    if len(partes) == 6:
        return [DIAS[i] for i, p in enumerate(partes) if p != "."]
    # formato inesperado: tomar letras conocidas
    return [c for c in s if c in DIAS]


def parse_hora(s):
    """'1500-1755' -> ('15:00','17:55')"""
    m = re.match(r"(\d{2})(\d{2})-(\d{2})(\d{2})", s.strip())
    if not m:
        return None, None
    return f"{m[1]}:{m[2]}", f"{m[3]}:{m[4]}"


def parse_pagina(texto):
    secciones = []
    for fila in RE_FILA.findall(texto):
        datos = RE_TD_DATO.findall(fila)
        if len(datos) < 7:
            continue
        nrc, clave, materia, sec, cr, cup, dis = (limpio(d) for d in datos[:7])
        depto = RE_DEPTO.search(datos[1])
        sesiones = []
        for ses, hora, dias, edif, aula, periodo in RE_SESION.findall(fila):
            ini, fin = parse_hora(limpio(hora))
            sesiones.append({
                "sesion": limpio(ses),
                "inicio": ini,
                "fin": fin,
                "dias": parse_dias(limpio(dias)),
                "edificio": limpio(edif),
                "aula": limpio(aula),
                "periodo": limpio(periodo),
            })
        profesores = [{"sesion": limpio(s), "nombre": limpio(n)} for s, n in RE_PROF.findall(fila)]
        secciones.append({
            "nrc": nrc,
            "clave": clave,
            "materia": materia,
            "seccion": sec,
            "creditos": a_int(cr),
            "cupos": a_int(cup),
            "disponibles": a_int(dis),
            "departamento": depto.group(1) if depto else "",
            "sesiones": sesiones,
            "profesores": profesores,
        })
    return secciones


def parse_carreras(texto):
    vistos = {}
    for clave, desc in re.findall(r"asigna\('([^']*)','([^']*)'\)", texto):
        vistos[clave.strip()] = html.unescape(desc).replace("~", "Ñ").strip()
    return vistos


# ------------------------------------------------------------ consultas

def campos_oferta(ciclo, centro, carrera="", p_start=0):
    return {
        "ciclop": ciclo, "cup": centro, "majrp": carrera, "majrdescp": "",
        "crsep": "", "materiap": "", "horaip": "", "horafp": "",
        "lup": "", "map": "", "mip": "", "jup": "", "vip": "", "sap": "",
        "edifp": "", "aulap": "", "dispp": "",
        "ordenp": "2",            # ordenado por NRC: paginas estables
        "mostrarp": str(POR_PAGINA),
        "p_start": str(p_start),  # desplazamiento base 0 (el boton "Proximos" del SIIAU lo calcula mal)
    }


def descargar_oferta(cli, ciclo, centro, carrera=""):
    todas, vistos, p = [], set(), 0
    while True:
        secs = parse_pagina(cli.pedir(URL_OFERTA, campos_oferta(ciclo, centro, carrera, p)))
        nuevas = [s for s in secs if s["nrc"] not in vistos]
        for s in nuevas:
            vistos.add(s["nrc"])
        todas.extend(nuevas)
        if len(secs) < POR_PAGINA or not nuevas:
            return todas
        p += POR_PAGINA


# ----------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ciclo", default="202710")
    ap.add_argument("--centro", default="A")
    ap.add_argument("--pausa", type=float, default=2.5, help="segundos entre peticiones (min 1.5)")
    ap.add_argument("--sin-cache", action="store_true", help="no reutilizar respuestas guardadas")
    ap.add_argument("--sede", default="sede_huentitan.json",
                    help="JSON con las carreras de la sede a publicar ('' = todo el centro)")
    args = ap.parse_args()
    cli = Cliente(max(args.pausa, 1.5), not args.sin_cache)
    DATA.mkdir(parents=True, exist_ok=True)

    print(f"[1/3] Oferta completa del centro {args.centro}, ciclo {args.ciclo}...")
    secciones = descargar_oferta(cli, args.ciclo, args.centro)
    por_nrc = {s["nrc"]: {**s, "carreras": []} for s in secciones}
    print(f"      {len(por_nrc)} secciones (NRC) encontradas")

    print("[2/3] Lista de carreras del centro...")
    carreras = parse_carreras(cli.pedir(URL_CARRERAS + "?" + urllib.parse.urlencode({"cup": args.centro})))
    print(f"      {len(carreras)} claves de carrera; consultando cada una...")

    fuera = 0
    for i, (clave, nombre) in enumerate(sorted(carreras.items()), 1):
        secs = descargar_oferta(cli, args.ciclo, args.centro, clave)
        for s in secs:
            if s["nrc"] not in por_nrc:          # por si aparece solo filtrando por carrera
                por_nrc[s["nrc"]] = {**s, "carreras": []}
                fuera += 1
            if clave not in por_nrc[s["nrc"]]["carreras"]:
                por_nrc[s["nrc"]]["carreras"].append(clave)
        print(f"      ({i:3}/{len(carreras)}) {clave:5} {nombre[:38]:38} -> {len(secs)} NRC")
    if fuera:
        print(f"      aviso: {fuera} NRC solo aparecieron al filtrar por carrera")

    secciones = sorted(por_nrc.values(), key=lambda s: (s["materia"], s["seccion"]))
    usadas = sorted({c for s in secciones for c in s["carreras"]})
    salida = {
        "generado": datetime.fromtimestamp(cli.mas_antigua).isoformat(timespec="seconds"),
        "fuente": "consulta.siiau.udg.mx (consulta publica de oferta academica)",
        "ciclo": args.ciclo,
        "centro": args.centro,
        "carreras": {c: carreras.get(c, c) for c in usadas},
        "secciones": secciones,
    }
    (DATA / f"oferta_cuaad_{args.ciclo}.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")

    print("[3/3] Reporte de carreras y edificios...")
    escribir_reporte(salida)

    sede = cargar_sede(args.sede)
    publicada = filtrar_sede(salida, sede) if sede else salida
    if sede:
        nombre = f"oferta_{norm_archivo(sede['sede'])}_{args.ciclo}.json"
        (DATA / nombre).write_text(json.dumps(publicada, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Sede {sede['sede']}: {len(publicada['secciones'])} de {len(secciones)} NRC -> {nombre}")
    (DATA / "oferta.js").write_text("window.OFERTA = " + json.dumps(publicada, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"Listo. {cli.peticiones} peticiones nuevas al SIIAU. La pagina carga data/oferta.js")


def norm_archivo(s):
    s = s.lower().translate(str.maketrans("áéíóúñ", "aeioun"))
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def cargar_sede(ruta):
    if not ruta:
        return None
    p = Path(ruta)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent / p
    if not p.exists():
        print(f"   (sin archivo de sede {p.name}; se publica todo el centro)")
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def filtrar_sede(d, sede):
    """Deja solo los NRC de las carreras de la sede; cada NRC conserva solo esas carreras."""
    nombres = sede["carreras"]
    secs = []
    for s in d["secciones"]:
        propias = [c for c in s["carreras"] if c in nombres]
        if propias:
            secs.append({**s, "carreras": propias})
    usadas = sorted({c for s in secs for c in s["carreras"]})
    return {
        **d,
        "sede": sede["sede"],
        "edificios_sede": sede.get("edificios", []),
        "carreras": {c: f"{nombres[c]}" for c in usadas},
        "secciones": secs,
    }


def escribir_reporte(d):
    secs = d["secciones"]
    edif_total = Counter()
    edif_carrera = defaultdict(Counter)
    aulas = defaultdict(set)
    for s in secs:
        eds = {x["edificio"] for x in s["sesiones"] if x["edificio"]} or {"(sin edificio)"}
        for e in eds:
            edif_total[e] += 1
            for c in s["carreras"] or ["(sin carrera)"]:
                edif_carrera[c][e] += 1
        for x in s["sesiones"]:
            if x["edificio"]:
                aulas[x["edificio"]].add(x["aula"])

    lin = [f"CUAAK RESPONDE - reporte de sedes  (ciclo {d['ciclo']}, {len(secs)} NRC, generado {d['generado']})", ""]
    lin.append("EDIFICIOS (NRC que usan ese edificio · nº de aulas distintas)")
    for e, n in edif_total.most_common():
        lin.append(f"  {e:16} {n:5} NRC   {len(aulas.get(e, ())):3} aulas")
    lin.append("")
    lin.append("CARRERAS (NRC · edificios donde tienen clase)")
    nombres = dict(d["carreras"], **{"(sin carrera)": "NRC sin carrera asignada"})
    for c, cnt in sorted(edif_carrera.items(), key=lambda kv: -sum(kv[1].values())):
        total = sum(1 for s in secs if c in s["carreras"]) if c != "(sin carrera)" else sum(1 for s in secs if not s["carreras"])
        eds = ", ".join(f"{e}:{n}" for e, n in cnt.most_common())
        lin.append(f"  {c:6} {nombres.get(c, c)[:34]:34} {total:5} NRC   {eds}")
    texto = "\n".join(lin) + "\n"
    (DATA / "reporte_sedes.txt").write_text(texto, encoding="utf-8")
    print(texto)


if __name__ == "__main__":
    main()
