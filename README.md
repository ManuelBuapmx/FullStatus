# FullStatus

Registro institucional de asistencia. Funciona sin conexión (offline-first) y,
cuando hay internet, sincroniza con el Excel institucional en Google Drive.

## Principios del proyecto

- **Offline primero:** ninguna función central (importar/exportar Excel, guardar datos) debe depender de internet.
- **Fidelidad a la plantilla:** los datos se escriben dentro del Excel institucional original (celdas combinadas, colores, fórmulas, estructura). Nunca se genera un archivo "parecido".
- **Anchos de columna:** nunca se modifican al insertar fechas o alumnos.

## Reglas obligatorias para quien modifique el proyecto (personas e IAs)

1. **Actualizar este README en cada cambio, sin excepción:** funciones nuevas o modificadas, fallas encontradas, mejoras, cambios pendientes, archivos creados/borrados, comandos y decisiones. Registrar en "Historial de cambios" **con fecha y hora (hora de Ciudad de México)** y mantener al día "Pendientes conocidos" y "Fallas conocidas".
2. **La hoja "Plantilla" del Excel institucional es intocable:** nunca borrarla, renombrarla ni escribir datos en ella (ni en scripts de diagnóstico). Solo se lee para clonar hojas de grupos nuevos. Debe permanecer vacía/neutral. Si un cambio podría tocarla, detenerse y preguntar.
3. **Tamaños de celda idénticos a "Plantilla":** anchos de columna y altos de fila de cada hoja de grupo deben ser iguales a los de "Plantilla". Si el texto no cabe, reducir el tamaño de fuente; nunca redimensionar celdas.
4. **Fechas de Excel siempre en UTC:** escribir con `Date.UTC(...)` (`excelFechaSerial`) y leer con `getUTCFullYear/getUTCMonth/getUTCDate`. Leer con getters locales desplaza un día en zonas UTC negativas (México) y duplica columnas.
5. **No asumir que las fechas empiezan en la columna de nombre + 1:** en la hoja real son `ALUMNO`, `Grupo`, `No. EQUIPO` y después las fechas (el bloque empieza en la primera cabecera que sea `Date`). `Grupo` y `No. EQUIPO` nunca se tocan al mover/compactar columnas de fechas ni al limpiar filas de alumnos.
6. **Antes de editar en lote el xlsx real:** hacer copia, simulación (dry-run), comparar encabezados contra la copia y pedir confirmación.
7. **Proyecto solo de escritorio Windows (Electron):** ya no hay versión Android ni carpeta `www/`; no hay que sincronizar copias. Se edita directamente `app.js`, `index.html`, `styles.css` y `vendor/`.
8. No subir credenciales, tokens ni datos personales de asistencia.
9. Mantener el idioma español de la interfaz y el estilo visual existente.
10. **Entregar archivos completos y comentados:** cada cambio se entrega como archivo completo listo para reemplazar (nunca fragmentos), con comentarios en el código que indiquen qué se cambió, por qué, la fecha y la hora, y qué reglas de este README se respetan.
11. No usar `confirm()`, `alert()` ni `prompt()` nativos (Electron); usar `confirmar` / `pedirTexto`.

## Plataformas y arquitectura

Aplicación web de una sola página, en JavaScript puro (sin framework ni bundler), que se usa como programa de escritorio de Windows (Electron). Los destinos Android y web quedaron descartados.

| Destino | Cómo funciona |
|---|---|
| Windows (Electron) | `electron-main.cjs` levanta un servidor local interno en el puerto 5173 y abre una ventana apuntando a él (necesario para el inicio de sesión de Google). Sirve la carpeta raíz. Se empaqueta con electron-builder (target `nsis`). |

- **Archivo de lógica único:** `app.js` (~1800 líneas) es una IIFE con todo el código; `index.html` solo contiene el esqueleto (cabecera, 4 pestañas, panel y toast) y `app.js` renderiza el resto.
- **Pestañas:** `Grupos` (crear grupos, alumnos, cargar de Drive), `Pasar lista` (una tarjeta por alumno; segundo pase para convertir faltas en retardos), `Historial y exportar` (consultar, justificar, editar/eliminar/renombrar fechas, copiar al portapapeles, descargar xlsx, actualizar Drive) y `Resultados` (Supabase, solo lectura).
- **Dependencias externas en ejecución:** Google Identity Services (`accounts.google.com/gsi/client`, se carga con reintentos por `asegurarGoogleIdentity`). ExcelJS (`vendor/`) y la fuente Inter (`fonts/`) son locales. Todo lo demás es offline.

