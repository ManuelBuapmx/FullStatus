# FullStatus

Registro institucional de asistencia. Funciona sin conexión (offline-first) y,
cuando hay internet, sincroniza con el Excel institucional en Google Drive.

## Principios del proyecto

- **Offline primero:** ninguna función central (importar/exportar Excel, guardar datos) debe depender de internet.
- **Fidelidad a la plantilla:** los datos se escriben dentro del Excel institucional original (celdas combinadas, colores, fórmulas, estructura). Nunca se genera un archivo "parecido".
- **Anchos de columna:** nunca se modifican al insertar fechas o alumnos.

## Reglas obligatorias para quien modifique el proyecto (personas e IAs)

1. **Actualizar este README en cada cambio, sin excepción:** funciones nuevas o modificadas, fallas encontradas, mejoras, cambios pendientes, archivos creados/borrados, comandos y decisiones. Registrar en "Historial de cambios" (con fecha y hora) y mantener al día "Pendientes conocidos" y "Fallas conocidas".
2. **La hoja "Plantilla" del Excel institucional es intocable:** nunca borrarla, renombrarla ni escribir datos en ella (ni en scripts de diagnóstico). Solo se lee para clonar hojas de grupos nuevos. Debe permanecer vacía/neutral. Si un cambio podría tocarla, detenerse y preguntar.
3. **Tamaños de celda idénticos a "Plantilla":** anchos de columna y altos de fila de cada hoja de grupo deben ser iguales a los de "Plantilla". Si el texto no cabe, reducir el tamaño de fuente; nunca redimensionar celdas.
4. **Fechas de Excel siempre en UTC:** escribir con `Date.UTC(...)` (`excelFechaSerial`) y leer con `getUTCFullYear/getUTCMonth/getUTCDate`. Leer con getters locales desplaza un día en zonas UTC negativas (México) y duplica columnas.
5. **No asumir que las fechas empiezan en la columna de nombre + 1:** en la hoja real son `ALUMNO`, `Grupo`, `No. EQUIPO` y después las fechas (el bloque empieza en la primera cabecera que sea `Date`). `Grupo` y `No. EQUIPO` nunca se tocan al mover/compactar columnas de fechas.
6. **Antes de editar en lote el xlsx real:** hacer copia, simulación (dry-run), comparar encabezados contra la copia y pedir confirmación.
7. **Proyecto solo de escritorio Windows (Electron):** ya no hay versión Android ni carpeta `www/`; no hay que sincronizar copias. Se edita directamente `app.js`, `index.html`, `styles.css` y `vendor/`.
8. No subir credenciales, tokens ni datos personales de asistencia.
9. Mantener el idioma español de la interfaz y el estilo visual existente.
10. No usar `confirm()`, `alert()` ni `prompt()` nativos (Electron): usar `confirmar` / `pedirTexto`.

## Plataformas y arquitectura

Aplicación web de una sola página, en JavaScript puro (sin framework ni bundler), que se usa como programa de escritorio de Windows (Electron). Los destinos Android y web quedaron descartados.

| Destino | Cómo funciona |
|---|---|
| Windows (Electron) | `electron-main.cjs` levanta un servidor local interno en el puerto 5173 y abre una ventana apuntando a él (necesario para el inicio de sesión de Google). Sirve la carpeta raíz. Se empaqueta con electron-builder (target `nsis`). |

- **Archivo de lógica único:** `app.js` es una IIFE con todo el código; `index.html` solo contiene el esqueleto (cabecera, 6 pestañas, panel y toast) y `app.js` renderiza el resto.
- **Pestañas:** `Grupos` (crear grupos, alumnos, cargar de Drive), `Pasar lista` (una tarjeta por alumno; segundo pase para convertir faltas en retardos), `Historial y exportar` (consultar, justificar, editar/eliminar/renombrar fechas, unidades y periodos, copiar al portapapeles, descargar xlsx, actualizar Drive), `Calificaciones` (tabla por grupo y unidad con la asistencia calculada sola; ver "Calificaciones") `Resultados` (lectura de los exámenes en Supabase, solo lectura) y `Exámenes` (subir exámenes por script a Supabase; ver "Exámenes").
- **Dependencias externas en ejecución:** Google Identity Services (`accounts.google.com/gsi/client`, se carga con reintentos por `asegurarGoogleIdentity`) y Supabase (pestañas Resultados y Exámenes, y la publicación de asistencias y calificaciones). ExcelJS (`vendor/`) y la fuente Inter (`fonts/`) son locales. Todo lo demás es offline.

## Datos y persistencia

| Clave / almacén | Contenido |
|---|---|
| `localStorage` `listaAsistenciaData_v2` | Estado: `{ grupos, grupoActivoId, asistencias, justificantes, hojasPorEliminar, fechasVacias }` |
| `localStorage` `listaAsistenciaCambiosPendientes_v1` | `"1"` si hay cambios sin subir a Drive |
| `localStorage` `listaAsistenciaDriveFileId_v1` | Id del archivo de Drive usado |
| `localStorage` `listaAsistenciaGoogleDriveAuth_v3` | Marca de que ya se concedió permiso (evita pedir consentimiento otra vez) |
| `localStorage` `fullstatusEscuelas_v1` | Lista de escuelas `[{id, nombre, driveFileId, original?}]`. La escuela `original` usa las claves de siempre; las demás agregan el sufijo `__<id>` a `listaAsistenciaData_v2`, `listaAsistenciaCambiosPendientes_v1`, `listaAsistenciaDriveFileId_v1` y a la clave `institucional` de IndexedDB |
| `sessionStorage` `fullstatusEscuelaSesion_v1` | Id de la escuela elegida en esta sesión (si no existe, se muestra la pantalla de inicio) |
| `localStorage` `listaAsistenciaCalificaciones_v1` | Calificaciones capturadas a mano: `{ grupoId: { _modelo?: "nuevo"\|"anterior", unidadId: { cols: { examen\|partic\|trab: { modo, max } }, alumnos: { estudianteId: { examen, partic, extra, trab } } } } }`. Solo viven en la app (no se sincronizan con Drive) |
| `localStorage` `fullstatusExamenesBorrador_v1` | Borrador de la pestaña Exámenes: `{ texto, materiaNombre, unidad, tipo, modo }` (el script pegado, la materia, unidad y tipo elegidos y "reemplazar"/"agregar"). Se guarda al escribir para no perderlo sin internet |
| IndexedDB `integratorium_cache_v1` | Copia local del Excel institucional (`plantillaExcel`) para trabajar sin conexión; se restaura al iniciar con `restaurarCacheLocal` |

Modelo: `grupos[] = { id, nombre, estudiantes: [{id, nombre}], materia, profesor, unidades?: [{id, nombre, desde, hasta}] }`; `asistencias[grupoId][fechaISO][estudianteId]` con estados `P` (asistencia, exporta `1`), `A` (falta, `0`) y `R` (retardo, `2`); `justificantes[grupoId][fechaISO][estudianteId] = { nota }`. Una fecha existe solo si tiene al menos una marca (`purgarFechasVacias` limpia las vacías al cargar). **No cambiar estas claves ni el formato sin plan de migración.**

