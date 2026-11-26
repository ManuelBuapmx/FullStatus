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
- **Destino (materia + unidad + tipo):** la **materia** sale de la tabla `materias` de Supabase (las materias base, la misma lista que ve FullStatus Student: p. ej. INGLES 1, INGLES VI, INGLES IX, PEDAGOGIA, ETICA PROFESIONAL), sin las «Materia · Tipo»; las desactivadas se marcan «(desactivada)». Solo si esa tabla viene vacía se usan de respaldo las materias de inglés/Ética de los grupos (`window.FullStatusMateriasGrupos`, definida en `app.js`). La **unidad** (1 a 5) se guarda en `preguntas.seccion` como «Unidad N», que es como FullStatus Student arma su menú; todas las preguntas del script van a esa unidad (las secciones del script ya no se usan como unidad). El **tipo** (Ordinario, Remedial, Extraordinario 1, 2 o 3) **no es una columna nueva**: *Ordinario* usa la materia tal cual y los demás tipos van a una materia aparte llamada «Materia · Tipo» (p. ej. «Inglés XI · Remedial»), que se **crea desactivada** al subir. Así cada tipo tiene su propio horario/asignación en `admin.html` y la pestaña Resultados (que muestra el nombre de la materia como «Tipo de examen») los distingue sin cambios. Los nombres se comparan sin acentos ni mayúsculas. Ya no hay campo «crear materia nueva»: la materia destino se crea sola al subir.
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
# Doble clic: baja lo último y abre FullStatus (equivale a actualizar.ps1 -Probar):
.\FullStatus.bat
```

> Mantén el proyecto fuera de carpetas sincronizadas con Google Drive: causan errores EPERM al compilar con electron-builder.

## Flujo de uso

1. **Grupos:** cargar el archivo institucional desde Drive (queda guardado en el dispositivo).
2. **Pasar lista:** una tarjeta por alumno (Asistencia / Falta). El segundo pase permite convertir faltas en retardos.
3. **Historial y exportar:** consultar, justificar faltas, editar/eliminar fechas, copiar a Excel o actualizar el archivo en Drive.

Reglas: ver "Reglas de conteo (totales)". Una falta justificada cuenta como asistencia (se guarda como `1` con una nota en la celda).

## Historial de cambios

### 2026-11-26 09:39 (hora de México) — Historial: columna "Faltas" por unidad seleccionada

- **Pedido:** en la pestaña Historial y exportar, mostrar el número de faltas de cada alumno en la unidad seleccionada.
- **`app.js` (`renderHistorial`):** nueva columna **Faltas** a la derecha de "Total presente". Cuenta solo las fechas que muestra la tabla, así que al elegir una unidad en el selector "Unidad" (o un rango Desde/Hasta) el número corresponde a ese periodo; con "Todas las unidades" es el total. Si hay una unidad elegida, su nombre aparece bajo el encabezado.
- **Regla de conteo:** faltas sin justificar + 1 por cada 3 retardos (`faltasEquivalentes`, la misma regla de siempre). Las faltas justificadas ("J") no cuentan como falta. Así, para cada alumno: Total presente + Faltas = días mostrados.
- No cambia el modelo de datos, el Excel institucional ni "Copiar para pegar en Excel" (la matriz exportada sigue igual).
- Verificado con `node --check app.js`; falta probarlo visualmente en Electron y Android. Después de copiar el archivo hay que ejecutar `npm run sync:www`.

### 2026-11-25 — Examen de prueba de Pedagogía (Unidad 2) y lista de materias de la pestaña Exámenes

- **Pedido:** crear un examen ficticio de 5 preguntas para la Unidad 2 de Pedagogía (materia de prueba con 2 unidades) y que se vea en FullStatus Student y se guarde una calificación real.
- **Supabase:** `materia_unidades` ← `pedagogia / PEDAGOGÍA / 2` (con esto el alumno ve «Unidad 1: aún no hay examen» y «Unidad 2»); `materias` ← «PEDAGOGÍA · Unidad 2» (id 22, activa, `solo_asignados`: solo la ve el grupo de prueba, ya que `config.grupo_prueba = 12F`, o quien se asigne); `preguntas` ← 5 preguntas de opción múltiple (teorías del aprendizaje, `seccion = 'Unidad 2'`). Nueva política `admin puede leer materia_unidades` (SELECT, solo la cuenta de administrador) y `grant select ... to authenticated`: sin ella FullStatus no podía leer esa tabla (RLS sin políticas).
- **`supabase-examenes.js` (pestaña Exámenes):** la lista de materias salía solo de `materias`, donde hoy solo hay filas de exámenes («INGLÉS VI · Unidad 2»), por eso ofrecía únicamente las materias de inglés/Ética de los grupos. Ahora `cargarMaterias` lee también `materia_unidades` y `materiasDisponibles` junta: materias dadas de alta, materias base sueltas y las que ya tienen examen por unidad (`baseDeExamen`). La lista de **Unidad** ya no es siempre 1-5: usa las unidades de la materia (`unidadesDeLaMateria`; Pedagogía = 2) y, si no está dada de alta o no hay permiso, `MAX_UNIDADES`. Al cambiar de materia, una unidad que ya no existe vuelve a «Unidad 1».
- **FullStatus Student:** sin cambios de código; todo llega por `mis_materias` / `mis_examenes` (verificado: el alumno de prueba ve Pedagogía con Unidad 1 «sin examen» y Unidad 2 «disponible»; un alumno real no ve la materia).
- **Calificación:** `calificar_examen` guarda en `resultados` (matrícula, grupo, correctas, total). En Calificaciones, 12F · Unidad 2 · Exámen se llena solo (5/5 = 10, 4/5 = 8, probado con el motor real y datos simulados).
- **Repetir la prueba:** cada alumno solo tiene un intento por examen (`intentos`); para volver a presentarlo hay que borrar su fila de `intentos` y de `resultados` de la materia 22.
- **Probado solo con `node`** (lógica de la lista y de la captura automática); no en Electron ni en el celular.

### 2026-11-20 — Versión 1.0.1 empaquetada

- Se subió la versión a 1.0.1 en `package.json` y se generó `dist\FullStatus Setup 1.0.1.exe` (`npm run dist:windows`).
- Se revirtió un intento de publicar remediales con `publicar_etapas` (borraba resultados remediales existentes). Pendiente: crear la fila «Materia · Unidad N · Remedial» en Supabase para que el botón aparezca «No disponible» en FullStatus Student.

### 2026-11-20 — Remediales y extraordinarios OFICIALES: se aplican solos desde la nube

- **Pedido:** capturar la «Acción Remedial 1» (PDF de la escuela del 20/11/2026) de 4C, Ética Profesional, Unidad 1: los 5 alumnos que reprobaron la unidad (5, 5, 5, 4 y 4) sacaron 7, 7, 7, 6 y 7 (promedio 6.80, 1 reprobado: Ortiz con 6).
- **Supabase:** tabla nueva `calificaciones_etapas_oficiales` (grupo, materia, unidad, etapa `remedial|ext1|ext2|ext3`, matrícula, total 0-10; RLS activo y sin acceso directo) y RPC `obtener_etapas_oficiales(p_grupo, p_materia)` (solo admin, mismo patrón que `obtener_calificaciones_oficiales`). Ya tiene las 5 filas del remedial de 4C Unidad 1.
- **`app.js` (`aplicarOficialesAutomatico`):** además de los totales oficiales de la unidad, pide `obtener_etapas_oficiales` y guarda cada calificación en `califDatos[grupo][unidad].etapas[etapa][alumno]` (la tabla de Remedial/Extraordinario de la pestaña Calificaciones). **Solo llena celdas vacías:** lo capturado a mano manda. Si la función no existe o falla, se omite sin afectar a los totales de la unidad. Si la unidad falta en local, se trae de la nube como antes.
- **No publica a los alumnos:** el botón «Publicar Remedial a los alumnos» sigue siendo manual.
- **Para oficializar otro remedial/extraordinario:** basta insertar filas en `calificaciones_etapas_oficiales`; la app las toma sola (al abrir, al entrar a Calificaciones, cada 5 min).
- **Probado solo con `node`** (nube simulada): llena los 5, no pisa lo capturado a mano, tolera que la función falle y funciona con la unidad faltante. No se probó en Electron.

### 2026-11-20 (6) — 05:29 UTC (19/11 11:29 p. m., hora de México) — Calificaciones: «Cómo capturas cada columna» va plegado

- **Cambio de usabilidad (`app.js`):** el cuadro con los modos de captura de Exámen, Partic. y Trabajos ocupaba media pantalla arriba de la tabla aunque casi nunca se cambia. Ahora es un `<details>` cerrado que muestra en una línea el modo vigente de cada columna (`resumenModosCalif`, p. ej. «Exámen: 0-10 · Partic.: escala (máx. automático) · Trabajos en clase: escala (máx. 13)») y se despliega con «Cambiar». Si se despliega, queda abierto al redibujar (`modosCalifAbierto`). Los selectores y sus manejadores son los mismos: no cambia ningún cálculo ni dato.

### 2026-11-20 (5) — 05:25 UTC (11:25 p. m. del 19/nov, hora de México) — Un grupo sin unidades las repone solo desde la nube

- **Falla encontrada:** el grupo 12F se quedó sin unidades en Calificaciones («Este grupo no tiene unidades») aunque sus unidades y calificaciones seguían publicadas en Supabase (`unidades` y `calificaciones_unidad`). La rutina automática solo traía las unidades de la nube a los grupos que tenían calificaciones oficiales (`continue` cuando `obtener_calificaciones_oficiales` devolvía vacío).
- **Cambio (`app.js`):** nueva `restaurarGrupoDesdeNube(g, rec)`, usada por `aplicarOficialesAutomatico` ANTES de mirar las oficiales: si el grupo no tiene ninguna unidad, llama a `recuperar_datos_grupo` (una vez por sesión por grupo, o al forzar) y repone unidades y calificaciones publicadas. Es aditiva: no agrega unidades que se empalmen ni repetidas por nombre, solo llena a alumnos sin datos capturados y deja las columnas en modo «Calificación (0-10)» (mismos puntos que ya estaban publicados). Aviso: «Se recuperaron desde la nube las unidades y calificaciones de: …».
- **Límite:** lo que se recupera son los **puntos publicados**, no las capturas originales; lo que nunca se publicó no se puede reponer.

### 2026-11-20 (5b) — Resumen de cambios del 11 al 19 de noviembre que faltaban en este historial

- **Calificaciones → lista «Etapa»** junto a la unidad: Ordinario siempre; Remedial y Extraordinario 1-3 solo si hay reprobados que la necesiten (reprobado = examen capturado y total menor al mínimo del modelo, `CALIF_MINIMA`). Cada etapa tiene su tabla de captura (0-10) y se guarda en `califDatos[grupo][unidad].etapas`. Botón **«Publicar … a los alumnos»** → RPC `publicar_etapas`: la calificación queda como examen «presentado» (correctas = calificación × 10 de 100) en la materia «Materia · Unidad N · Tipo»; a quien no aprobó se le crea (si falta) el siguiente examen sin preguntas, que el alumno ve inactivo («Aún no abre»).
- **Calificaciones → «Pegar participaciones desde Excel»:** pegar nombre + número; se asigna por nombre (exacto, orden distinto, palabras de más o de menos o error de dedo de distancia ≤ 2, solo si es único) a la columna «Partic.» de la unidad a la vista. Pide confirmar si reemplaza valores.
- **Grupos → Estudiantes:** se muestra la matrícula de cada alumno (RPC `consultar_matriculas`) y el botón **Editar** para agregarla o corregirla (RPC `guardar_matricula`, solo admin: en una edición cambia la matrícula también en asistencias, calificaciones, intentos y resultados, todo o nada). Se quitaron los avisos de «nombre parecido».
- **Resultados:** ya no tiene su propio inicio de sesión con correo y contraseña; usa la sesión de «☁ Alumnos».
- **Supabase (funciones):** `_alumno_por_nombre_flexible` (empata por nombre cuando a uno de los dos le sobran o faltan palabras; solo si es único y con ≥ 3 palabras) usada por `consultar_matriculas`, `publicar_asistencias` y `publicar_calificaciones`; `_motivo_no_disponible` (un examen sin preguntas activas se ve inactivo); `_elegible_siguiente_examen` (el Remedial sale a quien reprobó la unidad aunque no haya presentado el ordinario; los Extraordinarios, a quien presentó el examen del tipo anterior y no lo aprobó); trigger que activa solo las materias nuevas (`activa = true`).
- **Regla del proyecto (dicha por el usuario el 11/nov):** el registro de estudiantes (Supabase `alumnos`) y el Excel de Drive deben ser **uno solo**; si un nombre difiere, queda el del Excel. Pendiente: dar de alta en `alumnos` a los alumnos del Excel que aún no existen (4C, 10A, 1C, 7A y algunos de 7B/10B) cuando haya sus matrículas.
- **Forma de trabajo (dicha por el usuario el 19/nov):** los cambios se suben directo a GitHub y a Supabase; no se le entregan archivos.

### 2026-11-20 (4) — Simplificación: se quitan los 3 botones de calificaciones oficiales / recuperación

- **Quitado de Calificaciones:** «Fijar “Unidad X” con las calificaciones oficiales», «Traer unidades que falten desde la nube» y «Recuperar unidades y calificaciones desde la nube» (este último también en los estados vacíos de Calificaciones y de Historial → Unidades), junto con sus funciones manuales `fijarOficialDesdeNube` y `recuperarDesdeNube`.
- **Queda un solo mecanismo:** `aplicarOficialesAutomatico` (al abrir, al entrar a Calificaciones, al volver el internet y cada 5 min). Avisa con un aviso discreto «Calificaciones oficiales aplicadas.» cuando cambia algo y, si el servidor falla, «No se pudieron aplicar las calificaciones oficiales: …» una sola vez por sesión; sin internet reintenta en silencio.
- **Consecuencia:** si el profesor escribe algo a mano en un alumno con total oficial, ese alumno queda sin oficial (`oficialQuitado`) y ya no hay botón para reponerlo; para reponerlo basta borrar el campo `oficialQuitado` de ese alumno en el estado local o volver a cargar el dato.
- La RPC `recuperar_datos_grupo` se conserva: la usa la rutina automática para traer una unidad que falte; `obtener_calificaciones_oficiales` y la tabla `calificaciones_oficiales` no cambian.

### 2026-11-20 (3) — Botón «⟳ Actualizar» dentro de la app (sin terminal)

- **Archivos:** `actualizador.js` (interfaz, cargado desde `index.html`), IPC en `electron-main.cjs` (`fullstatus:actualizar-revisar` / `-aplicar` / `recargar` / `reiniciar`) y `preload.cjs` (`window.fullstatusActualizar`). `actualizador.js` también está en `build.files` de `package.json`.
- **Cómo funciona:** al abrir (8 s) y cada 10 min hace `git fetch` (no cambia nada) y, si hay commits nuevos en `origin/main`, el botón «⟳ Actualizar» (abajo a la derecha) muestra un punto rojo. Al pulsarlo: `git pull --ff-only`; si solo cambiaron archivos de la interfaz recarga la ventana (`reloadIgnoringCache`); si cambió `electron-main.cjs`, `preload.cjs` o `package.json`/`package-lock.json` reinicia la app sola (`app.relaunch`). Si cambió `package.json` avisa por si hace falta `npm install`.
- **Seguridad:** no actualiza si hay cambios locales sin guardar en la carpeta del proyecto (`git status`), solo acepta `--ff-only`, y los IPC solo responden desde `http://localhost:5173`. En web/Android o en el instalador (sin carpeta `.git`) el botón no aparece.
- **Primera vez:** esta versión hay que traerla con `git pull` y reiniciar a mano; desde ahí las siguientes se actualizan con el botón.
- No se actualiza sola a propósito: lo que está en GitHub se ejecuta en esta PC; el botón deja decidir cuándo.

