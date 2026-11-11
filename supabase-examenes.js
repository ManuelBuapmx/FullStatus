/* ============================================================================
   Propiedad intelectual de PRISMAL MESH. Todos los derechos reservados.

   supabase-examenes.js  (FullStatus)

   Pestaña "Exámenes": sube a Supabase los exámenes que los alumnos contestan en la app
   FullStatus Student. El profesor pega un script de Apps Script para Forms (el que genera
   Gemini); la app lo ANALIZA, muestra una vista previa (secciones, preguntas, respuesta
   correcta, videos) y, al confirmar, lo guarda en las tablas `materias` y `preguntas`. Es la
   misma lógica de la pestaña "Importar" de admin.html (repo CMKAdmin), portada aquí.

   DECISIONES (el porqué)
   - Reutiliza la sesión de administrador de supabase-asistencias.js (window.FullStatusSupabase),
     igual que supabase-calificaciones.js: no hay un segundo inicio de sesión ni otra copia de
     la clave. Hay que cargar ESE script antes que este, ambos después de app.js.
   - Offline primero: analizar el script NO necesita internet; solo cargar materias y subir.
     El script pegado se guarda como borrador en este equipo (localStorage). Sin internet o sin
     sesión no pasa nada malo y el resto de FullStatus sigue igual.
   - El script pegado se EJECUTA para analizarlo (new Function), por eso corre aislado: en un
     iframe con sandbox="allow-scripts" SIN allow-same-origin, que no puede leer el localStorage
     ni el IndexedDB de FullStatus (asistencias, token de Drive, copia del Excel).
   - Subida segura: al reemplazar un examen primero se insertan las preguntas nuevas
     DESACTIVADAS, luego se desactivan las anteriores y al final se activan las nuevas. Si algo
     falla a la mitad, el alumno nunca se queda sin examen (admin.html desactivaba primero).
   - La respuesta correcta solo se ENVÍA; este módulo nunca la vuelve a leer de la base.
   - Una materia nueva se crea ACTIVA (Supabase la activa sola con un trigger) y aparece de inmediato en
     FullStatus Student; fijar su horario o asignaciones se sigue haciendo en el panel de administración (admin.html).
   - No usa alert()/confirm()/prompt() (Electron): la confirmación va dentro de la pestaña.
   - DESTINO DEL EXAMEN = Materia + Unidad + Tipo (10/nov/2026). La materia sale de la tabla
     `materias` de Supabase (las materias base, la misma lista que ve FullStatus Student; sin las
     «Materia · Tipo»). Solo si esa tabla viene vacía se usan de respaldo las materias de inglés y
     Ética de los grupos (window.FullStatusMateriasGrupos, definida en app.js). La unidad se guarda en preguntas.seccion como «Unidad N» (así
     arma FullStatus Student su menú). El tipo NO es una columna nueva: «Ordinario» usa la materia
     tal cual; Remedial y Extraordinario 1, 2 o 3 van a una materia aparte llamada
     «<Materia> · <Tipo>» (se crea activa). Así FullStatus Student, el horario/asignación de
     admin.html y la pestaña Resultados (que ya muestra el nombre de la materia como «Tipo de examen»)
     funcionan sin cambios ni migraciones en la base.
   - Reemplazar solo desactiva las preguntas ACTIVAS DE LA MISMA UNIDAD; las otras unidades no se tocan.
   - Cada examen (unidad de una materia/tipo) es independiente y su numeración empieza en 1. Si la
     unidad todavía no tiene preguntas activas no se pregunta nada (no hay qué reemplazar); la opción
     Reemplazar/Agregar solo aparece cuando ya hay un examen activo en esa unidad.
   ============================================================================ */