## Reglas de conteo (totales)

- **Asistencia (`P`, `1`):** cuenta como asistencia.
- **Falta justificada (`J`):** es una `A` con justificante; cuenta como asistencia (se exporta como `1` con una nota en la celda) y no cuenta como falta.
- **Retardo (`R`, `2`):** cuenta como asistencia normal mientras el alumno tenga 1 o 2 retardos. Cada **3 retardos** de un alumno equivalen a **1 falta injustificada y 2 asistencias** (son 3 días: uno se convierte en falta).
- **Total presente / total de asistencias de un alumno** (`totalAsistencias`): `P + justificadas + retardos − floor(retardos / 3)`. Ejemplos: 1 retardo = 1; 2 retardos = 2; 3 retardos = 2; 4 retardos = 3; 6 retardos = 4.
- **Faltas equivalentes** de un alumno (`faltasEquivalentes`): `faltas injustificadas + floor(retardos / 3)`.
- La regla es **por alumno a lo largo de varias fechas**; el resumen de un solo día (`resumenDia`) muestra conteos simples (presentes = `P` + justificadas, faltas sin justificar, retardos) y no aplica la conversión.
- Las celdas del Excel guardan el valor original (`1`, `0`, `2`); la regla solo afecta a los **totales** (columna TOTAL del Excel, "Total presente" del Historial y "Copiar para pegar en Excel").

## Calificaciones

Pestaña **Calificaciones** (`renderCalificaciones`, `calcularCalificaciones`, `refrescarTotalesCalif`, `htmlReporteCalif`, `generarPdfCalificaciones`), basada en la hoja de calificaciones del usuario. Una tabla por grupo y **unidad** (solo se muestran unidades; si el grupo no tiene, pide definirlas en Historial → "Unidades y periodos"; por defecto se elige la unidad que contiene el día de hoy o la primera).

- **Ponderación (dos modelos, `CALIF_MODELOS`)**, elegible por grupo con el selector "Modelo de ponderación" (se guarda en `califDatos[grupoId]._modelo`):
  - **Modelo anterior** (10° grado, último cuatrimestre): trabajos 60 (6 pts), examen 20 (2 pts), participación 10 (1 pto), asistencias 10 (1 pto). Chips: Saber hacer 60% / Saber 20% / Ser 20%.
  - **Modelo nuevo** (grados anteriores; el que quedará): trabajos 50 (5 pts), examen 30 (3 pts), participación 10 (1 pto), asistencias 10 (1 pto). Chips: Saber hacer 50% / Saber 30% / Ser 20%.
  - Si no se ha elegido, los grupos cuyo nombre empieza con "10" (p. ej. `10A`) usan el modelo anterior y el resto el nuevo (`modeloCalifId`).
  - El **Extra** suma o resta puntos directos. **TOTAL** = suma de puntos, mínimo 0 y tope 10. Los colores de encabezado (los de la hoja original) están en `CALIF_COLORES`.
- **Asistencias (automático):** `totalAsistencias` sobre las fechas de la unidad (justificadas cuentan; 3 retardos = 1 falta + 2 asistencias): `asistencias / días de la unidad` × 1 pto.
- **Modo de captura por columna** (Exámen, Partic., Trabajos): *Porcentaje* (0-100), *Calificación* (0-10) o *Escala*. En escala se escribe el máximo o se deja vacío (automático = valor más alto capturado; en participación, con tope de 10). Por defecto: Exámen en calificación, Partic. y Trabajos en escala automática. Extra y Asistencias no tienen modo.
- **Resumen del periodo (cuadro aparte):** asistencias (días de clase), participaciones y trabajos en clase del periodo (el máximo de la escala efectiva, o el valor más alto capturado si la columna no está en escala).
- **PDF:** botón "Generar PDF" (horizontal, encabezados de color con el puntaje entre paréntesis, ponderaciones 60/20/20, resumen del periodo y tabla). En Electron lo genera el proceso principal (`ipcMain` `fullstatus:generar-pdf` en `electron-main.cjs`, expuesto por `preload.cjs` como `window.fullstatusPDF.generar`): ventana oculta sin JavaScript → `printToPDF` → "Guardar como". Fuera de Electron usa el cuadro de impresión como respaldo.
- Lo capturado se guarda al escribir en `listaAsistenciaCalificaciones_v1`; no marca "cambios pendientes" ni se escribe en el Excel institucional. "Copiar para pegar en Excel" copia la tabla.

## Exámenes

Pestaña **Exámenes** (`supabase-examenes.js`; `app.js` solo la llama desde `render`): sube a Supabase los exámenes que los alumnos contestan en FullStatus Student. Es la lógica de la pestaña "Importar" de `admin.html` (repo CMKAdmin) portada aquí.