### 2026-11-20 (2) — Remedial automático para alumnos con calificación oficial

- **Falla:** `listasEtapasCalif` solo metía a la lista de Remedial a quien tuviera el examen ordinario capturado en la app. Con calificaciones oficiales (●) no hay examen capturado, así que alumnos reprobados (p. ej. 1C con 6.0, mínimo 7 del modelo nuevo) nunca aparecían.
- **Ahora:** un total oficial cuenta como ordinario cerrado; si es menor al mínimo del modelo (7 nuevo, 8 anterior) el alumno entra solo a la lista de Remedial (y de ahí a Extraordinarios si siguen reprobando). La etapa «Remedial» aparece sola en el selector de Calificaciones. Publicar la etapa a los alumnos (`publicar_etapas`) sigue siendo con el botón.

### 2026-11-20 — Calificaciones oficiales automáticas (sin botón)

- `aplicarOficialesAutomatico` (app.js) aplica solas las calificaciones oficiales de `calificaciones_oficiales` a TODOS los grupos: al abrir la app (4 s después de cargar), al entrar a la pestaña Calificaciones, al volver el internet y cada 5 min (con un mínimo de 60 s entre corridas). Si a un grupo le falta localmente una unidad que tiene oficiales, la trae de la nube (solo agrega: no empalma con otra ni sobrescribe). Sin sesión o sin internet no hace nada y reintenta.
- Si el profesor escribe algo a mano en un alumno, se marca `oficialQuitado` y el automático lo respeta; el botón «Fijar…» sigue disponible para volver a fijarlo.
- Para oficializar otra unidad/grupo basta insertar sus filas en `calificaciones_oficiales`; la app las toma sola.

