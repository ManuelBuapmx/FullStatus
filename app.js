(function(){
  "use strict";

  // =========================================================
  // ESCUELAS (pantalla de inicio)
  // Cada escuela tiene su propio estado, cambios pendientes, caché del Excel
  // y archivo de Drive. La escuela "original" conserva las claves de siempre
  // (sin sufijo) para no perder los datos existentes.
  // =========================================================
  var ESCUELAS_KEY = "fullstatusEscuelas_v1";
  var ESCUELA_SESION_KEY = "fullstatusEscuelaSesion_v1";
  var SHEET_ID_ESCUELA_ORIGINAL = "1MyLylWU_26VzjMI8t3JZzDiDkcvsiYTi";
  var CACHE_DB_NOMBRE = "integratorium_cache_v1";

  function guardarEscuelas(lista){ localStorage.setItem(ESCUELAS_KEY, JSON.stringify(lista)); }
  function cargarEscuelas(){
    var lista = null;
    try{ lista = JSON.parse(localStorage.getItem(ESCUELAS_KEY)); }catch(e){}
    if(!Array.isArray(lista) || !lista.length){
      lista = [{id:"principal", nombre:"Escuela 1", driveFileId: localStorage.getItem("listaAsistenciaDriveFileId_v1") || SHEET_ID_ESCUELA_ORIGINAL, original:true}];
      guardarEscuelas(lista);
    }
    return lista;
  }
  function sufijoEscuela(e){ return e.original ? "" : "__" + e.id; }
  function extraerIdDrive(texto){
    var t = String(texto || "").trim();
    var m = t.match(/\/d\/([A-Za-z0-9_-]{15,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{15,})/);
    if(m) return m[1];
    return /^[A-Za-z0-9_-]{15,}$/.test(t) ? t : "";
  }
  function borrarCacheEscuela(clave){
    try{
      var req = indexedDB.open(CACHE_DB_NOMBRE, 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore("archivos"); };
      req.onsuccess = function(){ try{ req.result.transaction("archivos", "readwrite").objectStore("archivos").delete(clave); }catch(e){} };
    }catch(e){}
  }
  function mostrarSelectorEscuelas(){
    var nav = document.querySelector("nav.tabs"); if(nav) nav.style.display = "none";
    var conn = document.querySelector(".conn"); if(conn) conn.style.display = "none";
    var panel = document.getElementById("panelContent");
    function entrar(id){
      try{ sessionStorage.setItem(ESCUELA_SESION_KEY, id); }catch(e){}
      location.reload();
    }
    function pintar(){
      var html = '<div class="card"><div class="eyebrow">Inicio</div><h2>¿En qué escuela vas a trabajar?</h2>';
      html += '<p class="helptext" style="margin-top:0;">Cada escuela tiene sus propios grupos, asistencias y archivo de Drive.</p>';
      html += '<ul class="escuelas">';
      escuelas.forEach(function(e){
        html += '<li><button class="btn escuela-entrar" data-escuela-entrar="'+esc(e.id)+'">'+esc(e.nombre)+'</button>';
        html += '<button class="link-sutil" data-escuela-renombrar="'+esc(e.id)+'">Renombrar</button>';
        html += '<button class="btn danger" data-escuela-quitar="'+esc(e.id)+'"'+(escuelas.length < 2 ? ' disabled' : '')+'>Quitar</button></li>';
      });
      html += '</ul></div>';
      html += '<div class="card"><h2>Agregar otra escuela</h2>';
      html += '<div class="row" style="align-items:flex-end;">';
      html += '<div class="field" style="flex:1;min-width:200px;margin-bottom:0;"><label for="escuelaNombre">Nombre de la escuela</label><input type="text" id="escuelaNombre" maxlength="60" placeholder="Ej. Escuela 2"></div>';
      html += '<div class="field" style="flex:2;min-width:240px;margin-bottom:0;"><label for="escuelaDrive">Enlace o ID del Excel en Drive</label><input type="text" id="escuelaDrive" placeholder="https://docs.google.com/spreadsheets/d/..."></div>';
      html += '<button class="btn" id="btnEscuelaAgregar">Agregar escuela</button></div>';
      html += '<p class="helptext">Cada escuela usa su propio Excel institucional. Pega el enlace de ese archivo en Drive.</p></div>';
      panel.innerHTML = html;

      panel.querySelectorAll("[data-escuela-entrar]").forEach(function(b){
        b.addEventListener("click", function(){ entrar(b.getAttribute("data-escuela-entrar")); });
      });
      panel.querySelectorAll("[data-escuela-renombrar]").forEach(function(b){
        b.addEventListener("click", function(){
          var e = escuelas.find(function(x){ return x.id === b.getAttribute("data-escuela-renombrar"); });
          if(!e) return;
          pedirTexto('Nuevo nombre para "'+e.nombre+'":', function(nombre){
            nombre = nombre.trim();
            if(!nombre) return;
            e.nombre = nombre; guardarEscuelas(escuelas); pintar();
          });
        });
      });
      panel.querySelectorAll("[data-escuela-quitar]").forEach(function(b){
        b.addEventListener("click", function(){
          var e = escuelas.find(function(x){ return x.id === b.getAttribute("data-escuela-quitar"); });
          if(!e || escuelas.length < 2) return;
          confirmar('¿Quitar "'+e.nombre+'" de este equipo? Se borran sus grupos y asistencias guardados aquí (el Excel de Drive no se toca). No se puede deshacer.', function(){
            var suf = sufijoEscuela(e);
            localStorage.removeItem("listaAsistenciaData_v2" + suf);
            localStorage.removeItem("listaAsistenciaCambiosPendientes_v1" + suf);
            localStorage.removeItem("listaAsistenciaDriveFileId_v1" + suf);
            borrarCacheEscuela("institucional" + suf);
            escuelas = escuelas.filter(function(x){ return x.id !== e.id; });
            guardarEscuelas(escuelas); pintar();
          });
        });
      });
      document.getElementById("btnEscuelaAgregar").addEventListener("click", function(){
        var nombre = document.getElementById("escuelaNombre").value.trim();
        var idDrive = extraerIdDrive(document.getElementById("escuelaDrive").value);
        if(!nombre){ showToast("Escribe el nombre de la escuela."); return; }
        if(!idDrive){ showToast("Pega el enlace (o el ID) del Excel de esa escuela en Drive."); return; }
        if(escuelas.some(function(x){ return x.nombre.trim().toLowerCase() === nombre.toLowerCase(); })){ showToast("Ya existe una escuela con ese nombre."); return; }
        var nueva = {id: uid(), nombre: nombre, driveFileId: idDrive};
        escuelas.push(nueva); guardarEscuelas(escuelas);
        entrar(nueva.id);
      });
    }
    pintar();
  }

  var escuelas = cargarEscuelas();
  var escuelaActual = null;
  try{
    var idSesionEscuela = sessionStorage.getItem(ESCUELA_SESION_KEY);
    escuelaActual = escuelas.find(function(e){ return e.id === idSesionEscuela; }) || null;
  }catch(e){}
  // Sin escuela elegida en esta sesión: se muestra la pantalla de inicio y no se arranca la app.
  if(!escuelaActual){ mostrarSelectorEscuelas(); return; }
  var SUF = sufijoEscuela(escuelaActual);
  var STORAGE_KEY = "listaAsistenciaData_v2" + SUF;
  var PENDIENTES_KEY = "listaAsistenciaCambiosPendientes_v1" + SUF;
  var CACHE_KEY = "institucional" + SUF;
  document.title = "FullStatus — " + escuelaActual.nombre;
  var ESTADOS = ["P","A","R"];
  var ESTADO_VALOR_EXPORT = {P:1, A:0, R:2};

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  function todayISO(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function displayFecha(iso){
    var p = iso.split("-");
    return p.length===3 ? p[2]+"/"+p[1]+"/"+p[0] : iso;
  }
  function excelFechaSerial(iso){
    var partes = iso.split("-").map(Number);
    return (Date.UTC(partes[0], partes[1]-1, partes[2]) / 86400000) + 25569;
  }
  function parseFechaMX(value){
    var match = String(value).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!match) return null;
    var day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    var date = new Date(year, month-1, day);
    if(date.getFullYear() !== year || date.getMonth() !== month-1 || date.getDate() !== day) return null;
    return year + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
  }
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; });
  }

  function defaultState(){ return { grupos: [], grupoActivoId: null, asistencias: {}, justificantes: {}, hojasPorEliminar: [], fechasVacias: {} }; }
  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if(!parsed.grupos) return defaultState();
      if(!parsed.justificantes) parsed.justificantes = {};
      if(!parsed.asistencias) parsed.asistencias = {};
      if(!Array.isArray(parsed.hojasPorEliminar)) parsed.hojasPorEliminar = [];
      if(!parsed.fechasVacias) parsed.fechasVacias = {};
      purgarFechasVacias(parsed);
      return parsed;
    }catch(e){ return defaultState(); }
  }
  // Versiones anteriores creaban (y guardaban) un registro vacío de "hoy" con
  // solo seleccionar un grupo, lo que luego generaba una columna de fecha vacía
  // en el Excel. Al cargar, se eliminan esos registros sin ninguna marca para
  // que no vuelvan a aparecer como fechas del grupo.
  function purgarFechasVacias(estado){
    Object.keys(estado.asistencias || {}).forEach(function(grupoId){
      var porFecha = estado.asistencias[grupoId] || {};
      Object.keys(porFecha).forEach(function(fecha){
        if(!porFecha[fecha] || Object.keys(porFecha[fecha]).length === 0) delete porFecha[fecha];
      });
    });
  }
  function saveState(markPending){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if(markPending !== false){
        cambiosPendientes = true;
        localStorage.setItem(PENDIENTES_KEY, "1");
        if(document.getElementById("connText")) updateConn();
      }
    }
    catch(e){ showToast("No se pudo guardar en este dispositivo (¿modo privado?)."); }
  }

  var CACHE_DB = "integratorium_cache_v1";
  function abrirCache(){
    return new Promise(function(resolve, reject){
      var request = indexedDB.open(CACHE_DB, 1);
      request.onupgradeneeded = function(){ request.result.createObjectStore("archivos"); };
      request.onsuccess = function(){ resolve(request.result); };
      request.onerror = function(){ reject(request.error); };
    });
  }
  function guardarPlantillaLocal(buffer){
    return abrirCache().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction("archivos", "readwrite");
        tx.objectStore("archivos").put(buffer, CACHE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = function(){ reject(tx.error); };
      });
    });
  }
  function cargarPlantillaLocal(){
    return abrirCache().then(function(db){
      return new Promise(function(resolve, reject){
        var request = db.transaction("archivos").objectStore("archivos").get(CACHE_KEY);
        request.onsuccess = function(){ resolve(request.result || null); };
        request.onerror = function(){ reject(request.error); };
      });
    }).catch(function(){ return null; });
  }
  async function restaurarCacheLocal(){
    var buffer = await cargarPlantillaLocal();
    if(!buffer) return;
    try{
      plantillaExcel = new ExcelJS.Workbook();
      await plantillaExcel.xlsx.load(buffer);
      if(!state.grupos.length){
        var grupos = [], asistencias = {};
        plantillaExcel.worksheets.forEach(function(ws){
          if(esHojaPlantilla(ws.name)) return;
          var datos = extraerGrupoDeHoja(ws), grupoId = uid();
          grupos.push({id:grupoId, nombre:ws.name, estudiantes:datos ? datos.estudiantes : [], materia:datos ? datos.materia : "", profesor:datos ? datos.profesor : ""});
          asistencias[grupoId] = datos ? datos.asistencias : {};
          registrarFechasVacias(grupoId, asistencias[grupoId]);
        });
        state.grupos = grupos;
        state.asistencias = asistencias;
        state.grupoActivoId = grupos[0] ? grupos[0].id : null;
        saveState(false);
      }
    }catch(error){ console.error("No se pudo restaurar la plantilla local", error); }
  }

  var state = loadState();
  var currentTab = "pasar";
  var pasarFecha = todayISO();
  var pasarIndex = null;
  // PRISMAL MESH: columna desplegable "Matrícula" de la lista completa del pase de lista.
  // Muestra qué alumnos ya tienen matrícula en Supabase (coincidencia por nombre, la misma que usa
  // la publicación de asistencias). Va PLEGADA por defecto para no estorbar al pasar lista; la
  // elección se recuerda en este equipo. matPorGrupo[id del grupo] = { firma, estado, filas, msg }.
  var matVisible = false;
  try { matVisible = localStorage.getItem("fsMatriculasVisible") === "1"; } catch(e){}
  var matPorGrupo = {};
  var cuentasAbierto = false;   // sección «Cuentas de alumnos» (contraseña) desplegada; usa los mismos datos que la columna Matrícula
  // PRISMAL MESH: el Historial también tiene la columna "Matrícula" (misma consulta y mismo botón
  // plegable que Pasar lista) y un filtro para ver solo los que no tienen: "todos" | "sin" | "con".
  var matFiltro = "todos";
  // PRISMAL MESH: edición de la matrícula en Grupos → "Estudiantes de ...". matEdit = { gid, eid, valor }
  // mientras se escribe; matGuardando evita dobles envíos; matFoco pide enfocar el campo tras dibujar.
  var matEdit = null;
  var matGuardando = false;
  var matFoco = false;
  var pasarViewMode = "card";
  var pasarSegundaLista = null;
  var pasarSegundaIndex = null;
  var histDesde = "";
  var histHasta = "";
  var histUnidad = "";

  var plantillaExcel = null;
  var GOOGLE_CLIENT_ID = "814235047466-9bp0f3j15l5eikmpjasgigol9gnvdelv.apps.googleusercontent.com";
  var GOOGLE_SHEET_ID = escuelaActual.driveFileId; // archivo de Drive de la escuela elegida
  var DRIVE_FILE_KEY = "listaAsistenciaDriveFileId_v1" + SUF;
  var GOOGLE_AUTH_KEY = "listaAsistenciaGoogleDriveAuth_v3";
  var driveFileId = localStorage.getItem(DRIVE_FILE_KEY) || GOOGLE_SHEET_ID;
  var driveTokenClient = null;
  var drivePendingAction = null;
  var cambiosPendientes = localStorage.getItem(PENDIENTES_KEY) === "1";
  var sincronizando = false;

  function grupoActivo(){ return state.grupos.find(function(g){ return g.id === state.grupoActivoId; }) || null; }
  function ordenarEstudiantes(grupo){
    if(!grupo || !Array.isArray(grupo.estudiantes)) return;
    grupo.estudiantes.sort(function(a, b){
      return a.nombre.localeCompare(b.nombre, "es", {sensitivity:"base"});
    });
  }
  function ensureAsistenciaBucket(grupoId, fecha){
    if(!state.asistencias[grupoId]) state.asistencias[grupoId] = {};
    if(!state.asistencias[grupoId][fecha]) state.asistencias[grupoId][fecha] = {};
    return state.asistencias[grupoId][fecha];
  }
  // Lectura SIN efectos secundarios: devuelve las marcas de una fecha si existen,
  // o un objeto vacío temporal si no. A diferencia de ensureAsistenciaBucket,
  // nunca crea la fecha en el estado; así, solo mirar un grupo en la fecha de
  // hoy ya no genera una columna nueva. La fecha solo nace al registrar una marca.
  function leerAsistenciaBucket(grupoId, fecha){
    return (state.asistencias[grupoId] && state.asistencias[grupoId][fecha]) || {};
  }
  // Una fecha cuenta como "registrada" únicamente si tiene al menos una marca.
  function fechaTieneMarcas(grupoId, fecha){
    return Object.keys(leerAsistenciaBucket(grupoId, fecha)).length > 0;
  }
  function fechasDelGrupo(grupoId){
    var conMarcas = Object.keys(state.asistencias[grupoId] || {}).filter(function(fecha){
      return fechaTieneMarcas(grupoId, fecha);
    });
    // Fechas que ya existen como columna en el Excel pero sin ninguna marca (importadas).
    var vacias = Object.keys((state.fechasVacias || {})[grupoId] || {});
    return conMarcas.concat(vacias.filter(function(f){ return conMarcas.indexOf(f) === -1; })).sort();
  }
  // Conserva como días "sin marcas" las fechas del Excel que no tienen ninguna asistencia.
  function registrarFechasVacias(grupoId, asistenciasPorFecha){
    Object.keys(asistenciasPorFecha || {}).forEach(function(iso){
      if(Object.keys(asistenciasPorFecha[iso] || {}).length > 0) return;
      if(!state.fechasVacias) state.fechasVacias = {};
      if(!state.fechasVacias[grupoId]) state.fechasVacias[grupoId] = {};
      state.fechasVacias[grupoId][iso] = true;
    });
  }
  // Regla de retardos: cada 3 retardos de un alumno = 1 falta (injustificada) y 2 asistencias.
  function faltasEquivalentes(faltas, retardos){ return faltas + Math.floor(retardos / 3); }
  // Total de asistencias de un alumno. "presentes" ya incluye las faltas justificadas.
  // Cada retardo cuenta como asistencia normal mientras no se complete el tercero;
  // por cada grupo de 3 retardos, uno de los tres días pasa a ser falta
  // (3 retardos = 2 asistencias + 1 falta): asistencias = retardos - floor(retardos / 3).
  function totalAsistencias(presentes, retardos){ return presentes + retardos - Math.floor(retardos / 3); }
  // Conteo de un solo día (no aplica la regla de 3 retardos, que es por alumno
  // a lo largo de varios días): presentes (P + justificadas), faltas sin justificar y retardos.
  function resumenDia(g, bucket, fecha){
    var r = {P:0, A:0, R:0, J:0};
    g.estudiantes.forEach(function(e){
      var v = bucket[e.id];
      if(!v) return;
      if(v === "A" && esJustificada(g.id, fecha, e.id)) r.J++;
      else r[v]++;
    });
    return r;
  }

  // Unidades/periodos: solo viven en la app (no se escriben en el Excel institucional).
  function unidadesDelGrupo(g){
    return (Array.isArray(g.unidades) ? g.unidades.slice() : []).sort(function(a, b){ return a.desde < b.desde ? -1 : (a.desde > b.desde ? 1 : 0); });
  }
  function unidadDeFecha(g, fecha){
    return unidadesDelGrupo(g).find(function(u){ return fecha >= u.desde && fecha <= u.hasta; }) || null;
  }
  function fechasFiltradas(g, todasFechas){
    var unidad = histUnidad ? unidadesDelGrupo(g).find(function(u){ return u.id === histUnidad; }) : null;
    return todasFechas.filter(function(f){
      if(unidad && (f < unidad.desde || f > unidad.hasta)) return false;
      if(histDesde && f < histDesde) return false;
      if(histHasta && f > histHasta) return false;
      return true;
    });
  }
  // prompt() no existe en Electron, por eso se usa un cuadro propio.
  function pedirTexto(mensaje, alAceptar){
    var fondo = document.createElement("div");
    fondo.className = "modal-fondo";
    fondo.innerHTML = '<div class="modal-caja" role="dialog" aria-modal="true"><p>'+esc(mensaje)+'</p><input type="text" id="modalTexto" maxlength="200"><div class="row" style="justify-content:flex-end;margin-top:14px;"><button class="btn secondary" id="modalCancelar">Cancelar</button><button class="btn" id="modalAceptar">Aceptar</button></div></div>';
    document.body.appendChild(fondo);
    var input = fondo.querySelector("#modalTexto");
    function cerrar(){ document.body.removeChild(fondo); }
    function aceptar(){ var valor = input.value; cerrar(); alAceptar(valor); }
    fondo.querySelector("#modalAceptar").addEventListener("click", aceptar);
    fondo.querySelector("#modalCancelar").addEventListener("click", cerrar);
    input.addEventListener("keydown", function(ev){
      if(ev.key === "Enter") aceptar();
      else if(ev.key === "Escape") cerrar();
    });
    input.focus();
  }
  // confirm() nativo deja sin foco los campos de texto en Electron; este cuadro propio no.
  function confirmar(mensaje, alAceptar, alCancelar){
    var fondo = document.createElement("div");
    fondo.className = "modal-fondo";
    fondo.innerHTML = '<div class="modal-caja" role="dialog" aria-modal="true"><p>'+esc(mensaje)+'</p><div class="row" style="justify-content:flex-end;margin-top:14px;"><button class="btn secondary" id="modalCancelar">Cancelar</button><button class="btn" id="modalAceptar">Aceptar</button></div></div>';
    document.body.appendChild(fondo);
    function cerrar(){ document.removeEventListener("keydown", teclas); document.body.removeChild(fondo); }
    function aceptar(){ cerrar(); alAceptar(); }
    function cancelar(){ cerrar(); if(alCancelar) alCancelar(); }
    function teclas(ev){
      if(ev.key === "Escape") cancelar();
      else if(ev.key === "Enter" && !(document.activeElement && document.activeElement.id === "modalCancelar")){ ev.preventDefault(); aceptar(); }
    }
    fondo.querySelector("#modalAceptar").addEventListener("click", aceptar);
    fondo.querySelector("#modalCancelar").addEventListener("click", cancelar);
    document.addEventListener("keydown", teclas);
    fondo.querySelector("#modalAceptar").focus();
  }

  function ensureJustificantesBucket(grupoId, fecha){
    if(!state.justificantes[grupoId]) state.justificantes[grupoId] = {};
    if(!state.justificantes[grupoId][fecha]) state.justificantes[grupoId][fecha] = {};
    return state.justificantes[grupoId][fecha];
  }
  function esJustificada(grupoId, fecha, estudianteId){
    return !!(state.justificantes[grupoId] && state.justificantes[grupoId][fecha] && state.justificantes[grupoId][fecha][estudianteId]);
  }
  function notaJustificante(grupoId, fecha, estudianteId){
    var entrada = state.justificantes[grupoId] && state.justificantes[grupoId][fecha] && state.justificantes[grupoId][fecha][estudianteId];
    return entrada ? (entrada.nota || "") : "";
  }

  function showToast(msg){
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(function(){ t.classList.remove("show"); }, 2600);
  }

  function setTab(tab){
    currentTab = tab;
    document.querySelectorAll("nav.tabs button").forEach(function(b){ b.classList.toggle("active", b.dataset.tab === tab); });
    render();
  }
  function render(){
    var panel = document.getElementById("panelContent");
    state.grupos.forEach(ordenarEstudiantes);
    if(currentTab === "grupos") panel.innerHTML = renderGrupos();
    else if(currentTab === "pasar") panel.innerHTML = renderPasar();
    else if(currentTab === "calificaciones") panel.innerHTML = renderCalificaciones();
    else if(currentTab === "resultados") panel.innerHTML = renderResultados();
    // Exámenes: lo dibuja supabase-examenes.js (conserva su propio estado entre renders).
    else if(currentTab === "examenes"){
      if(window.FullStatusExamenes) window.FullStatusExamenes.montar(panel);
      else panel.innerHTML = '<div class="card"><p class="empty">Falta cargar supabase-examenes.js (revisa index.html).</p></div>';
    }
    else panel.innerHTML = renderHistorial();
    attachHandlers();
  }

  // =========================================================
  // GRUPOS
  // =========================================================
  function botonActualizarDrive(){
    return '<button class="btn" id="btnActualizarDrive">'+(driveFileId ? "Actualizar en Google Drive" : "Guardar en Google Drive")+'</button>';
  }

  function renderGrupos(){
    var html = "";

    html += '<div class="card">';
    html += "<h2>Grupos institucionales</h2>";
    html += '<p class="helptext" style="margin-top:0;">El archivo se carga una vez y queda disponible en este dispositivo. Sin conexión, tus cambios se guardan localmente y se sincronizan al volver internet.</p>';
    html += '<button class="btn" id="btnCargarGoogle">Cargar archivo institucional desde Drive</button>';
    html += '<span id="cargarGoogleEstado" class="helptext" style="margin-left:10px;"></span>';
    html += '<div style="margin-top:10px;"><button class="btn secondary" id="btnAgregarNuevosDrive">Agregar grupos nuevos del Excel</button></div>';
    if(state.grupos.length){
      html += '<div style="margin-top:10px;">' + botonActualizarDrive() + '</div>';
    }
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Tus grupos</h2>";
    if(state.grupos.length === 0){
      html += '<p class="empty">Aún no tienes ningún grupo. Cárgalos desde Google Sheets.</p>';
    } else {
      html += '<div class="grupo-selector">';
      html += '<select id="selGrupoActivo">';
      state.grupos.forEach(function(g){
        html += '<option value="'+esc(g.id)+'" '+(g.id===state.grupoActivoId?"selected":"")+'>'+esc(g.nombre)+' ('+g.estudiantes.length+')</option>';
      });
      html += "</select>";
      html += '<button class="btn danger" id="btnEliminarGrupo">Eliminar este grupo</button>';
      html += "</div>";
      var g = grupoActivo();
      if(g){
        html += '<div class="meta-fields">';
        html += '<div class="field"><label for="inputMateria">Materia (opcional)</label><input type="text" id="inputMateria" value="'+esc(g.materia||"")+'" placeholder="Ej. Inglés VIII"></div>';
        html += '<div class="field"><label for="inputProfesor">Profesor (opcional)</label><input type="text" id="inputProfesor" value="'+esc(g.profesor||"")+'" placeholder="Ej. Ing. José Manuel Robles"></div>';
        html += "</div>";
        // PRISMAL MESH: un grupo con varias materias. Cada materia es una entrada propia (con sus
        // asistencias, unidades, calificaciones y hoja de Excel) que comparte la lista de alumnos.
        html += '<div class="meta-fields" style="margin-top:10px;">';
        html += '<div class="field"><label for="inputOtraMateria">Agregar otra materia a este grupo</label><input type="text" id="inputOtraMateria" placeholder="Ej. Inglés VII"></div>';
        html += '<div class="field" style="align-self:flex-end;"><button class="btn secondary" id="btnOtraMateria">Agregar materia</button></div>';
        html += "</div>";
        html += '<p class="helptext" style="margin-top:4px;">Copia a los alumnos de «'+esc(g.grupoBase || g.nombre)+'» en una entrada nueva con sus propias asistencias, unidades y calificaciones. Se publica en Supabase como el mismo grupo.</p>';
      }
    }
    html += "</div>";

    html += renderCuentasAlumnos(grupoActivo());

    html += '<div class="card">';
    html += "<h2>Crear un grupo manualmente</h2>";
    html += '<div class="row">';
    html += '<input type="text" id="inputNuevoGrupo" placeholder="Ej. 3° A — Matemáticas" style="flex:1;min-width:200px;">';
    html += '<button class="btn" id="btnCrearGrupo">Crear grupo</button>';
    html += "</div></div>";

    var g2 = grupoActivo();
    if(g2){
      html += '<div class="card">';
      html += "<h2>Estudiantes de "+esc(g2.nombre)+"</h2>";
      if(g2.estudiantes.length === 0){
        html += '<p class="empty">Este grupo no tiene estudiantes todavía.</p>';
      } else {
        // PRISMAL MESH: aquí la matrícula se consulta siempre (no depende de la columna plegable de Pasar lista)
        // y se puede agregar o corregir con "Editar"; se guarda en Supabase con la función guardar_matricula.
        var cacheEst = asegurarMatriculas(g2, true);
        if(cacheEst){
          if(cacheEst.estado === "ok"){
            var conE = 0, sinE = 0, parE = 0;
            g2.estudiantes.forEach(function(e){
              var fE = cacheEst.filas[e.id];
              if(tieneMatricula(cacheEst, e)) conE++; else if(fE && fE.estado === "posible") parE++; else sinE++;
            });
            html += '<p class="helptext" style="margin:0 0 6px;">'+conE+' con matrícula · '+sinE+' sin matrícula'+(parE ? ' · <b style="color:var(--retardo);">'+parE+' con nombre distinto al de Supabase</b> (no se les publican asistencias ni calificaciones hasta corregirlo)' : '')+' <button class="link-sutil" id="btnRefrescarMatriculas">Actualizar</button></p>';
          } else if(cacheEst.estado === "cargando"){
            html += '<p class="helptext" style="margin:0 0 6px;">Consultando matrículas…</p>';
          } else {
            html += '<p class="helptext" style="margin:0 0 6px;">'+esc(cacheEst.msg)+' <button class="link-sutil" id="btnRefrescarMatriculas">Reintentar</button></p>';
          }
        }
        html += '<ul class="estudiantes">';
        g2.estudiantes.forEach(function(e){
          var fm = cacheEst && cacheEst.estado === "ok" ? cacheEst.filas[e.id] : null;
          var editando = !!(matEdit && matEdit.gid === g2.id && matEdit.eid === e.id);
          html += '<li><span class="est-nombre">'+esc(e.nombre)+'</span>';
          if(editando){
            var valorIni = matEdit.valor !== undefined ? matEdit.valor : (fm && fm.estado === "ok" ? fm.matricula : "");
            html += '<span class="est-mat"><input type="text" id="inputMatricula" class="input-matricula" placeholder="Matrícula" autocomplete="off" value="'+esc(valorIni)+'"'+(matGuardando?' disabled':'')+'></span>';
            html += '<span class="est-acciones"><button class="btn" data-guardar-mat="'+esc(e.id)+'"'+(matGuardando?' disabled':'')+'>'+(matGuardando?"Guardando…":"Guardar")+'</button>';
            html += '<button class="btn secondary" data-cancelar-mat="1"'+(matGuardando?' disabled':'')+'>Cancelar</button></span>';
          } else {
            html += '<span class="est-mat">'+(cacheEst && cacheEst.estado === "cargando" ? '<span class="helptext" style="margin:0;">…</span>' : celdaMatriculaHtml(cacheEst, e, true))+'</span>';
            html += '<span class="est-acciones">';
            if(fm && (fm.estado === "ok" || fm.estado === "sin")){
              html += '<button class="btn secondary" data-editar-mat="'+esc(e.id)+'">Editar</button>';
            } else if(fm && fm.estado === "posible"){
              html += '<button class="btn secondary" data-usar-nombre="'+esc(e.id)+'">Usar ese nombre</button>';
            }
            html += '<button class="btn danger" data-del-estudiante="'+esc(e.id)+'">Quitar</button></span>';
          }
          html += '</li>';
        });
        html += "</ul>";
      }
      html += '<div class="row" style="margin-top:16px;">';
      html += '<input type="text" id="inputNuevoEstudiante" placeholder="Nombre del estudiante" style="flex:1;min-width:180px;">';
      html += '<button class="btn secondary" id="btnAgregarEstudiante">Agregar</button>';
      html += "</div>";
      html += '<div class="field" style="margin-top:14px;">';
      html += '<label for="textareaBulk">O pega varios nombres, uno por línea</label>';
      html += '<textarea id="textareaBulk" placeholder="Ana Torres&#10;Luis Martínez&#10;Sofía Ramírez"></textarea>';
      html += "</div>";
      html += '<button class="btn secondary" id="btnAgregarVarios">Agregar todos</button>';
      html += "</div>";
    }
    return html;
  }

  // ---- Lectura de la plantilla institucional ----
  var NOMBRE_HOJA_PLANTILLA = "plantilla";
  function esHojaPlantilla(nombre){ return String(nombre||"").trim().toLowerCase() === NOMBRE_HOJA_PLANTILLA; }
  function obtenerHojaPlantilla(wb){
    return wb.worksheets.find(function(ws){ return esHojaPlantilla(ws.name); }) || null;
  }
  function columnaDesdeLetra(letra){
    var resultado = 0;
    for(var i=0; i<letra.length; i++){ resultado = resultado*26 + (letra.charCodeAt(i) - 64); }
    return resultado;
  }
  function normalizaEtiqueta(v){ return String(v==null?"":v).replace(/\s+/g,"").toUpperCase(); }
  function esEncabezadoAlumno(v){
    var etiqueta = normalizaEtiqueta(v);
    return etiqueta.indexOf("ALUMNO") !== -1 || (etiqueta.indexOf("NOMBRE") !== -1 && etiqueta.indexOf("PROFESOR") === -1 && etiqueta.indexOf("GRUPO") === -1);
  }

  function buscarValorEtiqueta(ws, etiquetaBuscada, maxRow, maxCol){
    for(var r=1; r<=maxRow; r++){
      var row = ws.getRow(r);
      for(var c=1; c<=maxCol; c++){
        var val = row.getCell(c).value;
        if(val && typeof val === "object" && val.richText){
          val = val.richText.map(function(t){return t.text;}).join("");
        }
        if(normalizaEtiqueta(val).indexOf(etiquetaBuscada) !== -1){
          for(var c2=c+1; c2<=Math.min(c+8,maxCol); c2++){
            var v2 = row.getCell(c2).value;
            if(v2 && typeof v2 === "object" && v2.richText) v2 = v2.richText.map(function(t){return t.text;}).join("");
            if(v2 !== null && v2 !== undefined && String(v2).trim() !== ""){
              return String(v2).trim();
            }
          }
        }
      }
    }
    return "";
  }

  function extraerGrupoDeHoja(ws){
    var MAX_HEADER_SEARCH = 200, MAX_COL = 100;
    var headerRow = -1, nameCol = -1;
    for(var r=1; r<=MAX_HEADER_SEARCH && headerRow===-1; r++){
      var row = ws.getRow(r);
      for(var c=1; c<=MAX_COL; c++){
        var val = row.getCell(c).value;
        if(val && typeof val === "object" && val.richText) val = val.richText.map(function(t){return t.text;}).join("");
        if(esEncabezadoAlumno(val)){
          headerRow = r; nameCol = c; break;
        }
      }
    }
    if(headerRow === -1) return null;

    var headerRowObj = ws.getRow(headerRow);
    var columnasFecha = [];
    for(var c2 = nameCol+1; c2 <= MAX_COL; c2++){
      var v = headerRowObj.getCell(c2).value;
      if(v instanceof Date){ columnasFecha.push({col:c2, fecha:v}); }
    }

    var estudiantes = [];
    var asistenciasPorFecha = {};
    columnasFecha.forEach(function(cf){
      var iso = cf.fecha.getUTCFullYear() + "-" + String(cf.fecha.getUTCMonth()+1).padStart(2,"0") + "-" + String(cf.fecha.getUTCDate()).padStart(2,"0");
      asistenciasPorFecha[iso] = {};
    });

    var r3 = headerRow + 1, vaciasSeguidas = 0, tope = headerRow + 400;
    while(r3 <= tope){
      var rowObj = ws.getRow(r3);
      var nameVal = rowObj.getCell(nameCol).value;
      if(nameVal && typeof nameVal === "object" && nameVal.richText) nameVal = nameVal.richText.map(function(t){return t.text;}).join("");
      var nombre = (nameVal===null||nameVal===undefined) ? "" : String(nameVal).trim();
      if(!nombre){
        vaciasSeguidas++;
        if(vaciasSeguidas >= 2) break;
        r3++; continue;
      }
      vaciasSeguidas = 0;
      var estId = uid();
      estudiantes.push({id: estId, nombre: nombre});
      columnasFecha.forEach(function(cf){
        var iso = cf.fecha.getUTCFullYear() + "-" + String(cf.fecha.getUTCMonth()+1).padStart(2,"0") + "-" + String(cf.fecha.getUTCDate()).padStart(2,"0");
        var raw = rowObj.getCell(cf.col).value;
        var estado = null;
        if(raw === 1) estado = "P";
        else if(raw === 0) estado = "A";
        else if(raw === 2 || (typeof raw === "string" && (raw.trim() === "2" || raw.trim().toUpperCase() === "R"))) estado = "R";
        if(estado) asistenciasPorFecha[iso][estId] = estado;
      });
      r3++;
    }
    var materia = buscarValorEtiqueta(ws, "MATERIA", headerRow, MAX_COL);
    var profesor = buscarValorEtiqueta(ws, "PROFESOR", headerRow, MAX_COL);

    return { nombre: ws.name, estudiantes: estudiantes, asistencias: asistenciasPorFecha, materia: materia, profesor: profesor };
  }

  // =========================================================
  // PASAR LISTA (modo tarjeta)
  // =========================================================
  function renderSelectorGrupoPasar(g){
    var html = '<div class="field" style="margin-bottom:0;"><label for="selGrupoPasar">Grupo</label><select id="selGrupoPasar">';
    state.grupos.forEach(function(grupo){
      html += '<option value="'+esc(grupo.id)+'" '+(grupo.id===g.id?"selected":"")+'>'+esc(grupo.nombre)+' ('+grupo.estudiantes.length+')</option>';
    });
    return html + '</select></div>';
  }

  function renderPasar(){
    var g = grupoActivo();
    if(!g) return '<div class="card"><p class="empty">Primero crea o importa un grupo en la pestaña "Grupos".</p></div>';
    if(g.estudiantes.length === 0) return '<div class="card">'+renderSelectorGrupoPasar(g)+'<p class="empty">"'+esc(g.nombre)+'" todavía no tiene estudiantes. Agrégalos en la pestaña "Grupos".</p></div>';

    // Solo lectura: la fecha se crea hasta que se marca al primer alumno.
    var bucket = leerAsistenciaBucket(g.id, pasarFecha);
    if(pasarIndex === null){
      var idx = g.estudiantes.findIndex(function(e){ return !bucket[e.id]; });
      pasarIndex = idx === -1 ? g.estudiantes.length : idx;
    }

    var html = '<div class="card">';
    html += '<div class="row" style="justify-content:space-between;">';
    html += renderSelectorGrupoPasar(g);
    html += '<div class="field" style="margin-bottom:0;"><label for="inputFechaLista">Fecha</label><input type="date" id="inputFechaLista" value="'+pasarFecha+'"></div>';
    if(pasarViewMode !== "segunda"){
      html += '<button class="link-sutil" id="btnToggleVista">'+(pasarViewMode==="card" ? "Ver lista completa" : "Volver a modo tarjeta")+'</button>';
    }
    html += botonActualizarDrive();
    html += "</div></div>";

    if(pasarViewMode === "list"){
      html += renderPasarListaCompleta(g, bucket);
      return html;
    }

    if(pasarViewMode === "segunda"){
      html += renderSegundoPase(g, bucket);
      return html;
    }

    if(pasarIndex >= g.estudiantes.length){
      // Presentes incluye las faltas justificadas; las faltas son solo las injustificadas.
      var resumen = resumenDia(g, bucket, pasarFecha);
      html += '<div class="card completo">';
      html += "<h3>Lista completa</h3>";
      html += '<p class="helptext">'+esc(g.nombre)+' — '+displayFecha(pasarFecha)+'</p>';
      html += '<div class="resumen-final">';
      html += '<span><b style="color:var(--presente)">'+(resumen.P + resumen.J)+'</b>presentes</span>';
      html += '<span><b style="color:var(--falta)">'+resumen.A+'</b>faltas</span>';
      html += '<span><b style="color:var(--retardo)">'+resumen.R+'</b>retardos</span>';
      html += "</div>";
      html += '<p class="helptext">Cada 3 retardos de un alumno equivalen a 1 falta y 2 asistencias.</p>';
      html += '<div class="row" style="justify-content:center;">';
      if(resumen.A + resumen.J > 0){
        html += '<button class="btn" id="btnSegundoPase">Segundo pase: revisar faltas ('+(resumen.A + resumen.J)+')</button>';
      }
      html += '<button class="btn secondary" id="btnRevisarLista">Revisar y corregir</button>';
      html += '<button class="btn secondary" id="btnReiniciarLista">Empezar de nuevo</button>';
      html += "</div></div>";
      return html;
    }

    var est = g.estudiantes[pasarIndex];
    var pct = Math.round((pasarIndex / g.estudiantes.length) * 100);
    html += '<div class="progreso">';
    html += '<div style="flex:1;"><div class="progreso-texto">'+(pasarIndex+1)+' de '+g.estudiantes.length+'</div><div class="barra"><div class="barra-fill" style="width:'+pct+'%;"></div></div></div>';
    html += "</div>";

    html += '<div class="tarjeta">';
    html += '<div class="num-lista">Alumno '+(pasarIndex+1)+'</div>';
    html += '<div class="nombre-grande">'+esc(est.nombre)+'</div>';
    html += '<div class="botones-estado">';
    html += '<button class="btn-estado presente" data-marcar="P">Asistencia</button>';
    html += '<button class="btn-estado falta" data-marcar="A">Falta</button>';
    html += "</div>";
    html += '<div class="fila-secundaria">';
    html += '<button class="link-sutil" id="btnAnterior" '+(pasarIndex===0?"disabled":"")+'>‹ Anterior</button>';
    html += '<button class="link-sutil" id="btnSaltar">Omitir por ahora</button>';
    html += "</div></div>";
    return html;
  }

  // Consulta a Supabase (solo lectura, solo admin) qué alumnos del grupo tienen matrícula.
  async function cargarMatriculas(g){
    var firma = g.estudiantes.map(function(e){ return e.id; }).join("|");
    var api = window.FullStatusSupabase;
    var entrada = { firma: firma, estado: "cargando", filas: {}, msg: "" };
    matPorGrupo[g.id] = entrada;
    try {
      if(!api || !api.rpc){ entrada.estado = "error"; entrada.msg = "Falta cargar supabase-asistencias.js."; }
      else if(!navigator.onLine){ entrada.estado = "sinConexion"; entrada.msg = "Sin conexión: la matrícula se consulta en línea."; }
      else {
        var res = await api.rpc("consultar_matriculas", {
          p_grupo: g.grupoBase || g.nombre,
          p_alumnos: g.estudiantes.map(function(e){ return {id: String(e.id), nombre: e.nombre}; })
        });
        if(res && res.sinSesion){ entrada.estado = "sinSesion"; entrada.msg = "Inicia sesión en ☁ Alumnos para ver las matrículas."; }
        else { entrada.estado = "ok"; (res || []).forEach(function(f){ entrada.filas[f.id] = f; }); }
      }
    } catch(err){ entrada.estado = "error"; entrada.msg = "No se pudo consultar: " + (err && err.message || err); }
    render();
  }

  // Guarda (alta) o corrige (edición) la matrícula de un alumno en Supabase con la función guardar_matricula
  // (solo admin). En una edición el servidor cambia la matrícula también en todo su historial, todo o nada.
  async function guardarMatricula(g, est, anterior, nueva){
    var api = window.FullStatusSupabase;
    if(!api || !api.rpc){ showToast("Falta cargar supabase-asistencias.js."); return; }
    if(!navigator.onLine){ showToast("Sin conexión: la matrícula se guarda en línea."); return; }
    matGuardando = true;
    if(matEdit) matEdit.valor = nueva;
    render();
    try {
      var res = await api.rpc("guardar_matricula", {
        p_grupo: g.grupoBase || g.nombre,
        p_nombre: est.nombre,
        p_matricula_anterior: anterior || "",
        p_matricula: nueva
      });
      if(res && res.sinSesion){
        showToast("Inicia sesión en ☁ Alumnos (administrador) para guardar la matrícula.");
      } else {
        matEdit = null;
        matPorGrupo = {};   // fuerza a releer las matrículas de todos los grupos
        showToast(anterior ? "Matrícula actualizada: " + nueva + "." : "Matrícula agregada: " + nueva + ".");
      }
    } catch(err){
      showToast("No se pudo guardar: " + (err && err.message || err));
    }
    matGuardando = false;
    render();
  }

  // Datos de matrícula del grupo (consulta una vez si la columna está abierta y no hay datos o cambió la lista).
  function asegurarMatriculas(g, forzar){
    var cache = matPorGrupo[g.id];
    var firma = g.estudiantes.map(function(e){ return e.id; }).join("|");
    if((matVisible || forzar) && (!cache || cache.firma !== firma)){
      cache = matPorGrupo[g.id] = { firma: firma, estado: "cargando", filas: {}, msg: "" };
      setTimeout(function(){ cargarMatriculas(g); }, 0);
    }
    return cache;
  }
  // true si el alumno tiene matrícula en Supabase (coincidencia única por nombre).
  function tieneMatricula(cache, e){
    var f = cache && cache.estado === "ok" ? cache.filas[e.id] : null;
    return !!(f && f.estado === "ok");
  }
  function celdaMatriculaHtml(cache, e, largo){
    var f = cache && cache.estado === "ok" ? cache.filas[e.id] : null;
    if(f && f.estado === "ok") return esc(f.matricula);
    if(f && f.estado === "ambiguo") return '<span style="color:var(--retardo);">⚠ Varias coincidencias</span>';
    // PRISMAL MESH: el servidor encontró en Supabase un alumno del mismo grupo con un nombre casi igual (error de
    // captura). Con el nombre distinto no se publican sus asistencias ni calificaciones: se corrige con «Usar ese nombre».
    if(f && f.estado === "posible"){
      var tip = "En Supabase aparece como «" + (f.nombre_sugerido || "") + "» (" + (f.matricula || "") + "). Con el nombre distinto no se publican sus asistencias ni calificaciones.";
      if(largo) return '<span style="color:var(--retardo);display:inline-block;white-space:normal;line-height:1.25;" title="'+esc(tip)+'">⚠ ¿Es «'+esc(f.nombre_sugerido || "")+'»?<br>'+esc(f.matricula || "")+'</span>';
      return '<span style="color:var(--retardo);" title="'+esc(tip)+'">⚠ Nombre parecido · '+esc(f.matricula || "")+'</span>';
    }
    if(f) return '<span style="color:var(--falta);">Sin matrícula</span>';
    return "";
  }

  // PRISMAL MESH: sección plegable «Cuentas de alumnos» (pestaña Grupos). Por alumno del grupo activo dice si su
  // cuenta de FullStatus Student ya tiene contraseña, si el registro está habilitado o si está bloqueada, y deja
  // restablecer la contraseña (la borra y habilita crear otra) o habilitar el registro. Los datos vienen de
  // consultar_matriculas (solo admin), la misma consulta de la columna Matrícula.
  function renderCuentasAlumnos(g){
    if(!g || !g.estudiantes || !g.estudiantes.length) return "";
    var cache = matPorGrupo[g.id];
    var firma = g.estudiantes.map(function(e){ return e.id; }).join("|");
    if(cuentasAbierto && (!cache || cache.firma !== firma)){
      cache = matPorGrupo[g.id] = { firma: firma, estado: "cargando", filas: {}, msg: "" };
      setTimeout(function(){ cargarMatriculas(g); }, 0);
    }
    var html = '<details class="card" id="detCuentas"'+(cuentasAbierto ? " open" : "")+'><summary style="cursor:pointer;font-weight:700;">Cuentas de alumnos (contraseña) · '+esc(g.nombre)+'</summary>';
    if(!cuentasAbierto) return html + "</details>";
    if(!cache || cache.estado === "cargando") return html + '<p class="helptext">Consultando cuentas…</p></details>';
    if(cache.estado !== "ok") return html + '<p class="helptext">'+esc(cache.msg)+' <button class="link-sutil" id="btnRefrescarCuentas">Reintentar</button></p></details>';
    var con = 0, sin = 0, porHabilitar = [];
    var filas = "";
    g.estudiantes.forEach(function(e, i){
      var f = cache.filas[e.id], cuenta = "", accion = "";
      if(f && f.estado === "ok"){
        if(f.tiene_password){
          con++;
          cuenta = '<span style="color:var(--presente);font-weight:600;">Con contraseña</span>';
          accion = '<button class="link-sutil" data-reset-pass="'+esc(f.matricula)+'" data-nombre="'+esc(e.nombre)+'">Restablecer contraseña</button>';
        } else {
          sin++;
          if(f.puede_crear){
            cuenta = '<span style="color:var(--retardo);font-weight:600;">Sin contraseña</span> · registro habilitado';
            accion = '<button class="link-sutil" data-hab-pass="'+esc(f.matricula)+'" data-valor="0">Cerrar registro</button>';
          } else {
            cuenta = '<span style="color:var(--falta);font-weight:600;">Sin contraseña</span> · registro cerrado';
            accion = '<button class="link-sutil" data-hab-pass="'+esc(f.matricula)+'" data-valor="1">Habilitar registro</button>';
            porHabilitar.push(f.matricula);
          }
        }
        if(f.bloqueado) cuenta += ' · <b>bloqueada por intentos fallidos</b>';
      } else {
        cuenta = '<span class="helptext" style="margin:0;">Sin matrícula en Supabase</span>';
      }
      filas += '<tr><td>'+(i+1)+'. '+esc(e.nombre)+'</td><td class="helptext" style="white-space:nowrap;">'+esc(f && f.matricula ? f.matricula : "")+'</td><td>'+cuenta+'</td><td>'+accion+'</td></tr>';
    });
    html += '<div class="row" style="justify-content:space-between;align-items:center;">';
    html += '<span class="helptext" style="margin:0;">'+con+' con contraseña · '+sin+' sin contraseña <button class="link-sutil" id="btnRefrescarCuentas">Actualizar</button></span>';
    if(porHabilitar.length) html += '<button class="btn secondary" id="btnHabilitarTodos" data-matriculas="'+esc(porHabilitar.join(","))+'">Habilitar registro a los '+porHabilitar.length+' sin contraseña</button>';
    html += '</div><div class="table-scroll"><table class="registro"><tbody>'+filas+'</tbody></table></div>';
    html += '<p class="helptext">«Restablecer» borra la contraseña del alumno y le deja crear una nueva desde la app. Un alumno sin contraseña solo puede crearla si su registro está habilitado.</p></details>';
    return html;
  }

  function renderPasarListaCompleta(g, bucket){
    var cache = matPorGrupo[g.id];
    var firmaActual = g.estudiantes.map(function(e){ return e.id; }).join("|");
    // Si la columna está abierta y no hay datos (o cambió la lista de alumnos), se consulta una vez.
    if(matVisible && (!cache || cache.firma !== firmaActual)){
      cache = matPorGrupo[g.id] = { firma: firmaActual, estado: "cargando", filas: {}, msg: "" };
      setTimeout(function(){ cargarMatriculas(g); }, 0);
    }
    var html = '<div class="card">';
    html += '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<button class="link-sutil" id="btnToggleMatriculas" aria-expanded="'+(matVisible?"true":"false")+'">Matrícula '+(matVisible?"▾":"▸")+'</button>';
    if(matVisible && cache){
      if(cache.estado === "ok"){
        var conM = 0, sinM = 0, posM = 0;
        g.estudiantes.forEach(function(e){ var f = cache.filas[e.id]; if(f && f.estado === "ok") conM++; else { sinM++; if(f && f.estado === "posible") posM++; } });
        html += '<span class="helptext" style="margin:0;">'+conM+' con matrícula · '+sinM+' sin matrícula'+(posM ? ' ('+posM+' con nombre casi igual)' : '')+' <button class="link-sutil" id="btnRefrescarMatriculas">Actualizar</button></span>';
      } else if(cache.estado === "cargando"){
        html += '<span class="helptext" style="margin:0;">Consultando matrículas…</span>';
      } else {
        html += '<span class="helptext" style="margin:0;">'+esc(cache.msg)+' <button class="link-sutil" id="btnRefrescarMatriculas">Reintentar</button></span>';
      }
    }
    html += '</div>';
    html += '<table class="registro">';
    g.estudiantes.forEach(function(e, i){
      var v = bucket[e.id] || "";
      html += "<tr><td>"+(i+1)+". "+esc(e.nombre)+"</td>";
      if(matVisible){
        var f = cache && cache.estado === "ok" ? cache.filas[e.id] : null;
        var celda = "";
        if(f && f.estado === "ok") celda = esc(f.matricula);
        else if(f && f.estado === "ambiguo") celda = '<span style="color:var(--retardo);">⚠ Varias coincidencias</span>';
        // PRISMAL MESH: nombre casi igual en Supabase (error de dedo). Se SUGIERE; solo cambia si el profesor pulsa.
        else if(f && f.estado === "posible") celda = '<span style="color:var(--retardo);">¿Será «'+esc(f.nombre_sugerido)+'» ('+esc(f.matricula)+')?</span> <button class="link-sutil" data-usar-nombre="'+esc(e.id)+'">Usar este nombre</button>';
        else if(f) celda = '<span style="color:var(--falta);">Sin matrícula</span>';
        html += '<td class="helptext" style="white-space:nowrap;">'+celda+'</td>';
      }
      html += '<td class="estados">';
      ESTADOS.forEach(function(code){
        html += '<span class="chip '+code+(v===code?" on":"")+'" data-chip data-estudiante="'+esc(e.id)+'" data-estado="'+code+'">'+ESTADO_VALOR_EXPORT[code]+"</span>";
      });
      html += "</td></tr>";
    });
    html += "</table></div>";
    return html;
  }

  function renderSegundoPase(g, bucket){
    if(!pasarSegundaLista || pasarSegundaLista.length === 0){
      var htmlVacio = '<div class="card completo">';
      htmlVacio += "<h3>Sin faltas que revisar</h3>";
      htmlVacio += '<p class="helptext">No hay estudiantes marcados con falta en esta fecha.</p>';
      htmlVacio += '<div class="row" style="justify-content:center;">';
      htmlVacio += '<button class="btn secondary" id="btnVolverResumen">Volver</button>';
      htmlVacio += "</div></div>";
      return htmlVacio;
    }

    if(pasarSegundaIndex >= pasarSegundaLista.length){
      var resumen = resumenDia(g, bucket, pasarFecha);
      var htmlFin = '<div class="card completo">';
      htmlFin += "<h3>Segundo pase completo</h3>";
      htmlFin += '<p class="helptext">'+esc(g.nombre)+' — '+displayFecha(pasarFecha)+'</p>';
      htmlFin += '<div class="resumen-final">';
      htmlFin += '<span><b style="color:var(--presente)">'+(resumen.P + resumen.J)+'</b>presentes</span>';
      htmlFin += '<span><b style="color:var(--falta)">'+resumen.A+'</b>faltas</span>';
      htmlFin += '<span><b style="color:var(--retardo)">'+resumen.R+'</b>retardos</span>';
      htmlFin += "</div>";
      htmlFin += '<p class="helptext">Cada 3 retardos de un alumno equivalen a 1 falta y 2 asistencias.</p>';
      htmlFin += '<div class="row" style="justify-content:center;">';
      htmlFin += '<button class="btn secondary" id="btnRevisarLista">Revisar y corregir</button>';
      htmlFin += '<button class="btn secondary" id="btnReiniciarLista">Empezar de nuevo</button>';
      htmlFin += "</div></div>";
      return htmlFin;
    }

    var estId = pasarSegundaLista[pasarSegundaIndex];
    var est = g.estudiantes.find(function(e){ return e.id === estId; });
    if(!est){
      pasarSegundaIndex++;
      return renderSegundoPase(g, bucket);
    }
    var pct = Math.round((pasarSegundaIndex / pasarSegundaLista.length) * 100);

    var htmlTarjeta = '<div class="progreso">';
    htmlTarjeta += '<div style="flex:1;"><div class="progreso-texto">Segundo pase — '+(pasarSegundaIndex+1)+' de '+pasarSegundaLista.length+'</div><div class="barra"><div class="barra-fill" style="width:'+pct+'%;"></div></div></div>';
    htmlTarjeta += "</div>";

    htmlTarjeta += '<div class="tarjeta">';
    htmlTarjeta += '<div class="num-lista">Marcado como falta</div>';
    htmlTarjeta += '<div class="nombre-grande">'+esc(est.nombre)+'</div>';
    htmlTarjeta += '<div class="botones-estado">';
    htmlTarjeta += '<button class="btn-estado retardo" data-marcar-segunda="R">Llegó (Retardo)</button>';
    htmlTarjeta += '<button class="btn-estado falta" data-marcar-segunda="A">Sigue de falta</button>';
    htmlTarjeta += "</div>";
    htmlTarjeta += '<div class="fila-secundaria">';
    htmlTarjeta += '<button class="link-sutil" id="btnAnteriorSegunda" '+(pasarSegundaIndex===0?"disabled":"")+'>‹ Anterior</button>';
    htmlTarjeta += '<button class="link-sutil" id="btnSaltarSegunda">Omitir por ahora</button>';
    htmlTarjeta += "</div></div>";
    return htmlTarjeta;
  }

  // =========================================================
  // HISTORIAL
  // =========================================================
  function renderHistorial(){
    var g = grupoActivo();
    if(!g) return '<div class="card"><p class="empty">Primero crea o importa un grupo en la pestaña "Grupos".</p></div>';

    var todasFechas = fechasDelGrupo(g.id);
    var fechas = fechasFiltradas(g, todasFechas);
    var unidades = unidadesDelGrupo(g);

    var html = '<div class="card">';
    html += '<div class="hist-head"><div><div class="eyebrow">Consulta de asistencia</div><h2>Historial de '+esc(g.nombre)+'</h2></div>';
    html += '<div class="field hist-group-field"><label for="selGrupoHistorial">Grupo</label><select id="selGrupoHistorial">';
    state.grupos.forEach(function(grupo){
      html += '<option value="'+esc(grupo.id)+'" '+(grupo.id===g.id?"selected":"")+'>'+esc(grupo.nombre)+'</option>';
    });
    html += '</select></div></div>';
    html += '<div class="hist-summary">';
    var unidadSel = histUnidad ? unidades.find(function(u){ return u.id === histUnidad; }) : null;
    html += '<div><strong>'+fechas.length+'</strong><span> '+(unidadSel ? 'días en '+esc(unidadSel.nombre) : 'días registrados')+'</span></div>';
    html += '</div>';
    html += '<div class="hist-toolbar">';
    html += '<div class="field" style="margin-bottom:0;"><label for="selUnidadHistorial">Unidad</label><select id="selUnidadHistorial"'+(unidades.length?'':' disabled')+'><option value="">'+(unidades.length?'Todas las unidades':'Sin unidades definidas')+'</option>';
    unidades.forEach(function(u){
      html += '<option value="'+esc(u.id)+'" '+(u.id===histUnidad?"selected":"")+'>'+esc(u.nombre)+' ('+displayFecha(u.desde)+' - '+displayFecha(u.hasta)+')</option>';
    });
    html += '</select></div>';
    html += '<div class="field" style="margin-bottom:0;"><label for="histDesde">Desde</label><input type="date" id="histDesde" value="'+histDesde+'"></div>';
    html += '<div class="field" style="margin-bottom:0;"><label for="histHasta">Hasta</label><input type="date" id="histHasta" value="'+histHasta+'"></div>';
    html += '<button class="btn secondary" id="btnLimpiarFiltro">Quitar filtro</button>';
    html += "</div>";
    html += '<div class="hist-legend"><span><b class="legend-P">1</b> Asistencia</span><span><b class="legend-A">0</b> Falta</span><span><b class="legend-R">2</b> Retardo</span><span><b class="legend-J">J</b> Falta justificada</span></div>';
    html += '<p class="helptext hist-rule">Cada 3 retardos de un alumno equivalen a 1 falta y 2 asistencias; con 1 o 2 retardos siguen contando como asistencias. La falta justificada ("J") cuenta como asistencia. Toca una falta ("0") en la tabla para marcarla como justificada.</p>';

    if(fechas.length === 0 || g.estudiantes.length === 0){
      html += '<p class="empty">Todavía no hay registros de asistencia'+(fechas.length===0?" en este rango de fechas":"")+'.</p></div>';
      html += renderUnidades(g, todasFechas);
      html += renderEditorFechas(g, todasFechas);
      html += renderJustificantes(g);
      return html;
    }

    // Matrícula (columna plegable): quién la tiene y quién no, con filtro para ver solo un grupo de alumnos.
    var cacheMat = asegurarMatriculas(g);
    var matListo = matVisible && cacheMat && cacheMat.estado === "ok";
    var estudiantesVista = g.estudiantes;
    html += '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<button class="link-sutil" id="btnToggleMatriculas" aria-expanded="'+(matVisible?"true":"false")+'">Matrícula '+(matVisible?"▾":"▸")+'</button>';
    if(matVisible && cacheMat){
      if(matListo){
        var conM = 0, sinM = 0;
        g.estudiantes.forEach(function(e){ if(tieneMatricula(cacheMat, e)) conM++; else sinM++; });
        html += '<span class="helptext" style="margin:0;">'+conM+' con matrícula · '+sinM+' sin matrícula ';
        html += '<select id="selMatFiltro" aria-label="Filtrar por matrícula"><option value="todos"'+(matFiltro==="todos"?" selected":"")+'>Todos</option><option value="sin"'+(matFiltro==="sin"?" selected":"")+'>Solo sin matrícula</option><option value="con"'+(matFiltro==="con"?" selected":"")+'>Solo con matrícula</option></select> ';
        html += '<button class="link-sutil" id="btnRefrescarMatriculas">Actualizar</button></span>';
        if(matFiltro === "sin") estudiantesVista = g.estudiantes.filter(function(e){ return !tieneMatricula(cacheMat, e); });
        else if(matFiltro === "con") estudiantesVista = g.estudiantes.filter(function(e){ return tieneMatricula(cacheMat, e); });
      } else if(cacheMat.estado === "cargando"){
        html += '<span class="helptext" style="margin:0;">Consultando matrículas…</span>';
      } else {
        html += '<span class="helptext" style="margin:0;">'+esc(cacheMat.msg)+' <button class="link-sutil" id="btnRefrescarMatriculas">Reintentar</button></span>';
      }
    }
    html += '</div>';

    html += '<div class="table-scroll"><table class="matriz"><thead><tr><th>Estudiante</th>'+(matVisible?'<th>Matrícula</th>':'');
    var unidadPrevia = null;
    fechas.forEach(function(f, i){
      var u = unidadDeFecha(g, f);
      var uid_ = u ? u.id : "";
      var inicio = unidades.length && i > 0 && uid_ !== unidadPrevia;
      unidadPrevia = uid_;
      html += '<th'+(inicio?' class="unidad-inicio"':'')+'>'+displayFecha(f)+(unidades.length?'<small class="unidad-etiqueta">'+(u?esc(u.nombre):"Sin unidad")+'</small>':'')+"</th>";
    });
    html += "<th>Total presente</th></tr></thead><tbody>";
    estudiantesVista.forEach(function(e){
      html += '<tr><td title="'+esc(e.nombre)+'">'+esc(e.nombre)+"</td>";
      if(matVisible) html += '<td class="helptext" style="white-space:nowrap;">'+celdaMatriculaHtml(cacheMat, e)+'</td>';
      var totalP = 0, totalR = 0;
      var unidadPreviaFila = null;
      fechas.forEach(function(f, i){
        var v = ((state.asistencias[g.id] || {})[f] || {})[e.id] || "";
        var justificada = v === "A" && esJustificada(g.id, f, e.id);
        if(v==="P" || justificada) totalP++;
        else if(v==="R") totalR++;
        var uf = unidadDeFecha(g, f);
        var ufId = uf ? uf.id : "";
        var inicioCelda = unidades.length && i > 0 && ufId !== unidadPreviaFila;
        unidadPreviaFila = ufId;
        var clase = (justificada ? "mark-J" : (v?"mark-"+v:"mark-empty")) + (inicioCelda ? " unidad-inicio" : "");
        var texto = justificada ? "J" : (v?ESTADO_VALOR_EXPORT[v]:"–");
        var atributos = (v==="A") ? ' data-justificar data-estudiante="'+esc(e.id)+'" data-fecha="'+esc(f)+'" title="Tocar para '+(justificada?"quitar el justificante":"marcar como justificada")+'"' : '';
        html += '<td class="'+clase+'"'+atributos+'>'+texto+"</td>";
      });
      html += "<td><b>"+totalAsistencias(totalP, totalR)+"</b></td></tr>";
    });
    html += "</tbody></table></div>";

    html += '<div class="hist-actions">';
    html += '<button class="btn" id="btnCopiarExcel">Copiar para pegar en Excel</button>';
    html += '<button class="btn secondary" id="btnDescargarXlsx">Descargar Excel institucional</button>';
    html += botonActualizarDrive();
    html += "</div>";
    html += '<p class="helptext">La primera vez se guarda el archivo institucional en Drive. Después, "Actualizar en Google Drive" modifica ese mismo archivo.</p>';
    html += "</div>";
    html += renderUnidades(g, todasFechas);
    html += renderEditorFechas(g, todasFechas);
    html += renderJustificantes(g);
    return html;
  }

  function renderUnidades(g, todasFechas){
    var unidades = unidadesDelGrupo(g);
    var html = '<div class="card">';
    html += "<h2>Unidades y periodos</h2>";
    html += '<p class="helptext" style="margin-top:0;">Define las unidades de la materia con su rango de fechas. Cada fecha registrada se asigna a la unidad cuyo rango la contiene, y puedes filtrar el historial por unidad. Las unidades solo se guardan en la app; no cambian el Excel institucional.</p>';
    if(unidades.length === 0){
      html += '<p class="empty">Este grupo todavía no tiene unidades.</p>';
    } else {
      html += '<ul class="estudiantes">';
      unidades.forEach(function(u){
        var cuantas = todasFechas.filter(function(f){ return f >= u.desde && f <= u.hasta; }).length;
        html += '<li><span><b>'+esc(u.nombre)+'</b> — '+displayFecha(u.desde)+' al '+displayFecha(u.hasta)+' <span class="helptext">('+cuantas+' '+(cuantas===1?"día":"días")+')</span></span><button class="btn danger" data-quitar-unidad="'+esc(u.id)+'">Quitar</button></li>';
      });
      html += "</ul>";
    }
    html += '<div class="row" style="margin-top:14px;align-items:flex-end;">';
    html += '<div class="field" style="flex:2;min-width:160px;margin-bottom:0;"><label for="unidadNombre">Nombre</label><input type="text" id="unidadNombre" placeholder="Unidad '+(unidades.length+1)+'" maxlength="60"></div>';
    html += '<div class="field" style="flex:1;min-width:150px;margin-bottom:0;"><label for="unidadDesde">Desde</label><input type="date" id="unidadDesde"></div>';
    html += '<div class="field" style="flex:1;min-width:150px;margin-bottom:0;"><label for="unidadHasta">Hasta</label><input type="date" id="unidadHasta"></div>';
    html += '<button class="btn" id="btnAgregarUnidad">Agregar unidad</button>';
    html += "</div></div>";
    return html;
  }

  function renderEditorFechas(g, todasFechas){
    if(todasFechas.length === 0) return "";
    var html = '<div class="card">';
    html += "<h2>Editar o eliminar una fecha</h2>";
    html += '<p class="helptext" style="margin-top:0;">Corrige una fecha capturada por error o borra por completo el registro de un día.</p>';
    html += '<div class="field"><label for="selFechaEditar">Fecha registrada</label><select id="selFechaEditar">';
    todasFechas.forEach(function(f){
      html += '<option value="'+esc(f)+'">'+displayFecha(f)+'</option>';
    });
    html += "</select></div>";
    html += '<div class="row">';
    html += '<div class="field" style="flex:1;min-width:180px;margin-bottom:0;"><label for="inputFechaEditarNueva">Cambiar a esta fecha</label><input type="date" id="inputFechaEditarNueva"></div>';
    html += '<button class="btn secondary" id="btnCambiarFecha">Cambiar fecha</button>';
    html += '<button class="btn danger" id="btnEliminarFecha">Eliminar esta fecha</button>';
    html += "</div>";
    html += '<p class="helptext">Eliminar quita las marcas de ese día en la app y las borra del Excel institucional en la próxima sincronización; no elimina físicamente la columna del archivo.</p>';
    html += "</div>";
    return html;
  }

  function renderJustificantes(g){
    var todasFechas = fechasDelGrupo(g.id);
    if(todasFechas.length === 0) return "";
    var lista = [];
    var porFecha = state.justificantes[g.id] || {};
    Object.keys(porFecha).sort().forEach(function(fecha){
      Object.keys(porFecha[fecha]).forEach(function(estId){
        var est = g.estudiantes.find(function(e){ return e.id === estId; });
        if(!est) return;
        lista.push({fecha:fecha, estudianteId:estId, nombre:est.nombre, nota:(porFecha[fecha][estId]||{}).nota || ""});
      });
    });
    var html = '<div class="card">';
    html += "<h2>Justificantes</h2>";
    html += '<p class="helptext" style="margin-top:0;">Toca una falta ("0") en la tabla de arriba para marcarla como justificada: cuenta como asistencia y queda etiquetada con "J". En el Excel institucional se guarda como asistencia (1), con una nota adjunta en la celda.</p>';
    if(lista.length === 0){
      html += '<p class="empty">No hay faltas justificadas todavía.</p>';
    } else {
      html += '<ul class="estudiantes">';
      lista.forEach(function(item){
        html += '<li><span><b>'+esc(item.nombre)+'</b> — '+displayFecha(item.fecha)+(item.nota?' <span class="helptext">('+esc(item.nota)+')</span>':'')+'</span><button class="btn danger" data-quitar-justificante data-estudiante="'+esc(item.estudianteId)+'" data-fecha="'+esc(item.fecha)+'">Quitar</button></li>';
      });
      html += "</ul>";
    }
    html += "</div>";
    return html;
  }

  function construirMatrizActiva(){
    var g = grupoActivo();
    var fechas = fechasFiltradas(g, fechasDelGrupo(g.id));
    var header = ["Estudiante"].concat(fechas.map(displayFecha)).concat(["Total presente"]);
    var rows = [header];
    g.estudiantes.forEach(function(e){
      var row = [e.nombre], totalP = 0, totalR = 0;
      fechas.forEach(function(f){
        var v = ((state.asistencias[g.id] || {})[f] || {})[e.id] || "";
        var justificada = v === "A" && esJustificada(g.id, f, e.id);
        if(v==="P" || justificada) totalP++;
        else if(v==="R") totalR++;
        row.push(justificada ? ESTADO_VALOR_EXPORT.P : (v ? ESTADO_VALOR_EXPORT[v] : ""));
      });
      row.push(totalAsistencias(totalP, totalR));
      rows.push(row);
    });
    return rows;
  }

  function copiarPortapapeles(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ showToast("Tabla copiada. Pégala en Excel con Ctrl+V."); }).catch(function(){ fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text){
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); showToast("Tabla copiada. Pégala en Excel con Ctrl+V."); }
    catch(e){ showToast("No se pudo copiar. Usa la descarga de Excel."); }
    document.body.removeChild(ta);
  }

  function nombreHojaValido(nombre, usados){
    var limpio = String(nombre).replace(/[\[\]\*\?\/\\:]/g, "").trim().slice(0,31) || "Grupo";
    var base = limpio, n = 2;
    while(usados[limpio]){ limpio = (base.slice(0,28) + " " + n).slice(0,31); n++; }
    usados[limpio] = true;
    return limpio;
  }

  // Clona la hoja "Plantilla" completa (logo, estilos, combinaciones, columnas
  // Grupo/No. Equipo/Evaluación) para un grupo que todavía no tiene pestaña propia.
  function clonarHojaDesdePlantilla(wb, nombreNuevo){
    var plantilla = obtenerHojaPlantilla(wb);
    if(!plantilla) return null;
    var nueva = wb.addWorksheet(nombreNuevo);

    var maxFila = Math.max(plantilla.rowCount, 50);
    var maxColumna = Math.max(plantilla.columnCount, 50);

    for(var c=1; c<=maxColumna; c++){
      var colOrigen = plantilla.getColumn(c);
      if(colOrigen && colOrigen.width) nueva.getColumn(c).width = colOrigen.width;
    }

    for(var r=1; r<=maxFila; r++){
      var filaOrigen = plantilla.getRow(r);
      var filaNueva = nueva.getRow(r);
      for(var c2=1; c2<=maxColumna; c2++){
        var celdaOrigen = filaOrigen.getCell(c2);
        var celdaNueva = filaNueva.getCell(c2);
        celdaNueva.value = celdaOrigen.value;
        if(celdaOrigen.style) celdaNueva.style = JSON.parse(JSON.stringify(celdaOrigen.style));
      }
      if(filaOrigen.height) filaNueva.height = filaOrigen.height;
    }

    ((plantilla.model && plantilla.model.merges) || []).forEach(function(rango){
      try{ nueva.mergeCells(rango); }catch(e){}
    });

    if(plantilla.getImages){
      plantilla.getImages().forEach(function(img){
        try{ nueva.addImage(img.imageId, img.range); }catch(e){}
      });
    }

    return nueva;
  }

  // Detecta hasta qué columna llega el bloque "ASISTENCIAS" (a partir de su
  // combinación de celdas) para nunca escribir fechas nuevas dentro de "EVALUACIÓN".
  function limiteColumnaAsistencias(ws, headerRow, nameCol, maxCol){
    var filaBanner = headerRow - 1;
    if(filaBanner < 1) return null;
    for(var c=nameCol+1; c<=maxCol; c++){
      var celda = ws.getRow(filaBanner).getCell(c);
      if(normalizaEtiqueta(celda.value).indexOf("ASISTENCIA") !== -1){
        var direccion = celda.address;
        var merges = (ws.model && ws.model.merges) || [];
        for(var i=0; i<merges.length; i++){
          var partes = merges[i].split(":");
          if(partes[0] === direccion){
            var colLetra = partes[1].match(/[A-Z]+/);
            if(colLetra) return columnaDesdeLetra(colLetra[0]);
          }
        }
        return c;
      }
    }
    return null;
  }

  // Ubica la fila/columna del encabezado "ALUMNO" en una hoja institucional.
  function encontrarEncabezadoAlumno(ws, maxRowBusqueda, maxColBusqueda){
    var maxRow = Math.min(ws.rowCount, maxRowBusqueda || 60);
    var maxCol = Math.min(ws.columnCount, maxColBusqueda || 70);
    for(var r=1; r<=maxRow; r++){
      for(var c=1; c<=maxCol; c++){
        var etiqueta = normalizaEtiqueta(ws.getRow(r).getCell(c).value);
        if(esEncabezadoAlumno(etiqueta)) return {headerRow:r, nameCol:c, maxCol:maxCol};
      }
    }
    return null;
  }

  // Quita por completo una fecha de la hoja de un grupo: recorre hacia la
  // izquierda todas las fechas posteriores (encabezado + las 32 filas de
  // alumnos) para que no quede una columna vacía en medio de "ASISTENCIAS".
  function eliminarFechaDeHoja(ws, headerRow, nameCol, maxCol, fechaISO){
    var columnasFecha = [];
    for(var c=nameCol+1; c<=maxCol; c++){
      var v = ws.getRow(headerRow).getCell(c).value;
      if(v instanceof Date){
        var iso = v.getUTCFullYear() + "-" + String(v.getUTCMonth()+1).padStart(2,"0") + "-" + String(v.getUTCDate()).padStart(2,"0");
        columnasFecha.push({col:c, iso:iso});
      }
    }
    var idx = columnasFecha.findIndex(function(cf){ return cf.iso === fechaISO; });
    if(idx === -1) return false;

    var maxFilaAlumno = headerRow + 32;
    for(var i=idx+1; i<columnasFecha.length; i++){
      var colOrigen = columnasFecha[i].col;
      var colDestino = colOrigen - 1;
      for(var fila=headerRow; fila<=maxFilaAlumno; fila++){
        var celdaOrigen = ws.getRow(fila).getCell(colOrigen);
        var celdaDestino = ws.getRow(fila).getCell(colDestino);
        celdaDestino.value = celdaOrigen.value;
        celdaDestino.numFmt = celdaOrigen.numFmt;
      }
    }
    var ultimaColUsada = columnasFecha[columnasFecha.length - 1].col;
    for(var fila2=headerRow; fila2<=maxFilaAlumno; fila2++){
      ws.getRow(fila2).getCell(ultimaColUsada).value = null;
    }
    return true;
  }

  // Detecta columnas de fecha que ya no tienen ninguna marca de asistencia en
  // ningún alumno (por ejemplo, columnas que quedaron vacías tras corregir
  // registros a mano) y las quita, recorriendo hacia la izquierda las columnas
  // siguientes para no dejar huecos en el bloque de "ASISTENCIAS". Se usa en
  // cada sincronización para mantener las columnas organizadas sin tener que
  // borrar fecha por fecha manualmente.
  function compactarColumnasVacias(ws, headerRow, nameCol, maxColBusqueda, protegidas){
    var maxFilaAlumno = headerRow + 32;
    var columnasFecha = [];
    for(var c=nameCol+1; c<=maxColBusqueda; c++){
      var v = ws.getRow(headerRow).getCell(c).value;
      if(v instanceof Date) columnasFecha.push(c);
    }
    if(columnasFecha.length === 0) return 0;

    var conservar = columnasFecha.filter(function(col){
      var fechaCol = ws.getRow(headerRow).getCell(col).value;
      var isoCol = fechaCol.getUTCFullYear() + "-" + String(fechaCol.getUTCMonth()+1).padStart(2,"0") + "-" + String(fechaCol.getUTCDate()).padStart(2,"0");
      if(protegidas && protegidas[isoCol]) return true;
      for(var fila=headerRow+1; fila<=maxFilaAlumno; fila++){
        var val = ws.getRow(fila).getCell(col).value;
        if(val !== null && val !== undefined && val !== "") return true;
      }
      return false;
    });
    if(conservar.length === columnasFecha.length) return 0;

    var snapshot = {};
    conservar.forEach(function(col){
      for(var fila2=headerRow; fila2<=maxFilaAlumno; fila2++){
        var celda = ws.getRow(fila2).getCell(col);
        snapshot[col+"_"+fila2] = {value: celda.value, numFmt: celda.numFmt};
      }
    });

    var primerCol = columnasFecha[0];
    var ultimaCol = columnasFecha[columnasFecha.length-1];
    conservar.forEach(function(colOriginal, indice){
      var colDestino = primerCol + indice;
      for(var fila3=headerRow; fila3<=maxFilaAlumno; fila3++){
        var datos = snapshot[colOriginal+"_"+fila3];
        var celdaDestino = ws.getRow(fila3).getCell(colDestino);
        celdaDestino.value = datos.value;
        celdaDestino.numFmt = datos.numFmt;
      }
    });
    for(var colLimpiar=primerCol+conservar.length; colLimpiar<=ultimaCol; colLimpiar++){
      for(var fila4=headerRow; fila4<=maxFilaAlumno; fila4++){
        ws.getRow(fila4).getCell(colLimpiar).value = null;
      }
    }
    return columnasFecha.length - conservar.length;
  }

  // Aplica eliminarFechaDeHoja sobre la hoja real del grupo en el archivo
  // institucional cargado en memoria, y refresca la copia local en caché.
  async function eliminarFechaDelExcelInstitucional(nombreGrupo, fechaISO){
    if(!plantillaExcel) return;
    var ws = plantillaExcel.worksheets.find(function(hoja){
      return !esHojaPlantilla(hoja.name) && hoja.name.trim().toLowerCase() === nombreGrupo.trim().toLowerCase();
    });
    if(!ws) return;
    var encabezado = encontrarEncabezadoAlumno(ws, 60, 70);
    if(!encabezado) return;
    var eliminado = eliminarFechaDeHoja(ws, encabezado.headerRow, encabezado.nameCol, encabezado.maxCol, fechaISO);
    if(!eliminado) return;
    try{
      var buffer = await plantillaExcel.xlsx.writeBuffer();
      await guardarPlantillaLocal(buffer);
    }catch(error){ console.error("No se pudo refrescar la copia local del archivo institucional", error); }
  }

  // Cambia el encabezado de una columna de fecha existente por otra fecha,
  // sin mover columnas (solo se sustituye el valor del encabezado).
  function renombrarFechaEnHoja(ws, headerRow, nameCol, maxCol, fechaVieja, fechaNueva){
    for(var c=nameCol+1; c<=maxCol; c++){
      var celda = ws.getRow(headerRow).getCell(c);
      var v = celda.value;
      if(v instanceof Date){
        var iso = v.getUTCFullYear() + "-" + String(v.getUTCMonth()+1).padStart(2,"0") + "-" + String(v.getUTCDate()).padStart(2,"0");
        if(iso === fechaVieja){
          celda.value = excelFechaSerial(fechaNueva);
          celda.numFmt = "dd/mm/yyyy";
          return true;
        }
      }
    }
    return false;
  }

  async function renombrarFechaDelExcelInstitucional(nombreGrupo, fechaVieja, fechaNueva){
    if(!plantillaExcel) return;
    var ws = plantillaExcel.worksheets.find(function(hoja){
      return !esHojaPlantilla(hoja.name) && hoja.name.trim().toLowerCase() === nombreGrupo.trim().toLowerCase();
    });
    if(!ws) return;
    var encabezado = encontrarEncabezadoAlumno(ws, 60, 70);
    if(!encabezado) return;
    var cambiado = renombrarFechaEnHoja(ws, encabezado.headerRow, encabezado.nameCol, encabezado.maxCol, fechaVieja, fechaNueva);
    if(!cambiado) return;
    try{
      var buffer = await plantillaExcel.xlsx.writeBuffer();
      await guardarPlantillaLocal(buffer);
    }catch(error){ console.error("No se pudo refrescar la copia local del archivo institucional", error); }
  }

  async function crearBufferPlantillaInstitucional(){
    var usados = {};
    plantillaExcel.worksheets.forEach(function(ws){ usados[ws.name] = true; });
    var avisos = [], gruposNuevos = [];

    var grupoSeleccionado = grupoActivo();
    var gruposASincronizar = grupoSeleccionado ? [grupoSeleccionado] : [];

    // Pestañas de grupos eliminados en la app; nunca se toca la hoja "Plantilla".
    var hojasEliminadas = [];
    (state.hojasPorEliminar || []).forEach(function(nombre){
      var objetivo = String(nombre).trim().toLowerCase();
      if(esHojaPlantilla(objetivo)) return;
      var hoja = plantillaExcel.worksheets.find(function(h){ return !esHojaPlantilla(h.name) && h.name.trim().toLowerCase() === objetivo; });
      if(hoja){ hojasEliminadas.push(hoja.name); plantillaExcel.removeWorksheet(hoja.id); }
    });
    gruposASincronizar.forEach(function(grupo){
      var ws = plantillaExcel.worksheets.find(function(hoja){
        return !esHojaPlantilla(hoja.name) && hoja.name.trim().toLowerCase() === grupo.nombre.trim().toLowerCase();
      });

      if(!ws){
        ws = clonarHojaDesdePlantilla(plantillaExcel, nombreHojaValido(grupo.nombre, usados));
        if(!ws){
          avisos.push('No se encontró la pestaña "Plantilla" en el archivo institucional; no se pudo crear la hoja de "'+grupo.nombre+'".');
          return;
        }
        gruposNuevos.push(grupo.nombre);
      }

      var encabezado = encontrarEncabezadoAlumno(ws, 60, 70);
      if(!encabezado){
        avisos.push('No se reconoció el formato de la hoja "'+ws.name+'"; no se actualizó.');
        return;
      }
      var headerRow = encabezado.headerRow, nameCol = encabezado.nameCol, maxCol = encabezado.maxCol;

      // Antes de tocar nada más, quitamos columnas de fecha que hayan quedado
      // completamente vacías (sin ninguna marca en ningún alumno) y recorremos
      // el resto hacia la izquierda, para que "Actualizar" también organice
      // las columnas en vez de dejar huecos entre las fechas reales.
      var columnasVaciasEliminadas = compactarColumnasVacias(ws, headerRow, nameCol, maxCol, (state.fechasVacias || {})[grupo.id]);
      if(columnasVaciasEliminadas > 0){
        avisos.push('Se organizaron las columnas de "'+grupo.nombre+'": se quitaron '+columnasVaciasEliminadas+' columna(s) de fecha vacía(s).');
      }

      // Profesor y Materia viven siempre en la misma columna que la respuesta,
      // 8 y 3 filas arriba del encabezado "ALUMNO" respectivamente. No se
      // sobreescriben si el grupo no tiene el dato capturado en la app.
      var colValor = nameCol + 7;
      if(grupo.profesor && headerRow-8 >= 1) ws.getRow(headerRow-8).getCell(colValor).value = grupo.profesor;
      if(grupo.materia && headerRow-3 >= 1) ws.getRow(headerRow-3).getCell(colValor).value = grupo.materia;

      var fechas = {};
      var totalCol = -1;
      for(var fechaCol=nameCol+1; fechaCol<=maxCol; fechaCol++){
        var headerValue = ws.getRow(headerRow).getCell(fechaCol).value;
        if(headerValue instanceof Date){
          var iso = headerValue.getUTCFullYear() + "-" + String(headerValue.getUTCMonth()+1).padStart(2,"0") + "-" + String(headerValue.getUTCDate()).padStart(2,"0");
          fechas[fechaCol] = iso;
        } else if(normalizaEtiqueta(headerValue).indexOf("TOTAL") !== -1){
          totalCol = fechaCol;
          break;
        }
      }

      var limiteAsistencia = limiteColumnaAsistencias(ws, headerRow, nameCol, maxCol);
      // Solo se agregan columnas para fechas que tengan al menos una marca.
      var fechasEstado = fechasDelGrupo(grupo.id);
      var ultimaColumnaFecha = Object.keys(fechas).reduce(function(maximo, col){ return Math.max(maximo, Number(col)); }, nameCol + 2);
      var fechasOmitidas = [];
      fechasEstado.forEach(function(iso){
        var existe = Object.keys(fechas).some(function(col){ return fechas[col] === iso; });
        if(existe) return;
        var siguiente = ultimaColumnaFecha + 1;
        if(limiteAsistencia && siguiente > limiteAsistencia){ fechasOmitidas.push(iso); return; }
        ultimaColumnaFecha = siguiente;
        fechas[ultimaColumnaFecha] = iso;
        var headerCell = ws.getRow(headerRow).getCell(ultimaColumnaFecha);
        headerCell.value = excelFechaSerial(iso);
        headerCell.numFmt = "dd/mm/yyyy";
      });
      if(fechasOmitidas.length){
        avisos.push('El grupo "'+grupo.nombre+'" ya no tiene columnas de asistencia libres en la plantilla; no se guardaron '+fechasOmitidas.length+' fecha(s).');
      }

      var estudiantesOrdenados = grupo.estudiantes.slice().sort(function(a, b){
        return a.nombre.localeCompare(b.nombre, "es", {sensitivity:"base"});
      });
      estudiantesOrdenados.forEach(function(est, indice){
        var rowNumber = headerRow + 1 + indice;
        var filaAlumno = ws.getRow(rowNumber);
        filaAlumno.getCell(nameCol).value = est.nombre;
        if(nameCol > 1 && !filaAlumno.getCell(nameCol - 1).value){
          filaAlumno.getCell(nameCol - 1).value = indice + 1;
        }
        var totalP = 0, totalR = 0;
        Object.keys(fechas).forEach(function(colText){
          var col = Number(colText), fechaIso = fechas[col];
          var estado = leerAsistenciaBucket(grupo.id, fechaIso)[est.id] || "";
          var justificada = estado === "A" && esJustificada(grupo.id, fechaIso, est.id);
          var cell = ws.getRow(rowNumber).getCell(col);
          cell.value = justificada ? ESTADO_VALOR_EXPORT.P : (estado ? ESTADO_VALOR_EXPORT[estado] : null);
          if(justificada){
            var nota = notaJustificante(grupo.id, fechaIso, est.id);
            cell.note = "Falta justificada" + (nota ? ": " + nota : "");
          } else {
            cell.note = undefined;
          }
          if(estado === "P" || justificada) totalP++;
          else if(estado === "R") totalR++;
        });
        // Total: P + justificadas + retardos, descontando 1 por cada 3 retardos.
        if(totalCol !== -1) ws.getRow(rowNumber).getCell(totalCol).value = totalAsistencias(totalP, totalR);
      });
      Object.keys(fechas).forEach(function(colText){
        var fechaCell = ws.getRow(headerRow).getCell(Number(colText));
        fechaCell.numFmt = "dd/mm/yyyy";
      });
    });

    if(gruposNuevos.length){
      avisos.unshift("Se crearon en el archivo institucional las pestañas: " + gruposNuevos.join(", ") + ".");
    }
    if(hojasEliminadas.length){
      avisos.unshift("Se eliminaron del archivo institucional las pestañas: " + hojasEliminadas.join(", ") + ".");
    }

    var buffer = await plantillaExcel.xlsx.writeBuffer();
    return { buffer: buffer, avisos: avisos };
  }

  async function descargarPlantillaInstitucional(){
    var resultado = await crearBufferPlantillaInstitucional();
    var blob = new Blob([resultado.buffer], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "asistencia_institucional_" + todayISO() + ".xlsx";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(resultado.avisos.length ? resultado.avisos.join(" ") : "Archivo institucional descargado con el formato original.");
  }

  // ---------------------------------------------------------
  // GOOGLE IDENTITY SERVICES: carga dinámica con reintentos.
  // ---------------------------------------------------------
  // index.html YA NO incluye <script src="https://accounts.google.com/gsi/client">
  // de forma estática (un solo fallo de red en ese punto dejaba "window.google"
  // indefinido para siempre, y todos los botones de Drive mostraban "revisa tu
  // conexión" aunque el usuario sí tuviera internet). En su lugar, esta función
  // inyecta el <script> por código, y si falla (red lenta, DNS, corte momentáneo)
  // reintenta varias veces con espera creciente antes de rendirse.
  var GOOGLE_GSI_SRC = "https://accounts.google.com/gsi/client";
  var googleIdentityPromise = null; // evita cargas duplicadas si hay varios clics

  // Revisa si la librería de Google ya quedó disponible en window.
  function gsiListo(){
    return !!(window.google && google.accounts && google.accounts.oauth2);
  }

  // Pequeña ayuda para esperar N milisegundos dentro de una función async.
  function esperar(ms){
    return new Promise(function(resolve){ setTimeout(resolve, ms); });
  }

  // Inyecta el <script> de Google Identity Services una vez y resuelve/rechaza
  // según si terminó de cargar (onload) o falló la petición de red (onerror).
  function cargarScriptGoogle(){
    return new Promise(function(resolve, reject){
      if(gsiListo()){ resolve(); return; }
      // Si quedó un <script> de un intento fallido anterior, lo quitamos para
      // forzar una petición de red nueva en vez de que el navegador reutilice
      // una respuesta de error en caché.
      document.querySelectorAll('script[data-gsi="1"]').forEach(function(s){ s.remove(); });
      var script = document.createElement("script");
      script.src = GOOGLE_GSI_SRC + "?_=" + Date.now(); // cache-bust por intento
      script.async = true;
      script.defer = true;
      script.dataset.gsi = "1";
      script.onload = function(){
        if(gsiListo()) resolve();
        else reject(new Error("Google respondió pero no expuso accounts.oauth2"));
      };
      script.onerror = function(){ reject(new Error("Fallo de red cargando el script de Google")); };
      document.head.appendChild(script);
    });
  }

  // Punto de entrada público: asegura que Google Identity Services esté listo,
  // reintentando hasta "intentos" veces con espera creciente (800ms, 1600ms...)
  // antes de rendirse. Si ya hay una carga en curso, todos los llamadores
  // comparten la misma promesa en vez de disparar peticiones duplicadas.
  function asegurarGoogleIdentity(intentos){
    if(gsiListo()) return Promise.resolve();
    if(googleIdentityPromise) return googleIdentityPromise;
    intentos = intentos || 3;
    googleIdentityPromise = (async function(){
      var ultimoError = null;
      for(var intento=1; intento<=intentos; intento++){
        try{
          await cargarScriptGoogle();
          return;
        }catch(err){
          ultimoError = err;
          if(intento < intentos) await esperar(800 * intento);
        }
      }
      // Se agotaron los intentos: se limpia la promesa para permitir un
      // reintento fresco la próxima vez que el usuario haga clic.
      googleIdentityPromise = null;
      throw ultimoError;
    })();
    return googleIdentityPromise;
  }

  // Inicia el flujo de OAuth de Google Drive. Antes de pedir el token, se
  // asegura (con reintentos) de que la librería de Google esté cargada; así
  // un corte de red momentáneo ya no deja el botón inutilizado para siempre.
  function iniciarGoogleDrive(action){
    if(location.protocol === "file:"){
      showToast("Abre FullStatus desde http://localhost para iniciar sesión con Google.");
      return;
    }
    drivePendingAction = action;
    asegurarGoogleIdentity().then(function(){
      if(!driveTokenClient){
        driveTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
          callback: function(response){
            if(response.error){
              console.error("Error de autorización de Google", response);
              showToast("Google bloqueó la autorización. Registra "+location.origin+" en Google Cloud Console.");
              return;
            }
            localStorage.setItem(GOOGLE_AUTH_KEY, "1");
            var pending = drivePendingAction;
            drivePendingAction = null;
            if(pending) pending(response.access_token);
          }
        });
      }
      driveTokenClient.requestAccessToken({prompt: localStorage.getItem(GOOGLE_AUTH_KEY) ? "" : "consent"});
    }).catch(function(err){
      // Solo llegamos aquí si TODOS los reintentos de red fallaron.
      console.error("No se pudo cargar Google Identity Services tras varios intentos", err);
      showToast("No se pudo conectar con los servicios de Google. Revisa tu conexión a internet e inténtalo de nuevo.");
    });
  }

  function columnaA1(numero){
    var resultado = "";
    while(numero > 0){
      var resto = (numero-1) % 26;
      resultado = String.fromCharCode(65+resto) + resultado;
      numero = Math.floor((numero-1) / 26);
    }
    return resultado;
  }

  async function descargarWorkbookInstitucional(accessToken){
    var response = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?fields=mimeType", {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(!response.ok) throw new Error("No se pudo consultar el archivo de Drive (HTTP "+response.status+")");
    var fileResponse = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?alt=media", {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(!fileResponse.ok) throw new Error("No se pudo descargar el archivo institucional");
    var workbookBuffer = await fileResponse.arrayBuffer();
    var workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    await guardarPlantillaLocal(workbookBuffer);
    plantillaExcel = workbook;
    return workbook;
  }

  async function cargarGruposExcelDrive(accessToken){
    var workbook = await descargarWorkbookInstitucional(accessToken);
    var grupos = [], asistencias = {};
    workbook.worksheets.forEach(function(ws){
      if(esHojaPlantilla(ws.name)) return;
      var datos = extraerGrupoDeHoja(ws);
      if(!datos){
        var grupoVacioId = uid();
        grupos.push({id:grupoVacioId, nombre:ws.name, estudiantes:[], materia:"", profesor:""});
        asistencias[grupoVacioId] = {};
        return;
      }
      var grupoId = uid();
      grupos.push({id:grupoId, nombre:datos.nombre, estudiantes:datos.estudiantes, materia:datos.materia, profesor:datos.profesor});
      asistencias[grupoId] = datos.asistencias;
    });
    if(!grupos.length) throw new Error("No se encontraron grupos en el archivo institucional");
    state.grupos = grupos;
    state.asistencias = asistencias;
    state.hojasPorEliminar = [];
    state.fechasVacias = {};
    Object.keys(asistencias).forEach(function(id){ registrarFechasVacias(id, asistencias[id]); });
    state.grupoActivoId = grupos[0].id;
    saveState(false);
    marcarSincronizado(); // el estado local ya es el de Drive
    render();
    showToast(grupos.length+" grupo(s) cargado(s) desde Drive.");
  }

  // Agrega solo las pestañas del Excel que aún no son grupos locales, sin reemplazar lo existente.
  async function agregarGruposNuevosDeDrive(accessToken){
    if(cambiosPendientes){
      showToast('Primero sube tus cambios pendientes con "Actualizar en Google Drive".');
      return;
    }
    var workbook = await descargarWorkbookInstitucional(accessToken);
    var nuevos = [], fechasAgregadas = 0;
    workbook.worksheets.forEach(function(ws){
      if(esHojaPlantilla(ws.name)) return;
      var existente = state.grupos.find(function(g){ return g.nombre.trim().toLowerCase() === ws.name.trim().toLowerCase(); });
      if(existente){
        // Grupo ya conocido: solo se añaden las fechas sin marcas que existan como columna en el Excel.
        var datosExistente = extraerGrupoDeHoja(ws);
        if(!datosExistente) return;
        var antes = fechasDelGrupo(existente.id).length;
        registrarFechasVacias(existente.id, datosExistente.asistencias);
        fechasAgregadas += fechasDelGrupo(existente.id).length - antes;
        return;
      }
      var datos = extraerGrupoDeHoja(ws);
      var grupoId = uid();
      state.grupos.push({id:grupoId, nombre:ws.name, estudiantes:datos ? datos.estudiantes : [], materia:datos ? datos.materia : "", profesor:datos ? datos.profesor : ""});
      state.asistencias[grupoId] = datos ? datos.asistencias : {};
      registrarFechasVacias(grupoId, state.asistencias[grupoId]);
      nuevos.push(ws.name);
    });
    if(!nuevos.length && !fechasAgregadas){ showToast("No hay grupos ni fechas nuevas en el Excel."); return; }
    saveState(false);
    render();
    var partes = [];
    if(nuevos.length) partes.push("Grupos agregados: " + nuevos.join(", "));
    if(fechasAgregadas) partes.push(fechasAgregadas + " fecha(s) sin marcas agregada(s)");
    showToast(partes.join(". ") + ".");
  }

  async function cargarGruposGoogle(accessToken){
    var estadoEl = document.getElementById("cargarGoogleEstado");
    if(estadoEl) estadoEl.textContent = "Leyendo hoja institucional…";
    var driveMetadataResponse = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?fields=mimeType", {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(driveMetadataResponse.ok){
      var driveMetadata = await driveMetadataResponse.json();
      if(driveMetadata.mimeType !== "application/vnd.google-apps.spreadsheet"){
        await cargarGruposExcelDrive(accessToken);
        if(estadoEl) estadoEl.textContent = "";
        return;
      }
    }
    var metadataResponse = await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID), {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(!metadataResponse.ok){
      var detail = await metadataResponse.text();
      if(metadataResponse.status === 403) throw new Error("Google Sheets API no habilitada o sin permisos para esta cuenta");
      throw new Error("No se pudo leer la hoja institucional (HTTP "+metadataResponse.status+"): "+detail.slice(0,160));
    }
    var metadata = await metadataResponse.json();
    var grupos = [], asistencias = {};

    for(var sheetIndex=0; sheetIndex<metadata.sheets.length; sheetIndex++){
      var title = metadata.sheets[sheetIndex].properties.title;
      if(esHojaPlantilla(title)) continue;
      var range = encodeURIComponent("'"+title.replace(/'/g,"''")+"'!A1:ZZ500");
      var valuesResponse = await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"/values/"+range, {
        headers: {Authorization:"Bearer "+accessToken}
      });
      if(!valuesResponse.ok) continue;
      var values = (await valuesResponse.json()).values || [];
      var headerRow = -1, nameCol = -1;
      for(var rowIndex=0; rowIndex<Math.min(values.length,60) && headerRow===-1; rowIndex++){
        for(var colIndex=0; colIndex<(values[rowIndex] || []).length; colIndex++){
          var label = normalizaEtiqueta(values[rowIndex][colIndex]);
          if(esEncabezadoAlumno(label)){
            headerRow = rowIndex; nameCol = colIndex; break;
          }
        }
      }
      if(headerRow === -1) continue;
      var dateColumns = {};
      for(var dateCol=nameCol+1; dateCol<(values[headerRow] || []).length; dateCol++){
        var dateISO = valorFechaGoogle(values[headerRow][dateCol]);
        if(dateISO) dateColumns[dateCol] = dateISO;
      }
      var estudiantes = [], sheetAttendance = {};
      Object.keys(dateColumns).forEach(function(colText){ sheetAttendance[dateColumns[colText]] = {}; });
      for(var studentIndex=headerRow+1; studentIndex<values.length; studentIndex++){
        var rowValues = values[studentIndex] || [];
        var nombre = String(rowValues[nameCol] || "").trim();
        if(!nombre) continue;
        var estudiante = {id:uid(), nombre:nombre};
        estudiantes.push(estudiante);
        Object.keys(dateColumns).forEach(function(colText){
          var raw = String(rowValues[Number(colText)] === undefined ? "" : rowValues[Number(colText)]).trim();
          var estado = raw === "1" ? "P" : raw === "0" ? "A" : raw === "2" || raw.toUpperCase() === "R" ? "R" : "";
          if(estado) sheetAttendance[dateColumns[colText]][estudiante.id] = estado;
        });
      }
      if(estudiantes.length) {
        var grupoId = uid();
        grupos.push({id:grupoId, nombre:title, estudiantes:estudiantes, materia:"", profesor:""});
        asistencias[grupoId] = sheetAttendance;
      }
    }
    if(!grupos.length) throw new Error("No se encontraron grupos con alumnos");
    state.grupos = grupos;
    state.asistencias = asistencias;
    state.hojasPorEliminar = [];
    state.grupoActivoId = grupos[0].id;
    saveState(false);
    marcarSincronizado(); // el estado local ya es el de Drive
    if(estadoEl) estadoEl.textContent = "";
    render();
    showToast(grupos.length+" grupo(s) cargado(s) desde Google Sheets.");
  }

  function valorFechaGoogle(value){
    if(value === null || value === undefined || value === "") return "";
    var texto = String(value).trim();
    var iso = parseFechaMX(texto);
    if(iso) return iso;
    var isoMatch = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(isoMatch) return isoMatch[1]+"-"+isoMatch[2]+"-"+isoMatch[3];
    if(/^\d+(\.\d+)?$/.test(texto)){
      var serial = Number(texto), date = new Date(Date.UTC(1899,11,30) + serial*86400000);
      return date.getUTCFullYear()+"-"+String(date.getUTCMonth()+1).padStart(2,"0")+"-"+String(date.getUTCDate()).padStart(2,"0");
    }
    return "";
  }

  async function actualizarHojaGoogle(accessToken){
    var baseUrl = "https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID);
    var metadataResponse = await fetch(baseUrl, {headers:{Authorization:"Bearer "+accessToken}});
    if(!metadataResponse.ok){
      var detail = await metadataResponse.text();
      throw new Error("No se pudo leer la hoja institucional (HTTP "+metadataResponse.status+"): "+detail.slice(0,160));
    }
    var metadata = await metadataResponse.json(), totalUpdates = [], formatRequests = [], matchedGroups = 0;
    var normalizaNombre = function(nombre){ return String(nombre || "").trim().replace(/\s+/g," ").toLowerCase(); };

    async function leerValores(title){
      var range = encodeURIComponent("'"+title.replace(/'/g,"''")+"'!A1:ZZ500");
      var response = await fetch(baseUrl+"/values/"+range, {headers:{Authorization:"Bearer "+accessToken}});
      if(!response.ok) throw new Error("No se pudo leer la pestaña "+title+" (HTTP "+response.status+")");
      return (await response.json()).values || [];
    }
    async function aplicarEstructura(requests){
      if(!requests.length) return;
      var response = await fetch(baseUrl+":batchUpdate", {
        method:"POST", headers:{Authorization:"Bearer "+accessToken, "Content-Type":"application/json"},
        body:JSON.stringify({requests:requests})
      });
      if(!response.ok){
        var detail = await response.text();
        throw new Error("No se pudo preparar la pestaña institucional (HTTP "+response.status+"): "+detail.slice(0,160));
      }
    }

    for(var i=0; i<metadata.sheets.length; i++){
      var sheetProperties = metadata.sheets[i].properties, title = sheetProperties.title;
      if(esHojaPlantilla(title)) continue;
      var grupo = state.grupos.find(function(g){ return normalizaNombre(g.nombre) === normalizaNombre(title); });
      if(!grupo) continue;
      matchedGroups++;
      var values = await leerValores(title), headerRow = -1, nameCol = -1;
      for(var rowIndex=0; rowIndex<Math.min(values.length,60) && headerRow===-1; rowIndex++){
        for(var colIndex=0; colIndex<(values[rowIndex] || []).length; colIndex++){
          if(esEncabezadoAlumno(normalizaEtiqueta(values[rowIndex][colIndex]))){ headerRow=rowIndex; nameCol=colIndex; break; }
        }
      }
      if(headerRow === -1) continue;

      var initialHeader = values[headerRow] || [], initialTotalCol = -1;
      for(var initialCol=nameCol+1; initialCol<initialHeader.length; initialCol++){
        if(normalizaEtiqueta(initialHeader[initialCol]).indexOf("TOTAL") !== -1){ initialTotalCol=initialCol; break; }
      }
      var requestedDates = Object.keys(state.asistencias[grupo.id] || {}).sort(), knownDates = {};
      for(var c=nameCol+1; c<initialHeader.length; c++){
        var knownDate = valorFechaGoogle(initialHeader[c]);
        if(knownDate) knownDates[knownDate] = true;
      }
      var missingDates = requestedDates.filter(function(date){ return !knownDates[date]; });
      if(missingDates.length){
        var insertAt = initialTotalCol === -1 ? initialHeader.length : initialTotalCol;
        await aplicarEstructura(missingDates.map(function(){
          return {insertDimension:{range:{sheetId:sheetProperties.sheetId, dimension:"COLUMNS", startIndex:insertAt, endIndex:insertAt+1}, inheritFromBefore:insertAt > 0}};
        }));
        values = await leerValores(title);
      }

      var header = values[headerRow] || [], dateColumns = {}, totalCol = -1;
      for(var dateCol=nameCol+1; dateCol<header.length; dateCol++){
        var dateISO = valorFechaGoogle(header[dateCol]);
        if(dateISO) dateColumns[dateCol] = dateISO;
        else if(normalizaEtiqueta(header[dateCol]).indexOf("TOTAL") !== -1){ totalCol=dateCol; break; }
      }
      missingDates.forEach(function(date){
        var col = Object.keys(dateColumns).find(function(colText){ return dateColumns[colText] === date; });
        if(col === undefined) throw new Error("No se pudo crear la fecha "+displayFecha(date)+" en la pestaña "+title);
        totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(Number(col)+1)+(headerRow+1), values:[[displayFecha(date)]]});
      });

      var rowsByName = {}, lastStudentRow = headerRow;
      for(var studentIndex=headerRow+1; studentIndex<values.length; studentIndex++){
        var studentName = normalizaNombre((values[studentIndex] || [])[nameCol]);
        if(studentName){ rowsByName[studentName] = studentIndex; lastStudentRow = studentIndex; }
      }
      var nextRow = lastStudentRow + 1;
      grupo.estudiantes.forEach(function(est){
        var key = normalizaNombre(est.nombre), row = rowsByName[key];
        if(row === undefined){
          row = nextRow++; rowsByName[key] = row;
          if(lastStudentRow > headerRow){
            formatRequests.push({copyPaste:{source:{sheetId:sheetProperties.sheetId, startRowIndex:lastStudentRow, endRowIndex:lastStudentRow+1, startColumnIndex:0, endColumnIndex:Math.max(totalCol+1,nameCol+1)}, destination:{sheetId:sheetProperties.sheetId, startRowIndex:row, endRowIndex:row+1, startColumnIndex:0, endColumnIndex:Math.max(totalCol+1,nameCol+1)}, pasteType:"PASTE_FORMAT", orientation:"NORMAL"}});
          }
          totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(nameCol+1)+(row+1), values:[[est.nombre]]});
          if(nameCol > 0) totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(nameCol)+(row+1), values:[[row-headerRow]]});
        }
        var totalPresent = 0, totalRetardos = 0;
        Object.keys(dateColumns).forEach(function(colText){
          var col = Number(colText), fechaCol = dateColumns[col];
          var estado = ((state.asistencias[grupo.id] || {})[fechaCol] || {})[est.id] || "";
          var justificada = estado === "A" && esJustificada(grupo.id, fechaCol, est.id);
          if(estado === "P" || justificada) totalPresent++;
          else if(estado === "R") totalRetardos++;
          totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(col+1)+(row+1), values:[[justificada ? ESTADO_VALOR_EXPORT.P : (estado ? ESTADO_VALOR_EXPORT[estado] : "")]]});
        });
        if(totalCol !== -1) totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(totalCol+1)+(row+1), values:[[totalAsistencias(totalPresent, totalRetardos)]]});
      });
    }
    if(!matchedGroups) throw new Error("No se encontró la pestaña del grupo en Google Sheets");
    await aplicarEstructura(formatRequests);
    if(!totalUpdates.length) throw new Error("No hay alumnos o asistencias nuevas para guardar");
    var updateResponse = await fetch(baseUrl+":values:batchUpdate", {
      method:"POST", headers:{Authorization:"Bearer "+accessToken, "Content-Type":"application/json"},
      body:JSON.stringify({valueInputOption:"USER_ENTERED", data:totalUpdates})
    });
    if(!updateResponse.ok){
      var updateDetail = await updateResponse.text();
      throw new Error("No se pudieron guardar los alumnos en Google Sheets (HTTP "+updateResponse.status+"): "+updateDetail.slice(0,160));
    }
    localStorage.setItem(DRIVE_FILE_KEY, GOOGLE_SHEET_ID);
    showToast("Alumnos y asistencias actualizados en la hoja institucional.");
    render();
  }

  async function guardarEnGoogleDrive(accessToken){
    sincronizando = true;
    updateConn();
    try{
      var fileInfo = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?fields=mimeType", {
        headers: {Authorization:"Bearer "+accessToken}
      });
      if(fileInfo.ok){
        var fileMetadata = await fileInfo.json();
        if(fileMetadata.mimeType !== "application/vnd.google-apps.spreadsheet"){
          // Antes se volvía a descargar el archivo de Drive siempre, lo que
          // sobreescribía en memoria cualquier edición local aún no subida
          // (fechas eliminadas/renombradas, columnas recién organizadas) con
          // la versión vieja que sigue en Drive. Ahora solo se descarga si
          // todavía no tenemos ninguna copia cargada en este dispositivo.
          if(!plantillaExcel){
            await descargarWorkbookInstitucional(accessToken);
          }
          var resultado = await crearBufferPlantillaInstitucional();
          var upload = await fetch("https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?uploadType=media", {
            method:"PATCH", headers:{Authorization:"Bearer "+accessToken, "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, body:resultado.buffer
          });
          if(!upload.ok){
            var uploadDetail = await upload.text();
            throw new Error("No se pudo actualizar el Excel institucional (HTTP "+upload.status+"): "+uploadDetail.slice(0,160));
          }

          // La subida a Drive tuvo éxito, así que la copia local en IndexedDB
          // debe quedar igual a lo que ya está en Drive. Sin esto, al reiniciar
          // la app restaurarCacheLocal() cargaba el libro viejo (sin las fechas,
          // alumnos y pestañas recién sincronizados) y la siguiente sincronización
          // podía pisar en Drive esos cambios o resucitar pestañas eliminadas.
          // Va en su propio try/catch: un fallo al guardar la caché no debe
          // convertir en error una subida que sí se completó.
          try{
            await guardarPlantillaLocal(resultado.buffer);
          }catch(errorCache){
            console.error("No se pudo actualizar la copia local tras sincronizar", errorCache);
          }

          showToast(resultado.avisos.length ? resultado.avisos.join(" ") : "Archivo institucional actualizado en Drive.");
          return true;
        }
      }
      await actualizarHojaGoogle(accessToken);
      return true;
    }catch(error){
      console.error(error);
      showToast(error.message || "No se pudo actualizar Google Sheets. Verifica el acceso y la API.");
      return false;
    }finally{
      sincronizando = false;
      updateConn();
    }
  }

  function marcarSincronizado(){
    cambiosPendientes = false;
    localStorage.removeItem(PENDIENTES_KEY);
    updateConn();
    if(state.hojasPorEliminar && state.hojasPorEliminar.length){ state.hojasPorEliminar = []; saveState(false); }
  }
  function sincronizarPendientes(){
    if(!navigator.onLine || !cambiosPendientes) return;
    iniciarGoogleDrive(function(accessToken){
      guardarEnGoogleDrive(accessToken).then(function(ok){ if(ok) marcarSincronizado(); });
    });
  }
  function autoSincronizarCambios(){
    if(!cambiosPendientes) return;
    if(!navigator.onLine){
      showToast("Sin conexión: se guardó en este dispositivo y se subirá a Drive automáticamente cuando vuelva internet.");
      return;
    }
    sincronizarPendientes();
  }

  async function descargarXlsxCompleto(){
    if(!plantillaExcel){
      showToast('Primero carga el archivo institucional desde Google Drive (pestaña "Grupos") para exportar con el formato correcto.');
      return;
    }
    try{
      await descargarPlantillaInstitucional();
    }catch(err){
      console.error(err);
      showToast("No se pudo actualizar el archivo institucional.");
    }
  }

  // =========================================================
  // RESULTADOS (Supabase, solo lectura)
  // =========================================================
  // La URL y la clave publishable son públicas por diseño; la tabla "resultados"
  // solo se puede leer con la sesión del administrador (política RLS).
  // PRISMAL MESH: esta pestaña YA NO tiene su propio inicio de sesión con correo y contraseña. Lee con la
  // sesión de administrador de «☁ Alumnos» (window.FullStatusSupabase.rest), la misma que usan Exámenes y
  // Calificaciones. Más adelante se le dará otra forma de acceso.
  var SUPABASE_URL = "https://juvqvshcfsrtscvzluaa.supabase.co";
  var SUPABASE_KEY = "sb_publishable_IYf3ISEUGCRGKEM2Bnq1UQ_qFkBHvk5";
  var resDatos = null;
  var resMensaje = "";
  var resCargando = false;
  var resIntentado = false;   // la primera vez que se abre la pestaña se cargan los resultados solos
  var resMateria = "", resGrupo = "", resBusqueda = "";

  // Lectura con la sesión de «☁ Alumnos». Sin sesión lanza un aviso claro; la seguridad real sigue siendo la política RLS.
  async function supabaseLeer(ruta){
    var api = window.FullStatusSupabase;
    if(!api || !api.rest) throw new Error("Falta cargar supabase-asistencias.js.");
    var datos = await api.rest(ruta);
    if(datos && datos.sinSesion) throw new Error("Inicia sesión en ☁ Alumnos (administrador) para ver los resultados.");
    return datos;
  }
  async function cargarResultados(){
    resCargando = true; resMensaje = ""; render();
    try{
      var materias = await supabaseLeer("materias?select=id,nombre");
      var filas = await supabaseLeer("resultados?select=id,nombre,matricula,grupo,correctas,total,materia_id,creado_en,reanudaciones,motivo&order=creado_en.desc&limit=2000");
      var nombres = {};
      materias.forEach(function(m){ nombres[m.id] = m.nombre; });
      resDatos = {nombres: nombres, filas: filas};
    }catch(err){
      resMensaje = err.message || "No se pudieron cargar los resultados.";
    }
    resCargando = false;
    render();
  }