- **Flujo:** iniciar sesión (la misma de "☁ Alumnos") → elegir **materia + unidad + tipo de examen** → pegar el script de Apps Script para Forms (el que genera Gemini) → **Analizar** (vista previa con secciones, preguntas, respuesta correcta marcada, videos y errores con su línea) → **Subir examen** → confirmación en la pestaña.
- **Qué entiende el script:** `FormApp.create`, `addMultipleChoiceItem`, `setTitle`, `createChoice(valor, esCorrecta)`, `setChoices`; el título de `FormApp.create` / `addSectionHeaderItem` / `addPageBreakItem` es la **sección**; el `setHelpText` del encabezado y `addVideoItem().setVideoUrl` son el **contexto**. Lo que la app no usa se ignora y se avisa. "Limpiar y corregir" es automático: quita ``` e invisibles, arregla comillas curvas, saltos de línea dentro de un texto y comillas interiores sin escapar; un script que ya compila no se modifica.
- **Videos:** un link de YouTube se guarda siempre como `https://www.youtube.com/watch?v=ID`. Un link que no sea de YouTube es **error** (los links externos rompen el examen). Se quita la numeración del título ("1. ¿...?") porque la app del alumno ya numera.
- **Seguridad:** el script se ejecuta para analizarlo, así que corre en un `iframe` con `sandbox="allow-scripts"` **sin** `allow-same-origin`: no puede leer el `localStorage` ni el IndexedDB de FullStatus. La respuesta correcta solo se envía; nunca se vuelve a leer de la base (`select=id`).
- **Destino (materia + unidad + tipo):** la **materia** sale de una lista con las materias de inglés (y Ética) registradas en los grupos (`window.FullStatusMateriasGrupos`, definida en `app.js`) más Ética siempre. La **unidad** (1 a 5) se guarda en `preguntas.seccion` como «Unidad N», que es como FullStatus Student arma su menú; todas las preguntas del script van a esa unidad (las secciones del script ya no se usan como unidad). El **tipo** (Ordinario, Remedial, Extraordinario 1, 2 o 3) **no es una columna nueva**: *Ordinario* usa la materia tal cual y los demás tipos van a una materia aparte llamada «Materia · Tipo» (p. ej. «Inglés XI · Remedial»), que se **crea desactivada** al subir. Así cada tipo tiene su propio horario/asignación en `admin.html` y la pestaña Resultados (que muestra el nombre de la materia como «Tipo de examen») los distingue sin cambios. Los nombres se comparan sin acentos ni mayúsculas y «english» = «ingles» (ENGLISH XI en Supabase = Inglés XI del grupo). Ya no hay campo «crear materia nueva»: la materia destino se crea sola al subir.
- **Subida segura:** *Reemplazar* ahora solo afecta a **las preguntas activas de la misma unidad** (antes desactivaba toda la materia); las otras unidades no se tocan. Cada examen (unidad de una materia/tipo) es **independiente y su numeración empieza en 1**. Si la unidad todavía no tiene preguntas activas se sube directo, sin preguntar; la opción *Reemplazar*/*Agregar* solo aparece cuando ya hay un examen activo en esa unidad (*Agregar* continúa después del orden más alto de esa unidad). Inserta las preguntas nuevas **desactivadas** → desactiva las anteriores → activa las nuevas (si falla a la mitad el alumno nunca se queda sin examen; el mensaje dice cómo quedó). *Agregar* las inserta activas al final del orden y avisa si ya existen con el mismo texto. Cada paso comprueba las filas afectadas (RLS). Las preguntas anteriores se desactivan, **no se borran**.
- **Qué NO hace:** no activa la materia, no fija horarios ni asigna alumnos (eso sigue en `admin.html`; una materia nueva se crea **desactivada**), no edita preguntas sueltas ni las borra, no lee la respuesta correcta.
- **Offline primero:** analizar no necesita internet; cargar materias y subir sí. Sin internet o sin sesión no se rompe nada de lo demás.
- **Decisión que cambia (2026-11-05):** hasta ahora la app solo *leía* Resultados y publicaba asistencias/calificaciones mediante funciones RPC. Esta pestaña **escribe directamente** en las tablas `materias` y `preguntas` del proyecto de exámenes, con la sesión de administrador y las políticas RLS "admin" que ya usa `admin.html`. Por eso `window.FullStatusSupabase.rest` se agregó a `supabase-asistencias.js`.

## Sincronización con Google Drive / Excel institucional

- Autenticación OAuth con Google Identity Services (scopes `drive` y `spreadsheets`); el client id está en `app.js` (es público por diseño; el origen debe estar registrado en Google Cloud Console).
- El archivo institucional (`Lista de asistencia.xlsx`) se descarga con `descargarWorkbookInstitucional`; si el archivo es una hoja de Google nativa se usa la ruta `actualizarHojaGoogle` (API de Sheets).
- `guardarEnGoogleDrive` solo descarga el libro si no hay copia local (`plantillaExcel`) para no pisar ediciones locales; luego `crearBufferPlantillaInstitucional` escribe las marcas **solo del grupo activo** y se sube con PATCH.
- Grupos nuevos: se clonan de la hoja "Plantilla" (`clonarHojaDesdePlantilla`); si no existe esa pestaña la creación falla con aviso.
- Auto-sincronización: `autoSincronizarCambios` / `sincronizarPendientes` suben cuando hay internet y cambios pendientes.
- Funciones clave en `app.js`: `extraerGrupoDeHoja`, `encontrarEncabezadoAlumno`, `limiteColumnaAsistencias`, `eliminarFechaDeHoja`, `renombrarFechaEnHoja`, `compactarColumnasVacias`, `construirMatrizActiva`, `descargarXlsxCompleto`, `faltasEquivalentes`, `totalAsistencias`, `resumenDia`; escuelas: `cargarEscuelas`, `sufijoEscuela`, `mostrarSelectorEscuelas`; resultados por escuela: `resEsDeEscuela`.

## Estructura

| Archivo | Descripción |
|---|---|
| `index.html`, `styles.css`, `app.js` | Aplicación (interfaz y lógica) |
| `supabase-asistencias.js` | Publica asistencias y unidades en Supabase (RPC `publicar_asistencias`), guarda la sesión de administrador y expone `window.FullStatusSupabase` (`rpc`, `rest`, `abrir`, `haySesion`) |
| `supabase-calificaciones.js` | Publica las calificaciones por unidad (RPC `publicar_calificaciones`) |
| `supabase-examenes.js` | Pestaña Exámenes: analiza el script pegado y sube el examen a Supabase (ver "Exámenes") |
| `vendor/exceljs.min.js` | ExcelJS local (para funcionar sin internet) |
| `fonts/` | Fuente Inter local (`inter-latin-wght-normal.woff2`) y su licencia `OFL.txt` |
| `electron-main.cjs` | Ventana de escritorio (Windows), servidor local interno y generación de PDF (IPC) |
| `preload.cjs` | Puente seguro (`contextBridge`) que expone `window.fullstatusPDF` a la interfaz |
| `package.json` | Scripts (`start:windows`, `dist:windows`) y configuración de electron-builder |
| `FS.png`, `FullStatus.png` | Icono de la app y logo de arranque |
| `.github/agents/fullstatus-maintainer.agent.md` | Instrucciones del agente de mantenimiento de Copilot |

Ignorados por git: `node_modules/`, `dist/`, `android/`, `android-build/`, `*.log`.

## Comandos

```
npm run start:windows    # ventana de escritorio con Electron
npm run dist:windows     # instalador de Windows (electron-builder)

# Todo en uno (actualiza desde GitHub, instala dependencias, compila y abre el instalador):
powershell -ExecutionPolicy Bypass -File .\actualizar.ps1
# Solo probar la última versión sin instalar:
powershell -ExecutionPolicy Bypass -File .\actualizar.ps1 -Probar
```

> Mantén el proyecto fuera de carpetas sincronizadas con Google Drive: causan errores EPERM al compilar con electron-builder.

## Flujo de uso

1. **Grupos:** cargar el archivo institucional desde Drive (queda guardado en el dispositivo).
2. **Pasar lista:** una tarjeta por alumno (Asistencia / Falta). El segundo pase permite convertir faltas en retardos.
3. **Historial y exportar:** consultar, justificar faltas, editar/eliminar fechas, copiar a Excel o actualizar el archivo en Drive.

Reglas: ver "Reglas de conteo (totales)". Una falta justificada cuenta como asistencia (se guarda como `1` con una nota en la celda).

## Historial de cambios

### 2026-11-10 (noche) — Historial: columna «Matrícula» plegable y filtro

- **Pedido:** en el Historial, una columna desplegable para verificar qué alumnos tienen matrícula y cuáles no.
- **Cambio (`app.js`):** botón «Matrícula ▸/▾» sobre la tabla del historial (el mismo de Pasar lista; la elección abierta/cerrada se comparte y se recuerda). Abierto, agrega la columna «Matrícula» (matrícula, «Sin matrícula» o «⚠ Varias coincidencias»), el conteo «N con matrícula · N sin matrícula» y una lista para filtrar: Todos / Solo sin matrícula / Solo con matrícula. Usa la misma consulta de solo lectura (`consultar_matriculas`, coincidencia por nombre, requiere sesión de «☁ Alumnos»). Es solo visual: no cambia el Excel ni lo que se copia/descarga. Nuevas funciones: `asegurarMatriculas`, `tieneMatricula`, `celdaMatriculaHtml`; variable `matFiltro`. Las «Varias coincidencias» cuentan como «sin matrícula» en el conteo y el filtro.
- **Sin probar en Electron con Supabase real.**

### 2026-11-10 (noche) — Exámenes: cada examen empieza en 1 y sin «Reemplazar» si no hay nada que reemplazar

- **Cambio:** la numeración de cada examen (unidad de una materia/tipo) empieza en 1, sin depender de otras unidades. Si la unidad no tiene preguntas activas se sube directo; *Reemplazar*/*Agregar* solo se ofrece cuando ya hay un examen activo ahí (`supabase-examenes.js`).
- **Supuesto a confirmar:** FullStatus Student filtra por unidad (`seccion`) antes de ordenar. Probar con un examen de prueba en una materia desactivada.