## Datos y persistencia

| Clave / almacén | Contenido |
|---|---|
| `localStorage` `listaAsistenciaData_v2` | Estado: `{ grupos, grupoActivoId, asistencias, justificantes, hojasPorEliminar, fechasVacias }` |
| `localStorage` `listaAsistenciaCambiosPendientes_v1` | `"1"` si hay cambios sin subir a Drive |
| `localStorage` `listaAsistenciaDriveFileId_v1` | Id del archivo de Drive usado |
| `localStorage` `listaAsistenciaGoogleDriveAuth_v3` | Marca de que ya se concedió permiso (evita pedir consentimiento otra vez) |
| IndexedDB `integratorium_cache_v1` | Copia local del Excel institucional (`plantillaExcel`) para trabajar sin conexión; se restaura al iniciar con `restaurarCacheLocal` |

Modelo: `grupos[] = { id, nombre, estudiantes: [{id, nombre}], materia, profesor, unidades?: [{id, nombre, desde, hasta}] }`; `asistencias[grupoId][fechaISO][estudianteId]` con estados `P` (asistencia, exporta `1`), `A` (falta, `0`) y `R` (retardo, `2`); `justificantes[grupoId][fechaISO][estudianteId] = { nota }`. Una fecha existe solo si tiene al menos una marca (`purgarFechasVacias` limpia las vacías al cargar), salvo las importadas del Excel sin marcas (`fechasVacias`). **No cambiar estas claves ni el formato sin plan de migración.**

## Sincronización con Google Drive / Excel institucional

- Autenticación OAuth con Google Identity Services (scopes `drive` y `spreadsheets`); el client id está en `app.js` (es público por diseño; el origen debe estar registrado en Google Cloud Console).
- El archivo institucional (`Lista de asistencia.xlsx`) se descarga con `descargarWorkbookInstitucional`; si el archivo es una hoja de Google nativa se usa la ruta `actualizarHojaGoogle` (API de Sheets).
- `guardarEnGoogleDrive` solo descarga el libro si no hay copia local (`plantillaExcel`) para no pisar ediciones locales; luego `crearBufferPlantillaInstitucional` escribe las marcas **solo del grupo activo** y se sube con PATCH.
- Grupos nuevos: se clonan de la hoja "Plantilla" (`clonarHojaDesdePlantilla`); si no existe esa pestaña la creación falla con aviso.
- Auto-sincronización: `autoSincronizarCambios` / `sincronizarPendientes` suben cuando hay internet y cambios pendientes.
- Al sincronizar un grupo, `crearBufferPlantillaInstitucional` escribe los alumnos en orden alfabético desde la primera fila y **limpia las filas sobrantes** (hasta `headerRow + 32`) para que un alumno quitado no deje datos duplicados.
- Funciones clave en `app.js`: `extraerGrupoDeHoja`, `encontrarEncabezadoAlumno`, `limiteColumnaAsistencias`, `eliminarFechaDeHoja`, `renombrarFechaEnHoja`, `compactarColumnasVacias`, `construirMatrizActiva`, `descargarXlsxCompleto`, `faltasEquivalentes` (3 retardos = 1 falta), `confirmar`, `pedirTexto`.

## Estructura

| Archivo | Descripción |
|---|---|
| `index.html`, `styles.css`, `app.js` | Aplicación (interfaz y lógica) |
| `vendor/exceljs.min.js` | ExcelJS local (para funcionar sin internet) |
| `fonts/` | Fuente Inter local (`inter-latin-wght-normal.woff2`) y su licencia `OFL.txt` |
| `electron-main.cjs` | Ventana de escritorio (Windows) y servidor local |
| `package.json` | Scripts (`start:windows`, `dist:windows`) y configuración de electron-builder |
| `FS.png`, `FullStatus.png` | Icono de la app y logo de arranque |
| `.github/agents/fullstatus-maintainer.agent.md` | Instrucciones del agente de mantenimiento de Copilot |

Ignorados por git: `node_modules/`, `dist/`, `android/`, `android-build/`, `*.log`.

## Comandos

```
npm run start:windows    # ventana de escritorio con Electron
npm run dist:windows     # instalador de Windows (electron-builder)
```

> Mantén el proyecto fuera de carpetas sincronizadas con Google Drive: causan errores EPERM al compilar con electron-builder.

## Flujo de uso