// Solo se muestran resultados de los grupos de la escuela elegida.
  function normalizaGrupoRes(v){ return String(v == null ? "" : v).trim().replace(/\s+/g, " ").toLowerCase(); }
  function resEsDeEscuela(f){
    var nombre = normalizaGrupoRes(f.grupo);
    return !!nombre && state.grupos.some(function(g){ return normalizaGrupoRes(g.nombre) === nombre; });
  }
  function resultadosFiltrados(){
    var q = resBusqueda.trim().toLowerCase();
    return resDatos.filas.filter(function(f){
      if(!resEsDeEscuela(f)) return false;
      if(resMateria && String(f.materia_id) !== resMateria) return false;
      if(resGrupo && f.grupo !== resGrupo) return false;
      if(q && (String(f.nombre||"") + " " + String(f.matricula||"")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function htmlTablaResultados(){
    var filas = resultadosFiltrados();
    if(filas.length === 0) return '<p class="empty">No hay resultados con estos filtros.</p>';
    var html = '<div class="table-scroll"><table class="matriz"><thead><tr><th>Alumno</th><th>Matrícula</th><th>Grupo</th><th>Tipo de examen</th><th>Aciertos</th><th>Fecha</th><th>Reanud.</th><th>Acción</th></tr></thead><tbody>';
    filas.forEach(function(f){
      var fecha = f.creado_en ? new Date(f.creado_en).toLocaleString("es-MX") : "";
      html += '<tr><td title="'+esc(f.nombre||"")+'">'+esc(f.nombre||"")+'</td><td>'+esc(f.matricula||"")+'</td><td>'+esc(f.grupo||"")+'</td><td>'+esc(resDatos.nombres[f.materia_id]||"")+'</td><td>'+f.correctas+" / "+f.total+'</td><td>'+esc(fecha)+'</td><td title="'+esc(f.motivo||"")+'">'+(f.reanudaciones||0)+'</td><td><button class="link-sutil" data-reactivar="'+esc(f.id)+'">Reactivar</button></td></tr>';
    });
    return html + "</tbody></table></div>";
  }
  function renderResultados(){
    var html = '<div class="card"><h2>Resultados de los exámenes</h2>';
    if(!navigator.onLine) return html + '<p class="empty">Sin conexión: los resultados se consultan en línea.</p></div>';
    if(resCargando) return html + '<p class="empty">Cargando resultados…</p></div>';
    if(!resDatos){
      if(!resIntentado){ resIntentado = true; setTimeout(cargarResultados, 0); return html + '<p class="empty">Cargando resultados…</p></div>'; }
      if(resMensaje) html += '<p class="helptext" style="color:var(--falta);">'+esc(resMensaje)+'</p>';
      return html + '<button class="btn" id="btnResActualizar">Cargar resultados</button></div>';
    }
    var grupos = [];
    resDatos.filas.forEach(function(f){ if(f.grupo && resEsDeEscuela(f) && grupos.indexOf(f.grupo) === -1) grupos.push(f.grupo); });
    grupos.sort();
    html += '<div class="hist-toolbar">';
    html += '<div class="field" style="margin-bottom:0;"><label for="selResMateria">Tipo de examen</label><select id="selResMateria"><option value="">Todos los resultados</option>';
    // Solo los tipos de examen que tienen resultados en esta escuela.
    var materiasEscuela = {};
    resDatos.filas.forEach(function(f){ if(resEsDeEscuela(f)) materiasEscuela[String(f.materia_id)] = true; });
    Object.keys(resDatos.nombres).filter(function(id){ return materiasEscuela[id]; }).forEach(function(id){ html += '<option value="'+esc(id)+'" '+(id===resMateria?"selected":"")+'>'+esc(resDatos.nombres[id])+'</option>'; });
    html += '</select></div>';
    html += '<div class="field" style="margin-bottom:0;"><label for="selResGrupo">Grupo</label><select id="selResGrupo"><option value="">Todos</option>';
    grupos.forEach(function(gr){ html += '<option value="'+esc(gr)+'" '+(gr===resGrupo?"selected":"")+'>'+esc(gr)+'</option>'; });
    html += '</select></div>';
    html += '<div class="field" style="margin-bottom:0;flex:1;min-width:180px;"><label for="inputResBuscar">Buscar</label><input type="text" id="inputResBuscar" placeholder="Nombre o matrícula" value="'+esc(resBusqueda)+'"></div>';
    html += '<button class="btn secondary" id="btnResActualizar">Actualizar</button></div>';
    var enEscuela = resDatos.filas.filter(resEsDeEscuela).length, deOtros = resDatos.filas.length - enEscuela;
    html += '<p class="helptext" style="margin-top:0;">Escuela: <b>'+esc(escuelaActual.nombre)+'</b> · '+enEscuela+' resultado(s) de los grupos de esta escuela'+(deOtros ? ' ('+deOtros+' de otros grupos no se muestran)' : '')+'.</p>';
    html += '<div id="resTabla">' + htmlTablaResultados() + '</div></div>';
    return html;
  }

  // =========================================================
  // CALIFICACIONES (por grupo y unidad; datos en su propia clave de localStorage)
  // =========================================================
  // Ponderación según el modelo del grupo (ver CALIF_MODELOS): trabajos en clase (saber hacer),
  // examen (saber) y asistencias + participación (ser). El extra suma o resta puntos directos.
  // TOTAL = suma de puntos, con mínimo 0 y tope 10. Las asistencias se calculan solas
  // desde el historial; el resto se captura a mano. Cada columna (examen, participación,
  // trabajos) puede capturarse como porcentaje, calificación (0-10) o escala con máximo
  // (manual o automático = valor más alto capturado).
  var CALIF_KEY = "listaAsistenciaCalificaciones_v1";
  // Dos modelos de ponderación (puntos sobre 10):
  //  - anterior (10° grado, último cuatrimestre): trabajos 60, examen 20, participación 10, asistencias 10.
  //  - nuevo (grados anteriores, el que quedará): trabajos 50, examen 30, participación 10, asistencias 10.
  var CALIF_MODELOS = {
    nuevo:    {nombre:"Modelo nuevo (50 / 30 / 10 / 10)",    puntos:{trab:5, examen:3, asist:1, partic:1}, pesos:{hacer:50, saber:30, ser:20}},
    anterior: {nombre:"Modelo anterior (60 / 20 / 10 / 10)", puntos:{trab:6, examen:2, asist:1, partic:1}, pesos:{hacer:60, saber:20, ser:20}}
  };
  var CALIF_COLORES = {nombre:"#ddebf7", asist:"#fce4d6", examen:"#e2efda", partic:"#fce4d6", extra:"#fce4d6", trab:"#ffc000", total:"#ddebf7"};
  var CALIF_MODOS = {porcentaje:"Porcentaje (0-100)", calificacion:"Calificación (0-10)", escala:"Escala (con máximo)"};
  var CALIF_COLUMNAS = [
    {campo:"examen", titulo:"Exámen"},
    {campo:"partic", titulo:"Partic."},
    {campo:"trab", titulo:"Trabajos en clase"}
  ];
  var califDatos = cargarCalificaciones();
  var calUnidad = "";
  // PRISMAL MESH: calificación del examen que se rellena sola. Lee de Supabase (misma sesión de administrador)
  // los resultados de los exámenes que contestaron los alumnos en FullStatus Student y los pasa a la columna
  // «Exámen» de la unidad, en el modo de captura de esa columna (0-10, % o escala). Los puntos con su
  // ponderación (3 o 2 pts según el modelo) los calcula calcularCalificaciones como con cualquier captura.
  // examAuto = { estado: "idle"|"cargando"|"ok"|"sinSesion"|"sinConexion"|"error", filas, nombres, unidadesMateria, ts, msg }
  var examAuto = {estado:"idle", filas:[], nombres:{}, unidadesMateria:{}, ts:0, msg:""};
  var EXAM_AUTO_VIGENCIA_MS = 120000;   // cuánto se reutiliza la consulta antes de volver a pedirla

  function cargarCalificaciones(){
    try{
      var raw = localStorage.getItem(CALIF_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    }catch(e){ return {}; }
  }
  function guardarCalificaciones(){
    try{ localStorage.setItem(CALIF_KEY, JSON.stringify(califDatos)); }
    catch(e){ showToast("No se pudieron guardar las calificaciones en este equipo."); }
  }
  function numCalif(v){
    var n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return isFinite(n) && n >= 0 ? n : 0;
  }
  // El extra puede ser positivo o negativo (puntos de más o de menos).
  function numExtra(v){
    var n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return isFinite(n) ? n : 0;
  }
  // El modelo se guarda por grupo (califDatos[grupoId]._modelo). Si no se ha elegido,
  // los grupos de 10° (nombre que empieza con "10") usan el modelo anterior; el resto, el nuevo.
  function modeloCalifId(g){
    var guardado = califDatos[g.id] && califDatos[g.id]._modelo;
    if(guardado && CALIF_MODELOS[guardado]) return guardado;
    return /^\s*10(?!\d)/.test(g.nombre) ? "anterior" : "nuevo";
  }
  // Solo se muestran unidades: si no hay una elegida, se usa la que contiene el día de hoy o la primera.
  function unidadCalifActual(g){
    var unidades = unidadesDelGrupo(g);
    if(!unidades.length){ calUnidad = ""; return null; }
    var actual = unidades.find(function(u){ return u.id === calUnidad; });
    if(!actual){
      var hoy = todayISO();
      actual = unidades.find(function(u){ return hoy >= u.desde && hoy <= u.hasta; }) || unidades[0];
      calUnidad = actual.id;
    }
    return actual;
  }
  function califBucket(grupoId, unidadId){
    if(!califDatos[grupoId]) califDatos[grupoId] = {};
    var b = califDatos[grupoId][unidadId];
    if(!b) b = califDatos[grupoId][unidadId] = {cols:{}, alumnos:{}};
    if(!b.cols) b.cols = {};
    if(!b.alumnos) b.alumnos = {};
    // Compatibilidad con la versión anterior (un solo "máx. trabajos").
    if(b.maxTrab && !b.cols.trab){ b.cols.trab = {modo:"escala", max:b.maxTrab}; }
    delete b.maxTrab;
    return b;
  }
  function configColumna(datos, campo){
    var c = datos.cols[campo] || {};
    return {modo: c.modo || (campo === "examen" ? "calificacion" : "escala"), max: c.max == null ? "" : c.max};
  }
  // La participación en escala nunca pasa de 10.
  function valorColumna(campo, modo, valor){
    var v = numCalif(valor);
    return (campo === "partic" && modo === "escala") ? Math.min(v, 10) : v;
  }
  function fraccionCalif(modo, valor, maxEscala){
    var f;
    if(modo === "porcentaje") f = valor / 100;
    else if(modo === "calificacion") f = valor / 10;
    else f = maxEscala > 0 ? valor / maxEscala : 0;
    return Math.max(0, Math.min(1, f));
  }
  function calcularCalificaciones(g, unidad){
    var datos = califBucket(g.id, unidad.id);
    var modeloId = modeloCalifId(g), modelo = CALIF_MODELOS[modeloId], puntos = modelo.puntos;
    var fechas = fechasDelGrupo(g.id).filter(function(f){ return f >= unidad.desde && f <= unidad.hasta; });
    var dias = fechas.length;
    var cfg = {}, escala = {}, cuenta = {};
    CALIF_COLUMNAS.forEach(function(col){
      var c = configColumna(datos, col.campo), masAlto = 0;
      g.estudiantes.forEach(function(e){
        masAlto = Math.max(masAlto, valorColumna(col.campo, c.modo, (datos.alumnos[e.id] || {})[col.campo]));
      });
      var manual = numCalif(c.max);
      if(col.campo === "partic") manual = Math.min(manual, 10);
      cfg[col.campo] = c;
      escala[col.campo] = {auto: masAlto, efectiva: manual > 0 ? manual : masAlto};
      cuenta[col.campo] = c.modo === "escala" ? escala[col.campo].efectiva : masAlto;
    });
    var filas = g.estudiantes.map(function(e){
      var d = datos.alumnos[e.id] || {};
      var presentes = 0, retardos = 0;
      fechas.forEach(function(f){
        var v = leerAsistenciaBucket(g.id, f)[e.id] || "";
        if(v === "P" || (v === "A" && esJustificada(g.id, f, e.id))) presentes++;
        else if(v === "R") retardos++;
      });
      var asist = totalAsistencias(presentes, retardos);
      var pts = {};
      CALIF_COLUMNAS.forEach(function(col){
        var modo = cfg[col.campo].modo;
        pts[col.campo] = fraccionCalif(modo, valorColumna(col.campo, modo, d[col.campo]), escala[col.campo].efectiva) * puntos[col.campo];
      });
      var ptsAsist = dias ? Math.min(asist / dias, 1) * puntos.asist : 0;
      var total = Math.max(0, Math.min(10, pts.trab + pts.partic + pts.examen + ptsAsist + numExtra(d.extra)));
      return {estudiante:e, asist:asist, total:Math.round(total * 100) / 100, pts:{asist:ptsAsist, trab:pts.trab, partic:pts.partic, examen:pts.examen}};
    });
    return {unidad:unidad, modeloId:modeloId, modelo:modelo, puntos:puntos, datos:datos, dias:dias, cfg:cfg, escala:escala, cuenta:cuenta, filas:filas};
  }
  // Calificación mínima para aprobar según el modelo del grupo: con menos de esto está reprobado.
  var CALIF_MINIMA = {nuevo:7, anterior:8};
  // Solo lectura: la usa supabase-calificaciones.js. Devuelve lo que espera la función RPC
  // publicar_calificaciones de Supabase: por grupo, cada alumno con sus unidades y los puntos
  // de cada componente (asistencias, actividades, participaciones, examen) más el extra.
  // "examen" va en null mientras no se capture, para que el alumno vea la unidad como incompleta.
  // Solo lectura: la usa supabase-examenes.js para la lista desplegable de materias. Devuelve los
  // nombres de materia distintos de los grupos de la escuela a la vista (sin repetir, ordenados).
  window.FullStatusMateriasGrupos = function(){
    var vistos = {}, lista = [];
    state.grupos.forEach(function(g){
      var m = (g.materia || "").trim(), k = m.toLowerCase();
      if(m && !vistos[k]){ vistos[k] = true; lista.push(m); }
    });
    return lista.sort(function(x, y){ return x.localeCompare(y, "es"); });
  };
  window.FullStatusCalifExport = function(){
    function r2(n){ return Math.round(n * 100) / 100; }
    function vacio(v){ return v == null || String(v).trim() === ""; }
    // Solo el grupo que está a la vista: los demás grupos no se tocan en Supabase.
    var visible = grupoActivo();
    return {grupos: (visible ? [visible] : []).map(function(g){
      var alumnos = g.estudiantes.map(function(e){ return {nombre:e.nombre, unidades:[]}; });
      unidadesDelGrupo(g).forEach(function(u){
        var r = calcularCalificaciones(g, u);
        r.filas.forEach(function(f, i){
          var d = r.datos.alumnos[f.estudiante.id] || {};
          var enEscala = function(campo){ return r.cfg[campo].modo === "escala"; };
          alumnos[i].unidades.push({
            nombre: u.nombre || "",
            asistencias: r2(f.pts.asist), actividades: r2(f.pts.trab), participaciones: r2(f.pts.partic),
            examen: vacio(d.examen) ? null : r2(f.pts.examen),
            extra: r2(numExtra(d.extra)),
            n_actividades: enEscala("trab") ? r2(valorColumna("trab", "escala", d.trab)) : null,
            total_actividades: enEscala("trab") ? r2(r.escala.trab.efectiva) : null,
            n_participaciones: enEscala("partic") ? r2(valorColumna("partic", "escala", d.partic)) : null
          });
        });
      });
      return {id: String(g.id), nombre: g.grupoBase || g.nombre || "", materia: g.materia || "", minimo: CALIF_MINIMA[modeloCalifId(g)], alumnos: alumnos};
    })};
  };
  // ---- Examen automático (ver comentario de examAuto) ----
  // Mismo criterio que el servidor (_clave_nombre): minúsculas, sin acentos ni signos.
  function claveTexto(t){
    return String(t == null ? "" : t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }
  var EXAM_TIPOS = ["", "Ordinario", "Remedial", "Extraordinario", "Extraordinario 2", "Extraordinario 3"];
  // Del nombre de la materia del examen («INGLÉS VI Unidad 1», «INGLÉS VI · Remedial»…) saca la materia base,
  // la unidad (si el nombre la trae) y el tipo (1 ordinario, 2 remedial, 3 extraordinario, 4 y 5 extraordinario 2 y 3).
  function infoExamen(nombre){
    var k = claveTexto(nombre);
    var mu = k.match(/\bunidad ?(\d+)\b/);
    var rango = /\bextraordinario (3|iii|tres)\b/.test(k) ? 5 : /\bextraordinario (2|ii|dos)\b/.test(k) ? 4
              : /\bextraordinario\b/.test(k) ? 3 : /\bremedial\b/.test(k) ? 2 : 1;
    var base = k.replace(/\b(extraordinario( (2|3|ii|iii|dos|tres))?|remedial|ordinario|unidad ?\d+)\b/g, " ").replace(/\s+/g, " ").trim();
    return {base: base, unidad: mu ? parseInt(mu[1], 10) : null, rango: rango};
  }
  // Número de la unidad: el del nombre («Unidad 2») o, si no lo trae, su posición en el grupo.
  function numeroUnidadCalif(g, unidad){
    var m = String(unidad.nombre || "").match(/unidad\s*(\d+)/i);
    if(m) return parseInt(m[1], 10);
    var i = unidadesDelGrupo(g).findIndex(function(u){ return u.id === unidad.id; });
    return i + 1;
  }
  async function cargarExamenesAuto(){
    if(examAuto.estado === "cargando") return;
    var api = window.FullStatusSupabase;
    examAuto.ts = Date.now();
    if(!api || !api.rest){ examAuto.estado = "error"; examAuto.msg = "Falta cargar supabase-asistencias.js."; render(); return; }
    if(!navigator.onLine){ examAuto.estado = "sinConexion"; examAuto.msg = "Sin conexión: los exámenes se consultan en línea."; render(); return; }
    examAuto.estado = "cargando";
    try{
      var materias = await api.rest("materias?select=id,nombre");
      if(materias && materias.sinSesion){
        examAuto.estado = "sinSesion"; examAuto.msg = "Inicia sesión en ☁ Alumnos (administrador) para traer las calificaciones de los exámenes.";
      } else {
        var filas = await api.rest("resultados?select=matricula,nombre,correctas,total,materia_id,creado_en&order=creado_en.desc&limit=3000");
        // Solo materia y sección de las preguntas activas (NUNCA la respuesta correcta): sirve para saber la unidad
        // de un examen cuya materia no lleva «Unidad N» en el nombre.
        var preg = [];
        try{ preg = await api.rest("preguntas?select=materia_id,seccion&activa=eq.true&limit=10000"); }catch(e2){ preg = []; }
        var nombres = {}, unidadesMateria = {};
        (Array.isArray(materias) ? materias : []).forEach(function(m){ nombres[m.id] = m.nombre; });
        (Array.isArray(preg) ? preg : []).forEach(function(q){
          var mm = String(q.seccion || "").match(/unidad\s*(\d+)/i);
          if(q.materia_id != null && mm){ (unidadesMateria[q.materia_id] = unidadesMateria[q.materia_id] || {})[parseInt(mm[1], 10)] = true; }
        });
        examAuto.filas = Array.isArray(filas) ? filas : [];
        examAuto.nombres = nombres;
        examAuto.unidadesMateria = unidadesMateria;
        examAuto.estado = "ok"; examAuto.msg = "";
      }
    }catch(err){
      examAuto.estado = "error"; examAuto.msg = "No se pudieron traer los exámenes: " + (err && err.message || err);
    }
    render();
  }
  // Consulta una vez y la repite solo si pasó la vigencia (no en cada dibujo de la pantalla).
  function asegurarExamenesAuto(){
    if(examAuto.estado === "cargando") return;
    if(examAuto.estado === "idle" || Date.now() - examAuto.ts > EXAM_AUTO_VIGENCIA_MS){
      setTimeout(cargarExamenesAuto, 0);
    }
  }
  // Rellena la columna «Exámen» de la unidad con el resultado del examen de cada alumno:
  //  - Solo cuenta el examen de la MISMA materia y unidad (la unidad sale del nombre de la materia del examen o,
  //    si no la trae, de la única «Unidad N» con preguntas activas; si hay varias no se adivina).
  //  - POR AHORA SOLO CUENTA EL EXAMEN ORDINARIO (tipo 1). Remedial y extraordinarios se ignoran hasta que se definan;
  //    para agregarlos después basta cambiar la condición «inf.rango !== 1» (el código ya sabe elegir el de mayor tipo).
  //  - Si hubiera varios del mismo tipo se usa el más reciente.
  //  - Nunca pisa lo que el profesor escribió a mano: solo llena celdas vacías o que ya eran automáticas.
  function aplicarExamenesAuto(g, unidad){
    var res = {estado: examAuto.estado, rellenadas: 0, sinResultado: 0, manuales: 0, sinMateria: false, info: {}};
    if(examAuto.estado !== "ok") return res;
    var materiaBase = claveTexto(g.materia);
    if(!materiaBase){ res.sinMateria = true; return res; }
    var numU = numeroUnidadCalif(g, unidad);
    var datos = califBucket(g.id, unidad.id);
    if(!datos.autoExamen) datos.autoExamen = {};
    var cambio = false;

    var candidatos = [];
    examAuto.filas.forEach(function(f){
      var nom = examAuto.nombres[f.materia_id];
      if(!nom || !(f.total > 0)) return;
      var inf = infoExamen(nom);
      if(inf.base !== materiaBase) return;
      if(inf.rango !== 1) return;   // solo ordinario por ahora
      var un = inf.unidad;
      if(un == null){
        var us = Object.keys(examAuto.unidadesMateria[f.materia_id] || {});
        if(us.length === 1) un = parseInt(us[0], 10);
      }
      if(un !== numU) return;
      candidatos.push({f: f, rango: inf.rango, nombre: nom});
    });

    var cacheM = matPorGrupo[g.id];
    g.estudiantes.forEach(function(e){
      var fm = cacheM && cacheM.estado === "ok" ? cacheM.filas[e.id] : null;
      var mat = fm && fm.estado === "ok" ? fm.matricula : "";
      var nk = claveTexto(e.nombre);
      var mejor = null;
      candidatos.forEach(function(c){
        var coincide = mat ? c.f.matricula === mat : claveTexto(c.f.nombre) === nk;
        if(!coincide) return;
        if(!mejor || c.rango > mejor.rango || (c.rango === mejor.rango && String(c.f.creado_en) > String(mejor.f.creado_en))) mejor = c;
      });
      if(!mejor){ res.sinResultado++; return; }

      var cfg = configColumna(datos, "examen");
      var frac = mejor.f.correctas / mejor.f.total, valor;
      if(cfg.modo === "porcentaje") valor = frac * 100;
      else if(cfg.modo === "escala"){
        var mx = numCalif(cfg.max);
        if(!(mx > 0)){   // escala sin máximo: el máximo automático sería el mejor alumno; se fija en 10 para que el valor sea real
          if(!datos.cols.examen) datos.cols.examen = {};
          datos.cols.examen.max = "10"; mx = 10; cambio = true;
        }
        valor = frac * mx;
      } else valor = frac * 10;
      var txt = String(Math.round(valor * 100) / 100);

      var actual = (datos.alumnos[e.id] || {}).examen;
      var vacio = actual == null || String(actual).trim() === "";
      if(vacio || String(actual) === datos.autoExamen[e.id]){
        if(String(actual) !== txt){
          if(!datos.alumnos[e.id]) datos.alumnos[e.id] = {};
          datos.alumnos[e.id].examen = txt; cambio = true;
        }
        if(datos.autoExamen[e.id] !== txt){ datos.autoExamen[e.id] = txt; cambio = true; }
        res.rellenadas++;
        res.info[e.id] = {correctas: mejor.f.correctas, total: mejor.f.total, nombre: mejor.nombre, tipo: EXAM_TIPOS[mejor.rango] || ""};
      } else res.manuales++;
    });
    if(cambio) guardarCalificaciones();
    return res;
  }
  function textoExamenesAuto(r, puntos){
    if(r.estado === "ok"){
      if(r.sinMateria) return "Este grupo no tiene materia, así que no se pueden relacionar los exámenes.";
      var t = "Exámen automático: " + r.rellenadas + " calificación(es) tomada(s) del examen ordinario (valen " + puntos + " pts)";
      t += " · " + r.sinResultado + " sin examen de esta unidad";
      if(r.manuales) t += " · " + r.manuales + " capturada(s) a mano (no se tocan)";
      return t + ".";
    }
    if(r.estado === "idle" || r.estado === "cargando") return "Consultando los exámenes de los alumnos…";
    return examAuto.msg || "No se pudieron consultar los exámenes.";
  }

  function refrescarTotalesCalif(){
    var g = grupoActivo(); if(!g) return;
    var u = unidadCalifActual(g); if(!u) return;
    var r = calcularCalificaciones(g, u);
    r.filas.forEach(function(f){
      var celda = document.querySelector('[data-calif-total="' + f.estudiante.id + '"]');
      if(celda) celda.innerHTML = "<b>" + f.total + "</b>";
    });
    var resumen = {califResAsist:r.dias, califResPartic:r.cuenta.partic, califResTrab:r.cuenta.trab};
    Object.keys(resumen).forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.textContent = resumen[id];
    });
    CALIF_COLUMNAS.forEach(function(col){
      var inp = document.querySelector('[data-calif-max="' + col.campo + '"]');
      if(inp) inp.placeholder = "Auto (" + r.escala[col.campo].auto + ")";
    });
  }
  function renderCalificaciones(){
    var g = grupoActivo();
    if(!g) return '<div class="card"><p class="empty">Primero crea o importa un grupo en la pestaña "Grupos".</p></div>';
    var unidades = unidadesDelGrupo(g);
    var unidad = unidadCalifActual(g);
    var html = '<div class="card compacta">';
    html += '<div class="hist-head"><div><div class="eyebrow">Calificaciones</div><h2>'+esc(g.nombre)+'</h2></div>';
    html += '<div class="field hist-group-field"><label for="selGrupoCalif">Grupo</label><select id="selGrupoCalif">';
    state.grupos.forEach(function(grupo){
      html += '<option value="'+esc(grupo.id)+'" '+(grupo.id===g.id?"selected":"")+'>'+esc(grupo.nombre)+'</option>';
    });
    html += '</select></div></div>';
    if(!unidad){
      return html + '<p class="empty">Este grupo no tiene unidades. Defínelas en "Historial y exportar" → "Unidades y periodos" para capturar calificaciones.</p></div>';
    }
    asegurarMatriculas(g, true);   // la matrícula es lo que relaciona al alumno con su examen
    asegurarExamenesAuto();
    var autoRes = aplicarExamenesAuto(g, unidad);
    var r = calcularCalificaciones(g, unidad);
    html += '<div class="hist-toolbar">';
    html += '<div class="field" style="margin-bottom:0;"><label for="selUnidadCalif">Unidad</label><select id="selUnidadCalif">';
    unidades.forEach(function(u){
      html += '<option value="'+esc(u.id)+'" '+(u.id===unidad.id?"selected":"")+'>'+esc(u.nombre)+' ('+displayFecha(u.desde)+' - '+displayFecha(u.hasta)+')</option>';
    });
    html += '</select></div>';
    html += '<div class="field" style="margin-bottom:0;"><label for="selModeloCalif">Modelo de ponderación</label><select id="selModeloCalif">';
    Object.keys(CALIF_MODELOS).forEach(function(id){
      html += '<option value="'+id+'" '+(id===r.modeloId?"selected":"")+'>'+CALIF_MODELOS[id].nombre+'</option>';
    });
    html += '</select></div>';
    html += '<button class="btn" id="btnPublicarCalif" title="Publica las calificaciones de este grupo en Supabase (app del alumno)">☁ Publicar calificaciones</button>';
    html += '<button class="btn secondary" id="btnPdfCalif">Generar PDF</button>';
    html += '<button class="btn secondary" id="btnCopiarCalif">Copiar para pegar en Excel</button>';
    html += '</div>';
    html += '<div class="hist-legend">';
    html += '<span><b style="background:'+CALIF_COLORES.trab+';color:#000;width:auto;padding:0 10px;border-radius:12px;">Saber hacer '+r.modelo.pesos.hacer+'%</b> Trabajos en clase ('+r.puntos.trab+' pts)</span>';
    html += '<span><b style="background:'+CALIF_COLORES.examen+';color:#000;width:auto;padding:0 10px;border-radius:12px;">Saber '+r.modelo.pesos.saber+'%</b> Exámen ('+r.puntos.examen+' pts)</span>';
    html += '<span><b style="background:'+CALIF_COLORES.asist+';color:#000;width:auto;padding:0 10px;border-radius:12px;">Ser '+r.modelo.pesos.ser+'%</b> Asistencias ('+r.puntos.asist+' pto) + Participación ('+r.puntos.partic+' pto)</span>';
    html += '</div>';
    html += '<p class="helptext hist-rule">El extra suma o resta puntos directos y el total máximo es 10. La asistencia se calcula sola desde el historial.</p>';
    html += '<p class="helptext" style="margin-top:4px;">'+esc(textoExamenesAuto(autoRes, r.puntos.examen))+' <button class="link-sutil" id="btnActualizarExamenes">Actualizar exámenes</button></p>';
    html += '</div>';

    // Cuadro aparte: cuántas asistencias, participaciones y trabajos hubo en el periodo.
    html += '<div class="card compacta"><h2>Resumen del periodo</h2><div class="hist-summary">';
    html += '<div><strong id="califResAsist">'+r.dias+'</strong><span> asistencias (días de clase)</span></div>';
    html += '<div><strong id="califResPartic">'+r.cuenta.partic+'</strong><span> participaciones</span></div>';
    html += '<div><strong id="califResTrab">'+r.cuenta.trab+'</strong><span> trabajos en clase</span></div>';
    html += '</div></div>';

    // Cómo se captura cada columna.
    html += '<div class="card compacta"><h2>Cómo capturas cada columna</h2>';
    html += '<p class="helptext" style="margin-top:0;">Elige si escribes porcentaje (0-100), calificación (0-10) o escala. En escala puedes poner el máximo o dejarlo vacío para que se calcule solo a partir del valor más alto capturado (en participación, con tope de 10).</p>';
    html += '<div class="row" style="align-items:flex-end;">';
    CALIF_COLUMNAS.forEach(function(col){
      var c = r.cfg[col.campo];
      html += '<div class="field" style="margin-bottom:0;min-width:170px;"><label for="modo_'+col.campo+'">'+col.titulo+' ('+r.puntos[col.campo]+' pts)</label><select id="modo_'+col.campo+'" data-calif-modo="'+col.campo+'">';
      Object.keys(CALIF_MODOS).forEach(function(modo){
        html += '<option value="'+modo+'" '+(modo===c.modo?"selected":"")+'>'+CALIF_MODOS[modo]+'</option>';
      });
      html += '</select></div>';
      if(c.modo === "escala"){
        html += '<div class="field" style="margin-bottom:0;width:130px;"><label for="max_'+col.campo+'">Máximo</label><input type="text" inputmode="decimal" id="max_'+col.campo+'" data-calif-max="'+col.campo+'" value="'+esc(c.max)+'" placeholder="Auto ('+r.escala[col.campo].auto+')"></div>';
      }
    });
    html += '</div></div>';

    html += '<div class="card compacta">';
    if(g.estudiantes.length === 0){
      return html + '<p class="empty">Este grupo no tiene estudiantes todavía.</p></div>';
    }
    var modoCorto = {porcentaje:"%", calificacion:"0-10", escala:"escala"};
    var th = function(texto, color, nota){
      return '<th style="background:'+color+';">'+texto+(nota ? '<small class="unidad-etiqueta">'+nota+'</small>' : '')+'</th>';
    };
    html += '<div class="table-scroll"><table class="matriz calif"><thead><tr>';
    html += th("Nombre", CALIF_COLORES.nombre);
    html += th("Asistencias ("+r.puntos.asist+" pto)", CALIF_COLORES.asist, "automático");
    html += th("Exámen ("+r.puntos.examen+" pts)", CALIF_COLORES.examen, modoCorto[r.cfg.examen.modo]);
    html += th("Partic. ("+r.puntos.partic+" pto)", CALIF_COLORES.partic, modoCorto[r.cfg.partic.modo]);
    html += th("Extra (±)", CALIF_COLORES.extra, "puntos");
    html += th("Trabajos en clase ("+r.puntos.trab+" pts)", CALIF_COLORES.trab, modoCorto[r.cfg.trab.modo]);
    html += th("Total (10)", CALIF_COLORES.total);
    html += '</tr></thead><tbody>';
    r.filas.forEach(function(f){
      var e = f.estudiante, d = r.datos.alumnos[e.id] || {};
      html += '<tr><td title="'+esc(e.nombre)+'">'+esc(e.nombre)+'</td>';
      html += '<td>'+f.asist+' / '+r.dias+'</td>';
      ["examen","partic","extra","trab"].forEach(function(campo){
        var ia = campo === "examen" && autoRes.info[e.id] && r.datos.autoExamen && String(d.examen) === r.datos.autoExamen[e.id] ? autoRes.info[e.id] : null;
        html += '<td><input type="text" inputmode="decimal" data-calif="'+campo+'" data-estudiante="'+esc(e.id)+'" value="'+esc(d[campo] == null ? "" : d[campo])+'" class="calif-input'+(ia ? ' calif-auto' : '')+'"'
          + (ia ? ' title="'+esc('Automático: '+ia.correctas+' / '+ia.total+' en «'+ia.nombre+'»'+(ia.tipo ? ' ('+ia.tipo+')' : '')+'. Si lo escribes a mano ya no se cambia solo.')+'"' : '')+'></td>';
      });
      html += '<td data-calif-total="'+esc(e.id)+'"><b>'+f.total+'</b></td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  // HTML del reporte en PDF (horizontal, encabezados de color y puntaje entre paréntesis).
  function htmlReporteCalif(g, r){
    var u = r.unidad;
    var textoModo = function(campo){
      var m = r.cfg[campo].modo;
      return m === "porcentaje" ? "en %" : (m === "calificacion" ? "de 0 a 10" : "sobre " + r.escala[campo].efectiva);
    };
    var th = function(texto, color, nota){
      return '<th style="background:'+color+';">'+texto+(nota ? '<small>'+nota+'</small>' : '')+'</th>';
    };
    var chip = function(color, texto){ return '<span class="chip" style="background:'+color+';">'+texto+'</span>'; };
    var hoy = new Date();
    var html = '<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>Calificaciones</title><style>';
    // Tamaño según el número de alumnos: con pocos se ve cómodo y con más se encoge para seguir
    // cabiendo en UNA hoja carta horizontal; con muchísimos continúa en la siguiente (encabezado repetido).
    var n = r.filas.length;
    var fs = n <= 20 ? 11 : (n <= 30 ? 10 : (n <= 38 ? 9 : (n <= 46 ? 8 : 7)));
    var pad = n <= 20 ? 4 : (n <= 30 ? 3 : (n <= 38 ? 2 : 1));
    html += '@page{size:letter landscape;margin:10mm;}';
    html += '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}';
    html += 'body{font-family:"Segoe UI",Arial,sans-serif;font-size:'+fs+'px;color:#0f172a;margin:0;}';
    html += 'h1{font-size:17px;margin:0 0 1px;}.sub{color:#475569;margin-bottom:4px;font-size:'+Math.min(fs,10)+'px;}';
    html += '.chips{margin:4px 0;white-space:nowrap;}.chip{display:inline-block;padding:2px 8px;border-radius:12px;margin-right:6px;font-size:9.5px;}';
    html += '.resumen{margin:4px 0 6px;}.resumen span{display:inline-block;border:1px solid #94a3b8;border-radius:6px;padding:2px 8px;margin-right:6px;}';
    html += 'table{border-collapse:collapse;width:100%;}thead{display:table-header-group;}tr{page-break-inside:avoid;}';
    html += 'th,td{border:1px solid #64748b;padding:'+pad+'px 6px;text-align:center;}th{font-size:'+Math.min(fs,10)+'px;}th small{display:block;font-weight:normal;font-size:8px;color:#334155;}';
    html += 'td.n{text-align:left;}.pie{margin-top:6px;color:#64748b;font-size:8px;}';
    html += '</style></head><body>';
    html += '<h1>Calificaciones — '+esc(g.nombre)+'</h1>';
    html += '<div class="sub">'+esc(u.nombre)+' ('+displayFecha(u.desde)+' - '+displayFecha(u.hasta)+')'+(g.materia ? ' · Materia: '+esc(g.materia) : '')+(g.profesor ? ' · Profesor: '+esc(g.profesor) : '')+' · '+esc(r.modelo.nombre)+'</div>';
    html += '<div class="chips">';
    html += chip(CALIF_COLORES.trab, 'Saber hacer '+r.modelo.pesos.hacer+'% · Trabajos en clase ('+r.puntos.trab+' pts)');
    html += chip(CALIF_COLORES.examen, 'Saber '+r.modelo.pesos.saber+'% · Exámen ('+r.puntos.examen+' pts)');
    html += chip(CALIF_COLORES.asist, 'Ser '+r.modelo.pesos.ser+'% · Asistencias ('+r.puntos.asist+' pto) + Participación ('+r.puntos.partic+' pto)');
    html += '</div>';
    html += '<div class="resumen"><span><b>'+r.dias+'</b> asistencias (días de clase)</span><span><b>'+r.cuenta.partic+'</b> participaciones</span><span><b>'+r.cuenta.trab+'</b> trabajos en clase</span></div>';
    html += '<table><thead><tr>';
    html += th("Nombre", CALIF_COLORES.nombre);
    html += th("Asistencias ("+r.puntos.asist+" pto)", CALIF_COLORES.asist, "de "+r.dias+" días");
    html += th("Exámen ("+r.puntos.examen+" pts)", CALIF_COLORES.examen, textoModo("examen"));
    html += th("Partic. ("+r.puntos.partic+" pto)", CALIF_COLORES.partic, textoModo("partic"));
    html += th("Extra (±)", CALIF_COLORES.extra, "puntos");
    html += th("Trabajos en clase ("+r.puntos.trab+" pts)", CALIF_COLORES.trab, textoModo("trab"));
    html += th("Total (10)", CALIF_COLORES.total);
    html += '</tr></thead><tbody>';
    r.filas.forEach(function(f){
      var d = r.datos.alumnos[f.estudiante.id] || {};
      html += '<tr><td class="n">'+esc(f.estudiante.nombre)+'</td><td>'+f.asist+' / '+r.dias+'</td>';
      html += '<td>'+esc(d.examen || "")+'</td><td>'+esc(d.partic || "")+'</td><td>'+esc(d.extra || "")+'</td><td>'+esc(d.trab || "")+'</td>';
      html += '<td><b>'+f.total+'</b></td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="pie">Generado el '+displayFecha(todayISO())+' a las '+String(hoy.getHours()).padStart(2,"0")+':'+String(hoy.getMinutes()).padStart(2,"0")+' con FullStatus. La asistencia incluye faltas justificadas y la regla de 3 retardos = 1 falta y 2 asistencias.</div>';
    return html + '</body></html>';
  }
  // En Electron se genera el PDF desde el proceso principal (guardar como...);
  // fuera de Electron se usa el cuadro de impresión del sistema como respaldo.
  async function generarPdfCalificaciones(){
    var g = grupoActivo(); if(!g) return;
    var u = unidadCalifActual(g);
    if(!u){ showToast("Define primero las unidades del grupo."); return; }
    var html = htmlReporteCalif(g, calcularCalificaciones(g, u));
    var nombre = "Calificaciones " + g.nombre + " " + u.nombre;
    if(window.fullstatusPDF && window.fullstatusPDF.generar){
      try{
        var res = await window.fullstatusPDF.generar(html, nombre);
        if(res && res.ok) showToast("PDF guardado.");
        else if(!(res && res.cancelado)) showToast((res && res.error) || "No se pudo generar el PDF.");
      }catch(err){
        console.error(err);
        showToast("No se pudo generar el PDF.");
      }
      return;
    }
    var marco = document.createElement("iframe");
    marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(marco);
    marco.onload = function(){
      marco.contentWindow.focus();
      marco.contentWindow.print();
      setTimeout(function(){ if(marco.parentNode) marco.parentNode.removeChild(marco); }, 1500);
    };
    marco.srcdoc = html;
  }

  // =========================================================
  // EVENTOS
  // =========================================================
  function attachHandlers(){
    // Calificaciones
    var selGrupoCalif = document.getElementById("selGrupoCalif");
    if(selGrupoCalif) selGrupoCalif.addEventListener("change", function(){ state.grupoActivoId = selGrupoCalif.value; calUnidad = ""; saveState(false); render(); });
    var selUnidadCalif = document.getElementById("selUnidadCalif");
    if(selUnidadCalif) selUnidadCalif.addEventListener("change", function(){ calUnidad = selUnidadCalif.value; render(); });
    document.querySelectorAll("[data-calif-modo]").forEach(function(sel){
      sel.addEventListener("change", function(){
        var g = grupoActivo(); var u = g && unidadCalifActual(g); if(!u) return;
        var datos = califBucket(g.id, u.id), campo = sel.getAttribute("data-calif-modo");
        if(!datos.cols[campo]) datos.cols[campo] = {};
        datos.cols[campo].modo = sel.value;
        guardarCalificaciones(); render();
      });
    });
    document.querySelectorAll("[data-calif-max]").forEach(function(inp){
      inp.addEventListener("input", function(){
        var g = grupoActivo(); var u = g && unidadCalifActual(g); if(!u) return;
        var datos = califBucket(g.id, u.id), campo = inp.getAttribute("data-calif-max");
        if(!datos.cols[campo]) datos.cols[campo] = {};
        datos.cols[campo].max = inp.value;
        guardarCalificaciones(); refrescarTotalesCalif();
      });
    });
    document.querySelectorAll("[data-calif]").forEach(function(inp){
      inp.addEventListener("input", function(){
        var g = grupoActivo(); var u = g && unidadCalifActual(g); if(!u) return;
        var datos = califBucket(g.id, u.id), id = inp.getAttribute("data-estudiante");
        if(!datos.alumnos[id]) datos.alumnos[id] = {};
        datos.alumnos[id][inp.getAttribute("data-calif")] = inp.value;
        // Lo escrito a mano manda: esa celda deja de ser automática y el examen ya no la pisa.
        if(inp.getAttribute("data-calif") === "examen" && datos.autoExamen){ delete datos.autoExamen[id]; inp.classList.remove("calif-auto"); inp.removeAttribute("title"); }
        guardarCalificaciones(); refrescarTotalesCalif();
      });
      // Flechas arriba/abajo: pasa a la misma columna de la fila de arriba o de abajo.
      inp.addEventListener("keydown", function(ev){
        if(ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
        var fila = inp.closest("tr");
        var vecina = fila && (ev.key === "ArrowUp" ? fila.previousElementSibling : fila.nextElementSibling);
        var destino = vecina && vecina.querySelector('[data-calif="' + inp.getAttribute("data-calif") + '"]');
        if(!destino) return;
        ev.preventDefault();
        destino.focus();
        destino.select();
      });
    });
    var btnActExamenes = document.getElementById("btnActualizarExamenes");
    if(btnActExamenes) btnActExamenes.addEventListener("click", function(){
      examAuto.estado = "idle";
      var g = grupoActivo(); if(g) delete matPorGrupo[g.id];
      render();
    });
    var selModeloCalif = document.getElementById("selModeloCalif");
    if(selModeloCalif) selModeloCalif.addEventListener("change", function(){
      var g = grupoActivo(); if(!g) return;
      if(!califDatos[g.id]) califDatos[g.id] = {};
      califDatos[g.id]._modelo = selModeloCalif.value;
      guardarCalificaciones(); render();
    });
    var btnPdfCalif = document.getElementById("btnPdfCalif");
    if(btnPdfCalif) btnPdfCalif.addEventListener("click", generarPdfCalificaciones);
    var btnPublicarCalif = document.getElementById("btnPublicarCalif");
    if(btnPublicarCalif) btnPublicarCalif.addEventListener("click", async function(){
      var api = window.FullStatusCalificacionesSupabase;
      if(!api){ showToast("Falta cargar supabase-calificaciones.js."); return; }
      var g = grupoActivo();
      btnPublicarCalif.disabled = true;
      var res = await api.subirAhora();
      btnPublicarCalif.disabled = false;
      if(res.estado === "ok"){
        var sin = (res.datos && res.datos.sin_match) || [];
        showToast("Calificaciones de " + (g ? g.nombre : "el grupo") + " publicadas." + (sin.length ? " Sin matrícula en Supabase: " + sin.join(", ") + "." : ""));
      }
      else if(res.estado === "sinSesion"){ showToast("Inicia sesión para publicar."); if(window.FullStatusSupabase && window.FullStatusSupabase.abrir) window.FullStatusSupabase.abrir(); }
      else if(res.estado === "sinConexion") showToast("Sin conexión: se publicará solo al volver internet.");
      else if(res.estado === "sinGrupo") showToast("No hay un grupo a la vista.");
      else if(res.estado !== "ocupado") showToast(res.error || "No se pudo publicar.");
    });
    var btnCopiarCalif = document.getElementById("btnCopiarCalif");
    if(btnCopiarCalif) btnCopiarCalif.addEventListener("click", function(){
      var g = grupoActivo(); var u = g && unidadCalifActual(g); if(!u) return;
      var r = calcularCalificaciones(g, u);
      var filas = [["Nombre","Asistencias","Exámen","Partic.","Extra","Trabajos en clase","Total"]];
      r.filas.forEach(function(f){
        var d = r.datos.alumnos[f.estudiante.id] || {};
        filas.push([f.estudiante.nombre, f.asist, d.examen || "", d.partic || "", d.extra || "", d.trab || "", f.total]);
      });
      copiarPortapapeles(filas.map(function(fila){ return fila.join("\t"); }).join("\n"));
    });

    // PRISMAL MESH: «Reactivar» = borrar el resultado y el intento de ESE alumno en ESE examen para que lo
    // conteste de nuevo. El resultado anterior se conserva en el servidor (tabla examenes_reactivados).
    var resTablaEl = document.getElementById("resTabla");
    if(resTablaEl) resTablaEl.addEventListener("click", async function(ev){
      var b = ev.target.closest ? ev.target.closest("[data-reactivar]") : null;
      if(!b) return;
      var id = b.getAttribute("data-reactivar");
      var f = resDatos && resDatos.filas.find(function(x){ return String(x.id) === id; });
      if(!f) return;
      var examen = resDatos.nombres[f.materia_id] || "este examen";
      // confirmar() es el cuadro propio de la app: el confirm() nativo deja sin foco los campos en Electron.
      confirmar("Reactivar el examen de " + (f.nombre || f.matricula) + " (" + examen + ", resultado " + f.correctas + " / " + f.total +
        "). Se borra ese resultado y podrá contestarlo de nuevo desde cero; el resultado anterior queda guardado en el servidor. ¿Reactivar?", async function(){
        b.disabled = true;
        try {
          var api = window.FullStatusSupabase;
          if(!api || !api.rpc) throw new Error("Falta cargar supabase-asistencias.js.");
          var res = await api.rpc("reactivar_examen", { p_resultado_id: Number(id) });
          if(res && res.sinSesion) throw new Error("Inicia sesión en ☁ Alumnos (administrador) para reactivar.");
          resDatos.filas = resDatos.filas.filter(function(x){ return String(x.id) !== id; });
          resTablaEl.innerHTML = htmlTablaResultados();
          showToast("Examen reactivado: " + (f.nombre || f.matricula) + " ya puede contestarlo de nuevo.");
        } catch(err){
          b.disabled = false;
          showToast(err.message || "No se pudo reactivar el examen.");
        }
      });
    });
    var btnResActualizar = document.getElementById("btnResActualizar");
    if(btnResActualizar) btnResActualizar.addEventListener("click", cargarResultados);
    var selResMateria = document.getElementById("selResMateria");
    if(selResMateria) selResMateria.addEventListener("change", function(){ resMateria = selResMateria.value; document.getElementById("resTabla").innerHTML = htmlTablaResultados(); });
    var selResGrupo = document.getElementById("selResGrupo");
    if(selResGrupo) selResGrupo.addEventListener("change", function(){ resGrupo = selResGrupo.value; document.getElementById("resTabla").innerHTML = htmlTablaResultados(); });
    var inputResBuscar = document.getElementById("inputResBuscar");
    if(inputResBuscar) inputResBuscar.addEventListener("input", function(){ resBusqueda = inputResBuscar.value; document.getElementById("resTabla").innerHTML = htmlTablaResultados(); });

    var btnAgregarNuevosDrive = document.getElementById("btnAgregarNuevosDrive");
    if(btnAgregarNuevosDrive) btnAgregarNuevosDrive.addEventListener("click", function(){
      if(!navigator.onLine){ showToast("Sin conexión: no se puede leer el Excel de Drive."); return; }
      iniciarGoogleDrive(function(accessToken){
        agregarGruposNuevosDeDrive(accessToken).catch(function(err){
          console.error(err);
          showToast(err.message || "No se pudieron agregar los grupos nuevos.");
        });
      });
    });

    var btnCargarGoogle = document.getElementById("btnCargarGoogle");
    if(btnCargarGoogle) btnCargarGoogle.addEventListener("click", function(){
      iniciarGoogleDrive(function(accessToken){
        cargarGruposGoogle(accessToken).catch(function(err){
          console.error(err);
          var estadoEl = document.getElementById("cargarGoogleEstado");
          if(estadoEl) estadoEl.textContent = "";
          showToast(err.message || "No se pudieron cargar los grupos desde Google Sheets.");
        });
      });
    });

    var sel = document.getElementById("selGrupoActivo");
    // Cambiar de grupo es solo navegación: se guarda la selección pero NO se marca
    // "cambios pendientes" (no hay nada nuevo que subir a Drive).
    if(sel) sel.addEventListener("change", function(){ state.grupoActivoId = sel.value; pasarIndex = null; saveState(false); render(); });

    var btnEliminarGrupo = document.getElementById("btnEliminarGrupo");
    if(btnEliminarGrupo) btnEliminarGrupo.addEventListener("click", function(){
      var g = grupoActivo(); if(!g) return;
      confirmar('¿Eliminar el grupo "'+g.nombre+'" y todos sus registros de asistencia? También se eliminará su pestaña del Excel institucional en la próxima sincronización. No se puede deshacer.', function(){
      if(!Array.isArray(state.hojasPorEliminar)) state.hojasPorEliminar = [];
      if(!esHojaPlantilla(g.nombre)) state.hojasPorEliminar.push(g.nombre);
      state.grupos = state.grupos.filter(function(x){ return x.id !== g.id; });
      delete state.asistencias[g.id];
      delete state.justificantes[g.id];
      if(state.fechasVacias) delete state.fechasVacias[g.id];
      if(califDatos[g.id]){ delete califDatos[g.id]; guardarCalificaciones(); }
      state.grupoActivoId = state.grupos.length ? state.grupos[0].id : null;
      pasarIndex = null;
      saveState(); render();
      });
    });

    var inputMateria = document.getElementById("inputMateria");
    if(inputMateria) inputMateria.addEventListener("change", function(){ grupoActivo().materia = inputMateria.value.trim(); saveState(); });
    var inputProfesor = document.getElementById("inputProfesor");
    if(inputProfesor) inputProfesor.addEventListener("change", function(){ grupoActivo().profesor = inputProfesor.value.trim(); saveState(); });

    var btnCrearGrupo = document.getElementById("btnCrearGrupo");
    if(btnCrearGrupo) btnCrearGrupo.addEventListener("click", function(){
      var input = document.getElementById("inputNuevoGrupo");
      var nombre = input.value.trim();
      if(!nombre){ showToast("Escribe un nombre para el grupo."); return; }
      var g = {id: uid(), nombre: nombre, estudiantes: [], materia:"", profesor:""};
      state.hojasPorEliminar = (state.hojasPorEliminar || []).filter(function(n){ return n.trim().toLowerCase() !== nombre.toLowerCase(); });
      state.grupos.push(g);
      state.grupoActivoId = g.id;
      pasarIndex = null;
      saveState(); render();
    });

    // PRISMAL MESH: agrega otra materia a un grupo. Crea una entrada nueva {id, nombre, grupoBase,
    // materia, profesor, estudiantes copiados con id nuevo}. "nombre" es también el nombre de la hoja
    // del Excel institucional (único, máx. 31 caracteres, sin []*?/\:), así que lleva la materia:
    // "7B · INGLÉS VII". "grupoBase" ("7B") es lo que se publica en Supabase como grupo.
    var btnOtraMateria = document.getElementById("btnOtraMateria");
    if(btnOtraMateria) btnOtraMateria.addEventListener("click", function(){
      var input = document.getElementById("inputOtraMateria");
      var materia = input.value.replace(/[\[\]\*\?\/\\:]/g, "").trim();
      if(!materia){ showToast("Escribe el nombre de la materia."); return; }
      var origen = grupoActivo();
      if(!origen) return;
      var base = origen.grupoBase || origen.nombre;
      var candidato = (base + " · " + materia).slice(0, 31).trim();
      var nombre = candidato, n = 2;
      var existe = function(nom){ return state.grupos.some(function(x){ return x.nombre.trim().toLowerCase() === nom.toLowerCase(); }); };
      while(existe(nombre)){ nombre = (candidato.slice(0, 28) + " " + n).slice(0, 31); n++; }
      var nuevo = {
        id: uid(),
        nombre: nombre,
        grupoBase: base,
        materia: materia,
        profesor: origen.profesor || "",
        estudiantes: origen.estudiantes.map(function(est){ return Object.assign({}, est, {id: uid()}); })
      };
      state.hojasPorEliminar = (state.hojasPorEliminar || []).filter(function(h){ return h.trim().toLowerCase() !== nombre.toLowerCase(); });
      state.grupos.push(nuevo);
      state.grupoActivoId = nuevo.id;
      pasarIndex = null;
      saveState(); render();
      showToast("Materia «" + materia + "» agregada a " + base + ". Su hoja del Excel se crea al actualizar en Drive.");
    });

    var btnAgregarEstudiante = document.getElementById("btnAgregarEstudiante");
    if(btnAgregarEstudiante) btnAgregarEstudiante.addEventListener("click", function(){
      var input = document.getElementById("inputNuevoEstudiante");
      var nombre = input.value.trim();
      if(!nombre) return;
      grupoActivo().estudiantes.push({id: uid(), nombre: nombre});
      pasarIndex = null;
      saveState(); render();
    });
    var inputNE = document.getElementById("inputNuevoEstudiante");
    if(inputNE) inputNE.addEventListener("keydown", function(ev){ if(ev.key==="Enter") document.getElementById("btnAgregarEstudiante").click(); });

    var btnAgregarVarios = document.getElementById("btnAgregarVarios");
    if(btnAgregarVarios) btnAgregarVarios.addEventListener("click", function(){
      var ta = document.getElementById("textareaBulk");
      var lineas = ta.value.split("\n").map(function(s){return s.trim();}).filter(Boolean);
      if(lineas.length === 0) return;
      var g = grupoActivo();
      lineas.forEach(function(nombre){ g.estudiantes.push({id: uid(), nombre: nombre}); });
      ta.value = ""; pasarIndex = null;
      saveState(); render();
      showToast(lineas.length + " estudiante(s) agregado(s).");
    });
    document.querySelectorAll("[data-del-estudiante]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        confirmar("¿Quitar a este estudiante del grupo?", function(){
          g.estudiantes = g.estudiantes.filter(function(e){ return e.id !== btn.getAttribute("data-del-estudiante"); });
          pasarIndex = null;
          saveState(); render();
        });
      });
    });

    // PRISMAL MESH: editar / agregar la matrícula de un alumno (Grupos → Estudiantes de ...).
    document.querySelectorAll("[data-editar-mat]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        if(!g) return;
        matEdit = { gid: g.id, eid: btn.getAttribute("data-editar-mat") };
        matFoco = true;
        render();
      });
    });
    // PRISMAL MESH: «Usar ese nombre» corrige el nombre del alumno en FullStatus al que tiene en Supabase.
    // Así coincide exacto, se le asigna su matrícula y sus asistencias/calificaciones se publican solas (saveState
    // dispara la publicación). Solo cambia el texto del nombre: el id del alumno y su historial local no se tocan.
    document.querySelectorAll("[data-usar-nombre]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        var est = g && g.estudiantes.find(function(e){ return e.id === btn.getAttribute("data-usar-nombre"); });
        var cacheG = g && matPorGrupo[g.id];
        var fila = cacheG && cacheG.estado === "ok" ? cacheG.filas[est ? est.id : ""] : null;
        if(!g || !est || !fila || fila.estado !== "posible" || !fila.nombre_sugerido) return;
        confirmar("Cambiar el nombre de «" + est.nombre + "» a «" + fila.nombre_sugerido + "» (matrícula " + fila.matricula + ")? Así coincide con Supabase y se le publican sus asistencias y calificaciones.", function(){
          est.nombre = fila.nombre_sugerido;
          matPorGrupo = {};      // vuelve a consultar las matrículas con el nombre corregido
          saveState(); render();
          showToast("Nombre corregido: " + est.nombre + ".");
        });
      });
    });
    document.querySelectorAll("[data-cancelar-mat]").forEach(function(btn){
      btn.addEventListener("click", function(){ matEdit = null; render(); });
    });
    var inputMat = document.getElementById("inputMatricula");
    if(inputMat){
      inputMat.addEventListener("input", function(){ if(matEdit) matEdit.valor = inputMat.value; });
      inputMat.addEventListener("keydown", function(ev){
        if(ev.key === "Enter"){ ev.preventDefault(); var b = document.querySelector("[data-guardar-mat]"); if(b) b.click(); }
        else if(ev.key === "Escape"){ matEdit = null; render(); }
      });
      if(matFoco){ matFoco = false; inputMat.focus(); inputMat.select(); }
    }
    document.querySelectorAll("[data-guardar-mat]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        var est = g && g.estudiantes.find(function(e){ return e.id === btn.getAttribute("data-guardar-mat"); });
        if(!g || !est || matGuardando) return;
        var campo = document.getElementById("inputMatricula");
        var nueva = String(campo ? campo.value : "").replace(/\s+/g, "");
        if(!nueva){ showToast("Escribe la matrícula (sin espacios)."); return; }
        var cacheG = matPorGrupo[g.id];
        var fila = cacheG && cacheG.estado === "ok" ? cacheG.filas[est.id] : null;
        var anterior = fila && fila.estado === "ok" ? fila.matricula : "";
        if(nueva === anterior){ matEdit = null; render(); return; }
        function enviar(){ guardarMatricula(g, est, anterior, nueva); }
        if(anterior){
          confirmar("Vas a cambiar la matrícula de " + est.nombre + " de " + anterior + " a " + nueva + ". Se actualizará también su historial en Supabase (asistencias, calificaciones y exámenes). ¿Continuar?", enviar);
        } else enviar();
      });
    });

    // Pasar lista
    var selGrupoPasar = document.getElementById("selGrupoPasar");
    if(selGrupoPasar) selGrupoPasar.addEventListener("change", function(){
      state.grupoActivoId = selGrupoPasar.value;
      pasarIndex = null;
      pasarViewMode = "card";
      pasarSegundaLista = null;
      pasarSegundaIndex = null;
      saveState(false); // solo navegación, no es un cambio de asistencia
      render();
    });
    var inputFecha = document.getElementById("inputFechaLista");
    if(inputFecha) inputFecha.addEventListener("change", function(){
      var fecha = inputFecha.value;
      if(!fecha){ render(); return; }
      var g = grupoActivo();
      var yaExiste = g && fechaTieneMarcas(g.id, fecha);
      var continuar = function(){
        pasarFecha = fecha;
        pasarIndex = null;
        pasarViewMode = "card";
        pasarSegundaLista = null;
        pasarSegundaIndex = null;
        render();
      };
      if(!yaExiste && g){
        confirmar('¿Agregar el '+displayFecha(fecha)+' como una nueva fecha de asistencia para "'+g.nombre+'"?', continuar, function(){ render(); });
        return;
      }
      continuar();
    });
    var btnToggleVista = document.getElementById("btnToggleVista");
    if(btnToggleVista) btnToggleVista.addEventListener("click", function(){
      pasarViewMode = pasarViewMode === "card" ? "list" : "card";
      render();
    });
    document.querySelectorAll("[data-marcar]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        var bucket = ensureAsistenciaBucket(g.id, pasarFecha);
        var est = g.estudiantes[pasarIndex];
        bucket[est.id] = btn.getAttribute("data-marcar");
        pasarIndex++;
        saveState();
        if(pasarIndex >= g.estudiantes.length) autoSincronizarCambios();
        render();
      });
    });
    var btnAnterior = document.getElementById("btnAnterior");
    if(btnAnterior) btnAnterior.addEventListener("click", function(){ if(pasarIndex>0){ pasarIndex--; render(); } });
    var btnSaltar = document.getElementById("btnSaltar");
    if(btnSaltar) btnSaltar.addEventListener("click", function(){
      var g = grupoActivo();
      pasarIndex++;
      if(g && pasarIndex >= g.estudiantes.length) autoSincronizarCambios();
      render();
    });
    var btnSegundoPase = document.getElementById("btnSegundoPase");
    if(btnSegundoPase) btnSegundoPase.addEventListener("click", function(){
      var g = grupoActivo();
      var bucket = leerAsistenciaBucket(g.id, pasarFecha);
      pasarSegundaLista = g.estudiantes.filter(function(e){ return bucket[e.id] === "A"; }).map(function(e){ return e.id; });
      pasarSegundaIndex = 0;
      pasarViewMode = "segunda";
      render();
    });
    document.querySelectorAll("[data-marcar-segunda]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        var bucket = ensureAsistenciaBucket(g.id, pasarFecha);
        var estId = pasarSegundaLista[pasarSegundaIndex];
        bucket[estId] = btn.getAttribute("data-marcar-segunda");
        pasarSegundaIndex++;
        saveState();
        if(pasarSegundaIndex >= pasarSegundaLista.length) autoSincronizarCambios();
        render();
      });
    });
    var btnAnteriorSegunda = document.getElementById("btnAnteriorSegunda");
    if(btnAnteriorSegunda) btnAnteriorSegunda.addEventListener("click", function(){ if(pasarSegundaIndex>0){ pasarSegundaIndex--; render(); } });
    var btnSaltarSegunda = document.getElementById("btnSaltarSegunda");
    if(btnSaltarSegunda) btnSaltarSegunda.addEventListener("click", function(){
      pasarSegundaIndex++;
      if(pasarSegundaLista && pasarSegundaIndex >= pasarSegundaLista.length) autoSincronizarCambios();
      render();
    });
    var btnVolverResumen = document.getElementById("btnVolverResumen");
    if(btnVolverResumen) btnVolverResumen.addEventListener("click", function(){ pasarViewMode = "card"; render(); });
    var btnRevisarLista = document.getElementById("btnRevisarLista");
    if(btnRevisarLista) btnRevisarLista.addEventListener("click", function(){ pasarViewMode = "list"; render(); });
    var btnReiniciarLista = document.getElementById("btnReiniciarLista");
    if(btnReiniciarLista) btnReiniciarLista.addEventListener("click", function(){
      pasarIndex = 0;
      pasarViewMode = "card";
      pasarSegundaLista = null;
      pasarSegundaIndex = null;
      render();
    });
    var btnToggleMat = document.getElementById("btnToggleMatriculas");
    if(btnToggleMat) btnToggleMat.addEventListener("click", function(){
      matVisible = !matVisible;
      try { localStorage.setItem("fsMatriculasVisible", matVisible ? "1" : "0"); } catch(e){}
      render();
    });
    var selMatFiltro = document.getElementById("selMatFiltro");
    if(selMatFiltro) selMatFiltro.addEventListener("change", function(){ matFiltro = selMatFiltro.value; render(); });
    document.querySelectorAll("[data-usar-nombre]").forEach(function(b){
      b.addEventListener("click", function(){
        var g = grupoActivo();
        var est = g && g.estudiantes.find(function(x){ return String(x.id) === b.getAttribute("data-usar-nombre"); });
        var f = est && matPorGrupo[g.id] && matPorGrupo[g.id].filas[est.id];
        if(!est || !f || !f.nombre_sugerido) return;
        confirmar("Cambiar el nombre en FullStatus: «" + est.nombre + "» → «" + f.nombre_sugerido + "». Así coincidirá con su matrícula " + f.matricula +
          ". Si ya subiste el Excel a Drive, revisa esa fila después de actualizar.", function(){
          est.nombre = f.nombre_sugerido;
          delete matPorGrupo[g.id];
          saveState(); render();
          showToast("Nombre corregido. Publica de nuevo con ☁ Alumnos para subir sus asistencias.");
        });
      });
    });
    var detCuentas = document.getElementById("detCuentas");
    if(detCuentas) detCuentas.addEventListener("toggle", function(){
      if(detCuentas.open !== cuentasAbierto){ cuentasAbierto = detCuentas.open; render(); }
    });
    var btnRefCuentas = document.getElementById("btnRefrescarCuentas");
    if(btnRefCuentas) btnRefCuentas.addEventListener("click", function(){
      var g = grupoActivo(); if(g){ delete matPorGrupo[g.id]; render(); }
    });
    // Llama a una función de Supabase con la sesión de administrador y refresca la sección.
    async function accionCuentas(nombreRpc, cuerpo, aviso){
      var g = grupoActivo();
      try {
        var api = window.FullStatusSupabase;
        if(!api || !api.rpc) throw new Error("Falta cargar supabase-asistencias.js.");
        var res = await api.rpc(nombreRpc, cuerpo);
        if(res && res.sinSesion) throw new Error("Inicia sesión en ☁ Alumnos (administrador).");
        if(g) delete matPorGrupo[g.id];
        render();
        showToast(aviso);
      } catch(err){ showToast(err.message || "No se pudo completar la acción."); }
    }
    document.querySelectorAll("[data-reset-pass]").forEach(function(b){
      b.addEventListener("click", function(){
        var matricula = b.getAttribute("data-reset-pass"), nombre = b.getAttribute("data-nombre");
        confirmar("Restablecer la contraseña de " + nombre + " (" + matricula + "). Se borra su contraseña actual y podrá crear una nueva desde la app. ¿Continuar?", function(){
          accionCuentas("restablecer_contrasena", { p_matricula: matricula }, "Contraseña de " + nombre + " restablecida: ya puede crear una nueva.");
        });
      });
    });
    document.querySelectorAll("[data-hab-pass]").forEach(function(b){
      b.addEventListener("click", function(){
        var habilitar = b.getAttribute("data-valor") === "1";
        accionCuentas("habilitar_registro", { p_matriculas: [b.getAttribute("data-hab-pass")], p_habilitar: habilitar }, habilitar ? "Registro habilitado." : "Registro cerrado.");
      });
    });
    var btnHabTodos = document.getElementById("btnHabilitarTodos");
    if(btnHabTodos) btnHabTodos.addEventListener("click", function(){
      var lista = btnHabTodos.getAttribute("data-matriculas").split(",");
      confirmar("Habilitar el registro de contraseña a " + lista.length + " alumno(s) sin contraseña de este grupo. ¿Continuar?", function(){
        accionCuentas("habilitar_registro", { p_matriculas: lista, p_habilitar: true }, "Registro habilitado a " + lista.length + " alumno(s).");
      });
    });
    var btnRefMat = document.getElementById("btnRefrescarMatriculas");
    if(btnRefMat) btnRefMat.addEventListener("click", function(){
      var g = grupoActivo();
      if(g){ delete matPorGrupo[g.id]; render(); }
    });
    document.querySelectorAll("[data-chip]").forEach(function(chip){
      chip.addEventListener("click", function(){
        var g = grupoActivo();
        var bucket = ensureAsistenciaBucket(g.id, pasarFecha);
        var estId = chip.getAttribute("data-estudiante"), estado = chip.getAttribute("data-estado");
        if(bucket[estId] === estado) delete bucket[estId]; else bucket[estId] = estado;
        // Si ya no queda ninguna marca, la fecha deja de existir (no queda columna vacía).
        if(Object.keys(bucket).length === 0) delete state.asistencias[g.id][pasarFecha];
        saveState(); render();
      });
    });

    // Historial
    var selGrupoHistorial = document.getElementById("selGrupoHistorial");
    if(selGrupoHistorial) selGrupoHistorial.addEventListener("change", function(){
      state.grupoActivoId = selGrupoHistorial.value;
      pasarIndex = null;
      histUnidad = "";
      saveState(false); // solo navegación, no es un cambio de asistencia
      render();
    });
    var selUnidadHistorial = document.getElementById("selUnidadHistorial");
    if(selUnidadHistorial) selUnidadHistorial.addEventListener("change", function(){ histUnidad = selUnidadHistorial.value; render(); });
    var btnAgregarUnidad = document.getElementById("btnAgregarUnidad");
    if(btnAgregarUnidad) btnAgregarUnidad.addEventListener("click", function(){
      var g = grupoActivo();
      var desde = document.getElementById("unidadDesde").value;
      var hasta = document.getElementById("unidadHasta").value;
      var nombre = document.getElementById("unidadNombre").value.trim() || "Unidad "+(unidadesDelGrupo(g).length+1);
      if(!desde || !hasta){ showToast("Elige las fechas de inicio y fin de la unidad."); return; }
      if(hasta < desde){ showToast("La fecha final no puede ser anterior a la inicial."); return; }
      var empalmada = unidadesDelGrupo(g).find(function(u){ return desde <= u.hasta && hasta >= u.desde; });
      if(empalmada){ showToast("Se empalma con "+empalmada.nombre+" ("+displayFecha(empalmada.desde)+" - "+displayFecha(empalmada.hasta)+")."); return; }
      if(!Array.isArray(g.unidades)) g.unidades = [];
      g.unidades.push({id: uid(), nombre: nombre, desde: desde, hasta: hasta});
      saveState(false); // las unidades no afectan al Excel
      render();
      showToast("Unidad agregada.");
    });
    document.querySelectorAll("[data-quitar-unidad]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        var id = btn.getAttribute("data-quitar-unidad");
        confirmar("¿Quitar esta unidad? Las fechas registradas no se borran.", function(){
          g.unidades = (g.unidades || []).filter(function(u){ return u.id !== id; });
          if(histUnidad === id) histUnidad = "";
          saveState(false);
          render();
          showToast("Unidad quitada.");
        });
      });
    });
    var hd = document.getElementById("histDesde");
    if(hd) hd.addEventListener("change", function(){ histDesde = hd.value; render(); });
    var hh = document.getElementById("histHasta");
    if(hh) hh.addEventListener("change", function(){ histHasta = hh.value; render(); });
    var btnLimpiarFiltro = document.getElementById("btnLimpiarFiltro");
    if(btnLimpiarFiltro) btnLimpiarFiltro.addEventListener("click", function(){ histDesde=""; histHasta=""; histUnidad=""; render(); });
    var btnCambiarFecha = document.getElementById("btnCambiarFecha");
    if(btnCambiarFecha) btnCambiarFecha.addEventListener("click", function(){
      var g = grupoActivo();
      var fechaVieja = document.getElementById("selFechaEditar").value;
      var fechaNueva = document.getElementById("inputFechaEditarNueva").value;
      if(!fechaNueva){ showToast("Elige la nueva fecha en el calendario."); return; }
      if(fechaNueva === fechaVieja){ showToast("Es la misma fecha."); return; }
      if(fechaTieneMarcas(g.id, fechaNueva)){
        showToast("Ya existe el "+displayFecha(fechaNueva)+" con datos. Elimínalo primero si quieres reemplazarlo.");
        return;
      }
      confirmar('¿Cambiar el '+displayFecha(fechaVieja)+' por el '+displayFecha(fechaNueva)+' en "'+g.nombre+'"?', function(){
      state.asistencias[g.id][fechaNueva] = state.asistencias[g.id][fechaVieja] || {};
      delete state.asistencias[g.id][fechaVieja];
      if(state.fechasVacias && state.fechasVacias[g.id] && state.fechasVacias[g.id][fechaVieja]){
        delete state.fechasVacias[g.id][fechaVieja];
        state.fechasVacias[g.id][fechaNueva] = true;
      }
      if(pasarFecha === fechaVieja) pasarFecha = fechaNueva;
      saveState(); render();
      renombrarFechaDelExcelInstitucional(g.nombre, fechaVieja, fechaNueva).then(function(){
        showToast("Fecha actualizada a "+displayFecha(fechaNueva)+".");
        autoSincronizarCambios();
      });
      });
    });
    var btnEliminarFecha = document.getElementById("btnEliminarFecha");
    if(btnEliminarFecha) btnEliminarFecha.addEventListener("click", function(){
      var g = grupoActivo();
      var fecha = document.getElementById("selFechaEditar").value;
      confirmar('¿Eliminar por completo el '+displayFecha(fecha)+' de "'+g.nombre+'"? Se recorrerán las fechas siguientes en el Excel institucional para no dejar columnas vacías. No se puede deshacer.', function(){
      delete state.asistencias[g.id][fecha];
      if(state.fechasVacias && state.fechasVacias[g.id]) delete state.fechasVacias[g.id][fecha];
      saveState(); render();
      eliminarFechaDelExcelInstitucional(g.nombre, fecha).then(function(){
        showToast("Fecha "+displayFecha(fecha)+" eliminada y columnas recorridas en el Excel.");
        autoSincronizarCambios();
      });
      });
    });
    document.querySelectorAll("[data-justificar]").forEach(function(celda){
      celda.addEventListener("click", function(){
        var g = grupoActivo();
        var estId = celda.getAttribute("data-estudiante"), fecha = celda.getAttribute("data-fecha");
        var est = g.estudiantes.find(function(e){ return e.id === estId; });
        var nombre = est ? est.nombre : "";
        if(esJustificada(g.id, fecha, estId)){
          confirmar('¿Quitar el justificante de '+nombre+' del '+displayFecha(fecha)+'? Volverá a contar como falta.', function(){
            delete state.justificantes[g.id][fecha][estId];
            saveState(); render();
            showToast("Justificante quitado.");
            autoSincronizarCambios();
          });
          return;
        }
        pedirTexto('¿Marcar la falta de '+nombre+' del '+displayFecha(fecha)+' como justificada? Contará como asistencia. Motivo (opcional):', function(nota){
          var bucket = ensureJustificantesBucket(g.id, fecha);
          bucket[estId] = {nota: nota.trim()};
          saveState(); render();
          showToast("Falta marcada como justificada.");
          autoSincronizarCambios();
        });
      });
    });
    document.querySelectorAll("[data-quitar-justificante]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        var estId = btn.getAttribute("data-estudiante"), fecha = btn.getAttribute("data-fecha");
        confirmar("¿Quitar este justificante? Volverá a contar como falta.", function(){
          if(state.justificantes[g.id] && state.justificantes[g.id][fecha]) delete state.justificantes[g.id][fecha][estId];
          saveState(); render();
          showToast("Justificante quitado.");
          autoSincronizarCambios();
        });
      });
    });
    var btnCopiarExcel = document.getElementById("btnCopiarExcel");
    if(btnCopiarExcel) btnCopiarExcel.addEventListener("click", function(){
      var rows = construirMatrizActiva();
      copiarPortapapeles(rows.map(function(r){ return r.join("\t"); }).join("\n"));
    });
    var btnDescargarXlsx = document.getElementById("btnDescargarXlsx");
    if(btnDescargarXlsx) btnDescargarXlsx.addEventListener("click", descargarXlsxCompleto);
    var btnActualizarDrive = document.getElementById("btnActualizarDrive");
    if(btnActualizarDrive) btnActualizarDrive.addEventListener("click", function(){
      if(!navigator.onLine){ showToast("Sin conexión: el cambio quedó guardado y se sincronizará después."); return; }
      iniciarGoogleDrive(function(accessToken){
        guardarEnGoogleDrive(accessToken).then(function(ok){ if(ok) marcarSincronizado(); });
      });
    });
  }

  // =========================================================
  // CONEXIÓN
  // =========================================================
  function updateConn(){
    var ind = document.getElementById("connIndicator"), txt = document.getElementById("connText");
    if(!ind || !txt) return;
    var caja = ind.parentNode;
    var enLinea = navigator.onLine;
    caja.classList.toggle("offline", !enLinea);
    caja.classList.toggle("pendiente", enLinea && cambiosPendientes);
    caja.classList.toggle("sincronizando", enLinea && sincronizando);
    if(enLinea && sincronizando){ txt.textContent = "Sincronizando con Drive…"; return; }
    if(!enLinea) txt.textContent = cambiosPendientes ? "Sin conexión · cambios sin guardar en Drive" : "Sin conexión · tus datos se guardan en este equipo";
    else txt.textContent = cambiosPendientes ? "En línea · cambios sin guardar en Drive" : "En línea · todo guardado";
  }
  window.addEventListener("online", function(){ updateConn(); sincronizarPendientes(); });
  window.addEventListener("offline", updateConn);

  // =========================================================
  // INICIO
  // =========================================================
  document.querySelectorAll("nav.tabs button").forEach(function(b){
    b.addEventListener("click", function(){ setTab(b.dataset.tab); });
  });
  if(!state.grupoActivoId && state.grupos.length) state.grupoActivoId = state.grupos[0].id;
  updateConn();
  // Dispara la carga de Google Identity Services desde el arranque (no bloqueante):
  // así, para cuando el usuario llegue a pulsar "Cargar desde Drive", la librería
  // ya suele estar lista. Si falla aquí, se reintentará automáticamente en el
  // primer clic (asegurarGoogleIdentity reutiliza/relanza la carga).
  // Botón con la escuela actual: al pulsarlo se vuelve a la pantalla de inicio.
  (function(){
    var conn = document.querySelector(".conn");
    if(!conn) return;
    var btn = document.createElement("button");
    btn.className = "btn-escuela";
    btn.textContent = escuelaActual.nombre + " ▾";
    btn.title = "Cambiar de escuela";
    btn.addEventListener("click", function(){
      try{ sessionStorage.removeItem(ESCUELA_SESION_KEY); }catch(e){}
      location.reload();
    });
    conn.insertBefore(btn, conn.firstChild);
  })();
  asegurarGoogleIdentity().catch(function(){ /* se reintentará al primer clic */ });
  restaurarCacheLocal().then(function(){
    setTab("pasar");
    sincronizarPendientes();
  });
})();