### 2026-11-10 18:10 — Exámenes: materia (lista), unidad y tipo de examen

- **Pedido:** en la pestaña Exámenes elegir la materia desde una lista (inglés de los grupos y Ética), el número de unidad y el tipo de examen (Ordinario, Remedial, Extraordinario 1, 2 o 3).
- **Cambios:** `supabase-examenes.js` (tarjeta «Destino del examen» con tres listas; subida a la unidad elegida; materia destino «Materia · Tipo» creada desactivada si no existe; *Reemplazar* limitado a la unidad) y `app.js` (nueva `window.FullStatusMateriasGrupos`, solo lectura). Sin migraciones en Supabase.
- **Decisión:** el tipo no se guarda en una columna sino en el nombre de la materia destino (ver «Exámenes»); así FullStatus Student, `admin.html` y Resultados siguen funcionando sin tocarlos.
- **Probado:** `node --check` y una prueba con jsdom y datos simulados (listas, texto informativo, y que *Reemplazar* en la Unidad 2 no desactive la Unidad 1). Falta probar en Electron con Supabase real.

### 2026-11-10 17:40 — Pantalla de inicio para elegir escuela; Resultados por escuela; arreglo de columna 0

- **Nuevo (`app.js`, `styles.css`):** al abrir la app se muestra "¿En qué escuela vas a trabajar?" (`mostrarSelectorEscuelas`). Cada escuela tiene su propio estado, cambios pendientes, copia local del Excel (IndexedDB) y archivo de Drive. Se pueden agregar (nombre + enlace/ID del Excel en Drive), renombrar y quitar escuelas (quitar borra solo los datos locales y pide confirmación). Un botón con el nombre de la escuela en el encabezado vuelve a la pantalla de inicio (recarga la ventana). `GOOGLE_SHEET_ID` ahora sale de la escuela elegida.
- **Compatibilidad:** la escuela `original` ("Escuela 1") conserva las claves de siempre sin sufijo, así que no hay migración ni se pierden datos; las demás usan las mismas claves con el sufijo `__<id>`. Las claves nuevas están en "Datos y persistencia".
- **Resultados por escuela:** la pestaña Resultados solo muestra los resultados cuyo `grupo` coincide con el nombre de algún grupo de la escuela seleccionada (`resEsDeEscuela`, sin distinguir mayúsculas ni espacios extra). El selector de grupo y el de "Tipo de examen" solo listan lo que tiene resultados en esa escuela, y se indica cuántos resultados de otros grupos quedan ocultos. Solo lectura; no cambia Supabase.
- **Falla corregida:** al sincronizar una hoja cuya columna `ALUMNO` es la primera (columna A), `crearBufferPlantillaInstitucional` leía `getCell(nameCol - 1)` con `nameCol = 1` (columna 0) y ExcelJS lanzaba "0 is out of bounds. Excel supports columns from 1 to 16384". La guarda correcta es `nameCol > 1`.
- **No cambia (a propósito):** `supabase-asistencias.js` y `supabase-calificaciones.js` leen `localStorage.listaAsistenciaData_v2`, o sea solo la escuela original; no publican a FullStatus Student los grupos de otras escuelas. Se dejó así porque no se sabe cómo `publicar_asistencias` trata los grupos que no vienen en el envío (podría borrar los de otra escuela). La clave de calificaciones se comparte entre escuelas sin problema porque va por `grupoId`, que es único.
- **Verificación:** `node --check app.js` y prueba con jsdom sobre el `index.html` real (pantalla de inicio, botón de escuela, aislamiento de grupos entre escuelas). **No se probó en Electron ni contra Drive/Supabase reales.**

### 2026-11-05 (noche) — Nueva pestaña "Exámenes": subir exámenes a FullStatus Student por script
- **Qué:** nueva pestaña **Exámenes** para subir a Supabase los exámenes que los alumnos contestan en FullStatus Student, pegando el script de Apps Script para Forms que genera Gemini. Detalle de flujo, reglas y límites en la sección "Exámenes".
- **Archivos:** nuevo `supabase-examenes.js`; `index.html` (botón de pestaña `examenes` y `<script>` después de `supabase-calificaciones.js`); `app.js` (5 líneas en `render` que llaman a `window.FullStatusExamenes.montar`); `supabase-asistencias.js` (nuevo `window.FullStatusSupabase.rest`, sin tocar lo que ya publicaba); `package.json` (`supabase-examenes.js` en `build.files`); este README.
- **Decisión:** la app ahora **escribe** en `materias` y `preguntas` (antes solo leía `resultados` y publicaba por RPC). Se reutiliza la sesión de "☁ Alumnos"; no hay otro inicio de sesión ni otra clave.
- **Diferencias con `admin.html`:** la subida inserta primero desactivado y activa al final (no desactiva primero); los links que no son de YouTube son error; los links de YouTube se normalizan a `watch?v=ID`; el script se ejecuta aislado en un iframe sin acceso al almacenamiento de la app.
- **Probado solo con `node`/jsdom:** parser con scripts tipo Gemini, scripts rotos (comillas curvas, saltos de línea, comillas sin escapar, error con línea), validaciones, secuencia de subida con una API simulada (incluye fallo por RLS, por red y a la mitad) y el flujo de la pestaña con un `fetch` simulado y el iframe simulado con `vm`. **No se probó en Electron ni contra el Supabase real.** Probar: iniciar sesión, analizar el script real de Gemini, subir a una materia **desactivada** de prueba y comprobar en FullStatus Student que lo ve (después de activarla en admin.html); probar *Reemplazar* y *Agregar*; probar que el iframe aislado funciona en Electron (si el análisis se queda en "Analizando..." o dice que tardó demasiado, ahí está el problema); recompilar con `npm run dist:windows` y comprobar que `supabase-examenes.js` entra en el instalador.
- **Observación:** este README no documentaba `supabase-asistencias.js` ni `supabase-calificaciones.js`; se agregaron a la tabla de estructura.