### 2026-11-19 (noche, 3) — La sesión de Supabase ya no se cierra sola (solo Electron para el auto-reingreso)

- **Falla:** había que volver a iniciar sesión con frecuencia. Causas en `supabase-asistencias.js`: (1) cualquier error del servidor (429/500/503) se trataba como «sesión inválida» y borraba el token guardado; (2) varias llamadas simultáneas (subida automática, Exámenes, Calificaciones) renovaban a la vez con el mismo `refresh_token`, Supabase lo rota en cada uso y rechazaba la segunda, que cerraba la sesión.
- **Ahora:** solo 400/401/403/422 cuentan como rechazo; una sola renovación a la vez (promesa compartida); si otra llamada ya rotó el token se prueba con el más nuevo; se guarda también el `access_token` vigente (al abrir la app no se renueva si sigue válido); y, como último recurso, la app **vuelve a entrar sola** con el correo y la contraseña guardados.
- **Credenciales:** se guardan cifradas con `safeStorage` de Electron (DPAPI en Windows, solo este usuario de este equipo) en `<userData>/secretos.bin`, vía `window.fullstatusSecretos` (`preload.cjs`, IPC `fullstatus:secreto-*` en `electron-main.cjs`, solo desde `http://localhost:5173`). Solo «Cerrar sesión» las borra. Si la contraseña cambia en Supabase, se pide una vez. En web/Android no hay `safeStorage`: queda el token de renovación.
- **Para activarlo:** reiniciar Electron (cambió el proceso principal) e iniciar sesión **una vez** con el botón ☁.

