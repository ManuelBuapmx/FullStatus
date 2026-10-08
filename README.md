# FullStatus

Registro institucional de asistencia. Funciona sin conexión (offline-first) y,
cuando hay internet, sincroniza con el Excel institucional en Google Drive.

## Principios del proyecto

- **Offline primero:** ninguna función central (importar/exportar Excel, guardar datos) debe depender de internet.
- **Fidelidad a la plantilla:** los datos se escriben dentro del Excel institucional original (celdas combinadas, colores, fórmulas, estructura). Nunca se genera un archivo "parecido".
- **Anchos de columna:** nunca se modifican al insertar fechas o alumnos.

## Reglas obligatorias para quien modifique el proyecto (personas e IAs)

1. **Actualizar este README en cada cambio, sin excepción:** funciones nuevas o modificadas, fallas encontradas, mejoras, cambios pendientes, archivos creados/borrados, comandos y decisiones. Registrar en "Historial de cambios" y mantener al día "Pendientes conocidos" y "Fallas conocidas".
2. **La hoja "Plantilla" del Excel institucional es intocable:** nunca borrarla, renombrarla ni escribir datos en ella (ni en scripts de diagnóstico). Solo se lee para clonar hojas de grupos nuevos. Debe permanecer vacía/neutral. Si un cambio podría tocarla, detenerse y preguntar.
3. **Tamaños de celda idénticos a "Plantilla":** anchos de columna y altos de fila de cada hoja de grupo deben ser iguales a los de "Plantilla". Si el texto no cabe, reducir el tamaño de fuente; nunca redimensionar celdas.
4. **Fechas de Excel siempre en UTC:** escribir con `Date.UTC(...)` (`excelFechaSerial`) y leer con `getUTCFullYear/getUTCMonth/getUTCDate`. Leer con getters locales desplaza un día en zonas UTC negativas (México) y duplica columnas.
5. **No asumir que las fechas empiezan en la columna de nombre + 1:** en la hoja real son `ALUMNO`, `Grupo`, `No. EQUIPO` y después las fechas (el bloque empieza en la primera cabecera que sea `Date`). `Grupo` y `No. EQUIPO` nunca se tocan al mover/compactar columnas de fechas.
6. **Antes de editar en lote el xlsx real:** hacer copia, simulación (dry-run), comparar encabezados contra la copia y pedir confirmación.
7. **Después de cambiar `app.js`, `index.html`, `styles.css` o `vendor/`:** ejecutar `npm run sync:www` para que Android no quede desfasado.
8. No subir credenciales, tokens ni datos personales de asistencia.
9. Mantener el idioma español de la interfaz y el estilo visual existente.

## Plataformas y arquitectura

Aplicación web de una sola página, en JavaScript puro (sin framework ni bundler), empaquetada para tres destinos:

| Destino | Cómo funciona |
|---|---|
| Web | `server.cjs` sirve la carpeta raíz en `http://localhost:5173` (`npm run start:web` o `Iniciar FullStatus.bat`). |
| Windows (Electron) | `electron-main.cjs` levanta un servidor local interno en el puerto 5173 y abre una ventana apuntando a él (necesario para el inicio de sesión de Google). Sirve la carpeta raíz. Se empaqueta con electron-builder (target `nsis`). |
| Android (Capacitor) | Usa la carpeta `www/` (`webDir`). `www/` es una **copia generada** de la raíz con `npm run sync:www`; no editar a mano. |

- **Archivo de lógica único:** `app.js` (~1800 líneas) es una IIFE con todo el código; `index.html` solo contiene el esqueleto (cabecera, 3 pestañas, panel y toast) y `app.js` renderiza el resto.
- **Pestañas:** `Grupos` (crear grupos, alumnos, importar Excel, cargar de Drive), `Pasar lista` (una tarjeta por alumno; segundo pase para convertir faltas en retardos) e `Historial y exportar` (consultar, justificar, editar/eliminar/renombrar fechas, copiar al portapapeles, descargar xlsx, actualizar Drive).
- **Dependencias externas en ejecución:** ExcelJS (local en `vendor/exceljs.min.js`) y Google Identity Services (`accounts.google.com/gsi/client`, se carga con reintentos por `asegurarGoogleIdentity`). Todo lo demás es offline.