### 2026-11-04 22:30 — Calificaciones: modelo de ponderación anterior (10°) y nuevo
- **Corrección de criterio:** el 60/20/20 aplica solo a 10° grado (último cuatrimestre con el modelo anterior). Los demás grados usan el modelo nuevo: trabajos 50, examen 30, participación 10 y asistencias 10 (5 / 3 / 1 / 1 puntos). Esto también coincide con el `×5` de trabajos de la fórmula original del Excel de calificaciones.
- Nuevo `CALIF_MODELOS`, `modeloCalifId` y selector "Modelo de ponderación" por grupo; por defecto los grupos que empiezan con "10" usan el modelo anterior. Los puntos por columna, los encabezados, los chips de ponderación y el PDF (que ahora indica el modelo) se calculan según el modelo del grupo. Se retiró `CALIF_PUNTOS`.
- Supuesto: en el modelo nuevo se mantienen las mismas categorías (Saber hacer = trabajos, Saber = examen, Ser = asistencias + participación) con 50 / 30 / 20.
- Probado solo con `node` y datos de ejemplo (grupos `10A` y `4C`); no se probó en Electron.

### 2026-11-04 22:00 — Calificaciones: solo unidades, modos por columna, resumen y PDF
- **Solo unidades:** se quitó la opción "Todas las fechas"; la pestaña exige elegir una unidad (por defecto la actual). Los datos de la versión anterior guardados como "general" ya no se usan.
- **Ponderación 60/20/20 con puntaje por columna:** Trabajos 6 pts, Exámen 2, Asistencias 1, Participación 1, Extra directo, tope 10. **Cambio frente a la versión anterior de la pestaña:** trabajos valían 5 puntos (copiado de la fórmula del Excel de calificaciones) y ahora valen 6, para que Saber hacer sea realmente el 60%. Si el criterio es otro, se ajusta en `CALIF_PUNTOS`.
- **Modos por columna** (porcentaje / calificación / escala con máximo manual o automático) para Exámen, Partic. y Trabajos; el "Máx. trabajos" suelto se sustituyó por esta configuración (compatibilidad en `califBucket`).
- **Cuadro "Resumen del periodo"** con asistencias (días), participaciones y trabajos en clase.
- **Botón "Generar PDF":** nuevos `preload.cjs` y manejador IPC en `electron-main.cjs`; `package.json` incluye `preload.cjs` en `build.files`. Encabezados de color como la hoja original y puntaje entre paréntesis.
- Archivos tocados: `app.js`, `electron-main.cjs`, `package.json`, `README.md` y nuevo `preload.cjs`.
- Probado solo con `node` y datos de ejemplo (cálculo de totales y armado del HTML); el PDF y la interfaz no se probaron en Electron. Probar: generar el PDF, confirmar que guarda, que conserva colores y que la app sigue aceptando teclado después del cuadro "Guardar como".

### 2026-11-04 15:20 — Nueva pestaña "Calificaciones"
- Nueva pestaña con tabla Nombre / Asistencias / Exámen / Partic. / Extra / Trabajos en clase / Total, por grupo y unidad. La asistencia se rellena sola desde el historial (regla de totales vigente) y lo demás se captura a mano. Fórmula y reglas en la sección "Calificaciones".
- Funciones nuevas en `app.js`: `cargarCalificaciones`, `guardarCalificaciones`, `numCalif`, `claveCalif`, `califBucket`, `calcularCalificaciones`, `textoInfoCalif`, `refrescarTotalesCalif`, `renderCalificaciones` y sus eventos en `attachHandlers`. `render` y el botón de pestaña (`index.html`) se actualizaron. Al eliminar un grupo también se borran sus calificaciones.
- Datos en una clave nueva (`listaAsistenciaCalificaciones_v1`); no se cambió ninguna clave ni formato existente.
- **Pendiente:** no hay exportación a un Excel con este formato ni sincronización con Drive. No se ejecutó la app: solo se validó la sintaxis con `node --check`. Probar con la hoja `4C 2` y comparar totales contra el Excel de calificaciones.

### 2026-11-04 14:49 — Totales: la falta justificada cuenta como asistencia y 3 retardos = 1 falta + 2 asistencias
- **Regla nueva (`totalAsistencias`):** el total de asistencias de un alumno es `P + justificadas + retardos − floor(retardos / 3)`. Con 1 o 2 retardos siguen contando como asistencias normales; al completar el tercero, ese grupo de 3 días pasa a ser 1 falta injustificada y 2 asistencias. Antes los retardos no sumaban nada al total.
- **Dónde se aplica:** columna TOTAL del Excel (`crearBufferPlantillaInstitucional`), "Total presente" del Historial (`renderHistorial`), "Copiar para pegar en Excel" (`construirMatrizActiva`) y la ruta de hojas de Google nativas (`actualizarHojaGoogle`).
- **Resumen de "Pasar lista" (`resumenDia`, nuevo):** ahora "presentes" incluye las faltas justificadas, "faltas" cuenta solo las injustificadas y "retardos" es el conteo simple del día. Antes mostraba "faltas equivalentes" sumando retardos de alumnos distintos, lo cual no corresponde a la regla (que es por alumno en varias fechas). El botón "Segundo pase" sigue revisando todas las faltas del día, justificadas o no.
- **`actualizarHojaGoogle`:** ahora exporta las faltas justificadas como `1` (igual que la ruta de Excel) y calcula el total con la regla nueva. Antes escribía `0` y no las contaba.
- Textos de ayuda del Historial y de "Pasar lista" actualizados con la regla. Las celdas del Excel siguen guardando `1`, `0` y `2`; solo cambian los totales.
- Además: `renderHistorial` y `construirMatrizActiva` leen `state.asistencias[g.id]` con protección (`|| {}`) por si un grupo tiene fechas sin marcas importadas pero no tiene entrada de asistencias.
- Verificado en el código: `app.js` ya no contiene `confirm()` nativo ni `importarArchivoExcel` (se eliminaron de "Funciones clave" y de pendientes).
- README: corregidos "3 pestañas" → 4 (Resultados), `server.cjs` quitado de la tabla de estructura y añadida la sección "Reglas de conteo (totales)".
- **Pendiente de probar en Electron:** solo se escribió el código; no se ejecutó la app. Probar con un alumno con 1, 2, 3 y 4 retardos y con una falta justificada, y comparar la columna TOTAL en el Excel.