### 2026-11-19 (noche, 2) — Total oficial por alumno (documento de la escuela) en Calificaciones

- **Por qué:** la app calcula y publica los totales desde lo capturado en local (`califDatos`) y `publicar_calificaciones` reemplaza lo de la nube; si el documento oficial de la escuela difiere de lo capturado, cualquier corrección hecha solo en Supabase se perdía en la siguiente sincronización.
- **Qué:** cada alumno de una unidad puede traer `oficial` (total 0-10). Si existe, manda sobre el total calculado (`calcularCalificaciones`), se marca con ● y se publica tal cual: `supabase`/`FullStatusCalifExport` manda `extra = oficial − (asistencias + trabajos + participación + examen)` para que la suma cuadre, y el examen deja de publicarse como «vacío» (la unidad ya está cerrada). Escribir cualquier celda a mano en ese alumno quita su `oficial`.
- **Botón** «Fijar “Unidad X” con las calificaciones oficiales» (pestaña Calificaciones): llama a la RPC `obtener_calificaciones_oficiales(p_grupo, p_materia)` (solo lectura, solo admin) y fija el total por nombre. No borra lo capturado y se puede repetir.
- **Supabase:** tabla `calificaciones_oficiales (grupo, materia, unidad, matricula, total, fuente)` con RLS sin políticas (solo se lee por la RPC). Cargadas: 7A Unidad 1 y 2 (30 alumnos, «Evaluaciones.pdf» del 18/11/2026) y 7B Unidad 1 (31 alumnos, «Evaluaciones (1).pdf» del 19/11/2026). 7B ahora tiene también la unidad «Unidad 1» (2026-09-02 a 2026-10-14; fechas inferidas: la «Unidad 2» de 7B empieza el 2026-10-15).
- Para cargar otro documento oficial: insertar sus filas en `calificaciones_oficiales` y pulsar el botón en esa unidad.