## Datos y persistencia

| Clave / almacén | Contenido |
|---|---|
| `localStorage` `listaAsistenciaData_v2` | Estado: `{ grupos, grupoActivoId, asistencias, justificantes }` |
| `localStorage` `listaAsistenciaCambiosPendientes_v1` | `"1"` si hay cambios sin subir a Drive |
| `localStorage` `listaAsistenciaDriveFileId_v1` | Id del archivo de Drive usado |
| `localStorage` `listaAsistenciaGoogleDriveAuth_v3` | Marca de que ya se concedió permiso (evita pedir consentimiento otra vez) |
| IndexedDB `integratorium_cache_v1` | Copia local del Excel institucional (`plantillaExcel`) para trabajar sin conexión; se restaura al iniciar con `restaurarCacheLocal` |

Modelo: `grupos[] = { id, nombre, estudiantes: [{id, nombre}], materia, profesor, unidades?: [{id, nombre, desde, hasta}] }`; `asistencias[grupoId][fechaISO][estudianteId]` con estados `P` (asistencia, exporta `1`), `A` (falta, `0`) y `R` (retardo, `2`); `justificantes[grupoId][fechaISO][estudianteId] = { nota }`. Una fecha existe solo si tiene al menos una marca (`purgarFechasVacias` limpia las vacías al cargar). **No cambiar estas claves ni el formato sin plan de migración.**

## Sincronización con Google Drive / Excel institucional

- Autenticación OAuth con Google Identity Services (scopes `drive` y `spreadsheets`); el client id está en `app.js` (es público por diseño; el origen debe estar registrado en Google Cloud Console).
- El archivo institucional (`Lista de asistencia.xlsx`) se descarga con `descargarWorkbookInstitucional`; si el archivo es una hoja de Google nativa se usa la ruta `actualizarHojaGoogle` (API de Sheets).
- `guardarEnGoogleDrive` solo descarga el libro si no hay copia local (`plantillaExcel`) para no pisar ediciones locales; luego `crearBufferPlantillaInstitucional` escribe las marcas **solo del grupo activo** y se sube con PATCH.
- Grupos nuevos: se clonan de la hoja "Plantilla" (`clonarHojaDesdePlantilla`); si no existe esa pestaña la creación falla con aviso.
- Auto-sincronización: `autoSincronizarCambios` / `sincronizarPendientes` suben cuando hay internet y cambios pendientes.
- Funciones clave en `app.js`: `extraerGrupoDeHoja`, `importarArchivoExcel`, `encontrarEncabezadoAlumno`, `limiteColumnaAsistencias`, `eliminarFechaDeHoja`, `renombrarFechaEnHoja`, `compactarColumnasVacias`, `construirMatrizActiva`, `descargarXlsxCompleto`, `faltasEquivalentes` (3 retardos = 1 falta).

## Estructura

| Archivo | Descripción |
|---|---|
| `index.html`, `styles.css`, `app.js` | Aplicación (interfaz y lógica) |
| `vendor/exceljs.min.js` | ExcelJS local (para funcionar sin internet) |
| `server.cjs` | Servidor local para la versión web (`http://localhost:5173`) |
| `electron-main.cjs` | Ventana de escritorio (Windows) |
| `capacitor.config.json` | Configuración de la app Android (Capacitor, `webDir: www`) |
| `sync-www.cjs` | Copia la app de la raíz a `www/` (fuente de Android) |
| `www/` | Copia generada para Capacitor; no editar a mano |
| `manifest.webmanifest` | Manifiesto PWA |
| `Iniciar FullStatus.bat` | Arranca el servidor local y abre el navegador |
| `package.json` | Scripts (`start:web`, `start:windows`, `dist:windows`, `sync:www`, `sync:android`) y configuración de electron-builder |
| `FS.png`, `FullStatus.png` | Icono de la app y logo de arranque |
| `.github/workflows/build-android-apk.yml` | CI: `npm install`, `cap add android`, `npm run sync:android` y compila el APK debug |
| `.github/agents/fullstatus-maintainer.agent.md` | Instrucciones del agente de mantenimiento de Copilot |
| `android/` | Proyecto Android generado por Capacitor (ignorado por git; se recrea en CI) |