### 2026-10-10 — Falla: el campo "Motivo" del justificante no dejaba escribir
- **Causa:** en Electron, tras cerrar un `confirm()` nativo la ventana pierde el foco del teclado y los campos de texto que se abren después no aceptan escritura. El justificante hacía `confirm()` y luego mostraba el cuadro del motivo.
- **Arreglo:** nuevo cuadro propio `confirmar(mensaje, alAceptar, alCancelar)` (junto a `pedirTexto`) que sustituye a **todos** los `confirm()` activos de la app (eliminar grupo, quitar alumno, agregar fecha, quitar unidad, cambiar/eliminar fecha, quitar justificante). Marcar una falta como justificada ahora usa un solo cuadro: confirmación + motivo opcional.
- Regla: no usar `confirm()`, `alert()` ni `prompt()` nativos en la app (Electron); usar `confirmar` / `pedirTexto`.

### 2026-10-09 — Historial: filtro de unidad siempre visible y sin totales
- Quitados del Historial los totales de **asistencias, faltas equivalentes, retardos y justificadas** (y el cálculo `resumen` en `renderHistorial`); solo queda "días registrados", que cuenta los días visibles: todos, o solo los de la unidad elegida (la etiqueta pasa a "días en <unidad>"). Se conservan la columna "Total presente" por alumno y la regla de 3 retardos = 1 falta (`faltasEquivalentes`) para otros usos.
- El selector **Unidad** (`selUnidadHistorial`) ahora aparece siempre: si el grupo no tiene unidades queda deshabilitado con "Sin unidades definidas"; si las tiene, permite ver todas o solo la unidad seleccionada (filtra la tabla y "Copiar para pegar en Excel"). Las unidades se definen en "Unidades y periodos" del mismo Historial.

### 2026-10-09 — Resultados: sin conteo/promedio/porcentaje y filtro por tipo de examen
- Quitados de la pestaña Resultados el contador de resultados, el promedio y la columna `%`. Se mantiene la columna "Aciertos" (correctas / total).
- El filtro de materia ahora se llama **Tipo de examen** (`selResMateria`) y su primera opción es "Todos los resultados"; las demás son las materias de la tabla `materias`. Siguen los filtros de grupo y la búsqueda por nombre o matrícula.

### 2026-10-09 — Pestaña "Resultados" (Supabase, solo lectura)
- Nueva pestaña **Resultados** (`renderResultados`, `supabaseLogin`, `supabaseLeer`, `cargarResultados`, `htmlTablaResultados` en `app.js`): muestra la tabla `resultados` del proyecto de exámenes de Supabase (nombre, matrícula, grupo, materia, aciertos, %, fecha, reanudaciones) con filtros por materia y grupo y búsqueda por nombre o matrícula, más conteo y promedio.
- **Seguridad:** la RLS del proyecto solo permite leer `resultados` al usuario autenticado con el correo del administrador; sin sesión Supabase devuelve `permission denied` (verificado). La app inicia sesión con correo y contraseña por la API de Auth (`/auth/v1/token`), guarda el token **solo en memoria** (nunca en disco ni `localStorage`) y no guarda la contraseña. La URL y la clave `sb_publishable_…` del proyecto están en `app.js` (son públicas por diseño). Todo es de **solo lectura**: la app nunca escribe en Supabase.
- Requiere internet; sin conexión muestra un aviso. No se usa Supabase para guardar asistencia: eso sigue en Google Drive.
- Eliminado `.vscode/mcp.json` (el acceso de Copilot a Supabase ya no se necesita).
- Pendiente: probar con la cuenta real; la sesión expira cada hora (hay que volver a entrar); límite de 2000 filas más recientes.

### 2026-10-09 — Acceso de Copilot al proyecto de Supabase (solo lectura)
- Instalada la extensión `supabase.vscode-supabase-extension`; solo conecta con una instancia **local** de Supabase (CLI + Docker), no con el proyecto en la nube.
- Nuevo `.vscode/mcp.json` con el servidor MCP oficial de Supabase acotado al proyecto `juvqvshcfsrtscvzluaa` y en modo solo lectura (`read_only=true`). No contiene claves: la autenticación se hace por OAuth en el navegador al iniciar el servidor desde VS Code. Aún no se usa Supabase en la app; la integración (respaldo en la nube) está por definir.
- **Decisión (2026-10-09):** FullStatus **sigue guardando únicamente en Google Drive** (Excel institucional) y `localStorage`/IndexedDB; no se integra Supabase. El proyecto de Supabase existente es de otro sistema (exámenes en línea: `alumnos`, `materias`, `preguntas`, `asignaciones`, `intentos`, `resultados`, `config`) y no debe modificarse desde este repositorio.

### 2026-10-09 — Fechas sin marcas importadas del Excel (`fechasVacias`)
- Nuevo `state.fechasVacias[grupoId][fechaISO] = true`: fechas que existen como columna en el Excel pero sin ninguna marca. `fechasDelGrupo` ahora devuelve fechas con marcas **más** estas; se registran al importar (`registrarFechasVacias` en `cargarGruposExcelDrive`, `restaurarCacheLocal` y `agregarGruposNuevosDeDrive`, que también las añade a grupos ya existentes). La app nunca crea estas fechas por sí sola.
- `compactarColumnasVacias` recibe las fechas protegidas del grupo y no quita esas columnas al sincronizar. Cambiar o eliminar una fecha, y eliminar un grupo, también actualizan `fechasVacias`.
- **Hallazgo:** el 2026-10-09 a las 23:11 una sincronización quitó de la hoja `12F` la columna vacía del 21/09 (era el comportamiento de `compactarColumnasVacias`), por lo que `12F` quedó realmente con 3 fechas en el Excel y en la app. Para tener una cuarta fecha hay que marcar ese día en "Pasar lista".
- Probado solo con datos de ejemplo (`node`), no en la app.

### 2026-10-09 — Botón "Agregar grupos nuevos del Excel"
- **Problema:** la lista de grupos es estado local y solo se refrescaba con "Cargar archivo institucional desde Drive" (que reemplaza todo). Una pestaña creada o existente en el Excel de Drive (ej. `12F`, verificada en el archivo real, que se importa bien: 2 alumnos y 4 fechas) no aparecía en la app.
- **Ahora:** en Grupos, el botón "Agregar grupos nuevos del Excel" (`agregarGruposNuevosDeDrive`) descarga el libro y añade solo las pestañas que no son grupos locales (nunca "Plantilla"), sin reemplazar nada. Se rechaza si hay cambios pendientes (hay que subirlos antes, porque descargar reemplaza la copia local del libro `plantillaExcel`). Solo funciona con el `.xlsx` en Drive, no con hojas de Google nativas.
- Nota: el Excel institucional está sincronizado con Drive para Windows (carpeta `Documentos\UTTECAM SEP-DIC 2026\Lista de asistencia.xlsx` es el mismo archivo que el de Drive).