### 2026-11-19 (noche) — Falla: al recargar desde Drive se perdían unidades y calificaciones (también en Supabase)

- **Falla:** `cargarGruposExcelDrive` y la carga desde Google Sheets daban un id nuevo (`uid()`) a cada grupo y a cada alumno. Las unidades (`grupo.unidades`), las calificaciones capturadas (`califDatos[grupoId]`) y los justificantes viven en el estado local ligados a esos ids, así que se quedaban huérfanos. Además `publicar_asistencias` y `publicar_calificaciones` reemplazan en Supabase TODO lo de un `origen_grupo` con lo que manda la app: el grupo "nuevo" mandaba `unidades: []` y sin calificaciones, y la nube quedaba sin ellas (los datos viejos quedaban bajo el id anterior, sin que la app los viera).
- **Ahora:** `conservarIdentidadGrupos` (app.js) reutiliza el id, las unidades y los ids de los alumnos (por nombre) de los grupos que ya existían (mismo nombre y materia) y re-liga las asistencias a esos ids. `supabase-asistencias.js` ya no manda la clave `unidades` si el grupo nunca tuvo ese arreglo (así un grupo sin unidades locales no borra las de Supabase); si el profesor quita todas, `g.unidades` queda `[]` y sí se borran.
- **Recuperación:** botón «Recuperar unidades y calificaciones desde la nube» (Calificaciones y Historial → Unidades, cuando el grupo no tiene unidades). Llama a la RPC nueva `recuperar_datos_grupo(p_grupo, p_materia)` (solo lectura, solo admin). Es aditivo: no sobrescribe unidades ni alumnos con datos capturados; las columnas recuperadas quedan en modo «Calificación (0-10)» (mismos puntos que ya estaban publicados). Los alumnos se enlazan por nombre.
- Supabase: migración `recuperar_datos_grupo_rpc`; respaldos `respaldo_20261118_*` y `respaldo_20261119_*` (unidades, calificaciones_unidad, asistencias).
- Pendiente: las filas con el `origen_grupo` anterior siguen en Supabase (asistencias, unidades, calificaciones duplicadas); limpiar con cuidado cuando todo esté verificado.

