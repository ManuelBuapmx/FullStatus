(function(){
  "use strict";

  var STORAGE_KEY = "listaAsistenciaData_v2";
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
        localStorage.setItem("listaAsistenciaCambiosPendientes_v1", "1");
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
        tx.objectStore("archivos").put(buffer, "institucional");
        tx.oncomplete = resolve;
        tx.onerror = function(){ reject(tx.error); };
      });
    });
  }
  function cargarPlantillaLocal(){
    return abrirCache().then(function(db){
      return new Promise(function(resolve, reject){
        var request = db.transaction("archivos").objectStore("archivos").get("institucional");
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
  var pasarViewMode = "card";
  var pasarSegundaLista = null;
  var pasarSegundaIndex = null;
  var histDesde = "";
  var histHasta = "";
  var histUnidad = "";

  var plantillaExcel = null;
  var GOOGLE_CLIENT_ID = "814235047466-9bp0f3j15l5eikmpjasgigol9gnvdelv.apps.googleusercontent.com";
  var GOOGLE_SHEET_ID = "1MyLylWU_26VzjMI8t3JZzDiDkcvsiYTi";
  var DRIVE_FILE_KEY = "listaAsistenciaDriveFileId_v1";
  var GOOGLE_AUTH_KEY = "listaAsistenciaGoogleDriveAuth_v3";
  var driveFileId = localStorage.getItem(DRIVE_FILE_KEY) || GOOGLE_SHEET_ID;
  var driveTokenClient = null;
  var drivePendingAction = null;
  var cambiosPendientes = localStorage.getItem("listaAsistenciaCambiosPendientes_v1") === "1";
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
  function faltasEquivalentes(faltas, retardos){ return faltas + Math.floor(retardos / 3); }

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
    else if(currentTab === "resultados") panel.innerHTML = renderResultados();
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
      }
    }
    html += "</div>";

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
        html += '<ul class="estudiantes">';
        g2.estudiantes.forEach(function(e){
          html += '<li><span>'+esc(e.nombre)+'</span><button class="btn danger" data-del-estudiante="'+esc(e.id)+'">Quitar</button></li>';
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
      var counts = {P:0,A:0,R:0};
      g.estudiantes.forEach(function(e){ var v=bucket[e.id]; if(v) counts[v]++; });
      var faltasTotales = faltasEquivalentes(counts.A, counts.R);
      html += '<div class="card completo">';
      html += "<h3>Lista completa</h3>";
      html += '<p class="helptext">'+esc(g.nombre)+' — '+displayFecha(pasarFecha)+'</p>';
      html += '<div class="resumen-final">';
      html += '<span><b style="color:var(--presente)">'+counts.P+'</b>presentes</span>';
      html += '<span><b style="color:var(--falta)">'+faltasTotales+'</b>faltas equivalentes</span>';
      html += '<span><b style="color:var(--retardo)">'+counts.R+'</b>retardos</span>';
      html += "</div>";
      html += '<p class="helptext">Cada 3 retardos se convierten en 1 falta.</p>';
      html += '<div class="row" style="justify-content:center;">';
      if(counts.A > 0){
        html += '<button class="btn" id="btnSegundoPase">Segundo pase: revisar faltas ('+counts.A+')</button>';
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

  function renderPasarListaCompleta(g, bucket){
    var html = '<div class="card">';
    html += '<table class="registro">';
    g.estudiantes.forEach(function(e, i){
      var v = bucket[e.id] || "";
      html += "<tr><td>"+(i+1)+". "+esc(e.nombre)+"</td>";
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
      var counts = {P:0,A:0,R:0};
      g.estudiantes.forEach(function(e){ var v=bucket[e.id]; if(v) counts[v]++; });
      var faltasTotales = faltasEquivalentes(counts.A, counts.R);
      var htmlFin = '<div class="card completo">';
      htmlFin += "<h3>Segundo pase completo</h3>";
      htmlFin += '<p class="helptext">'+esc(g.nombre)+' — '+displayFecha(pasarFecha)+'</p>';
      htmlFin += '<div class="resumen-final">';
      htmlFin += '<span><b style="color:var(--presente)">'+counts.P+'</b>presentes</span>';
      htmlFin += '<span><b style="color:var(--falta)">'+faltasTotales+'</b>faltas equivalentes</span>';
      htmlFin += '<span><b style="color:var(--retardo)">'+counts.R+'</b>retardos</span>';
      htmlFin += "</div>";
      htmlFin += '<p class="helptext">Cada 3 retardos se convierten en 1 falta.</p>';
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
    html += '<p class="helptext hist-rule">Cada 3 retardos se convierten en 1 falta equivalente. Toca una falta ("0") en la tabla para marcarla como justificada.</p>';

    if(fechas.length === 0 || g.estudiantes.length === 0){
      html += '<p class="empty">Todavía no hay registros de asistencia'+(fechas.length===0?" en este rango de fechas":"")+'.</p></div>';
      html += renderUnidades(g, todasFechas);
      html += renderEditorFechas(g, todasFechas);
      html += renderJustificantes(g);
      return html;
    }

    html += '<div class="table-scroll"><table class="matriz"><thead><tr><th>Estudiante</th>';
    var unidadPrevia = null;
    fechas.forEach(function(f, i){
      var u = unidadDeFecha(g, f);
      var uid_ = u ? u.id : "";
      var inicio = unidades.length && i > 0 && uid_ !== unidadPrevia;
      unidadPrevia = uid_;
      html += '<th'+(inicio?' class="unidad-inicio"':'')+'>'+displayFecha(f)+(unidades.length?'<small class="unidad-etiqueta">'+(u?esc(u.nombre):"Sin unidad")+'</small>':'')+"</th>";
    });
    html += "<th>Total presente</th></tr></thead><tbody>";
    g.estudiantes.forEach(function(e){
      html += '<tr><td title="'+esc(e.nombre)+'">'+esc(e.nombre)+"</td>";
      var totalP = 0;
      var unidadPreviaFila = null;
      fechas.forEach(function(f, i){
        var v = (state.asistencias[g.id][f] || {})[e.id] || "";
        var justificada = v === "A" && esJustificada(g.id, f, e.id);
        if(v==="P" || justificada) totalP++;
        var uf = unidadDeFecha(g, f);
        var ufId = uf ? uf.id : "";
        var inicioCelda = unidades.length && i > 0 && ufId !== unidadPreviaFila;
        unidadPreviaFila = ufId;
        var clase = (justificada ? "mark-J" : (v?"mark-"+v:"mark-empty")) + (inicioCelda ? " unidad-inicio" : "");
        var texto = justificada ? "J" : (v?ESTADO_VALOR_EXPORT[v]:"–");
        var atributos = (v==="A") ? ' data-justificar data-estudiante="'+esc(e.id)+'" data-fecha="'+esc(f)+'" title="Tocar para '+(justificada?"quitar el justificante":"marcar como justificada")+'"' : '';
        html += '<td class="'+clase+'"'+atributos+'>'+texto+"</td>";
      });
      html += "<td><b>"+totalP+"</b></td></tr>";
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
      var row = [e.nombre], totalP = 0;
      fechas.forEach(function(f){
        var v = (state.asistencias[g.id][f] || {})[e.id] || "";
        var justificada = v === "A" && esJustificada(g.id, f, e.id);
        if(v==="P" || justificada) totalP++;
        row.push(justificada ? ESTADO_VALOR_EXPORT.P : (v ? ESTADO_VALOR_EXPORT[v] : ""));
      });
      row.push(totalP);
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
        if(nameCol > 0 && !filaAlumno.getCell(nameCol - 1).value){
          filaAlumno.getCell(nameCol - 1).value = indice + 1;
        }
        var totalP = 0;
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
        });
        if(totalCol !== -1) ws.getRow(rowNumber).getCell(totalCol).value = totalP;
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
        var totalPresent = 0;
        Object.keys(dateColumns).forEach(function(colText){
          var col = Number(colText), estado = ((state.asistencias[grupo.id] || {})[dateColumns[col]] || {})[est.id] || "";
          if(estado === "P") totalPresent++;
          totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(col+1)+(row+1), values:[[estado ? ESTADO_VALOR_EXPORT[estado] : ""]]});
        });
        if(totalCol !== -1) totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(totalCol+1)+(row+1), values:[[totalPresent]]});
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
    localStorage.removeItem("listaAsistenciaCambiosPendientes_v1");
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
  // solo se puede leer iniciando sesión como el administrador (política RLS).
  var SUPABASE_URL = "https://juvqvshcfsrtscvzluaa.supabase.co";
  var SUPABASE_KEY = "sb_publishable_IYf3ISEUGCRGKEM2Bnq1UQ_qFkBHvk5";
  var resToken = null; // solo en memoria; nunca se guarda en disco
  var resDatos = null;
  var resMensaje = "";
  var resCargando = false;
  var resMateria = "", resGrupo = "", resBusqueda = "";

  async function supabaseLogin(correo, contrasena){
    var r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {"apikey": SUPABASE_KEY, "Content-Type": "application/json"},
      body: JSON.stringify({email: correo, password: contrasena})
    });
    if(!r.ok) throw new Error("Correo o contraseña incorrectos.");
    var datos = await r.json();
    return datos.access_token;
  }
  async function supabaseLeer(ruta){
    var r = await fetch(SUPABASE_URL + "/rest/v1/" + ruta, {
      headers: {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + resToken}
    });
    if(r.status === 401 || r.status === 403){ resToken = null; resDatos = null; throw new Error("La sesión expiró. Inicia sesión de nuevo."); }
    if(!r.ok) throw new Error("No se pudieron leer los resultados (HTTP " + r.status + ").");
    return r.json();
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
  function resultadosFiltrados(){
    var q = resBusqueda.trim().toLowerCase();
    return resDatos.filas.filter(function(f){
      if(resMateria && String(f.materia_id) !== resMateria) return false;
      if(resGrupo && f.grupo !== resGrupo) return false;
      if(q && (String(f.nombre||"") + " " + String(f.matricula||"")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function htmlTablaResultados(){
    var filas = resultadosFiltrados();
    if(filas.length === 0) return '<p class="empty">No hay resultados con estos filtros.</p>';
    var html = '<div class="table-scroll"><table class="matriz"><thead><tr><th>Alumno</th><th>Matrícula</th><th>Grupo</th><th>Tipo de examen</th><th>Aciertos</th><th>Fecha</th><th>Reanud.</th></tr></thead><tbody>';
    filas.forEach(function(f){
      var fecha = f.creado_en ? new Date(f.creado_en).toLocaleString("es-MX") : "";
      html += '<tr><td title="'+esc(f.nombre||"")+'">'+esc(f.nombre||"")+'</td><td>'+esc(f.matricula||"")+'</td><td>'+esc(f.grupo||"")+'</td><td>'+esc(resDatos.nombres[f.materia_id]||"")+'</td><td>'+f.correctas+" / "+f.total+'</td><td>'+esc(fecha)+'</td><td title="'+esc(f.motivo||"")+'">'+(f.reanudaciones||0)+'</td></tr>';
    });
    return html + "</tbody></table></div>";
  }
  function renderResultados(){
    var html = '<div class="card"><div class="eyebrow">Solo lectura</div><h2>Resultados de los exámenes</h2>';
    if(!navigator.onLine) return html + '<p class="empty">Sin conexión: los resultados se consultan en línea.</p></div>';
    if(!resToken){
      html += '<p class="helptext" style="margin-top:0;">Inicia sesión con la cuenta de administrador para ver los resultados. La contraseña no se guarda en este equipo.</p>';
      if(resMensaje) html += '<p class="helptext" style="color:var(--falta);">'+esc(resMensaje)+'</p>';
      html += '<div class="row" style="align-items:flex-end;">';
      html += '<div class="field" style="flex:1;min-width:200px;margin-bottom:0;"><label for="resCorreo">Correo</label><input type="email" id="resCorreo" autocomplete="username"></div>';
      html += '<div class="field" style="flex:1;min-width:200px;margin-bottom:0;"><label for="resClave">Contraseña</label><input type="password" id="resClave" autocomplete="current-password"></div>';
      html += '<button class="btn" id="btnResEntrar">Entrar</button></div></div>';
      return html;
    }
    if(resCargando) return html + '<p class="empty">Cargando resultados…</p></div>';
    if(!resDatos){
      if(resMensaje) html += '<p class="helptext" style="color:var(--falta);">'+esc(resMensaje)+'</p>';
      return html + '<button class="btn" id="btnResActualizar">Cargar resultados</button></div>';
    }
    var grupos = [];
    resDatos.filas.forEach(function(f){ if(f.grupo && grupos.indexOf(f.grupo) === -1) grupos.push(f.grupo); });
    grupos.sort();
    html += '<div class="hist-toolbar">';
    html += '<div class="field" style="margin-bottom:0;"><label for="selResMateria">Tipo de examen</label><select id="selResMateria"><option value="">Todos los resultados</option>';
    Object.keys(resDatos.nombres).forEach(function(id){ html += '<option value="'+esc(id)+'" '+(id===resMateria?"selected":"")+'>'+esc(resDatos.nombres[id])+'</option>'; });
    html += '</select></div>';
    html += '<div class="field" style="margin-bottom:0;"><label for="selResGrupo">Grupo</label><select id="selResGrupo"><option value="">Todos</option>';
    grupos.forEach(function(gr){ html += '<option value="'+esc(gr)+'" '+(gr===resGrupo?"selected":"")+'>'+esc(gr)+'</option>'; });
    html += '</select></div>';
    html += '<div class="field" style="margin-bottom:0;flex:1;min-width:180px;"><label for="inputResBuscar">Buscar</label><input type="text" id="inputResBuscar" placeholder="Nombre o matrícula" value="'+esc(resBusqueda)+'"></div>';
    html += '<button class="btn secondary" id="btnResActualizar">Actualizar</button><button class="btn secondary" id="btnResSalir">Cerrar sesión</button></div>';
    html += '<div id="resTabla">' + htmlTablaResultados() + '</div></div>';
    return html;
  }

  // =========================================================
  // EVENTOS
  // =========================================================
  function attachHandlers(){
    var btnResEntrar = document.getElementById("btnResEntrar");
    if(btnResEntrar){
      var entrar = function(){
        var correo = document.getElementById("resCorreo").value.trim();
        var claveInput = document.getElementById("resClave");
        var clave = claveInput.value;
        if(!correo || !clave){ showToast("Escribe tu correo y contraseña."); return; }
        claveInput.value = "";
        supabaseLogin(correo, clave).then(function(token){
          resToken = token; resMensaje = "";
          return cargarResultados();
        }).catch(function(err){
          resMensaje = err.message || "No se pudo iniciar sesión.";
          render();
        });
      };
      btnResEntrar.addEventListener("click", entrar);
      document.getElementById("resClave").addEventListener("keydown", function(ev){ if(ev.key === "Enter") entrar(); });
    }
    var btnResActualizar = document.getElementById("btnResActualizar");
    if(btnResActualizar) btnResActualizar.addEventListener("click", cargarResultados);
    var btnResSalir = document.getElementById("btnResSalir");
    if(btnResSalir) btnResSalir.addEventListener("click", function(){ resToken = null; resDatos = null; resMensaje = ""; render(); });
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
  asegurarGoogleIdentity().catch(function(){ /* se reintentará al primer clic */ });
  restaurarCacheLocal().then(function(){
    setTab("pasar");
    sincronizarPendientes();
  });
})();