### 2026-10-09 — Indicador de conexión y cambios sin guardar
- El indicador de la cabecera (`updateConn`) ahora distingue cuatro estados: **En línea · todo guardado** (punto verde), **En línea · cambios sin guardar en Drive** (ámbar), **Sin conexión · tus datos se guardan en este equipo** (rojo) y **Sin conexión · cambios sin guardar en Drive** (rojo).
- **Fallas corregidas:** (1) el color de "sin conexión" nunca se aplicaba, porque la clase `offline` se ponía en el punto pero la regla CSS era `.conn.offline .dot`; ahora la clase va en el contenedor `.conn` (`offline` / `pendiente`). (2) Tras sincronizar con éxito el texto seguía mostrando "cambios pendientes"; `marcarSincronizado` ahora llama a `updateConn`.
- Regla: el indicador debe mostrar siempre estos estados; cualquier cambio que modifique `cambiosPendientes` o la conexión debe llamar a `updateConn`.
- Añadido el estado **Sincronizando con Drive…** (punto azul parpadeante, variable `sincronizando`): se activa al inicio de `guardarEnGoogleDrive` y se apaga en su `finally`. Al cargar grupos desde Drive (`cargarGruposExcelDrive` / `cargarGruposGoogle`) ahora se llama a `marcarSincronizado()`, porque el estado local pasa a ser el de Drive y ya no hay cambios por subir.

### 2026-10-09 — Fuente Inter local (offline)
- La tipografía Inter ya no se descarga de Google Fonts: se usa `fonts/inter-latin-wght-normal.woff2` (variable, pesos 100–900, subconjunto `latin`, 48 KB) declarada con `@font-face` en `styles.css` y licencia en `fonts/OFL.txt` (SIL OFL). Se quitaron los tres `<link>` de Google Fonts de `index.html`, se añadió `.woff2` al mapa MIME de `electron-main.cjs` y `fonts/**/*` a `build.files`.
- La carpeta `fonts/` está versionada en git (no ignorada), así que la fuente queda en el repositorio y en el instalador aunque no haya internet. Pendiente: recompilar y probar el `.exe` sin conexión.

### 2026-10-09 — Proyecto solo de escritorio Windows: se eliminan Android y copias `www/`
- El proyecto se enfoca únicamente en la app de escritorio de Windows (Electron). Eliminados: carpeta `android/` (proyecto Capacitor generado, ignorado por git; no contenía claves), `www/` (copia para Android), `capacitor.config.json`, `sync-www.cjs`, `.github/workflows/build-android-apk.yml` y los scripts `sync:www` / `sync:android` de `package.json`.
- Retirada la versión web y PWA: eliminados `server.cjs`, `Iniciar FullStatus.bat`, `manifest.webmanifest`, el script `start:web`, la etiqueta `<link rel="manifest">` de `index.html`, el tipo MIME `.webmanifest` de `electron-main.cjs` y esos archivos de `build.files`. Para ejecutar la app ahora solo existe `npm run start:windows`.
- Retirado código móvil/Capacitor: `&& !window.Capacitor` en `iniciarGoogleDrive` (`app.js`), la etiqueta `viewport` de `index.html`, los bloques `@media (max-width:700px)` y `(max-width:420px)` de `styles.css` (la ventana de Electron mide 900 px como mínimo) y las propiedades `touch-action`, `-webkit-overflow-scrolling` y `env(safe-area-inset-bottom)`. El comentario "CORREGIDO" de `index.html` se redujo a una línea.
- Pendiente de retirar (opcional, requiere prueba visual): `fallbackCopy` del portapapeles y la clase `is-electron`.
- Retiradas las dependencias `@capacitor/*` (android, core, cli, assets) de `package.json` y regenerado `package-lock.json`; `node_modules` solo conserva `electron` y `electron-builder`. `server.cjs` salió de `build.files` (Electron usa su propio servidor en `electron-main.cjs`).

### 2026-10-09 — La copia local del Excel se actualiza tras sincronizar

- **Falla:** tras subir a Drive, la copia local en IndexedDB (`integratorium_cache_v1`) no se actualizaba. Al reiniciar se restauraba el libro viejo y la siguiente sincronización podía pisar en Drive lo subido antes (otros grupos, fechas nuevas) o resucitar pestañas eliminadas.
- **Ahora:** `guardarEnGoogleDrive` llama a `guardarPlantillaLocal(resultado.buffer)` justo después de una subida exitosa (en su propio `try/catch`, para que un fallo de caché no cuente como fallo de subida).
- Pendiente: probar: pasar lista, sincronizar, reiniciar, sincronizar otro grupo y verificar en Drive que el primero conserve sus datos.

### 2026-10-08 — Eliminar grupo también elimina su pestaña en el Excel
- **Falla:** "Eliminar este grupo" solo borraba el grupo en la app; su pestaña quedaba en el Excel de Drive (ej. la hoja de prueba `12F` seguía en el archivo pero ya no aparecía en la lista de grupos).
- **Ahora:** el nombre del grupo se guarda en `state.hojasPorEliminar` y `crearBufferPlantillaInstitucional` elimina esa pestaña (nunca "Plantilla") en la siguiente sincronización; `marcarSincronizado` vacía la lista. Crear un grupo con el mismo nombre la cancela, y recargar desde Drive también la reinicia. La confirmación avisa del borrado en Excel.
- Limitación: solo aplica a la ruta de Excel (`.xlsx`); no a hojas de Google nativas (`actualizarHojaGoogle`). Las pestañas eliminadas que ya existían antes de este cambio (como `12F`) no se borran solas: se recuperan con "Cargar archivo institucional desde Drive" o se eliminan a mano.

### 2026-10-08 — Unidades/periodos y arreglo del justificante
- **Unidades y periodos:** cada grupo puede definir unidades (nombre + fecha inicial y final, p. ej. 2, 3 o 4 por materia). Se gestionan en Historial → "Unidades y periodos" (`renderUnidades`, `unidadesDelGrupo`, `unidadDeFecha`). El historial tiene un selector "Unidad" que filtra las fechas (`fechasFiltradas`, usado también por `construirMatrizActiva`, así que "Copiar para pegar en Excel" respeta la unidad); la tabla muestra la unidad bajo cada fecha y una línea dorada donde cambia de unidad. Se valida que `hasta >= desde` y que no se empalmen. Se guardan en `grupo.unidades = [{id, nombre, desde, hasta}]` dentro de `localStorage`; **no se escriben en el Excel institucional** y cambiarlas no marca "cambios pendientes".
- **Falla corregida — el botón de justificar no hacía nada en escritorio:** tras confirmar, el código llamaba a `prompt()`, que Electron no soporta (lanza error y se abortaba la acción). Se reemplazó por un cuadro propio (`pedirTexto`, estilos `.modal-fondo`/`.modal-caja`).
- `www/` re-sincronizado.

