// Pone fecha y hora a las entradas del README de hoy y completa datos, funciones,
// fallas y pendientes de los cambios de la sesión (escuelas, resultados, fix columna 0).
// Uso (desde la carpeta del proyecto):  node actualizar-readme.cjs
// Es seguro repetirlo: si algo ya está aplicado, lo omite. No toca app.js.
const fs = require("fs");
if(!fs.existsSync("README.md")) throw new Error("No encuentro README.md en esta carpeta.");
let t = fs.readFileSync("README.md", "utf8");
const cambios = [];
function eol(){ return t.includes("\r\n") ? "\r\n" : "\n"; }

// 1) Hora en los encabezados de hoy (hora de Ciudad de México, aproximada)
const horas = [
  ["### 2026-10-10 — Pantalla de inicio: elegir escuela", "### 2026-10-10 01:25 a. m. — Pantalla de inicio: elegir escuela"],
  ["### 2026-10-10 — Fix: error \"0 is out of bounds\" al actualizar Drive", "### 2026-10-10 01:34 a. m. — Fix: error \"0 is out of bounds\" al actualizar Drive"],
  ["### 2026-10-10 — Resultados filtrados por escuela", "### 2026-10-10 01:52 a. m. — Resultados filtrados por escuela"],
  ["### 2026-10-10 — Filtro \"Tipo de examen\" por escuela", "### 2026-10-10 01:55 a. m. — Filtro \"Tipo de examen\" por escuela"]
];
horas.forEach(function(p){
  if(t.includes(p[0])){ t = t.replace(p[0], p[1]); cambios.push("hora: " + p[1].slice(4, 31)); }
});
const NOTA_HORA = "_Horas en horario de Ciudad de México. Las de las entradas del 2026-10-10 posteriores a las 00:44 son aproximadas (tomadas del reloj de las capturas de pantalla de la sesión)._";
if(!t.includes("Horas en horario de Ciudad de México")){
  const re = /^## Historial de cambios\r?\n/m;
  if(re.test(t)){ t = t.replace(re, function(m){ return m + eol() + NOTA_HORA + eol(); }); cambios.push("nota de horas"); }
}

// 2) Datos y persistencia: claves nuevas
if(!t.includes("fullstatusEscuelas_v1`  ") && !/\|\s*`localStorage` `fullstatusEscuelas_v1`/.test(t)){
  const filas = [
    "| `localStorage` `fullstatusEscuelas_v1` | Lista de escuelas `[{id, nombre, driveFileId, original?}]`. La escuela `original` usa las claves de siempre; las demás agregan el sufijo `__<id>` a `listaAsistenciaData_v2`, `listaAsistenciaCambiosPendientes_v1`, `listaAsistenciaDriveFileId_v1` y a la clave `institucional` de IndexedDB |",
    "| `sessionStorage` `fullstatusEscuelaSesion_v1` | Id de la escuela elegida en esta sesión (si no existe, se muestra la pantalla de inicio) |"
  ].join(eol());
  const reFila = /^(\|[^\n]*listaAsistenciaGoogleDriveAuth_v3[^\n]*)\r?\n/m;
  if(reFila.test(t)){ t = t.replace(reFila, function(m, fila){ return fila + eol() + filas + eol(); }); cambios.push("tabla de claves"); }
  else {
    const reH = /^## Datos y persistencia\r?\n/m;
    if(reH.test(t)){ t = t.replace(reH, function(m){ return m + eol() + filas.split(eol()).map(function(f){ return "- " + f.replace(/^\|\s*/, "").replace(/\s*\|\s*/, ": ").replace(/\s*\|$/, ""); }).join(eol()) + eol(); }); cambios.push("claves (lista)"); }
  }
}

// 3) Funciones clave: quitar la que ya no existe y agregar las nuevas
if(t.includes("`importarArchivoExcel`, ")){ t = t.replace("`importarArchivoExcel`, ", ""); cambios.push("quitada importarArchivoExcel (ya no existe)"); }
if(!t.includes("mostrarSelectorEscuelas`, ") && !t.includes("`cargarEscuelas`")){
  const reF = /^(- Funciones clave en `app\.js`:[^\r\n]*?)\.?(\r?\n)/m;
  if(reF.test(t)){
    t = t.replace(reF, function(m, linea, fin){ return linea + "; escuelas: `cargarEscuelas`, `sufijoEscuela`, `mostrarSelectorEscuelas`; resultados: `resEsDeEscuela`." + fin; });
    cambios.push("funciones clave");
  }
}

// 4) Fallas conocidas y pendientes
const FALLA = "- **Excel de una escuela sin pestaña `Plantilla`:** al sincronizar, la app no puede crear la hoja de un grupo nuevo (avisa) y además elimina del archivo las pestañas de grupos quitados en la app (p. ej. una `Sheet1` vacía cargada como grupo). Si era la única pestaña, el archivo podría quedar sin hojas. Cada escuela debe usar una copia del Excel institucional con su `Plantilla`.";
const PEND = [
  "- Escuelas: falta un botón \"Cambiar archivo de Drive\" (editar el enlace sin perder grupos; hoy hay que quitar y volver a agregar la escuela, lo que borra sus datos locales) y una protección que impida borrar pestañas cuando el archivo no tiene `Plantilla`.",
  "- Resultados por escuela: se filtra por nombre de grupo; falta una columna `escuela` en Supabase para no depender de que los nombres coincidan ni de que no se repitan entre escuelas."
].join(eol());
if(!t.includes("Excel de una escuela sin pestaña `Plantilla`")){
  const re = /^## Fallas y riesgos conocidos\r?\n/m;
  if(re.test(t)){ t = t.replace(re, function(m){ return m + eol() + FALLA + eol(); }); cambios.push("falla conocida"); }
}
if(!t.includes("falta un botón \"Cambiar archivo de Drive\"")){
  const re = /^## Pendientes conocidos\r?\n/m;
  if(re.test(t)){ t = t.replace(re, function(m){ return m + eol() + PEND + eol(); }); cambios.push("pendientes"); }
}

fs.writeFileSync("README.md", t);
console.log(cambios.length ? "README.md actualizado:\n- " + cambios.join("\n- ") : "No había nada que cambiar (ya estaba al día).");