### 2026-11-11 (tarde) — Calificaciones: el examen automático ya no pierde alumnos con el nombre escrito distinto

- **Falla encontrada:** Dimas Juárez (examen 40/40 guardado a las 9:17) y Karla Pérez (26/40) no se capturaron solos. En el examen escribieron su nombre distinto al de la lista (JUAREZ/JUARES, MARTINEZ/MATINEZ). El empate por matrícula depende de la lectura `consultar_matriculas`; si no estaba disponible, `aplicarExamenesAuto` caía a nombre **exacto** y fallaba en silencio (comprobado con los datos reales: el código anterior daba 5 capturados y 4 sin examen, el nuevo 7 y 2).
- **Cambio en `aplicarExamenesAuto` (`app.js`):** el empate va por pasos: 1) matrícula resuelta, 2) matrícula «posible» sugerida por el servidor, 3) nombre exacto, 4) nombre casi igual (distancia de edición ≤ 2, único, mismo grupo, sin examen ya usado por otro). Un examen con la matrícula de otro alumno del grupo nunca se asigna por nombre. La consulta de `resultados` ahora pide también `grupo`.
- **Avisos en la línea «Exámen automático»:** exámenes terminados del grupo que no se pudieron relacionar con nadie (nombre y matrícula), calificaciones capturadas a mano distintas de la del examen, y si las matrículas no se pudieron leer (se relaciona solo por nombre). Antes el hueco pasaba sin avisar.
- **Probado solo con `node`** simulando los datos reales de hoy (matrículas cargadas, sin caché, con error de lectura, calificación manual distinta, examen sin dueño, examen de otro grupo). No se probó en Electron.

### 2026-11-10 (noche) — Exámenes: aviso cuando Supabase no devuelve materias

- La tarjeta «Destino del examen» muestra un aviso en rojo si la lectura de `materias` devuelve 0 filas (la lista cae al respaldo de los grupos). Sirve para detectar sesión sin permisos de administrador o tabla vacía (`supabase-examenes.js`).

### 2026-11-10 (noche) — Exámenes: la lista de materias sale de Supabase

- **Falla corregida:** la lista salía de los grupos y no coincidía con FullStatus Student (aparecía «Ética» repetida, faltaba «Pedagogía» y «Inglés I» no coincidía con «INGLES 1»). Ahora sale de la tabla `materias` (materias base) y solo cae a los grupos si la tabla viene vacía (`supabase-examenes.js`).

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