Ignorados por git: `node_modules/`, `dist/`, `android/`, `android-build/`, `*.log`.

## Comandos

```
npm run start:web        # servidor local en http://localhost:5173
npm run start:windows    # ventana de escritorio con Electron
npm run dist:windows     # instalador de Windows (electron-builder)
npm run sync:www         # copia la app de la raíz a www/
npm run sync:android     # sync:www + cap sync android
```

> Mantén el proyecto fuera de carpetas sincronizadas con Google Drive: causan errores EPERM al compilar con electron-builder.

## Flujo de uso

1. **Grupos:** cargar el archivo institucional desde Drive (queda guardado en el dispositivo).
2. **Pasar lista:** una tarjeta por alumno (Asistencia / Falta). El segundo pase permite convertir faltas en retardos.
3. **Historial y exportar:** consultar, justificar faltas, editar/eliminar fechas, copiar a Excel o actualizar el archivo en Drive.

Reglas: 3 retardos = 1 falta equivalente. Una falta justificada cuenta como asistencia (se guarda como `1` con una nota en la celda).

## Historial de cambios

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

- Unidades: no hay edición (solo agregar/quitar), ni totales de asistencia por unidad en la tabla, ni se importan/exportan al Excel institucional; tampoco se muestra la unidad en "Pasar lista". Probar en Electron y Android (probado solo con `node --check`).
- Uso de `confirm()` nativo para varias acciones; funciona en Electron pero conviene unificarlo con el cuadro propio.
- Alumnos quitados de un grupo dejan filas viejas en el Excel.
- La sincronización solo escribe el grupo activo (decisión deliberada, pero hay que avisar al usuario).
- Cargar desde Drive no avisa si hay cambios locales sin subir.
- [index.html](index.html): comentario "CORREGIDO" de 17 líneas sobre Google Identity Services; reducirlo a una línea.
- Dependencias: parches de Capacitor 8.5.1 → 8.5.3 disponibles; Electron fijado en `^37` (última 44).
- `@capacitor/assets` quedó sin uso tras eliminar `resources/`; quitarlo o recrear `resources/icon.png` y `resources/splash.png` si se regeneran iconos.
- Hacer commit de los cambios sin confirmar (`app.js`, `index.html`, `README.md`, `package.json`, workflow, `www/`, `sync-www.cjs`, borrados).

## Fallas y riesgos conocidos

- **Sin verificar tras la limpieza del 2026-10-08:** `npm run sync:android` y compilaci\u00f3n del APK; en Android no se ha comprobado que ExcelJS cargue desde `www/vendor/`. (`npm run dist:windows` ya se verific\u00f3 el 2026-10-08: genera `dist/FullStatus Setup 1.0.0.exe`, 92.5 MB; aviso de electron-builder por referencia duplicada de `@capacitor/core`, sin impacto.)
- `www/index.html` ahora es copia de la raíz e incluye el script que añade la clase `is-electron`; es inofensivo en Android pero no se ha probado visualmente.
- No hay pruebas automatizadas (`npm test` ya no existe).
- `app.js` es un único archivo grande sin módulos; los cambios deben ser pequeños y localizados.
- Si se compila Android en local, ejecutar antes `npm run sync:android` (la carpeta `assets/public` ya no existe hasta sincronizar).

## Mantenimiento de este README

Este documento es la fuente de verdad para personas e IAs. Cada cambio (código, archivos, scripts, configuración) debe reflejarse aquí en la misma sesión: añadir entrada al historial, actualizar estructura/arquitectura si cambió, y mover pendientes y fallas según corresponda.
