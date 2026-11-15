# CUAAK RESPONDE

Planificador de horarios para la comunidad del CUAAD Huentitán. Busca materias, arma tu semana, detecta empalmes y guarda varios planes en tu navegador.

**Proyecto estudiantil no oficial.** No está afiliado a ninguna institución. Los datos vienen de la consulta pública de oferta académica del SIIAU y pueden cambiar: confirma siempre en SIIAU antes de registrar.

## Usar

Abre `index.html` en el navegador (no necesita servidor) o entra a la versión publicada en GitHub Pages.

- Elige tu carrera y busca por materia, clave, NRC o profesor.
- Filtra por edificio, aula, días y lugares disponibles.
- Agrega secciones al horario semanal: los empalmes se marcan en rojo.
- Crea varios planes (A, B, C…); se guardan solo en tu navegador.
- Copia tus NRC para el registro o imprime el horario.

## Actualizar los datos

Requiere Python 3.9+ (sin dependencias externas):

```bash
cd scraper
python descargar_oferta.py --sin-cache
```

Genera `data/oferta_cuaad_<ciclo>.json`, `data/oferta.js` y `data/reporte_sedes.txt`. El script hace pausas entre peticiones para no saturar el servidor; por favor no las reduzcas.

## Estructura

```
index.html  styles.css  app.js   página (HTML/CSS/JS sin frameworks)
data/                            oferta descargada
scraper/descargar_oferta.py      descarga desde la consulta pública
```