### 2026-10-08 — Limpieza del proyecto y documentación
- Eliminados: carpeta duplicada `FullStatus/`, `android/app/src/main/assets/public/` (generada), salidas de compilación (`android-build/`, `android/**/build/`, `dist/`), `inspect-header-block.cjs`, `create-plantilla.cjs`, `Logo Cuadrado.jfif` (y su MIME en `server.cjs`/`electron-main.cjs`), `resources/` (copias de los PNG) y los tests de ejemplo de Android.
- Nuevo `sync-www.cjs` y scripts `sync:www` / `sync:android`; `www/` quedó sincronizado con la raíz (incluye `www/vendor/exceljs.min.js`, así Android ya no depende del CDN). El workflow de CI usa `sync:android`.
- `package.json`: target de Windows unificado en `nsis` (se quitó `portable`), `www/**/*` fuera de `build.files`, script `test` vacío eliminado, `@capacitor/cli` movido a `devDependencies`, lockfile regenerado.
- README ampliado (reglas, arquitectura, datos, sincronización, pendientes).

### Fecha de hoy ya no se crea sola
- **Problema:** al seleccionar un grupo con la fecha de hoy se creaba un registro vacío de esa fecha; al sincronizar aparecía una columna vacía en el Excel aunque ese día no hubiera clase.
- **Ahora:** una fecha existe únicamente cuando tiene al menos una marca. Solo mirar un grupo ya no crea nada.
- Si se quitan todas las marcas de un día, la fecha desaparece (y su columna vacía se retira en la siguiente sincronización).
- Cambiar de grupo ya no marca "cambios pendientes" ni dispara sincronizaciones.
- Al abrir la app se limpian las fechas vacías que dejó la versión anterior.

### Anteriores
- ExcelJS local en `vendor/` (antes dependía de un CDN).
- Google Identity Services se carga dinámicamente con reintentos (`asegurarGoogleIdentity`).
- La sincronización ya no vuelve a descargar de Drive si hay un libro local cargado (no pisa ediciones locales).
- `Actualizar` compacta columnas de fecha vacías sin dejar huecos.
- Los grupos nuevos generan su pestaña clonando la hoja "Plantilla".

## Pendientes conocidos

- Exámenes: probar en Electron con Supabase real (materia «Inglés XI» vs «ENGLISH XI», unidad y tipo). Si FullStatus Student debe mostrar los exámenes Remedial/Extraordinario como parte de la misma materia en vez de materias aparte, habría que agregar una columna `tipo_examen` y adaptar la app del alumno.
- Escuelas: falta un botón "Cambiar archivo de Drive" (editar el enlace sin perder grupos; hoy hay que quitar y volver a agregar la escuela, lo que borra sus datos locales) y una protección que impida borrar pestañas cuando el Excel de la escuela no tiene `Plantilla`.
- Escuelas y FullStatus Student: `supabase-asistencias.js` y `supabase-calificaciones.js` solo publican la escuela original; decidir cómo publicar varias escuelas (depende de cómo `publicar_asistencias` trata los grupos ausentes).
- Resultados por escuela: se filtra por nombre de grupo; falta una columna `escuela` en Supabase para no depender de que los nombres coincidan ni de que no se repitan entre escuelas.

- Exámenes: probar en Electron (iframe aislado, sesión compartida con "☁ Alumnos") y contra el Supabase real con una materia de prueba; no hay edición ni borrado de preguntas sueltas (se hace en admin.html); un fallo a la mitad de *Reemplazar* deja preguntas nuevas desactivadas que hay que activar o borrar en admin.html; el análisis ejecuta el script pegado (aislado, pero un ciclo infinito congelaría la ventana hasta que el tope de 10 s lo cancele, si el navegador lo permite).

- Calificaciones: confirmar los nombres de las categorías del modelo nuevo, probar el PDF en Electron, exportar a Excel con el formato de CALIFICACIONES.xlsx y decidir si se sincroniza con Drive. Recompilar con `npm run dist:windows` para verificar que `preload.cjs` entra en el instalador.
- Probar en Electron la regla de totales (1, 2, 3 y 4 retardos, faltas justificadas) y revisar la columna TOTAL del Excel real.
- Si la columna TOTAL de la hoja institucional contiene una fórmula propia, `crearBufferPlantillaInstitucional` la sustituye por el valor calculado (comportamiento previo); confirmar que es lo deseado.
- Unidades: no hay edición (solo agregar/quitar), ni totales de asistencia por unidad en la tabla, ni se importan/exportan al Excel institucional; tampoco se muestra la unidad en "Pasar lista". Probar en Electron.
- Alumnos quitados de un grupo dejan filas viejas en el Excel.
- La sincronización solo escribe el grupo activo (decisión deliberada, pero hay que avisar al usuario).
- Cargar desde Drive no avisa si hay cambios locales sin subir.
- `actualizarHojaGoogle` (hojas de Google nativas) usa `Object.keys(state.asistencias[...])` en vez de `fechasDelGrupo` y `cargarGruposGoogle` no reinicia `fechasVacias`; el archivo real es `.xlsx`, así que casi no se ejecuta.
- Las notas de justificantes (`cell.note`) no se mueven al compactar o eliminar columnas; se regeneran en la siguiente sincronización.
- `electron-main.cjs`: `decodeURIComponent` sin `try/catch` y puerto 5173 fijo (si está ocupado, la app no carga y Google exige ese origen).
- `GOOGLE_SHEET_ID` fijo: `driveFileId` se guarda pero las funciones usan siempre la constante.
- [index.html](index.html): comentario "CORREGIDO" de 17 líneas sobre Google Identity Services; reducirlo a una línea.
- Dependencias: Electron fijado en `^37` (última 44).
- Hacer commit de los cambios sin confirmar.

## Fallas y riesgos conocidos

- **Excel de una escuela sin pestaña `Plantilla`:** al sincronizar, la app no puede crear la hoja de un grupo nuevo (avisa) y además elimina del archivo las pestañas de grupos quitados en la app (p. ej. una `Sheet1` vacía cargada como grupo). Si era la única pestaña, el archivo podría quedar sin hojas. Cada escuela debe usar una copia del Excel institucional con su `Plantilla`.

- `npm run dist:windows` se verificó el 2026-10-08 (genera `dist/FullStatus Setup 1.0.0.exe`); tras retirar Android y Capacitor el 2026-10-09 aún no se ha vuelto a compilar.
- No hay pruebas automatizadas (`npm test` ya no existe).
- `app.js` es un único archivo grande sin módulos; los cambios deben ser pequeños y localizados.

## Mantenimiento de este README

Este documento es la fuente de verdad para personas e IAs. Cada cambio (código, archivos, scripts, configuración) debe reflejarse aquí en la misma sesión: añadir entrada al historial (con fecha y hora), actualizar estructura/arquitectura si cambió, y mover pendientes y fallas según corresponda.
