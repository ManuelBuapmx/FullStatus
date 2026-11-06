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
   - Una materia nueva se crea DESACTIVADA; activarla y fijar su horario o asignaciones se sigue
     haciendo en el panel de administración (admin.html).
   - No usa alert()/confirm()/prompt() (Electron): la confirmación va dentro de la pestaña.
   ============================================================================ */
(function () {
  'use strict';

  const CLAVE_BORRADOR = 'fullstatusExamenesBorrador_v1'; // { texto, materiaId, modo }
  const ESPERA_ANALISIS_MS = 10000;                       // tope para el análisis aislado del script

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
  function contarDuplicados(nuevas, existentes) {
    var vistos = {};
    (existentes || []).forEach(function (q) { if (q.activa) vistos[normalizarTexto(q.texto)] = true; });
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
  function subirExamen(api, mid, preguntas, modo, existentes) {
    var etapa = 'insertar';
    var activasViejas = (existentes || []).filter(function (q) { return q.activa; }).map(function (q) { return q.id; });
    var offset = 0;
    if (modo === 'agregar') (existentes || []).forEach(function (q) { if (q.orden > offset) offset = q.orden; });
    var reemplaza = modo === 'reemplazar';
    var filas = preguntas.map(function (p) {
      return {
        texto: p.texto, opciones: p.opciones, correcta: p.correcta, orden: p.orden + offset,
        activa: !reemplaza, materia_id: mid, seccion: p.seccion || null, contexto: p.contexto || null
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
    materias: [], materiaId: borrador.materiaId || '',
    existentes: null,                         // preguntas de la materia elegida (id, orden, activa, texto)
    texto: borrador.texto || '', modo: borrador.modo === 'agregar' ? 'agregar' : 'reemplazar',
    preview: null, avisos: [],
    ocupado: '', msg: '', err: '', confirmando: false, nuevaMateria: ''
  };
  var raiz = null; // contenedor de esta pestaña; si ya no está en pantalla (cambió de pestaña) no se dibuja nada
  function guardarBorrador() {
    try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ texto: est.texto, materiaId: est.materiaId, modo: est.modo })); } catch (e) { /* sin espacio: no es grave */ }
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
    return rest('materias?select=id,nombre,activa,orden&order=orden.asc').then(function (filas) {
      est.materias = filas || [];
      if (!est.materias.some(function (m) { return String(m.id) === String(est.materiaId); })) {
        est.materiaId = est.materias.length ? String(est.materias[0].id) : '';
      }
    });
  }
  // Solo se leen id, orden, activa y texto: NUNCA la respuesta correcta.
  function cargarExistentes(mid) {
    if (mid === '' || mid === null || mid === undefined) { est.existentes = null; return Promise.resolve(); }
    return rest('preguntas?select=id,orden,activa,texto&materia_id=eq.' + Number(mid) + '&order=orden.asc')
      .then(function (filas) { est.existentes = filas || []; });
  }
  function refrescar() {
    if (!haySesion()) { pintar(); return Promise.resolve(); }
    est.ocupado = 'Cargando materias...'; pintar();
    return cargarMaterias().then(function () { return cargarExistentes(est.materiaId); })
      .then(function () { est.ocupado = ''; pintar(); }).catch(function (e) { fallo(e, ''); });
  }

  function nombreMateria(id) {
    var m = est.materias.find(function (x) { return String(x.id) === String(id); });
    return m ? m.nombre : 'materia ' + id;
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

  function vistaMateria() {
    var sel = h('select', { id: 'exaMateria' });
    est.materias.forEach(function (m) { sel.appendChild(h('option', { value: String(m.id), text: m.nombre + (m.activa ? '' : ' (desactivada)') })); });
    sel.value = String(est.materiaId);
    sel.addEventListener('change', function () {
      est.materiaId = sel.value; est.existentes = null; est.confirmando = false; guardarBorrador();
      cargarExistentes(est.materiaId).then(pintar).catch(function (e) { fallo(e, ''); });
      pintar();
    });
    var nueva = h('input', { type: 'text', id: 'exaNuevaMateria', placeholder: 'Nombre de una materia nueva', maxlength: '120', value: est.nuevaMateria });
    nueva.addEventListener('input', function () { est.nuevaMateria = nueva.value; });
    var info = '';
    if (est.existentes) {
      var act = est.existentes.filter(function (q) { return q.activa; }).length;
      info = '«' + nombreMateria(est.materiaId) + '» tiene ' + est.existentes.length + ' pregunta(s), ' + act + ' activa(s).';
    }
    return h('div', { 'class': 'card' }, [
      h('h2', { text: 'Materia (examen) destino' }),
      h('div', { 'class': 'field' }, [h('label', { 'for': 'exaMateria', text: 'Materia' }), sel]),
      info ? h('p', { 'class': 'helptext', text: info }) : null,
      h('div', { 'class': 'field', style: 'margin-top:12px' }, [h('label', { 'for': 'exaNuevaMateria', text: 'O crea una materia nueva (se crea desactivada)' }), nueva]),
      h('div', { 'class': 'row' }, [boton('Crear materia', 'secondary', function () {
        var n = est.nuevaMateria.trim();
        if (!n) { est.err = 'Escribe el nombre de la materia.'; pintar(); return; }
        var orden = est.materias.reduce(function (mx, m) { return Math.max(mx, m.orden || 0); }, 0) + 1;
        est.err = ''; est.msg = ''; est.ocupado = 'Creando materia...'; pintar();
        escribirConfirmado(rest, 'materias', 'POST', { nombre: n, orden: orden, activa: false }, 1)
          .then(function (filas) { est.materiaId = String(filas[0].id); est.nuevaMateria = ''; est.existentes = null; guardarBorrador(); return cargarMaterias(); })
          .then(function () { return cargarExistentes(est.materiaId); })
          .then(function () { est.ocupado = ''; est.msg = 'Materia creada (desactivada). Actívala en el panel de administración cuando el examen esté listo.'; pintar(); })
          .catch(function (e) { fallo(e, 'No se pudo crear la materia: '); });
      })])
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

  function vistaSubida() {
    var lista = est.preview, errores = lista.filter(function (p) { return p._error; }).length;
    var puede = !errores && lista.length > 0 && !!est.materiaId && !est.ocupado;
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
      h('h2', { text: 'Subir a «' + (est.materiaId ? nombreMateria(est.materiaId) : '—') + '»' }),
      opcion('reemplazar', 'Reemplazar el examen activo (las preguntas activas actuales se desactivan, no se borran)'),
      opcion('agregar', 'Agregar al final de las preguntas de la materia'),
      h('div', { 'class': 'row', style: 'margin-top:12px' }, [subir]),
      errores ? h('p', { 'class': 'helptext', text: 'Corrige el script y vuelve a analizar: no se puede subir con preguntas con error.' }) : null
    ];
    if (est.confirmando && est.existentes) {
      var act = est.existentes.filter(function (q) { return q.activa; }).length;
      var dup = est.modo === 'agregar' ? contarDuplicados(lista, est.existentes) : 0;
      var resumen = 'Vas a subir ' + lista.length + ' pregunta(s) a «' + nombreMateria(est.materiaId) + '». '
        + (est.modo === 'reemplazar' ? 'Se desactivarán ' + act + ' pregunta(s) activa(s) actuales. ' : 'Se agregarán después de las ' + est.existentes.length + ' existentes. ')
        + (dup ? '⚠ ' + dup + ' ya existen activas con el mismo texto (quedarían duplicadas). ' : '')
        + 'No lo hagas mientras haya alumnos contestando: se calificaría mal.';
      partes.push(h('div', { style: 'border:1px solid var(--brand-accent);border-radius:8px;padding:12px;margin-top:14px;background:var(--accent-soft)' }, [
        h('p', { style: 'margin:0 0 10px', text: resumen }),
        h('div', { 'class': 'row' }, [
          boton('Sí, subir ahora', '', function () {
            est.confirmando = false; est.err = ''; est.ocupado = 'Subiendo...'; pintar();
            subirExamen(rest, Number(est.materiaId), lista, est.modo, est.existentes).then(function (r) {
              est.ocupado = ''; est.preview = null; est.avisos = []; est.texto = ''; guardarBorrador();
              est.msg = 'Listo: ' + r.subidas + ' pregunta(s) subidas a «' + nombreMateria(est.materiaId) + '»' + (r.desactivadas ? ' (se desactivaron ' + r.desactivadas + ' anteriores)' : '') + '.';
              return cargarExistentes(est.materiaId);
            }).then(pintar).catch(function (e) { fallo(e, 'No se pudo subir. '); });
          }),
          boton('Cancelar', 'secondary', function () { est.confirmando = false; pintar(); })
        ])
      ]));
    }
    return h('div', { 'class': 'card' }, partes);
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