1. **Grupos:** cargar el archivo institucional desde Drive (queda guardado en el dispositivo).
2. **Pasar lista:** una tarjeta por alumno (Asistencia / Falta). El segundo pase permite convertir faltas en retardos.
3. **Historial y exportar:** consultar, justificar faltas, editar/eliminar fechas, copiar a Excel o actualizar el archivo en Drive.

Reglas: 3 retardos = 1 falta equivalente. Una falta justificada cuenta como asistencia (se guarda como `1` con una nota en la celda).

## Historial de cambios

> Formato: `AAAA-MM-DD hh:mm a. m./p. m. (hora de Ciudad de México)`. Las entradas anteriores al 2026-10-10 12:35 a. m. solo tienen fecha porque no se registró la hora.

### 2026-10-10 12:35 a. m. — Falla: al quitar un alumno, el Excel lo dejaba duplicado
- **Síntoma (hoja `12F`):** tras quitar un alumno en la app y sincronizar, el Excel mostraba dos filas idénticas (mismo nombre, número y marcas 2, 0, 0, 1) en las filas 16 y 17.
- **Causa:** `crearBufferPlantillaInstitucional` escribe los alumnos que quedan en orden alfabético desde la fila 16. La fila final que ya no correspondía a nadie conservaba los datos del alumno anterior (por ejemplo, con dos alumnos A y B, al quitar A, B subía a la fila 16 y la fila 17 seguía con B).
- **Arreglo (`app.js`):** después de escribir a los alumnos, se limpian las filas sobrantes desde `headerRow + 1 + cantidad de alumnos` hasta `headerRow + 32`: número (`No.`), nombre, marcas y notas de las columnas de fecha, y `Total`. Solo se borran valores; no se tocan estilos, anchos ni altos, ni `Grupo`, `No. EQUIPO` ni `EVALUACIÓN`, ni la hoja "Plantilla".
- **Datos ya afectados:** la fila duplicada existente se limpia sola en la siguiente sincronización del grupo (`Actualizar en Google Drive`). Si la app no marca cambios pendientes, quitar y volver a agregar un alumno de prueba fuerza la subida, o se borra la fila a mano en Excel.
- Probado solo leyendo el código y con la captura de la hoja; **pendiente probar en Electron** (quitar un alumno → Actualizar → revisar el Excel en Drive).
- Documentación: el README ahora exige fecha y hora en cada entrada y entrega de archivos completos y comentados (reglas 1 y 10); se corrigió la nota desactualizada del `confirm()` en `importarArchivoExcel` (esa función ya no existe) y se quitó de pendientes el uso de `confirm()` nativo (ya resuelto).

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

- Probar en Electron la limpieza de filas sobrantes al quitar alumnos (2026-10-10 12:35 a. m.): quitar un alumno, sincronizar y revisar el Excel en Drive.
- Unidades: no hay edición (solo agregar/quitar), ni totales de asistencia por unidad en la tabla, ni se importan/exportan al Excel institucional; tampoco se muestra la unidad en "Pasar lista". Probar en Electron (probado solo con `node --check`).
- La sincronización solo escribe el grupo activo (decisión deliberada, pero hay que avisar al usuario).
- Cargar desde Drive no avisa si hay cambios locales sin subir.
- La limpieza de filas sobrantes solo aplica a la ruta de Excel (`.xlsx`); la ruta de hojas de Google nativas (`actualizarHojaGoogle`) no la tiene.
- [index.html](index.html): comentario "CORREGIDO" de 17 líneas sobre Google Identity Services; reducirlo a una línea.
- Dependencias: Electron fijado en `^37` (última 44).
- Hacer commit de los cambios sin confirmar (`app.js`, `README.md`, `package.json`, archivos eliminados).

## Fallas y riesgos conocidos

- `npm run dist:windows` se verificó el 2026-10-08 (genera `dist/FullStatus Setup 1.0.0.exe`); tras retirar Android y Capacitor el 2026-10-09 aún no se ha vuelto a compilar.
- No hay pruebas automatizadas (`npm test` ya no existe).
- `app.js` es un único archivo grande sin módulos; los cambios deben ser pequeños y localizados.

## Mantenimiento de este README

Este documento es la fuente de verdad para personas e IAs. Cada cambio (código, archivos, scripts, configuración) debe reflejarse aquí en la misma sesión: añadir entrada al historial **con fecha y hora**, actualizar estructura/arquitectura si cambió, y mover pendientes y fallas según corresponda.