(function () {
  'use strict';

  const CLAVE_BORRADOR = 'fullstatusExamenesBorrador_v1'; // { texto, materiaNombre, unidad, tipo, modo }
  const ESPERA_ANALISIS_MS = 10000;                       // tope para el análisis aislado del script
  const TIPOS_EXAMEN = ['Ordinario', 'Remedial', 'Extraordinario 1', 'Extraordinario 2', 'Extraordinario 3'];
  const MAX_UNIDADES = 5;                                 // unidades que ofrece la lista (1 a 5)

  // =========================================================================
  // 1) LIMPIEZA Y CORRECCIÓN DEL SCRIPT PEGADO (portado de admin.html)
  // =========================================================================
  // Arregla lo que suele romperse al copiar de un chat: marcas ```, caracteres invisibles, comillas
  // curvas, saltos de línea que parten un texto y comillas interiores sin escapar. Regla de oro: un
  // script que ya compila NUNCA se modifica (ver prepararScript).

  // Quita las marcas ``` (con o sin lenguaje) que rodean el código al copiarlo de un chat.
  function quitarMarcasBloque(c) {
    return c.replace(/^\s*```[a-zA-Z]*[ \t]*\n?/, "").replace(/\n?[ \t]*```\s*$/, "");
  }
  function limpiarScript(c) {
    var avisos = [], o = c;
    c = quitarMarcasBloque(c);
    if (c !== o) avisos.push("Se quitaron las marcas de bloque de código (```).");
    o = c;
    // Invisibles que JavaScript NO acepta como espacio y espacios "especiales" -> espacio normal.
    c = c.replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFFC]/g, "")
         .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
         .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
    if (c !== o) avisos.push("Se quitaron espacios o caracteres invisibles copiados del chat o documento.");
    return { codigo: c.trim(), avisos: avisos };
  }
  // Comillas tipográficas -> rectas. Solo se prueba como alternativa si el script no compila.
  function comillasRectas(c) { return c.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'"); }

  // Devuelve el error de sintaxis del código (o null si compila). Solo COMPILA, no ejecuta nada.
  function errorDeSintaxis(c) {
    try { new Function("FormApp", "Logger", "Utilities", "DriveApp", "SpreadsheetApp", "PropertiesService", c); return null; }
    catch (e) { return e; }
  }

  // Recorre el código sabiendo si está dentro de un texto, comentario o plantilla y arregla:
  // saltos de línea reales dentro de un texto (-> \n), comillas interiores sin escapar y comillas
  // curvas fuera de textos. Solo se llama cuando el código NO compila.
  function repararScript(c) {
    var out = "", n = c.length, i = 0, q = null;
    var saltos = 0, escapadas = 0, curvas = 0;
    // ¿Lo que sigue a la comilla en la posición j puede venir tras CERRAR un texto?
    function cierraTexto(j) {
      var k = j + 1;
      while (k < n && (c.charAt(k) === " " || c.charAt(k) === "\t")) k++;
      if (k >= n) return true;
      var s = c.charAt(k);
      if (s === "\n" || s === "\r" || ",;)]}+:".indexOf(s) >= 0) return true;
      return s === "." && /[A-Za-z_$]/.test(c.charAt(k + 1));
    }
    while (i < n) {
      var ch = c.charAt(i);
      if (q === null) {
        if (ch === "/" && c.charAt(i + 1) === "/") {
          var fl = c.indexOf("\n", i); if (fl < 0) fl = n;
          out += c.slice(i, fl); i = fl; continue;
        }
        if (ch === "/" && c.charAt(i + 1) === "*") {
          var fb = c.indexOf("*/", i + 2); fb = fb < 0 ? n : fb + 2;
          out += c.slice(i, fb); i = fb; continue;
        }
        if (ch === "`") {
          var j = i + 1;
          while (j < n && c.charAt(j) !== "`") { if (c.charAt(j) === "\\") j++; j++; }
          out += c.slice(i, j + 1); i = j + 1; continue;
        }
        if (ch === '"' || ch === "'") { q = ch; out += ch; i++; continue; }
        if (ch === "\u201C" || ch === "\u201D") { q = '"'; out += '"'; curvas++; i++; continue; }
        if (ch === "\u2018" || ch === "\u2019") { q = "'"; out += "'"; curvas++; i++; continue; }
        out += ch; i++; continue;
      }
      // --- dentro de un texto ---
      if (ch === "\\") { out += ch + c.charAt(i + 1); i += 2; continue; }
      if (ch === "\r" && c.charAt(i + 1) === "\n") { out += "\\n"; saltos++; i += 2; continue; }
      if (ch === "\n" || ch === "\r") { out += "\\n"; saltos++; i++; continue; }
      var cierre = ch === q
        || (q === '"' && (ch === "\u201C" || ch === "\u201D"))
        || (q === "'" && (ch === "\u2018" || ch === "\u2019"));
      if (cierre) {
        if (cierraTexto(i)) { out += q; q = null; i++; continue; }
        if (ch === q) { out += "\\" + q; escapadas++; i++; continue; }
      }
      out += ch; i++;
    }
    var avisos = [];
    if (saltos) avisos.push("Se unieron " + saltos + " salto(s) de línea que estaban partiendo un texto en dos (ahora son \\n).");
    if (escapadas) avisos.push("Se escaparon " + escapadas + " comilla(s) que estaban dentro de un texto y lo cortaban.");
    if (curvas) avisos.push("Se cambiaron comillas tipográficas por comillas normales.");
    return { codigo: out, avisos: avisos };
  }

  // Limpieza + reparación. Devuelve { codigo, avisos, error }; "error" es null si ya compila. Se
  // prueban varias versiones y gana la primera que compila.
  function prepararScript(texto) {
    var tal = quitarMarcasBloque(texto).trim();
    if (!errorDeSintaxis(tal)) return { codigo: tal, avisos: [], error: null };
    var limp = limpiarScript(texto), base = limp.codigo, previos = limp.avisos.slice();
    var err = errorDeSintaxis(base);
    if (!err) return { codigo: base, avisos: previos, error: null };
    var rect = comillasRectas(base);
    var candidatos = [];
    var rep = repararScript(base);
    if (rep.codigo !== base) candidatos.push({ c: rep.codigo, av: rep.avisos });
    if (rect !== base) {
      candidatos.push({ c: rect, av: ["Se cambiaron las comillas tipográficas por comillas normales."] });
      var rep2 = repararScript(rect);
      if (rep2.codigo !== rect) candidatos.push({ c: rep2.codigo, av: ["Se cambiaron las comillas tipográficas por comillas normales."].concat(rep2.avisos) });
    }
    for (var k = 0; k < candidatos.length; k++) {
      if (!errorDeSintaxis(candidatos[k].c)) return { codigo: candidatos[k].c, avisos: previos.concat(candidatos[k].av), error: null };
    }
    return { codigo: base, avisos: previos, error: err };
  }

  // Dice en qué línea está el error de sintaxis (compila el código línea por línea cerrando lo que
  // falte). Un error de sintaxis nunca "se cura" al agregar más líneas, por eso se descartan los falsos.
  function localizarError(c) {
    var lineas = c.split("\n"), pila = [], enBloque = false, candidato = null;
    var cierre = { "(": ")", "[": "]", "{": "}" };
    for (var k = 0; k < lineas.length; k++) {
      var L = lineas[k], q = null;
      for (var i = 0; i < L.length; i++) {
        var ch = L.charAt(i);
        if (enBloque) { if (ch === "*" && L.charAt(i + 1) === "/") { enBloque = false; i++; } continue; }
        if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
        if (ch === "/" && L.charAt(i + 1) === "/") break;
        if (ch === "/" && L.charAt(i + 1) === "*") { enBloque = true; i++; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (cierre[ch]) pila.push(ch);
        else if (ch === ")" || ch === "]" || ch === "}") pila.pop();
      }
      var cierres = pila.slice().reverse().map(function (x) { return cierre[x]; }).join("");
      var e = errorDeSintaxis(lineas.slice(0, k + 1).join("\n") + "\n" + cierres);
      if (e) { if (!candidato) candidato = { linea: k + 1, texto: L, mensaje: e.message }; }
      else candidato = null;
    }
    return candidato;
  }
  // Lista los caracteres raros de una línea (código Unicode) para ver qué se coló.
  function caracteresRaros(t) {
    var hallados = [], vistos = {};
    var re = /[\u00A0\u00AD\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF\uFFFC\u201C\u201D\u2018\u2019]/g, m;
    while ((m = re.exec(t))) {
      var cod = "U+" + ("0000" + m[0].charCodeAt(0).toString(16).toUpperCase()).slice(-4);
      if (!vistos[cod]) { vistos[cod] = true; hallados.push(cod); }
    }
    return hallados;
  }
  // Traduce los errores típicos de JavaScript a algo que el profesor pueda corregir.
  function explicarError(e, codigo) {
    var m = String((e && e.message) || e), d, f;
    if (e instanceof SyntaxError) {
      var donde = "", loc = codigo ? localizarError(codigo) : null;
      if (loc) {
        var corto = loc.texto.length > 110 ? loc.texto.slice(0, 110) + "…" : loc.texto;
        var raros = caracteresRaros(loc.texto);
        donde = " Línea " + loc.linea + ": «" + corto.trim() + "»." + (raros.length ? " Contiene caracteres raros (" + raros.join(", ") + ")." : "");
      }
      return "error de sintaxis (" + m + ")." + donde + " Revisa comillas, paréntesis, llaves y comas de esa línea (o de la anterior). Si no ves el problema, pídele a la IA que te regenere el script.";
    }
    if ((d = /^(\S+) is not defined/.exec(m))) return "el script usa «" + d[1] + "», que la app no conoce. Quita esa línea o define la variable.";
    if ((f = /^(\S+) is not a function/.exec(m))) return "el script llama a «" + f[1] + "», que la app no soporta. Quita esa línea.";
    return m;
  }

  // =========================================================================
  // 2) EJECUCIÓN DEL SCRIPT (simula FormApp). IMPORTANTE: esta función debe ser AUTOCONTENIDA (no usar
  //    nada de fuera): su código fuente se copia dentro del iframe aislado con Function.toString().
  // =========================================================================
  // El script se pega casi tal cual como Apps Script de Forms: FormApp.create(título),
  // exam.addMultipleChoiceItem(), item.setTitle(...), item.createChoice(valor, esCorrecta),
  // addSectionHeaderItem / addPageBreakItem (título = sección, helpText = contexto) y addVideoItem
  // (URL = contexto). Lo que la app no usa se ignora y se avisa. Devuelve { preguntas, avisos }.
  function ejecutarScript(codigo) {
    var examenesGenerados = [];
    var ignorados = {};
    // Comodín para APIs de Google que no se simulan (Utilities, DriveApp...): acepta todo.
    var NOOP = typeof Proxy === "function"
      ? new Proxy(function () {}, { get: function (t, k) { return k === Symbol.toPrimitive ? function () { return ""; } : NOOP; }, apply: function () { return NOOP; } })
      : {};
    // Envuelve un objeto simulado: lo que no define se ignora (y permite seguir encadenando).
    function tolerante(obj) {
      if (typeof Proxy !== "function") return obj;
      var envuelto = new Proxy(obj, { get: function (t, k) {
        if (typeof k !== "string" || k in t) return t[k];
        ignorados[k] = true;
        return function () { return envuelto; };
      } });
      return envuelto;
    }
    // Campo de texto del formulario original: se ignora por completo.
    function itemTexto() {
      var item = {};
      item.setTitle = function () { return item; };
      item.setRequired = function () { return item; };
      item.setHelpText = function () { return item; };
      item = tolerante(item);
      return item;
    }
    // Lista desplegable (datos del alumno): se ignora por completo.
    function itemLista() {
      var item = {};
      item.setTitle = function () { return item; };
      item.setRequired = function () { return item; };
      item.createChoice = function (valor) { return { valor: valor }; };
      item.setChoices = function () { return item; };
      item = tolerante(item);
      return item;
    }
    // Pregunta de opción múltiple: la única que se convierte en pregunta real.
    function itemOpcionMultiple(lista, seccion, contexto) {
      var p = { texto: "", opciones: [], correcta: -1, orden: lista.length + 1, activa: true, seccion: seccion || null, contexto: contexto || null };
      lista.push(p);
      var item = {};
      item.setTitle = function (t) { p.texto = String(t); return item; };
      item.setRequired = function () { return item; };
      item.setPoints = function () { return item; };
      item.setHelpText = function () { return item; };
      // createChoice registra la opción en el orden en que se crea y guarda la posición de la correcta.
      item.createChoice = function (valor, esCorrecta) {
        var idx = p.opciones.length;
        p.opciones.push(String(valor));
        if (esCorrecta) p.correcta = idx;
        return { valor: valor, idx: idx };
      };
      item.setChoiceValues = function (arr) { p.opciones = arr.map(String); return item; };
      item.setChoices = function () { return item; };
      item.setCorrectAnswer = function (letraOIndice) {
        p.correcta = typeof letraOIndice === "number" ? letraOIndice : String(letraOIndice).toUpperCase().charCodeAt(0) - 65;
        return item;
      };
      item = tolerante(item);
      return item;
    }
    // Simula el objeto "formulario" que devuelve FormApp.create(título).
    function crearExam(titulo) {
      var lista = [];
      var seccion = titulo ? String(titulo) : null;
      var contextoVigente = null;
      examenesGenerados.push({ titulo: seccion, preguntas: lista });
      var exam = {};
      exam.setTitle = function (t) { seccion = String(t); examenesGenerados[examenesGenerados.length - 1].titulo = seccion; return exam; };
      exam.setDescription = function () { return exam; };
      exam.setIsQuiz = function () { return exam; };
      exam.setConfirmationMessage = function () { return exam; };
      exam.setShuffleQuestions = function () { return exam; };
      exam.addTextItem = function () { return itemTexto(); };
      exam.addParagraphTextItem = function () { return itemTexto(); };
      exam.addListItem = function () { return itemLista(); };
      exam.addMultipleChoiceItem = function () { return itemOpcionMultiple(lista, seccion, contextoVigente); };
      exam.addCheckboxItem = function () { return itemOpcionMultiple(lista, seccion, contextoVigente); };
      // Encabezado de sección / salto de página: su título pasa a ser la sección de las preguntas que
      // le siguen (y el video anterior deja de aplicar). Su texto de ayuda es el CONTEXTO de esas preguntas.
      exam.addSectionHeaderItem = exam.addPageBreakItem = function () {
        contextoVigente = null;
        var it = {};
        it.setTitle = function (t) { seccion = String(t); examenesGenerados[examenesGenerados.length - 1].titulo = seccion; return it; };
        it.setHelpText = function (t) { contextoVigente = String(t).trim() || null; return it; };
        it = tolerante(it);
        return it;
      };
      // Video de Forms: su URL pasa a ser el contexto (video) de las preguntas siguientes.
      exam.addVideoItem = function () {
        var it = {};
        it.setVideoUrl = function (u) { contextoVigente = String(u); return it; };
        it = tolerante(it);
        return it;
      };
      exam = tolerante(exam);
      return exam;
    }
    var FormApp = { create: crearExam, getActiveForm: function () { return crearExam(null); }, openById: function () { return crearExam(null); }, openByUrl: function () { return crearExam(null); } };
    if (typeof Proxy === "function") FormApp = new Proxy(FormApp, { get: function (t, k) { return k in t ? t[k] : NOOP; } });

    // Si el script define funciones las ejecuta como "Ejecutar", pero SOLO las que no reciben
    // parámetros y que nadie más llama (si no, se ejecutarían dos veces y duplicarían preguntas).
    var nombresFunciones = [];
    var re = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*\)/g, m;
    while ((m = re.exec(codigo))) {
      var usos = codigo.match(new RegExp("\\b" + m[1].replace(/\$/g, "\\$") + "\\s*\\(", "g")) || [];
      if (usos.length <= 1) nombresFunciones.push(m[1]);
    }
    var llamadas = nombresFunciones.map(function (n) {
      return "if (typeof " + n + " === 'function') { " + n + "(); }";
    }).join("\n");

    var Logger = { log: function () {} };
    var correr = new Function("FormApp", "Logger", "Utilities", "DriveApp", "SpreadsheetApp", "PropertiesService", codigo + "\n" + llamadas);
    correr(FormApp, Logger, NOOP, NOOP, NOOP, NOOP);

    if (!examenesGenerados.length) {
      throw new Error("El script no llegó a llamar FormApp.create(...). Si tu examen está adentro de una función, revisa que el nombre esté bien escrito.");
    }
    // Une las preguntas de todos los exámenes generados, en orden, y las numera de corrido.
    var todas = [];
    examenesGenerados.forEach(function (ex) { ex.preguntas.forEach(function (p) { todas.push(p); }); });
    if (!todas.length) {
      throw new Error("El script creó el examen pero no agregó ninguna pregunta. Revisa que llames a addMultipleChoiceItem().");
    }
    todas.forEach(function (p, i) {
      p.orden = i + 1;
      // La app del alumno numera sola: se quita la numeración del título ("1. ", "2) ").
      p.texto = p.texto.trim().replace(/^\d+\s*[.)]\s+/, "");
      if (!p.texto) p._error = "Falta el título de la pregunta (setTitle).";
      else if (p.opciones.length < 2) p._error = "Necesita al menos 2 opciones.";
      else if (p.opciones.some(function (o) { return !o.trim(); })) p._error = "Hay una opción vacía.";
      else if (p.correcta < 0 || p.correcta >= p.opciones.length) p._error = "No se marcó cuál opción es la correcta (createChoice(valor, true)).";
      else p._error = null;
    });
    var nIg = Object.keys(ignorados);
    return { preguntas: todas, avisos: nIg.length ? ["Se ignoraron llamadas de Forms que la app no usa: " + nIg.join(", ") + "."] : [] };
  }

  // Id de video de un link de YouTube (watch, youtu.be, embed, shorts, live) dentro de un texto, o null.
  function extraerIdYoutube(texto) {
    var m = /(?:youtube\.com\/(?:watch\?(?:[^\s"'&]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(texto || "");
    return m ? m[1] : null;
  }
  // Revisión posterior al análisis (en la app, fuera del aislamiento). Reglas de FullStatus Student:
  //  - Un link de YouTube se guarda SIEMPRE como https://www.youtube.com/watch?v=ID (el formato que
  //    reconoce su index.html); si el contexto traía además texto, la app del alumno solo muestra el video.
  //  - Un link que NO sea de YouTube es error: abrir otra app le quita el foco y anula el examen.
  function revisarPreguntas(lista) {
    lista.forEach(function (p) {
      if (p._error || !p.contexto) return;
      var id = extraerIdYoutube(p.contexto);
      if (id) p.contexto = "https://www.youtube.com/watch?v=" + id;
      else if (/https?:\/\//i.test(p.contexto)) p._error = "El contexto trae un link que no es de YouTube. Los links externos rompen el examen: usa un video de YouTube o solo texto.";
    });
    return lista;
  }

  // Ejecuta el script en un iframe con sandbox="allow-scripts" (sin allow-same-origin): origen opaco, sin
  // acceso al almacenamiento de FullStatus. El código se mete en el propio srcdoc, así no hay
  // "apretón de manos": el iframe corre, responde con postMessage y se destruye.
  function ejecutarAislado(codigo) {
    return new Promise(function (resolver, rechazar) {
      var id = "fsx" + Date.now() + "_" + Math.random().toString(36).slice(2);
      var iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.display = "none";
      var tempo;
      function limpiar() {
        window.removeEventListener("message", alRecibir);
        clearTimeout(tempo);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }
      function alRecibir(ev) {
        if (ev.source !== iframe.contentWindow) return; // solo este iframe
        var d = ev.data || {};
        if (d.id !== id) return;
        limpiar();
        if (d.ok) resolver(d);
        else rechazar(d.esSintaxis ? new SyntaxError(d.mensaje) : new Error(d.mensaje));
      }
      window.addEventListener("message", alRecibir);
      tempo = setTimeout(function () { limpiar(); rechazar(new Error("El análisis tardó demasiado y se canceló. Revisa que el script no tenga ciclos infinitos.")); }, ESPERA_ANALISIS_MS);
      // "<" se escapa para que nada del script cierre la etiqueta <script> del srcdoc.
      function seguro(s) { return s.replace(/</g, "\\u003c"); }
      var js = "var ejecutarScript = " + ejecutarScript.toString() + ";\n"
        + "var CODIGO = " + seguro(JSON.stringify(codigo)) + ", ID = " + seguro(JSON.stringify(id)) + ";\n"
        + "try { var r = ejecutarScript(CODIGO); parent.postMessage({ id: ID, ok: true, preguntas: r.preguntas, avisos: r.avisos }, '*'); }\n"
        + "catch (err) { parent.postMessage({ id: ID, ok: false, mensaje: String(err && err.message || err), esSintaxis: err instanceof SyntaxError }, '*'); }";
      iframe.srcdoc = "<!doctype html><html><body><scr" + "ipt>" + js + "</scr" + "ipt></body></html>";
      document.body.appendChild(iframe);
    });
  }

  // Limpia, repara, ejecuta aislado y revisa. Rechaza con un mensaje en español si algo falla.
  function analizarScript(texto) {
    var p = prepararScript(texto);
    if (p.error) return Promise.reject(new Error(explicarError(p.error, p.codigo)));
    return ejecutarAislado(p.codigo).then(function (r) {
      return { preguntas: revisarPreguntas(r.preguntas), avisos: p.avisos.concat(r.avisos || []) };
    }, function (e) { throw new Error(explicarError(e, p.codigo)); });
  }

  // =========================================================================
  // 3) SUBIDA A SUPABASE
  // =========================================================================
  function normalizarTexto(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  // Cuántas preguntas nuevas ya existen (mismo texto) entre las ACTIVAS de la materia: sirve para
  // avisar de duplicados cuando se elige "Agregar al final".
  // "seccion" (opcional) limita la comparación a las preguntas de esa unidad.
  function contarDuplicados(nuevas, existentes, seccion) {
    var vistos = {};
    (existentes || []).forEach(function (q) { if (q.activa && (seccion === undefined || q.seccion === seccion)) vistos[normalizarTexto(q.texto)] = true; });
    return nuevas.filter(function (p) { return vistos[normalizarTexto(p.texto)]; }).length;
  }

  // PATCH/POST con verificación de filas afectadas: con RLS, un cambio sin permiso no da error,
  // solo afecta 0 filas; sin esta revisión se fingiría éxito. "api(ruta, opciones)" devuelve la
  // respuesta ya interpretada (ver rest() más abajo).
  function escribirConfirmado(api, ruta, metodo, cuerpo, esperadas) {
    return api(ruta, { method: metodo, headers: { Prefer: 'return=representation' }, body: cuerpo }).then(function (filas) {
      if (!Array.isArray(filas) || filas.length < esperadas) {
        throw new Error('La base solo aplicó ' + (Array.isArray(filas) ? filas.length : 0) + ' de ' + esperadas + ' cambio(s) (revisa los permisos RLS).');
      }
      return filas;
    });
  }

  // Sube el examen.
  //  - Agregar: se insertan ACTIVAS al final del orden.
  //  - Reemplazar: se insertan DESACTIVADAS -> se desactivan las anteriores -> se activan las nuevas.
  // Todas las filas llevan exactamente las mismas claves (requisito de la inserción masiva de PostgREST).
  // "seccion" (opcional, p. ej. "Unidad 2"): todas las preguntas nuevas se guardan en esa sección y
  // "reemplazar" solo desactiva las activas de ESA sección (las demás unidades quedan intactas).
  function subirExamen(api, mid, preguntas, modo, existentes, seccion) {
    var etapa = 'insertar';
    var activasViejas = (existentes || []).filter(function (q) { return q.activa && (seccion === undefined || q.seccion === seccion); }).map(function (q) { return q.id; });
    // Orden de las preguntas nuevas: cada examen (unidad de una materia/tipo) es independiente y su
    // numeración empieza en 1.
    //  - Reemplazar (o primera subida): empieza en 1; las anteriores de la unidad se desactivan.
    //  - Agregar: continúa después del orden más alto de ESA unidad (sin \"seccion\": de la materia).
    var offset = 0;
    if (modo === 'agregar') (existentes || []).forEach(function (q) {
      if ((seccion === undefined || q.seccion === seccion) && q.orden > offset) offset = q.orden;
    });
    var reemplaza = modo === 'reemplazar';
    var filas = preguntas.map(function (p) {
      return {
        texto: p.texto, opciones: p.opciones, correcta: p.correcta, orden: p.orden + offset,
        activa: !reemplaza, materia_id: mid, seccion: seccion !== undefined ? seccion : (p.seccion || null), contexto: p.contexto || null
      };
    });
    var nuevosIds = [];
    // select=id: solo se pide de vuelta el id (nunca la respuesta correcta).
    return escribirConfirmado(api, 'preguntas?select=id', 'POST', filas, filas.length)
      .then(function (creadas) {
        nuevosIds = creadas.map(function (f) { return f.id; });
        if (!reemplaza) return null;
        etapa = 'desactivar';
        if (!activasViejas.length) return null;
        return escribirConfirmado(api, 'preguntas?select=id&id=in.(' + activasViejas.join(',') + ')', 'PATCH', { activa: false }, activasViejas.length);
      })
      .then(function () {
        if (!reemplaza) return null;
        etapa = 'activar';
        return escribirConfirmado(api, 'preguntas?select=id&id=in.(' + nuevosIds.join(',') + ')', 'PATCH', { activa: true }, nuevosIds.length);
      })
      .then(function () { return { subidas: nuevosIds.length, desactivadas: reemplaza ? activasViejas.length : 0 }; })
      .catch(function (e) {
        if (e && e.sinSesion) throw e;
        var guia = etapa === 'insertar' ? 'No se subió nada; el examen actual sigue igual.'
          : etapa === 'desactivar' ? 'Las ' + nuevosIds.length + ' preguntas nuevas quedaron subidas pero DESACTIVADAS y el examen anterior sigue activo. Actívalas desde el panel de administración o vuelve a intentar (quedarían duplicadas desactivadas).'
          : 'Las anteriores ya se desactivaron pero las ' + nuevosIds.length + ' nuevas siguen DESACTIVADAS: actívalas desde el panel de administración o vuelve a intentar.';
        var x = new Error(guia + ' Detalle: ' + e.message);
        x.sinConexion = e instanceof TypeError; // fetch rechaza con TypeError cuando no hay red
        throw x;
      });
  }

  // =========================================================================
  // 4) ESTADO E INTERFAZ (se dibuja dentro de la pestaña "Exámenes" de app.js)
  // =========================================================================
  function leerBorrador() {
    try { return JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || 'null') || {}; } catch (e) { return {}; }
  }
  var borrador = leerBorrador();
  var est = {
    materias: [],                             // filas de la tabla `materias` (id, nombre, activa, orden)
    materiaNombre: borrador.materiaNombre || '',   // materia elegida en la lista (inglés de los grupos o Ética)
    unidad: (Number(borrador.unidad) >= 1 && Number(borrador.unidad) <= MAX_UNIDADES) ? String(Number(borrador.unidad)) : '1',
    tipo: TIPOS_EXAMEN.indexOf(borrador.tipo) >= 0 ? borrador.tipo : 'Ordinario',
    materiaId: '',                            // id de la materia DESTINO en Supabase ('' si todavía no existe)
    existentes: null,                         // preguntas de la materia destino (id, orden, activa, texto, seccion)
    texto: borrador.texto || '', modo: borrador.modo === 'agregar' ? 'agregar' : 'reemplazar',
    preview: null, avisos: [],
    ocupado: '', msg: '', err: '', confirmando: false,
    adminAbierto: false, eliminando: null     // sección «Administrar exámenes»: ¿desplegada? y id de la materia por eliminar
  };
  var raiz = null; // contenedor de esta pestaña; si ya no está en pantalla (cambió de pestaña) no se dibuja nada
  function guardarBorrador() {
    try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ texto: est.texto, materiaNombre: est.materiaNombre, unidad: est.unidad, tipo: est.tipo, modo: est.modo })); } catch (e) { /* sin espacio: no es grave */ }
  }

  function sesionApi() { return window.FullStatusSupabase; }
  function listoSupabase() { var s = sesionApi(); return !!(s && typeof s.rest === 'function'); }
  function haySesion() { return listoSupabase() && sesionApi().haySesion(); }
  // Llamada REST con la sesión de administrador. Si no hay sesión, falla con e.sinSesion.
  function rest(ruta, opciones) {
    return sesionApi().rest(ruta, opciones).then(function (r) {
      if (r && r.sinSesion) { var e = new Error('Inicia sesión de administrador para continuar.'); e.sinSesion = true; throw e; }
      return r;
    });
  }

  function cargarMaterias() {
    return rest('materias?select=id,nombre,activa,orden,abre_en,cierra_en,solo_asignados&order=orden.asc').then(function (filas) { est.materias = filas || []; });
  }
  // Solo se leen id, orden, activa, texto y seccion: NUNCA la respuesta correcta.
  function cargarExistentes(mid) {
    if (mid === '' || mid === null || mid === undefined) { est.existentes = null; return Promise.resolve(); }
    return rest('preguntas?select=id,orden,activa,texto,seccion&materia_id=eq.' + Number(mid) + '&order=orden.asc')
      .then(function (filas) { est.existentes = filas || []; });
  }

  // --- Destino del examen: materia (lista) + unidad + tipo -------------------------------------
  // Clave para comparar nombres: sin acentos ni mayúsculas, y «english» = «ingles» (en Supabase la
  // materia puede llamarse ENGLISH XI y en el grupo Inglés XI).
  function clave(s) { return normalizarTexto(s).replace(/english/g, 'ingles'); }
  // ¿Es una materia creada por esta pestaña para un tipo distinto de Ordinario («Materia · Remedial»...)?
  function esMateriaDeTipo(nombre) {
    var n = clave(nombre);
    return TIPOS_EXAMEN.some(function (t) { return t !== 'Ordinario' && n.slice(-(clave(t).length + 3)) === ' \u00b7 ' + clave(t); });
  }
  // Materias que ofrece la lista: las MATERIAS BASE de Supabase (la misma lista que ve FullStatus Student:
  // INGLES 1, INGLES VI, PEDAGOGIA, ETICA PROFESIONAL...), sin las «Materia · Tipo». Solo si la tabla
  // está vacía o no se pudo leer se usan, de respaldo, las materias de inglés/Ética de los grupos.
  function materiasDisponibles() {
    var base = est.materias.filter(function (m) { return !esMateriaDeTipo(m.nombre); }).map(function (m) { return m.nombre; });
    if (base.length) return base;
    var lista = [], vistos = {}, grupos = [];
    try { if (typeof window.FullStatusMateriasGrupos === 'function') grupos = window.FullStatusMateriasGrupos() || []; } catch (e) { grupos = []; }
    grupos.forEach(function (m) {
      var k = clave(m);
      if ((/ingles/.test(k) || /etica/.test(k)) && !vistos[k]) { vistos[k] = true; lista.push(m); }
    });
    if (!lista.length) lista.push('\u00c9tica profesional');
    return lista;
  }
  function asegurarMateria() {
    var op = materiasDisponibles();
    if (op.indexOf(est.materiaNombre) < 0) est.materiaNombre = op[0] || '';
  }
  // Ordinario usa la materia tal cual; los demás tipos van a «<Materia> · <Tipo>».
  function nombreDestino() { return est.tipo === 'Ordinario' ? est.materiaNombre : est.materiaNombre + ' \u00b7 ' + est.tipo; }
  function seccionDestino() { return 'Unidad ' + est.unidad; }
  function buscarDestino() {
    var k = clave(nombreDestino());
    return est.materias.find(function (m) { return clave(m.nombre) === k; }) || null;
  }
  // Localiza (si ya existe) la materia destino y carga sus preguntas.
  function actualizarDestino() {
    var m = buscarDestino();
    est.materiaId = m ? String(m.id) : '';
    est.existentes = null;
    return cargarExistentes(est.materiaId);
  }
  // Crea la materia destino ACTIVA (el trigger de Supabase también la activa sola; el horario se fija en admin.html). Devuelve su id.
  function crearMateriaDestino(nombre) {
    var orden = est.materias.reduce(function (mx, m) { return Math.max(mx, m.orden || 0); }, 0) + 1;
    return escribirConfirmado(rest, 'materias?select=id', 'POST', { nombre: nombre, orden: orden, activa: true }, 1)
      .then(function (filas) { return Number(filas[0].id); });
  }
  function refrescar() {
    if (!haySesion()) { pintar(); return Promise.resolve(); }
    est.ocupado = 'Cargando materias...'; pintar();
    return cargarMaterias().then(function () { asegurarMateria(); return actualizarDestino(); })
      .then(function () { est.ocupado = ''; pintar(); }).catch(function (e) { fallo(e, ''); });
  }

  // Muestra el error (o el aviso de falta de conexión) y repinta.
  function fallo(e, prefijo) {
    est.ocupado = '';
    var sinRed = (e instanceof TypeError) || (e && e.sinConexion);
    est.err = (prefijo || '') + (sinRed ? 'No hay conexión. Tu borrador sigue guardado en este equipo; inténtalo cuando tengas internet. ' : '') + (e && e.message && !(e instanceof TypeError) ? e.message : '');
    pintar();
  }

  function h(tag, props, hijos) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'text') e.textContent = props[k]; // textContent: lo pegado nunca se interpreta como HTML
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    }
    (hijos || []).forEach(function (x) { if (x) e.appendChild(x); });
    return e;
  }
  function boton(texto, clase, alClic) { var b = h('button', { 'class': clase ? 'btn ' + clase : 'btn', type: 'button', text: texto }); b.addEventListener('click', alClic); return b; }

  function vistaSesion() {
    var tarjeta = h('div', { 'class': 'card' }, [
      h('h2', { text: 'Exámenes para FullStatus Student' }),
      h('p', { 'class': 'helptext', style: 'margin-top:0', text: 'Sube aquí el examen pegando su script. La sesión es la misma de «☁ Alumnos» (cuenta de administrador de Supabase). Para subir se necesita internet; analizar el script no.' })
    ]);
    if (!listoSupabase()) {
      tarjeta.appendChild(h('p', { style: 'color:var(--falta)', text: 'Falta cargar supabase-asistencias.js antes que supabase-examenes.js (revisa index.html).' }));
    } else if (!haySesion()) {
      tarjeta.appendChild(h('p', { text: 'Inicia sesión como administrador para cargar tus materias y subir exámenes.' }));
      tarjeta.appendChild(h('div', { 'class': 'row' }, [
        boton('Iniciar sesión', '', function () { sesionApi().abrir(); }),
        boton('Ya inicié sesión', 'secondary', function () { refrescar(); })
      ]));
    }
    return tarjeta;
  }

  // Un <select> con etiqueta. opciones = [{ valor, texto }]; alCambiar recibe el valor elegido.
  function campoSelect(id, etiqueta, opciones, actual, alCambiar) {
    var sel = h('select', { id: id });
    opciones.forEach(function (o) { sel.appendChild(h('option', { value: o.valor, text: o.texto })); });
    sel.value = actual;
    sel.addEventListener('change', function () { alCambiar(sel.value); });
    return h('div', { 'class': 'field' }, [h('label', { 'for': id, text: etiqueta }), sel]);
  }

  function vistaMateria() {
    asegurarMateria();
    // Cualquier cambio del destino: se guarda el borrador y se vuelve a ubicar la materia destino.
    function cambio(campo, valor) {
      est[campo] = valor; est.confirmando = false; guardarBorrador();
      actualizarDestino().then(pintar).catch(function (e) { fallo(e, ''); });
      pintar();
    }
    var unidades = [];
    for (var u = 1; u <= MAX_UNIDADES; u++) unidades.push({ valor: String(u), texto: 'Unidad ' + u });
    var info = '', aviso = '';
    // Si Supabase no devolvió ninguna materia, la lista es el respaldo (grupos): se avisa en rojo.
    if (!est.materias.length) {
      aviso = '⚠ Supabase devolvió 0 materias, así que esta lista es solo un respaldo con las materias de tus grupos y puede no coincidir con FullStatus Student. Revisa que la sesión de «☁ Alumnos» sea de administrador (usa «Ya inicié sesión» o vuelve a entrar) y que la tabla materias tenga filas.';
    }
    if (est.materiaNombre) {
      if (!est.materiaId) {
        info = '«' + nombreDestino() + '» todavía no existe en Supabase: se creará activa al subir el examen.';
      } else if (est.existentes) {
        var sec = seccionDestino();
        var deUnidad = est.existentes.filter(function (q) { return q.seccion === sec; });
        var act = deUnidad.filter(function (q) { return q.activa; }).length;
        info = '«' + nombreDestino() + '» tiene ' + est.existentes.length + ' pregunta(s); en la ' + sec + ': ' + deUnidad.length + ' (' + act + ' activa(s)).';
      }
    }
    return h('div', { 'class': 'card' }, [
      h('h2', { text: 'Destino del examen' }),
      h('p', { 'class': 'helptext', style: 'margin-top:0', text: 'La materia sale de la misma lista que ve FullStatus Student. Las preguntas se guardan en la unidad elegida. El tipo Ordinario usa la materia tal cual; Remedial y Extraordinario 1, 2 o 3 se guardan en una materia aparte «Materia · Tipo», para que cada examen tenga su propio horario y sus propios resultados.' }),
      campoSelect('exaMateria', 'Materia', materiasDisponibles().map(function (m) {
        var fila = est.materias.find(function (x) { return x.nombre === m; });
        return { valor: m, texto: m + (fila && !fila.activa ? ' (desactivada)' : '') };
      }), est.materiaNombre, function (v) { cambio('materiaNombre', v); }),
      campoSelect('exaUnidad', 'Unidad', unidades, est.unidad, function (v) { cambio('unidad', v); }),
      campoSelect('exaTipo', 'Tipo de examen', TIPOS_EXAMEN.map(function (t) { return { valor: t, texto: t }; }), est.tipo, function (v) { cambio('tipo', v); }),
      aviso ? h('p', { style: 'color:var(--falta);font-weight:600', text: aviso }) : null,
      info ? h('p', { 'class': 'helptext', text: info }) : null
    ]);
  }

  function vistaScript() {
    var area = h('textarea', { id: 'exaScript', spellcheck: 'false', style: 'min-height:260px;font-family:ui-monospace,Consolas,monospace;font-size:0.85rem', placeholder: 'Pega aquí el script de Apps Script (FormApp.create(...), addMultipleChoiceItem(), createChoice(valor, true)...)' });
    area.value = est.texto;
    area.addEventListener('input', function () { est.texto = area.value; est.preview = null; est.confirmando = false; guardarBorrador(); });
    var analizar = boton(est.ocupado === 'Analizando...' ? 'Analizando...' : 'Analizar', '', function () {
      est.texto = area.value; guardarBorrador();
      est.err = ''; est.msg = ''; est.preview = null; est.confirmando = false;
      if (!est.texto.trim()) { est.err = 'Pega el script primero.'; pintar(); return; }
      est.ocupado = 'Analizando...'; pintar();
      analizarScript(est.texto).then(function (r) { est.preview = r.preguntas; est.avisos = r.avisos; est.ocupado = ''; pintar(); })
        .catch(function (e) { est.ocupado = ''; est.err = 'No se pudo analizar el script: ' + e.message; pintar(); });
    });
    analizar.disabled = !!est.ocupado;
    return h('div', { 'class': 'card' }, [
      h('h2', { text: 'Script del examen' }),
      h('p', { 'class': 'helptext', style: 'margin-top:0', text: 'Pega el script casi tal cual lo genera la IA. El título de cada FormApp.create(...) o encabezado de sección pasa a ser la sección de sus preguntas; el texto de ayuda del encabezado y los videos de YouTube son el contexto. Si algo no se puede leer, el análisis dice en qué línea.' }),
      area,
      h('div', { 'class': 'row', style: 'margin-top:10px' }, [analizar, boton('Vaciar', 'secondary', function () {
        est.texto = ''; est.preview = null; est.avisos = []; est.err = ''; est.confirmando = false; guardarBorrador(); pintar();
      })])
    ]);
  }

  function vistaPrevia() {
    var lista = est.preview;
    var errores = lista.filter(function (p) { return p._error; }).length;
    var secciones = 0, previa = null;
    lista.forEach(function (p) { if (p.seccion && p.seccion !== previa) secciones++; previa = p.seccion; });
    var cuerpo = h('div');
    var secPrev = null, ctxPrev = null;
    lista.forEach(function (p) {
      if (p.seccion !== secPrev) {
        if (p.seccion) cuerpo.appendChild(h('div', { style: 'margin-top:14px;font-weight:700;color:var(--brand-accent)', text: p.seccion }));
        secPrev = p.seccion; ctxPrev = null;
      }
      if (p.contexto && p.contexto !== ctxPrev) {
        var esVideo = extraerIdYoutube(p.contexto);
        cuerpo.appendChild(h('div', { 'class': 'helptext', style: 'border-left:3px solid var(--brand-accent);padding-left:10px;white-space:pre-wrap', text: (esVideo ? '▶ Video: ' : 'Texto de apoyo:\n') + p.contexto }));
      }
      ctxPrev = p.contexto;
      var opciones = p._error ? [h('div', { style: 'color:var(--falta)', text: p._error })] : p.opciones.map(function (o, i) {
        return h('div', { 'class': 'helptext', style: 'margin-top:2px' + (i === p.correcta ? ';color:var(--presente);font-weight:600' : ''), text: String.fromCharCode(65 + i) + ') ' + o + (i === p.correcta ? '  ✓' : '') });
      });
      cuerpo.appendChild(h('div', { style: 'padding:8px 0;border-bottom:1px solid var(--line)' }, [h('strong', { text: p.orden + '. ' + (p.texto || '(sin texto)') })].concat(opciones)));
    });
    return h('div', { 'class': 'card' }, [
      h('h2', { text: lista.length + ' pregunta(s) leída(s) · ' + secciones + ' sección(es)' + (errores ? ' · ' + errores + ' con error' : '') }),
      est.avisos.length ? h('p', { 'class': 'helptext', style: 'margin-top:0', text: 'Correcciones automáticas: ' + est.avisos.join(' ') }) : null,
      cuerpo
    ]);
  }

  // ¿Esa unidad ya tiene un examen activo? Solo entonces tiene sentido elegir Reemplazar o Agregar.
  function activasDeLaUnidad() {
    var sec = seccionDestino();
    return (est.existentes || []).filter(function (q) { return q.activa && q.seccion === sec; }).length;
  }
  // Sin examen activo en la unidad no hay qué reemplazar: se sube directo (equivale a Reemplazar).
  function modoEfectivo() { return activasDeLaUnidad() > 0 ? est.modo : 'reemplazar'; }

  function vistaSubida() {
    var lista = est.preview, errores = lista.filter(function (p) { return p._error; }).length;
    var puede = !errores && lista.length > 0 && !!est.materiaNombre && !est.ocupado;
    function opcion(valor, texto) {
      var r = h('input', { type: 'radio', name: 'exaModo', style: 'width:auto;min-height:0;margin-top:4px' });
      r.checked = est.modo === valor;
      r.addEventListener('change', function () { est.modo = valor; est.confirmando = false; guardarBorrador(); pintar(); });
      return h('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:0.94rem;color:var(--ink)' }, [r, h('span', { text: texto })]);
    }
    var subir = boton('Subir examen', '', function () {
      if (navigator.onLine === false) { est.err = 'No hay conexión. Tu borrador sigue guardado; sube el examen cuando tengas internet.'; pintar(); return; }
      est.err = ''; est.msg = ''; est.ocupado = 'Revisando la materia...'; pintar();
      // Se vuelve a leer la materia justo antes de confirmar: el resumen y los duplicados quedan al día.
      cargarExistentes(est.materiaId).then(function () { est.ocupado = ''; est.confirmando = true; pintar(); }).catch(function (e) { fallo(e, ''); });
    });
    subir.disabled = !puede;
    var partes = [
      h('h2', { text: 'Subir a «' + nombreDestino() + '» · ' + seccionDestino() }),
      h('p', { 'class': 'helptext', style: 'margin-top:0', text: 'Todas las preguntas se guardarán en la ' + seccionDestino() + ' (las secciones del script no se usan como unidad).' }),
      activasDeLaUnidad() > 0 ? h('p', { 'class': 'helptext', style: 'margin-top:0', text: 'Esta unidad ya tiene ' + activasDeLaUnidad() + ' pregunta(s) activa(s). Elige qué hacer:' }) : null,
      activasDeLaUnidad() > 0 ? opcion('reemplazar', 'Reemplazar el examen de esta unidad (sus preguntas activas actuales se desactivan, no se borran; la numeración empieza en 1; las otras unidades no se tocan)') : null,
      activasDeLaUnidad() > 0 ? opcion('agregar', 'Agregar al final de esta unidad') : null,
      h('div', { 'class': 'row', style: 'margin-top:12px' }, [subir]),
      errores ? h('p', { 'class': 'helptext', text: 'Corrige el script y vuelve a analizar: no se puede subir con preguntas con error.' }) : null
    ];
    if (est.confirmando) {
      var sec = seccionDestino(), existentes = est.existentes || [];
      var act = existentes.filter(function (q) { return q.activa && q.seccion === sec; }).length;
      var modo = modoEfectivo();
      var dup = modo === 'agregar' ? contarDuplicados(lista, existentes, sec) : 0;
      var resumen = 'Vas a subir ' + lista.length + ' pregunta(s) a «' + nombreDestino() + '» (' + sec + '). '
        + (est.materiaId ? '' : 'La materia todavía no existe: se creará DESACTIVADA. ')
        + (modo === 'reemplazar' ? (act ? 'Se desactivarán ' + act + ' pregunta(s) activa(s) de esta unidad. ' : '') + 'La numeración empieza en 1. ' : 'Se agregarán al final de esta unidad. ')
        + (dup ? '⚠ ' + dup + ' ya existen activas con el mismo texto en esta unidad (quedarían duplicadas). ' : '')
        + 'No lo hagas mientras haya alumnos contestando: se calificaría mal.';
      partes.push(h('div', { style: 'border:1px solid var(--brand-accent);border-radius:8px;padding:12px;margin-top:14px;background:var(--accent-soft)' }, [
        h('p', { style: 'margin:0 0 10px', text: resumen }),
        h('div', { 'class': 'row' }, [
          boton('Sí, subir ahora', '', function () {
            est.confirmando = false; est.err = ''; est.ocupado = 'Subiendo...'; pintar();
            var destino = nombreDestino(), creada = !est.materiaId, modo = modoEfectivo();
            // Si la materia destino no existe se crea primero (activa); luego se suben las preguntas.
            var preparar = creada ? crearMateriaDestino(destino) : Promise.resolve(Number(est.materiaId));
            preparar.then(function (mid) { return subirExamen(rest, mid, lista, modo, creada ? [] : existentes, sec); })
              .then(function (r) {
                est.ocupado = ''; est.preview = null; est.avisos = []; est.texto = ''; guardarBorrador();
                est.msg = 'Listo: ' + r.subidas + ' pregunta(s) subidas a «' + destino + '» (' + sec + ')' + (r.desactivadas ? ' (se desactivaron ' + r.desactivadas + ' anteriores)' : '') + '.'
                  + (creada ? ' La materia se creó activa y ya aparece en FullStatus Student: fija su horario en el panel de administración si lo necesitas.' : '');
                return cargarMaterias().then(actualizarDestino);
              }).then(pintar).catch(function (e) { fallo(e, 'No se pudo subir. '); });
          }),
          boton('Cancelar', 'secondary', function () { est.confirmando = false; pintar(); })
        ])
      ]));
    }
    return h('div', { 'class': 'card' }, partes);
  }

  // --- Administrar exámenes: fechas de apertura y cierre, activar/desactivar y eliminar -----------
  // PRISMAL MESH. Cada fila es una materia de Supabase («INGLÉS VI», «INGLÉS VI · Remedial»...). Las
  // fechas se editan en hora LOCAL de esta computadora y se guardan en UTC (abre_en / cierra_en). Con
  // asignación manual de un alumno (asignaciones) sus propias fechas mandan sobre estas.
  function dosDig(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function aLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + dosDig(d.getMonth() + 1) + '-' + dosDig(d.getDate()) + 'T' + dosDig(d.getHours()) + ':' + dosDig(d.getMinutes());
  }
  function deLocal(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
  function textoFecha(iso) { return iso ? new Date(iso).toLocaleString('es-MX') : 'sin límite'; }
  function estadoDeMateria(m) {
    if (!m.activa) return 'Desactivado';
    var ahora = Date.now();
    if (m.abre_en && ahora < new Date(m.abre_en).getTime()) return 'Programado';
    if (m.cierra_en && ahora >= new Date(m.cierra_en).getTime()) return 'Cerrado';
    return 'Abierto';
  }
  // Guarda cambios de UNA materia y repinta. "cambios" son columnas de la tabla materias.
  function guardarMateria(m, cambios, aviso) {
    est.ocupado = 'Guardando...'; est.err = ''; est.msg = ''; pintar();
    return escribirConfirmado(rest, 'materias?select=id&id=eq.' + Number(m.id), 'PATCH', cambios, 1)
      .then(function () { for (var k in cambios) m[k] = cambios[k]; est.ocupado = ''; est.msg = aviso; pintar(); })
      .catch(function (e) { fallo(e, 'No se pudo guardar: '); });
  }
  // Elimina una materia SIN resultados: antes se borran sus intentos y preguntas. Si ya tiene resultados
  // de alumnos NO se elimina (se perdería el vínculo del resultado con su examen): se pide desactivarla.
  function eliminarMateria(m) {
    var id = Number(m.id);
    est.ocupado = 'Eliminando...'; est.err = ''; est.msg = ''; est.eliminando = null; pintar();
    return rest('resultados?select=id&materia_id=eq.' + id + '&limit=1').then(function (r) {
      if (Array.isArray(r) && r.length) throw new Error('«' + m.nombre + '» ya tiene resultados de alumnos y no se elimina para no perderlos. Desactívala en su lugar.');
      return rest('intentos?select=id&materia_id=eq.' + id, { method: 'DELETE' });
    }).then(function () {
      return rest('preguntas?select=id&materia_id=eq.' + id, { method: 'DELETE' });
    }).then(function () {
      return escribirConfirmado(rest, 'materias?select=id&id=eq.' + id, 'DELETE', undefined, 1);
    }).then(function () {
      est.materias = est.materias.filter(function (x) { return x.id !== m.id; });
      if (String(est.materiaId) === String(id)) { est.materiaId = ''; est.existentes = null; }
      est.msg = '«' + m.nombre + '» se eliminó junto con sus preguntas.';
      return refrescar();
    }).catch(function (e) { fallo(e, 'No se pudo eliminar: '); });
  }
  function filaAdministrar(m) {
    var abre = h('input', { type: 'datetime-local', id: 'admAbre' + m.id, value: aLocal(m.abre_en) });
    var cierra = h('input', { type: 'datetime-local', id: 'admCierra' + m.id, value: aLocal(m.cierra_en) });
    var solo = h('input', { type: 'checkbox', id: 'admSolo' + m.id }); solo.checked = !!m.solo_asignados;
    var estado = estadoDeMateria(m);
    var acciones = [
      boton('Guardar fechas', '', function () {
        var a = deLocal(abre.value), c = deLocal(cierra.value);
        if (a && c && new Date(c) <= new Date(a)) { est.err = 'El cierre de «' + m.nombre + '» debe ser posterior a la apertura.'; est.msg = ''; pintar(); return; }
        guardarMateria(m, { abre_en: a, cierra_en: c, solo_asignados: solo.checked }, 'Fechas de «' + m.nombre + '» guardadas.');
      }),
      boton('Quitar fechas', 'secondary', function () { guardarMateria(m, { abre_en: null, cierra_en: null }, '«' + m.nombre + '» quedó sin fechas de apertura ni cierre.'); }),
      boton(m.activa ? 'Desactivar' : 'Activar', 'secondary', function () { guardarMateria(m, { activa: !m.activa }, '«' + m.nombre + '» ' + (m.activa ? 'desactivada' : 'activada') + '.'); }),
      boton('Eliminar', 'secondary', function () { est.eliminando = m.id; pintar(); })
    ];
    var partes = [
      h('div', { 'class': 'row', style: 'justify-content:space-between;align-items:center' }, [
        h('b', { text: m.nombre }),
        h('span', { 'class': 'helptext', style: 'margin:0', text: estado + ' · abre: ' + textoFecha(m.abre_en) + ' · cierra: ' + textoFecha(m.cierra_en) })
      ]),
      h('div', { 'class': 'row' }, [
        h('div', { 'class': 'field' }, [h('label', { 'for': 'admAbre' + m.id, text: 'Apertura' }), abre]),
        h('div', { 'class': 'field' }, [h('label', { 'for': 'admCierra' + m.id, text: 'Cierre' }), cierra]),
        h('div', { 'class': 'field' }, [h('label', { 'for': 'admSolo' + m.id, text: 'Solo alumnos asignados' }), solo])
      ]),
      h('div', { 'class': 'row' }, acciones)
    ];
    if (est.eliminando === m.id) {
      partes.push(h('p', { style: 'color:var(--falta);margin:8px 0 4px', text: '¿Eliminar «' + m.nombre + '»? Se borran sus preguntas. Si ya tiene resultados de alumnos no se elimina.' }));
      partes.push(h('div', { 'class': 'row' }, [
        boton('Sí, eliminar', '', function () { eliminarMateria(m); }),
        boton('Cancelar', 'secondary', function () { est.eliminando = null; pintar(); })
      ]));
    }
    return h('div', { style: 'border-top:1px solid var(--borde, #e0e0e0);padding:10px 0' }, partes);
  }
  function vistaAdministrar() {
    var det = h('details', { 'class': 'card' });
    if (est.adminAbierto) det.setAttribute('open', '');
    det.addEventListener('toggle', function () { est.adminAbierto = det.open; });
    det.appendChild(h('summary', { style: 'cursor:pointer;font-weight:700', text: 'Administrar exámenes (fechas, activar, eliminar) · ' + est.materias.length }));
    det.appendChild(h('p', { 'class': 'helptext', text: 'Programa cuándo se abre y se cierra cada examen (hora de esta computadora), actívalo o desactívalo, o elimínalo. Si asignas un examen a un alumno en el panel de administración, las fechas de esa asignación mandan.' }));
    if (!est.materias.length) det.appendChild(h('p', { 'class': 'empty', text: 'Todavía no hay exámenes en Supabase.' }));
    est.materias.slice().sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); }).forEach(function (m) { det.appendChild(filaAdministrar(m)); });
    return det;
  }

  // Repinta TODA la pestaña. El texto del script se conserva porque cada tecla lo guarda en est.texto.
  // Si el profesor ya cambió de pestaña, una respuesta tardía de la red NO debe pintar encima.
  function pintar() {
    if (!raiz || !raiz.isConnected) return;
    raiz.textContent = '';
    raiz.appendChild(vistaSesion());
    if (est.ocupado && est.ocupado !== 'Analizando...') raiz.appendChild(h('p', { 'class': 'helptext', text: est.ocupado }));
    if (est.msg) raiz.appendChild(h('p', { style: 'color:var(--presente);font-weight:600', text: est.msg }));
    if (est.err) raiz.appendChild(h('p', { style: 'color:var(--falta);white-space:pre-wrap', text: est.err }));
    if (!haySesion()) return;
    if (navigator.onLine === false) raiz.appendChild(h('p', { 'class': 'helptext', text: 'Sin conexión: puedes pegar y analizar el script; subirlo requiere internet.' }));
    raiz.appendChild(vistaAdministrar());
    raiz.appendChild(vistaMateria());
    raiz.appendChild(vistaScript());
    if (est.preview) { raiz.appendChild(vistaPrevia()); raiz.appendChild(vistaSubida()); }
  }

  // Lo llama app.js (render) cada vez que se muestra la pestaña.
  function montar(panel) {
    var nueva = !raiz || !raiz.isConnected;
    if (nueva) { est.err = ''; est.msg = ''; }
    raiz = h('div');
    panel.textContent = '';
    panel.appendChild(raiz);
    pintar();
    // Con sesión se refrescan materias y preguntas (si hay internet; si no, queda el borrador).
    if (nueva && haySesion() && navigator.onLine !== false) refrescar();
  }

  if (typeof window !== 'undefined') window.FullStatusExamenes = { montar: montar };
  // Exportación solo para pruebas en Node (en Electron "module" no existe).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      prepararScript: prepararScript, explicarError: explicarError, ejecutarScript: ejecutarScript, revisarPreguntas: revisarPreguntas,
      extraerIdYoutube: extraerIdYoutube, subirExamen: subirExamen, contarDuplicados: contarDuplicados, analizarScript: analizarScript, _est: est
    };
  }
})();
